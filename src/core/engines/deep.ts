/**
 * DeepEngine — LLM-powered semantic analysis (Ratchet Pro).
 *
 * Flow:
 *   1. Run ClassicEngine for a fast baseline + finding inventory.
 *   2. Select the most important files for deep analysis (prioritised by
 *      classic findings, then by file risk classification).
 *   3. Batch files into chunks (≤30 files or ≤150 KB per batch).
 *   4. Send each batch to the LLM with category-specific prompts.
 *   5. Parse structured JSON findings from the LLM response.
 *   6. Merge Classic + Deep findings via normalizeFindings() + mergeResults().
 *   7. Return the merged ScanResult.
 */

import type { ScanEngine, ScanEngineOptions } from "../scan-engine.js";
import type { ScanResult } from "../../core/scanner";
import type { Provider } from "../providers/base.js";
import type { Finding } from "../normalize.js";
import { normalizeFindings, mergeResults } from "../normalize.js";
import { ClassicEngine } from "./classic.js";
import { findSourceFiles, readContents } from "../scan-constants.js";
import { CATEGORIES, buildPromptForCategory, type FileContent, type Category } from "./deep-prompts.js";
import { parseDeepFindings } from "./deep-parser.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILES_PER_BATCH = 30;
const MAX_BYTES_PER_BATCH = 150 * 1024; // 150 KB
const CHARS_PER_TOKEN = 4;
const OUTPUT_TOKENS_PER_CATEGORY = 500;

/** Pricing per million tokens (input / output). */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.25, output: 1.25 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 15, output: 75 },
};

/** Models/providers with zero or near-zero marginal cost (flat-rate subscriptions). */
const FREE_MODEL_PATTERNS = ["mistral", "kimi", "glm", "nemotron", "qwen", "deepseek", "devstral", "gpt-oss"];

/** High-risk file patterns — routes, auth, controllers, core services. */
const HIGH_RISK_PATTERNS = [
  /routes?\//i,
  /controllers?\//i,
  /handlers?\//i,
  /middleware\//i,
  /auth/i,
  /security/i,
  /\.route\.[tj]sx?$/,
  /\.controller\.[tj]sx?$/,
  /\.handler\.[tj]sx?$/,
  /\.service\.[tj]sx?$/,
  /\.middleware\.[tj]sx?$/,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPricing(modelHint?: string): { input: number; output: number } {
  if (modelHint) {
    const lower = modelHint.toLowerCase();
    // Check for free/subscription models first
    if (FREE_MODEL_PATTERNS.some(p => lower.includes(p))) {
      return { input: 0, output: 0 };
    }
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (lower.includes(key)) return pricing;
    }
  }
  return MODEL_PRICING["sonnet"]!; // safe default
}

function estimateBatchCost(
  inputChars: number,
  categoriesCount: number,
  pricing: { input: number; output: number }
): number {
  const inputTokens = inputChars / CHARS_PER_TOKEN;
  const outputTokens = OUTPUT_TOKENS_PER_CATEGORY * categoriesCount;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

function isHighRiskFile(filePath: string): boolean {
  return HIGH_RISK_PATTERNS.some(p => p.test(filePath));
}

// ---------------------------------------------------------------------------
// DeepEngine
// ---------------------------------------------------------------------------

export class DeepEngine implements ScanEngine {
  readonly name = "DeepEngine";
  readonly mode = "deep" as const;

  constructor(
    private readonly provider?: Provider,
    private readonly scanProvider?: Provider
  ) {}

  /** Returns the provider to use for deep analysis (scan-specific or fallback to fix provider). */
  private get activeProvider(): Provider | undefined {
    return this.scanProvider ?? this.provider;
  }

  async analyze(cwd: string, options: ScanEngineOptions = {}): Promise<ScanResult> {
    logger.info(
      { cwd, provider: this.provider?.name ?? "none", scanProvider: this.scanProvider?.name },
      "DeepEngine: analyze started"
    );
    if (!this.activeProvider) {
      throw new Error(
        "Deep scanning requires an API key. " +
          "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure a provider in .ratchet.yml"
      );
    }

    // 0. Model compatibility preflight — fail fast if model can't return JSON.
    const preflightPassed = await this.preflightCheck();
    if (!preflightPassed) {
      logger.warn("DeepEngine: preflight failed — falling back to classic engine");
      return new ClassicEngine().analyze(cwd, options);
    }

    // 1. Classic baseline.
    const classic = new ClassicEngine();
    const { result: classicResult, findings: classicFindings } = await classic.analyzeWithFindings(cwd, options);

    logger.info({ classicTotal: classicResult.total }, "DeepEngine: classic baseline complete");

    // 2. Select files for deep analysis.
    const allFiles = options.files ?? findSourceFiles(cwd, { scanProductionOnly: false });
    const contents = readContents(allFiles);
    const selectedFiles = this.selectFiles(allFiles, contents, classicFindings, options);

    if (selectedFiles.length === 0) {
      logger.warn("DeepEngine: no files selected for deep analysis, returning classic result");
      return classicResult;
    }

    // 3. Batch files.
    const batches = this.createBatches(selectedFiles);

    // 4. Analyse each batch with category-specific prompts.
    const pricing = getPricing(this.activeProvider?.name);
    let budgetUsed = 0;
    const budget = options.budget ?? Infinity;
    const deepFindings: Finding[] = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      const batchChars = batch.reduce((s, f) => s + f.content.length, 0);
      const batchCost = estimateBatchCost(batchChars, CATEGORIES.length, pricing);

      if (budgetUsed + batchCost > budget) {
        logger.info(
          { budgetUsed: budgetUsed.toFixed(4), budget, batchIdx },
          "DeepEngine: budget limit reached — stopping early"
        );
        break;
      }

      const batchFindings = await this.analyzeBatch(batch, options);
      deepFindings.push(...batchFindings);
      budgetUsed += batchCost;

      logger.debug(
        { batchIdx, files: batch.length, findingsAdded: batchFindings.length, budgetUsed: budgetUsed.toFixed(4) },
        "DeepEngine: batch complete"
      );
    }

    logger.info(
      `Deep analysis: $${budgetUsed.toFixed(4)} / $${isFinite(budget) ? budget.toFixed(2) : "∞"} budget used`
    );

    if (deepFindings.length === 0) {
      return classicResult;
    }

    // 5. Build a ScanResult from deep findings.
    const { scanResult: deepResult } = normalizeFindings(deepFindings);

    // 6. Merge classic + deep.
    return mergeResults(classicResult, deepResult);
  }

  // ---------------------------------------------------------------------------
  // Preflight — validate model can return structured JSON before full scan
  // ---------------------------------------------------------------------------

  private async preflightCheck(): Promise<boolean> {
    const testPrompt = `Analyse this single-line code for security issues.

const secret = "sk-test-12345";

Return ONLY a valid JSON array of findings:
[{ "ruleId": "SEC-001", "subcategory": "Secrets & env vars", "severity": "high", "file": "test.ts", "line": 1, "message": "Hardcoded secret", "confidence": 0.95, "suggestion": "Use environment variable" }]

If no issues, return: []`;

    logger.info("DeepEngine: running preflight check...");
    const start = Date.now();

    try {
      const response = await this.activeProvider!.sendMessage(testPrompt, { maxTokens: 512 });
      const findings = parseDeepFindings(response, "Security");
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (findings.length === 0) {
        // The model returned something but it didn't parse into findings.
        // This is a strong signal the model can't follow JSON instructions.
        logger.warn(
          { provider: this.activeProvider!.name, elapsed, responsePreview: response.slice(0, 200) },
          "DeepEngine: preflight returned 0 findings — model may not support structured JSON output"
        );
        logger.warn(
          { provider: this.activeProvider!.name, elapsed },
          "DeepEngine: preflight returned 0 findings — model may not support structured JSON. Consider --scan-model kimi-k2:1t"
        );
        // Don't abort — the extractJson fallback chain may still recover some findings.
        // But warn the user so they know why coverage is low.
      } else {
        logger.info({ findings: findings.length, elapsed: `${elapsed}s` }, "DeepEngine: preflight OK");
      }
      return true;
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      // Network/auth errors: log warning and signal caller to fall back to classic engine.
      logger.warn(
        { provider: this.activeProvider!.name, elapsed, err: err instanceof Error ? err.message : String(err) },
        "DeepEngine: preflight failed — falling back to classic engine. Check your API key and network connection."
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // File selection
  // ---------------------------------------------------------------------------

  private selectFiles(
    allFiles: string[],
    contents: Map<string, string>,
    classicFindings: Finding[],
    options: ScanEngineOptions
  ): FileContent[] {
    const maxFiles = options.maxFiles ?? 50;

    // Build a set of files already flagged by classic analysis.
    const classicFlaggedFiles = new Set(classicFindings.map(f => f.file).filter((f): f is string => f != null));

    // Score each file: higher = higher priority.
    const scored: Array<{ path: string; score: number }> = allFiles.map(filePath => {
      let score = 0;
      if (classicFlaggedFiles.has(filePath)) score += 3;
      if (isHighRiskFile(filePath)) score += 2;
      // Penalise test files (still valid to scan but lower priority).
      if (/\.(test|spec)\.[tj]sx?$/.test(filePath) || /__tests__/.test(filePath)) score -= 1;
      return { path: filePath, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxFiles).map(({ path }) => ({
      path,
      content: contents.get(path) ?? "",
    }));
  }

  // ---------------------------------------------------------------------------
  // Batching
  // ---------------------------------------------------------------------------

  private createBatches(files: FileContent[]): FileContent[][] {
    const batches: FileContent[][] = [];
    let current: FileContent[] = [];
    let currentBytes = 0;

    for (const file of files) {
      const fileBytes = Buffer.byteLength(file.content, "utf8");

      if (
        current.length > 0 &&
        (current.length >= MAX_FILES_PER_BATCH || currentBytes + fileBytes > MAX_BYTES_PER_BATCH)
      ) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }

      current.push(file);
      currentBytes += fileBytes;
    }

    if (current.length > 0) batches.push(current);
    return batches;
  }

  // ---------------------------------------------------------------------------
  // Batch analysis
  // ---------------------------------------------------------------------------

  private async analyzeBatch(batch: FileContent[], options: ScanEngineOptions): Promise<Finding[]> {
    const findings: Finding[] = [];
    const categories = options.categories
      ? (CATEGORIES.filter(c => options.categories!.includes(c)) as Category[])
      : ([...CATEGORIES] as Category[]);

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i]!;
      try {
        const start = Date.now();
        logger.info(
          { batch: batch.length, category, progress: `${i + 1}/${categories.length}` },
          "DeepEngine: analyzing category"
        );
        const prompt = buildPromptForCategory(category, batch);
        const response = await this.activeProvider!.sendMessage(prompt, { maxTokens: 2048 });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const parsed = parseDeepFindings(response, category);
        findings.push(...parsed);
        logger.info({ findings: parsed.length, elapsed: `${elapsed}s`, category }, "DeepEngine: category complete");
      } catch (err) {
        logger.warn({ err, category }, "DeepEngine: LLM call failed for category — skipping");
      }
    }

    return findings;
  }
}
