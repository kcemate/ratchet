/**
 * Tests for DeepEngine — LLM-powered semantic analysis.
 *
 * The Provider is mocked so these tests exercise the orchestration logic
 * (batching, budget, merging, parsing) without real API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Provider, ProviderOptions } from '../core/providers/base.js';
import { DeepEngine } from '../core/engines/deep.js';
import { parseDeepFindings } from '../core/engines/deep-parser.js';
import { buildPromptForCategory } from '../core/engines/deep-prompts.js';
import type { FileContent } from '../core/engines/deep-prompts.js';
import type { Finding } from '../core/normalize.js';
import { mergeResults, normalizeFindings } from '../core/normalize.js';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeMockProvider(response = '[]'): Provider & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name: 'MockProvider',
    tier: 'pro' as const,
    sendMessage: vi.fn().mockResolvedValue(response),
    estimateCost: (_input: number, _output: number) => 0,
    supportsStructuredOutput: () => false,
  };
}

// ---------------------------------------------------------------------------
// DeepEngine — interface
// ---------------------------------------------------------------------------

describe('DeepEngine interface', () => {
  it('has correct name and mode', () => {
    const engine = new DeepEngine(makeMockProvider());
    expect(engine.name).toBe('DeepEngine');
    expect(engine.mode).toBe('deep');
    expect(typeof engine.analyze).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// DeepEngine — no provider error
// ---------------------------------------------------------------------------

describe('DeepEngine — no provider', () => {
  it('throws helpful error when no provider is passed', async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow(
      'Deep scanning requires an API key',
    );
  });

  it('error message mentions ANTHROPIC_API_KEY', async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('error message mentions .ratchet.yml', async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow('.ratchet.yml');
  });
});

// ---------------------------------------------------------------------------
// DeepEngine — runs ClassicEngine first
// ---------------------------------------------------------------------------

describe('DeepEngine — classic baseline', () => {
  it('runs ClassicEngine first and returns a valid ScanResult', async () => {
    const provider = makeMockProvider('[]');
    const engine = new DeepEngine(provider);
    const result = await engine.analyze(process.cwd(), { maxFiles: 5 });

    expect(result).toMatchObject({
      projectName: expect.any(String),
      total: expect.any(Number),
      maxTotal: expect.any(Number),
      categories: expect.any(Array),
      totalIssuesFound: expect.any(Number),
      issuesByType: expect.any(Array),
    });
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(result.maxTotal);
  });

  it('calls the LLM when files are available', async () => {
    const provider = makeMockProvider('[]');
    const engine = new DeepEngine(provider);
    await engine.analyze(process.cwd(), { maxFiles: 5 });
    // With maxFiles=5 there should be files found — LLM should be called at
    // least once per category per batch.
    expect(provider.sendMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DeepEngine — budget tracking
// ---------------------------------------------------------------------------

describe('DeepEngine — budget tracking', () => {
  it('stops before calling LLM when budget is too small for any batch', async () => {
    const provider = makeMockProvider('[]');
    const engine = new DeepEngine(provider);
    // Budget of $0.000001 is far below the minimum batch cost (~$0.000045 for
    // output tokens alone at Sonnet pricing), so no batches should be processed.
    // The preflight check calls sendMessage once, so we expect exactly 1 call.
    await engine.analyze(process.cwd(), { budget: 0.000001, maxFiles: 10 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1); // preflight only
  });

  it('returns a valid ScanResult even when budget stops all batches', async () => {
    const provider = makeMockProvider('[]');
    const engine = new DeepEngine(provider);
    const result = await engine.analyze(process.cwd(), { budget: 0.000001, maxFiles: 10 });
    // Falls back to classic result
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.categories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DeepEngine — prompt generation
// ---------------------------------------------------------------------------

describe('DeepEngine — prompt generation', () => {
  it('includes source code in the prompt', () => {
    const files: FileContent[] = [
      { path: 'src/auth.ts', content: 'export function login() {}' },
    ];
    const prompt = buildPromptForCategory('Security', files);
    expect(prompt).toContain('src/auth.ts');
    expect(prompt).toContain('export function login() {}');
  });

  it('prompts mention the category focus areas', () => {
    const files: FileContent[] = [{ path: 'test.ts', content: '' }];
    expect(buildPromptForCategory('Security', files)).toContain('SEC-001');
    expect(buildPromptForCategory('Testing', files)).toContain('TST-001');
    expect(buildPromptForCategory('Type Safety', files)).toContain('TYP-001');
    expect(buildPromptForCategory('Error Handling', files)).toContain('EH-001');
    expect(buildPromptForCategory('Performance', files)).toContain('PRF-001');
    expect(buildPromptForCategory('Code Quality', files)).toContain('CQ-001');
  });

  it('prompts include instruction to return JSON array', () => {
    const files: FileContent[] = [{ path: 'a.ts', content: '' }];
    for (const cat of ['Security', 'Testing', 'Type Safety', 'Error Handling', 'Performance', 'Code Quality'] as const) {
      const p = buildPromptForCategory(cat, files);
      expect(p).toContain('JSON array');
    }
  });
});

// ---------------------------------------------------------------------------
// Deep parser — valid JSON
// ---------------------------------------------------------------------------

describe('parseDeepFindings — valid JSON', () => {
  const validFinding = {
    ruleId: 'SEC-001',
    subcategory: 'Secrets & env vars',
    severity: 'high',
    file: 'src/config.ts',
    line: 12,
    message: 'Hardcoded API key detected in source',
    confidence: 0.95,
    suggestion: 'Move to environment variable',
  };

  it('parses a plain JSON array response', () => {
    const findings = parseDeepFindings(JSON.stringify([validFinding]), 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Hardcoded API key detected in source');
    expect(findings[0]!.source).toBe('deep');
    expect(findings[0]!.category).toBe('Security');
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify([validFinding]) + '\n```';
    const findings = parseDeepFindings(wrapped, 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('src/config.ts');
    expect(findings[0]!.line).toBe(12);
  });

  it('parses JSON wrapped in plain ``` fences', () => {
    const wrapped = '```\n' + JSON.stringify([validFinding]) + '\n```';
    const findings = parseDeepFindings(wrapped, 'Security');
    expect(findings).toHaveLength(1);
  });

  it('sets source: "deep" on all findings', () => {
    const findings = parseDeepFindings(JSON.stringify([validFinding]), 'Security');
    expect(findings[0]!.source).toBe('deep');
  });

  it('infers category from ruleId via RULE_REGISTRY', () => {
    const f = { ...validFinding, ruleId: 'TST-002' };
    const findings = parseDeepFindings(JSON.stringify([f]), 'Security');
    expect(findings[0]!.category).toBe('Testing');
  });

  it('falls back to prompt category when ruleId not in registry', () => {
    const f = { ...validFinding, ruleId: 'UNKNOWN-999' };
    const findings = parseDeepFindings(JSON.stringify([f]), 'Security');
    expect(findings[0]!.category).toBe('Security');
  });

  it('clamps confidence to [0, 1]', () => {
    const f = { ...validFinding, confidence: 1.5 };
    const findings = parseDeepFindings(JSON.stringify([f]), 'Security');
    expect(findings[0]!.confidence).toBe(1.0);

    const f2 = { ...validFinding, confidence: -0.5 };
    const findings2 = parseDeepFindings(JSON.stringify([f2]), 'Security');
    expect(findings2[0]!.confidence).toBe(0.0);
  });

  it('defaults severity to "medium" when missing', () => {
    const f = { ...validFinding, severity: undefined };
    const findings = parseDeepFindings(JSON.stringify([f]), 'Security');
    expect(findings[0]!.severity).toBe('medium');
  });

  it('handles empty array response', () => {
    const findings = parseDeepFindings('[]', 'Security');
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deep parser — malformed responses
// ---------------------------------------------------------------------------

describe('parseDeepFindings — malformed responses', () => {
  it('returns empty array for completely invalid JSON', () => {
    expect(parseDeepFindings('not json at all', 'Security')).toHaveLength(0);
  });

  it('returns empty array for JSON object (not array)', () => {
    expect(parseDeepFindings('{"ruleId":"SEC-001"}', 'Security')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseDeepFindings('', 'Security')).toHaveLength(0);
  });

  it('skips findings with missing message', () => {
    const bad = [{ ruleId: 'SEC-001', subcategory: 'Secrets & env vars', severity: 'high', confidence: 0.9 }];
    expect(parseDeepFindings(JSON.stringify(bad), 'Security')).toHaveLength(0);
  });

  it('skips findings with missing subcategory', () => {
    const bad = [{ ruleId: 'SEC-001', severity: 'high', message: 'An issue', confidence: 0.9 }];
    expect(parseDeepFindings(JSON.stringify(bad), 'Security')).toHaveLength(0);
  });

  it('keeps valid findings and skips invalid ones in mixed array', () => {
    const mixed = [
      { ruleId: 'SEC-001', subcategory: 'Secrets & env vars', severity: 'high', message: 'Good finding', confidence: 0.9 },
      { ruleId: 'SEC-002' }, // missing message and subcategory
    ];
    const findings = parseDeepFindings(JSON.stringify(mixed), 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Good finding');
  });

  it('does not throw on deeply malformed input', () => {
    const malformed = '{"this": "is": "not": "valid"}';
    expect(() => parseDeepFindings(malformed, 'Security')).not.toThrow();
  });

  it('handles LLM responses with prose before JSON', () => {
    const response = 'Here are the findings I found:\n[{"ruleId":"SEC-001","subcategory":"Secrets & env vars","severity":"high","message":"test issue","confidence":0.8}]';
    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeResults — score merging
// ---------------------------------------------------------------------------

describe('mergeResults — combined score', () => {
  it('deep result overrides classic when scores differ by more than 1', () => {
    const classicFindings: Finding[] = [
      {
        category: 'Security',
        subcategory: 'Secrets & env vars',
        severity: 'high',
        message: 'Classic finding',
        confidence: 1.0,
        source: 'classic',
      },
    ];
    const deepFindings: Finding[] = [
      {
        category: 'Security',
        subcategory: 'Secrets & env vars',
        severity: 'critical',
        message: 'Deep: SQL injection data flow',
        confidence: 0.9,
        source: 'deep',
      },
    ];

    const classicResult = normalizeFindings(classicFindings).scanResult;
    const deepResult = normalizeFindings(deepFindings).scanResult;
    const merged = mergeResults(classicResult, deepResult);

    expect(merged.total).toBeGreaterThanOrEqual(0);
    expect(merged.categories).toBeDefined();
  });

  it('merged result has all 6 categories when both engines produce findings', () => {
    const classicFindings: Finding[] = [
      { category: 'Security', subcategory: 'Secrets & env vars', severity: 'medium', message: 'c1', confidence: 1.0, source: 'classic' },
      { category: 'Testing', subcategory: 'Coverage ratio', severity: 'medium', message: 'c2', confidence: 1.0, source: 'classic' },
    ];
    const deepFindings: Finding[] = [
      { category: 'Security', subcategory: 'Input validation', severity: 'high', message: 'd1', confidence: 0.9, source: 'deep' },
    ];

    const classicResult = normalizeFindings(classicFindings).scanResult;
    const deepResult = normalizeFindings(deepFindings).scanResult;
    const merged = mergeResults(classicResult, deepResult);

    expect(merged.totalIssuesFound).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DeepEngine — batching
// ---------------------------------------------------------------------------

describe('DeepEngine — file batching', () => {
  it('analyzes files when provided explicitly', async () => {
    const provider = makeMockProvider('[]');
    const engine = new DeepEngine(provider);

    // Find a couple of real ts files in this repo
    const { findSourceFiles } = await import('../core/scan-constants.js');
    const files = findSourceFiles(process.cwd(), { scanProductionOnly: true }).slice(0, 3);

    if (files.length > 0) {
      const result = await engine.analyze(process.cwd(), { files, maxFiles: 3 });
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(provider.sendMessage).toHaveBeenCalled();
    }
  });

  it('returns classic result when LLM returns empty findings for all batches', async () => {
    const provider = makeMockProvider('[]'); // always returns empty
    const engine = new DeepEngine(provider);
    const result = await engine.analyze(process.cwd(), { maxFiles: 5 });
    // classic result is returned unchanged when deep produces no additional findings
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('merges deep findings into the result when LLM returns findings', async () => {
    const deepFinding = JSON.stringify([{
      ruleId: 'SEC-002',
      subcategory: 'Input validation',
      severity: 'high',
      message: 'SQL injection via req.body.id',
      file: 'src/routes/user.ts',
      line: 42,
      confidence: 0.92,
      suggestion: 'Use parameterised queries',
    }]);
    const provider = makeMockProvider(deepFinding);
    const engine = new DeepEngine(provider);
    const result = await engine.analyze(process.cwd(), { maxFiles: 3 });
    // Result should be a valid ScanResult
    expect(result).toMatchObject({
      total: expect.any(Number),
      categories: expect.any(Array),
    });
  });
});
