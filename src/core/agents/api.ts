import type { Target, BuildResult, HardenPhase } from '../../types.js';
import type { Agent, AgentOptions } from './base.js';
import type { Provider, ProviderOptions } from '../providers/base.js';
import type { IssueTask } from '../issue-backlog.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../../lib/logger.js';
import { microCompact, shouldMicroCompact, DEFAULT_CONTEXT_WINDOW_CHARS } from '../micro-compact.js';

export interface APIAgentConfig extends AgentOptions {
  provider: Provider;
  providerOptions?: ProviderOptions;
}

export class APIAgent implements Agent {
  private provider: Provider;
  private providerOptions: ProviderOptions;
  /** Tracks whether current click is issue-driven (single-shot prompt) */
  private _issueDrivenClick = false;
  /** Override cwd for GitNexus lookups (worktrees don't have .gitnexus) */
  gitnexusCwd?: string;
  /** Strategy context injected into prompts (set by engine before each run) */
  strategyContext?: string;
  /** Click guards — injected by engine before each click to constrain output size */
  clickGuards?: { maxFiles: number; maxLines: number };
  /** Source roots for resolving agent-guessed paths (e.g. ['client/src/', 'server/']) */
  sourceRoots?: string[];
  /** Repo context string injected into prompts to orient agents in unfamiliar repos */
  repoContext?: string;
  /** Summary of prior click rounds — injected by context-manager before each API call */
  priorRoundsContext?: string;

  constructor(config: APIAgentConfig) {
    this.provider = config.provider;
    this.providerOptions = config.providerOptions ?? {};
  }

  async analyze(context: string, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    if (issues && issues.length > 0) {
      this._issueDrivenClick = true;
      // Dynamic import avoids circular dep (shell.ts already imports from api.ts)
      const { buildIssuePlanPrompt } = await import('./shell.js');
      return buildIssuePlanPrompt(context, issues, this.gitnexusCwd ?? process.cwd(), this.strategyContext, this.repoContext, this.priorRoundsContext);
    }
    this._issueDrivenClick = false;
    const prompt = hardenPhase === 'harden:tests'
      ? buildHardenAnalyzePrompt(context)
      : buildAnalyzePrompt(context);
    return this.provider.sendMessage(prompt, this.providerOptions);
  }

  async propose(analysis: string, target: Target, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    // When we already have a plan (issues path), analysis IS the proposal — skip the extra call
    if (issues && issues.length > 0) {
      return analysis;
    }
    const prompt = hardenPhase === 'harden:tests'
      ? buildHardenProposePrompt(analysis, target)
      : buildProposePrompt(analysis, target);
    return this.provider.sendMessage(prompt, this.providerOptions);
  }

  async build(proposal: string, cwd: string): Promise<BuildResult> {
    try {
      // Issue-driven clicks: the proposal IS the single-shot prompt — send it directly
      // without wrapping in buildBuildPrompt (which would double-wrap instructions)
      const basePrompt = this._issueDrivenClick ? proposal : buildBuildPrompt(proposal);

      // Inject actual file contents so the LLM can see the code it needs to modify.
      // For search/replace to work, model needs EXACT content of target files.
      // maxFiles defaults to 1 for backward compat when no clickGuards are set.
      const rawTargetFiles = extractTargetFiles(basePrompt, cwd);
      // Resolve source roots: if a literal path doesn't exist, try prepending each source root
      const targetFiles: string[] = [];
      for (const rawPath of rawTargetFiles) {
        targetFiles.push(await resolveWithSourceRoots(rawPath, cwd, this.sourceRoots));
      }

      const maxFilesToEdit = this.clickGuards?.maxFiles ?? 1;
      let fileContents = '';
      let primaryFileContent: string | null = null;
      // Extract line number hint from prompt for windowed injection
      const lineHint = extractLineHint(basePrompt);
      for (const filePath of targetFiles.slice(0, maxFilesToEdit)) {
        try {
          const absPath = join(cwd, filePath);
          const content = await readFile(absPath, 'utf-8');
          if (!primaryFileContent) primaryFileContent = content;
          const window = extractLineWindow(content, lineHint, 75);
          fileContents += `\n--- FILE: ${filePath}${window.note} ---\n${window.text}\n--- END FILE ---\n`;
        } catch {
          // File doesn't exist yet or unreadable — skip
        }
      }

      // Find up to 4 related files for read-only context (test file + imports)
      const readOnlyParts: string[] = [];
      const primaryFile = targetFiles[0];
      if (primaryFile && primaryFileContent) {
        // 1. Check for a matching test file
        for (const tc of buildTestCandidates(primaryFile)) {
          try {
            const content = await readFile(join(cwd, tc), 'utf-8');
            const preview = content.split('\n').slice(0, 60).join('\n');
            readOnlyParts.push(`\n--- READ-ONLY: ${tc} ---\n${preview}\n--- END READ-ONLY ---\n`);
            break;
          } catch { /* not found */ }
        }
        // 2. Check for imported files
        for (const ip of extractRelativeImports(primaryFileContent, primaryFile)) {
          if (readOnlyParts.length >= 4) break;
          if (targetFiles.includes(ip)) continue; // already in editable set
          try {
            const content = await readFile(join(cwd, ip), 'utf-8');
            const preview = content.split('\n').slice(0, 60).join('\n');
            readOnlyParts.push(`\n--- READ-ONLY: ${ip} ---\n${preview}\n--- END READ-ONLY ---\n`);
          } catch { /* not found */ }
        }
      }

      const readOnlyContext = readOnlyParts.join('');
      let prompt = buildAPIBuildPrompt(basePrompt, fileContents, this.clickGuards, readOnlyContext, this.repoContext);

      // Micro-compaction: if prompt exceeds 80% of context window estimate, trim it down
      if (shouldMicroCompact(prompt.length, DEFAULT_CONTEXT_WINDOW_CHARS)) {
        const before = prompt.length;
        prompt = microCompact(prompt, Math.floor(DEFAULT_CONTEXT_WINDOW_CHARS * 0.8));
        if (prompt.length < before) {
          logger.debug(
            { before, after: prompt.length, saved: before - prompt.length },
            '[APIAgent] Micro-compacted prompt',
          );
        }
      }

      const output = await this.provider.sendMessage(prompt, this.providerOptions);

      // Parse structured file blocks from LLM response and write to disk
      const { written: writtenFiles, searchMisses } = await applyFileBlocks(output, cwd);
      // Also check for MODIFIED: lines as fallback
      const declaredFiles = parseModifiedFiles(output);
      const allModified = [...new Set([...writtenFiles, ...declaredFiles])];

      if (writtenFiles.length > 0) {
        logger.info(`[APIAgent] Wrote ${writtenFiles.length} file(s) to disk: ${writtenFiles.join(', ')}`);
      }

      // Pre-flight failure: EDIT blocks existed but all search texts were not found in files.
      // Return failure so the click doesn't silently waste itself as a no-op.
      if (writtenFiles.length === 0 && searchMisses > 0) {
        const msg = `[APIAgent] ${searchMisses} EDIT block(s) failed — search text not found in target file(s). Click skipped.`;
        logger.warn(msg);
        return { success: false, output, filesModified: [], error: msg };
      }

      return { success: true, output, filesModified: allModified };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, output: error.message ?? '', filesModified: [], error: error.message };
    }
  }
}

export function buildAnalyzePrompt(context: string): string {
  return (
    `You are a code improvement assistant. Analyze the following target and ` +
    `provide a concise analysis of what can be improved.\n\n` +
    `${context}\n\n` +
    `Focus on: code quality, error handling, performance, maintainability. ` +
    `Be specific and actionable. List the top 3 improvement opportunities.`
  );
}

export function buildProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a code improvement assistant. Based on the following analysis, ` +
    `propose ONE specific, focused improvement.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific change to make (one sentence)\n` +
    `2. Which file(s) to modify\n` +
    `3. The exact code change\n\n` +
    `Keep it minimal — one change, one commit.`
  );
}

export function buildHardenAnalyzePrompt(context: string): string {
  return (
    `You are a test-writing assistant. Analyze the following target and identify what test coverage is missing.\n\n` +
    `${context}\n\n` +
    `Focus on: untested functions, uncovered edge cases, missing error condition tests. ` +
    `Be specific and actionable. List the top 3 missing test scenarios.`
  );
}

export function buildHardenProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a test-writing assistant. Based on the following analysis, ` +
    `propose ONE specific set of tests to write.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific test(s) to write (one sentence)\n` +
    `2. Which test file to create or modify\n` +
    `3. The exact test code\n\n` +
    `Write comprehensive tests for the target code. Focus on correctness, not style.`
  );
}

function buildBuildPrompt(proposal: string): string {
  return (
    `You are a code improvement assistant. Implement the following proposed change.\n\n` +
    `${proposal}\n\n` +
    `Make ONLY the described change. Do not refactor unrelated code. ` +
    `After making the change, output the list of modified files in this format:\n` +
    `MODIFIED: <filepath>\n` +
    `(one line per file)`
  );
}

/**
 * Enhanced build prompt for API agents that don't have filesystem access.
 * Uses search-and-replace format instead of full-file output to keep diffs small.
 */
function buildAPIBuildPrompt(
  basePrompt: string,
  fileContents: string,
  guards?: { maxFiles?: number; maxLines?: number },
  readOnlyContext?: string,
  repoContext?: string,
): string {
  const maxFiles = guards?.maxFiles ?? 1;   // default 1 for backward compat
  const maxLines = guards?.maxLines ?? 20;  // default 20 for backward compat
  return (
    (repoContext ? `${repoContext}\n\n` : '') +
    `TASK: ${basePrompt}\n\n` +
    (fileContents ? `FILE CONTENTS (editable — use SEARCH/REPLACE to modify):\n${fileContents}\n\n` : '') +
    (readOnlyContext ? `READ-ONLY CONTEXT (do NOT edit these — for reference only):\n${readOnlyContext}\n\n` : '') +
    `PRE-EXECUTION CHECKLIST (MUST confirm verbally BEFORE outputting changes):\n` +
    `1. "I will modify at most ${maxFiles} file(s)."\n` +
    `2. "I will change at most ${maxLines} total lines."\n` +
    `3. "My target file is: <path from FILE CONTENTS above>"\n` +
    `4. "I will copy-paste EXACTLY from FILE CONTENTS for every SEARCH block."\n` +
    `5. "I will output NO prose, analysis, or explanation — only SEARCH/REPLACE blocks."\n\n` +
    `SEARCH BLOCK RULES:\n` +
    `- Copy EXACTLY 5-10 consecutive lines from FILE CONTENTS above\n` +
    `- Include the code to change PLUS 2-3 lines of context on each side\n` +
    `- Do NOT include the \`<<<<<<<< SEARCH\` marker inside your search block\n` +
    `- Do NOT include the \`=======\` or \`>>>>>>>> REPLACE\` markers inside either block\n` +
    `- Verify your SEARCH block appears VERBATIM in FILE CONTENTS above before outputting\n` +
    `- If unsure, use MORE context lines (8-10) rather than fewer\n\n` +
    `OUTPUT FORMAT (output NOTHING except this):\n\n` +
    `EDIT: <path from FILE CONTENTS above — must match exactly>\n` +
    `<<<<<<< SEARCH\n` +
    `[exact consecutive lines copied from FILE CONTENTS — 5-10 lines minimum]\n` +
    `=======\n` +
    `[replacement lines]\n` +
    `>>>>>>> REPLACE\n\n` +
    `MODIFIED: <filepath>\n\n` +
    `TERMINAL RULES:\n` +
    `- Do NOT output anything before the first EDIT: line\n` +
    `- Do NOT output anything after the last MODIFIED: line\n` +
    `- After MODIFIED:, output NOTHING else — no closing braces, no explanations, no JSON\n` +
    `- Do NOT reformat, restyle, or change whitespace outside the fix\n`
  );
}

/**
 * Extract a line number hint from the prompt (e.g. ":42:", "line 42", "(line 42)").
 * Returns null if none found.
 */
function extractLineHint(prompt: string): number | null {
  // "line 42" or "line: 42"
  const lineMatch = prompt.match(/\bline[:\s]+(\d+)/i);
  if (lineMatch) return parseInt(lineMatch[1], 10);
  // ":42:" file:line:col pattern
  const colonMatch = prompt.match(/:(\d{1,5}):/);
  if (colonMatch) return parseInt(colonMatch[1], 10);
  return null;
}

/**
 * Extract a window of ~windowSize lines centered on the target line.
 * Falls back to first windowSize lines when no line hint is provided.
 */
function extractLineWindow(content: string, lineHint: number | null, windowSize: number): { text: string; note: string } {
  const lines = content.split('\n');
  if (lineHint === null || lineHint <= 0) {
    // No hint — use first windowSize lines
    const sliced = lines.slice(0, windowSize);
    const note = lines.length > windowSize ? ` (lines 1-${windowSize} of ${lines.length})` : '';
    return { text: sliced.join('\n'), note };
  }
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, lineHint - 1 - half);
  const end = Math.min(lines.length, start + windowSize);
  const sliced = lines.slice(start, end);
  const note = ` (lines ${start + 1}-${end} of ${lines.length}, centered on line ${lineHint})`;
  return { text: sliced.join('\n'), note };
}

/**
 * Resolve a file path against known source roots.
 * If the literal path exists, returns it unchanged.
 * Otherwise, tries prepending each source root until a match is found.
 */
async function resolveWithSourceRoots(filePath: string, cwd: string, sourceRoots?: string[]): Promise<string> {
  try {
    await readFile(join(cwd, filePath));
    return filePath;
  } catch {
    for (const root of (sourceRoots ?? [])) {
      const prefix = root.endsWith('/') ? root : root + '/';
      // Try 1: direct prepend (e.g. 'server/' + 'routes/foo.ts')
      const direct = prefix + filePath;
      try {
        await readFile(join(cwd, direct));
        return direct;
      } catch { /* not found */ }
      // Try 2: strip first path segment from filePath when it overlaps with the source root
      // e.g. sourceRoot='client/src/', filePath='src/pages/X.tsx' → 'client/src/pages/X.tsx'
      const stripped = filePath.replace(/^[^/]+\//, '');
      if (stripped !== filePath) {
        const withStripped = prefix + stripped;
        try {
          await readFile(join(cwd, withStripped));
          return withStripped;
        } catch { /* not found */ }
      }
    }
    return filePath; // fall back to original
  }
}

/**
 * Build test file path candidates for a given source file.
 * foo.ts → foo.test.ts, foo.spec.ts, __tests__/foo.test.ts, __tests__/foo.spec.ts
 */
export function buildTestCandidates(filePath: string): string[] {
  const extMatch = filePath.match(/\.(ts|tsx|js|jsx|mjs|cjs)$/);
  if (!extMatch) return [];
  const ext = extMatch[1];
  const base = filePath.slice(0, filePath.length - ext.length - 1);
  const dir = dirname(filePath);
  const filename = base.slice(dir === '.' ? 0 : dir.length + 1);
  const dirPrefix = dir === '.' ? '' : dir + '/';
  return [
    `${base}.test.${ext}`,
    `${base}.spec.${ext}`,
    `${dirPrefix}__tests__/${filename}.test.${ext}`,
    `${dirPrefix}__tests__/${filename}.spec.${ext}`,
  ];
}

/**
 * Extract relative import paths from file content.
 * Only follows relative imports (starting with '.') — skips node_modules.
 */
export function extractRelativeImports(content: string, filePath: string): string[] {
  const dir = dirname(filePath);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    if (results.length >= 8) break; // cap candidates to avoid over-reading
    const importPath = match[1];
    // If the import already has a source extension, use it directly (+ .ts swap for .js)
    const tryExts = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(importPath)
      ? [importPath, importPath.replace(/\.js$/, '.ts'), importPath.replace(/\.jsx$/, '.tsx')]
      : [`${importPath}.ts`, `${importPath}.tsx`, `${importPath}.js`, `${importPath}/index.ts`, `${importPath}/index.js`];

    for (const candidate of tryExts) {
      const resolved = join(dir, candidate).replace(/\\/g, '/');
      if (seen.has(resolved)) {
        break; // already included an equivalent import — skip whole import
      }
      seen.add(resolved);
      results.push(resolved);
      break;
    }
  }
  return results;
}

/**
 * Extract target file paths from the prompt text.
 * Looks for common patterns: "Path: ./foo.ts", file paths in issue descriptions,
 * "FILES TO FIX:" blocks, and explicit file references.
 */
function extractTargetFiles(prompt: string, _cwd: string): string[] {
  const files = new Set<string>();

  // Pattern 1: "Path: ./server/routes/groups.ts"
  const pathMatches = prompt.matchAll(/^Path:\s*(.+)$/gm);
  for (const m of pathMatches) {
    files.add(m[1].trim().replace(/^\.\//, ''));
  }

  // Pattern 2: "FILES TO FIX:" block with "  - path" lines
  const filesBlock = prompt.match(/FILES TO FIX[^:]*:\n((?:\s+-\s+.+\n?)+)/);
  if (filesBlock) {
    const lines = filesBlock[1].split('\n');
    for (const line of lines) {
      const m = line.match(/^\s+-\s+(.+)/);
      if (m) files.add(m[1].trim());
    }
  }

  // Pattern 3: References to .ts/.js/.tsx/.jsx/.py files in issue descriptions
  const fileRefMatches = prompt.matchAll(/(?:^|\s)((?:src|lib|server|client|app|test|tests|packages)\/[\w/.-]+\.(?:ts|tsx|js|jsx|py|go|rs))/gm);
  for (const m of fileRefMatches) {
    files.add(m[1].trim());
  }

  return [...files];
}

/**
 * Normalize a file path: strip cwd prefix, validate safety.
 * Returns null if path is unsafe.
 */
function normalizePath(filePath: string, cwd: string): string | null {
  let p = filePath.trim();
  if (p.startsWith(cwd + '/') || p.startsWith(cwd + '\\')) {
    p = p.slice(cwd.length + 1);
  }
  if (p.startsWith('/') || p.includes('..') || p.startsWith('~')) {
    logger.warn(`[APIAgent] Skipping unsafe path: ${p}`);
    return null;
  }
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|php|rb|vue|svelte|json|yml|yaml|toml|md|css|scss|html)$/.test(p)) {
    logger.warn(`[APIAgent] Skipping non-source file: ${p}`);
    return null;
  }
  return p;
}

/**
 * Parse EDIT search/replace blocks from LLM output and apply to files on disk.
 * Falls back to FILE: full-file blocks if no EDIT blocks found.
 * Returns { written: paths successfully written, searchMisses: count of EDIT blocks where
 * search text was not found in the target file }. A non-zero searchMisses with zero written
 * indicates the LLM output contained edits but none could be applied (pre-flight failure).
 */
export async function applyFileBlocks(output: string, cwd: string): Promise<{ written: string[]; searchMisses: number }> {
  const written: string[] = [];

  // Try EDIT: search/replace format first
  const editRegex = /EDIT:\s*([^\n]+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let editMatch: RegExpExecArray | null;
  const editsApplied = new Set<string>();
  let searchMisses = 0;

  while ((editMatch = editRegex.exec(output)) !== null) {
    const filePath = normalizePath(editMatch[1], cwd);
    if (!filePath) continue;

    const searchText = editMatch[2];
    const replaceText = editMatch[3];

    // Pre-flight: verify the search text exists in the target file before attempting edit.
    // If not found, skip this edit and count as a miss instead of silently wasting a click.
    try {
      const absPath = join(cwd, filePath);
      const content = await readFile(absPath, 'utf-8');

      if (content.includes(searchText)) {
        const newContent = content.replace(searchText, replaceText);
        await writeFile(absPath, newContent, 'utf-8');
        editsApplied.add(filePath);
        logger.debug(`[APIAgent] Applied search/replace edit to ${filePath}`);
      } else {
        // Try with normalized whitespace (trim trailing spaces per line)
        const normalizedContent = content.split('\n').map(l => l.trimEnd()).join('\n');
        const normalizedSearch = searchText.split('\n').map(l => l.trimEnd()).join('\n');
        if (normalizedContent.includes(normalizedSearch)) {
          // Find the original position and replace
          const lines = content.split('\n');
          const searchLines = searchText.split('\n');
          const replaceLines = replaceText.split('\n');
          let found = false;
          for (let i = 0; i <= lines.length - searchLines.length; i++) {
            const slice = lines.slice(i, i + searchLines.length);
            if (slice.map(l => l.trimEnd()).join('\n') === normalizedSearch) {
              lines.splice(i, searchLines.length, ...replaceLines);
              await writeFile(absPath, lines.join('\n'), 'utf-8');
              editsApplied.add(filePath);
              found = true;
              logger.debug(`[APIAgent] Applied whitespace-normalized edit to ${filePath}`);
              break;
            }
          }
          if (!found) {
            searchMisses++;
            logger.warn(`[APIAgent] Search text not found in ${filePath} (${searchText.length} chars) — skipping edit`);
          }
        } else {
          searchMisses++;
          logger.warn(`[APIAgent] Search text not found in ${filePath} (${searchText.length} chars) — skipping edit`);
        }
      }
    } catch (err) {
      logger.warn({ err }, `[APIAgent] Failed to apply edit to ${filePath}`);
    }
  }

  if (editsApplied.size > 0) {
    written.push(...editsApplied);
    return { written, searchMisses };
  }

  // Fallback: FILE: <path> + code block format — only for NEW files (not existing ones)
  // This prevents full-file rewrites that blow guard limits
  const blockRegex = /FILE:\s*([^\n]+)\n\s*```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(output)) !== null) {
    const filePath = normalizePath(match[1], cwd);
    if (!filePath) continue;
    const content = match[2];

    try {
      const absPath = join(cwd, filePath);
      // Only write via FILE: format if the file doesn't exist yet (new file creation)
      // For existing files, search/replace should have been used
      try {
        await readFile(absPath);
        // File exists — skip full-file write to avoid blown guards
        logger.warn(`[APIAgent] Skipping full-file write to existing file ${filePath} — use EDIT format`);
        continue;
      } catch {
        // File doesn't exist — safe to create
      }
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, 'utf-8');
      written.push(filePath);
      logger.debug(`[APIAgent] Created new file ${filePath} (${content.length} bytes)`);
    } catch (err) {
      logger.warn({ err }, `[APIAgent] Failed to write ${filePath}`);
    }
  }

  return { written, searchMisses };
}

export function parseModifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^MODIFIED:\s*(.+)$/);
    if (match) files.push(match[1].trim());
  }
  return files;
}

export function createAPIAgent(config: APIAgentConfig): APIAgent {
  return new APIAgent(config);
}
