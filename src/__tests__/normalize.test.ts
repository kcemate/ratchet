/**
 * Tests for the Finding Normalization Layer.
 *
 * Covers:
 *   - FindingDeduplicator: same file+line from both engines → kept once
 *   - FindingAggregator: flat findings → proper CategoryResult structure
 *   - normalizeFindings: end-to-end with real-ish data
 *   - mergeScores: already tested in scan-engine.test.ts — extended here
 *   - mergeResults: two full ScanResults merge correctly
 *   - RULE_REGISTRY: every ClassicEngine subcategory has a matching rule
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeFindings,
  mergeScores,
  mergeResults,
  removeResolvedFindings,
  FindingDeduplicator,
  FindingAggregator,
  type Finding,
} from '../core/normalize.js';
import { RULE_REGISTRY, getRuleBySubcategory } from '../core/finding-rules.js';
import { ClassicEngine } from '../core/engines/classic.js';
import type { ScanResult } from '../commands/scan.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClassicFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: 'Security',
    subcategory: 'Secrets & env vars',
    severity: 'high',
    message: 'Hardcoded API key',
    confidence: 0.9,
    source: 'classic',
    file: 'src/config.ts',
    line: 10,
    ...overrides,
  };
}

function makeDeepFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: 'Security',
    subcategory: 'Secrets & env vars',
    severity: 'high',
    message: 'Hardcoded API key detected (semantic)',
    confidence: 0.95,
    source: 'deep',
    file: 'src/config.ts',
    line: 10,
    ...overrides,
  };
}

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 75,
    maxTotal: 100,
    totalIssuesFound: 2,
    issuesByType: [
      { category: 'Testing', subcategory: 'Coverage ratio', count: 3, description: 'low coverage', severity: 'high' },
      { category: 'Security', subcategory: 'Secrets & env vars', count: 1, description: 'hardcoded secret', severity: 'high' },
    ],
    categories: [
      {
        name: 'Testing',
        emoji: '🧪',
        score: 16,
        max: 25,
        summary: 'ok',
        subcategories: [
          { name: 'Coverage ratio', score: 5, max: 8, summary: 'low ratio', issuesFound: 3 },
          { name: 'Edge case depth', score: 7, max: 9, summary: 'good', issuesFound: 0 },
          { name: 'Test quality',    score: 4, max: 8, summary: 'ok',   issuesFound: 0 },
        ],
      },
      {
        name: 'Security',
        emoji: '🔒',
        score: 12,
        max: 15,
        summary: 'ok',
        subcategories: [
          { name: 'Secrets & env vars', score: 0,  max: 3, summary: 'secret found', issuesFound: 1 },
          { name: 'Input validation',   score: 6,  max: 6, summary: 'good',          issuesFound: 0 },
          { name: 'Auth & rate limiting', score: 6, max: 6, summary: 'good',         issuesFound: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FindingDeduplicator
// ---------------------------------------------------------------------------

describe('FindingDeduplicator', () => {
  it('keeps unique findings unchanged', () => {
    const dedup = new FindingDeduplicator();
    const f1 = makeClassicFinding({ file: 'a.ts', line: 1 });
    const f2 = makeClassicFinding({ file: 'b.ts', line: 1 });
    expect(dedup.deduplicate([f1, f2])).toHaveLength(2);
  });

  it('deduplicates same file+line from both engines', () => {
    const dedup = new FindingDeduplicator();
    const classic = makeClassicFinding({ confidence: 0.9 });
    const deep = makeDeepFinding({ confidence: 0.95 });
    const result = dedup.deduplicate([classic, deep]);
    expect(result).toHaveLength(1);
  });

  it('keeps the finding with higher confidence', () => {
    const dedup = new FindingDeduplicator();
    const lowConf  = makeClassicFinding({ confidence: 0.7, message: 'classic' });
    const highConf = makeDeepFinding({ confidence: 0.95, message: 'deep' });
    const [kept] = dedup.deduplicate([lowConf, highConf]);
    expect(kept!.message).toBe('deep');
  });

  it('prefers Deep on equal confidence', () => {
    const dedup = new FindingDeduplicator();
    const classic = makeClassicFinding({ confidence: 0.9, message: 'classic' });
    const deep    = makeDeepFinding({ confidence: 0.9, message: 'deep' });
    const [kept] = dedup.deduplicate([classic, deep]);
    expect(kept!.source).toBe('deep');
  });

  it('treats lines within ±5 as duplicates', () => {
    const dedup = new FindingDeduplicator();
    const f1 = makeClassicFinding({ line: 10 });
    const f2 = makeDeepFinding({ line: 14 }); // 4 lines away → duplicate
    expect(dedup.deduplicate([f1, f2])).toHaveLength(1);
  });

  it('does NOT deduplicate lines more than 5 apart', () => {
    const dedup = new FindingDeduplicator();
    const f1 = makeClassicFinding({ line: 10 });
    const f2 = makeDeepFinding({ line: 16 }); // 6 lines away → distinct
    expect(dedup.deduplicate([f1, f2])).toHaveLength(2);
  });

  it('does NOT deduplicate different subcategories in same file', () => {
    const dedup = new FindingDeduplicator();
    const f1 = makeClassicFinding({ subcategory: 'Secrets & env vars' });
    const f2 = makeDeepFinding({ subcategory: 'Input validation' });
    expect(dedup.deduplicate([f1, f2])).toHaveLength(2);
  });

  it('attaches id to deduplicated findings', () => {
    const dedup = new FindingDeduplicator();
    const [kept] = dedup.deduplicate([makeClassicFinding()]);
    expect(typeof kept!.id).toBe('string');
    expect(kept!.id!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FindingAggregator
// ---------------------------------------------------------------------------

describe('FindingAggregator', () => {
  it('groups findings into correct CategoryResult structure', () => {
    const agg = new FindingAggregator();
    const findings: Finding[] = [
      makeClassicFinding({ category: 'Security', subcategory: 'Secrets & env vars', severity: 'high' }),
      makeClassicFinding({ category: 'Testing',  subcategory: 'Coverage ratio',     severity: 'medium', source: 'classic' }),
    ];
    const { categories } = agg.aggregate(findings);
    const catNames = categories.map(c => c.name);
    expect(catNames).toContain('Security');
    expect(catNames).toContain('Testing');
  });

  it('produces subcategories with correct names', () => {
    const agg = new FindingAggregator();
    const { categories } = agg.aggregate([
      makeClassicFinding({ category: 'Security', subcategory: 'Input validation', severity: 'low' }),
    ]);
    const sec = categories.find(c => c.name === 'Security')!;
    expect(sec.subcategories[0]!.name).toBe('Input validation');
  });

  it('issuesFound equals number of findings per subcategory', () => {
    const agg = new FindingAggregator();
    const findings: Finding[] = [
      makeClassicFinding({ file: 'a.ts' }),
      makeClassicFinding({ file: 'b.ts' }),
    ];
    const { categories } = agg.aggregate(findings);
    const sec = categories.find(c => c.name === 'Security')!;
    expect(sec.subcategories[0]!.issuesFound).toBe(2);
  });

  it('critical finding zeros out subcategory score', () => {
    const agg = new FindingAggregator();
    const { categories } = agg.aggregate([
      makeClassicFinding({ severity: 'critical' }),
    ]);
    const sec = categories.find(c => c.name === 'Security')!;
    expect(sec.subcategories[0]!.score).toBe(0);
  });

  it('high finding reduces score by 50% of max', () => {
    const agg = new FindingAggregator();
    const { categories } = agg.aggregate([
      makeClassicFinding({ severity: 'high', category: 'Security', subcategory: 'Secrets & env vars' }),
    ]);
    const sec = categories.find(c => c.name === 'Security')!;
    const sub = sec.subcategories[0]!;
    // maxScore for SEC-001 is 3; 3 - 3*0.5 = 1.5 → rounded to 2
    expect(sub.score).toBeLessThan(sub.max);
  });

  it('medium finding reduces score by 1 point', () => {
    const agg = new FindingAggregator();
    const { categories } = agg.aggregate([
      makeClassicFinding({ severity: 'medium', category: 'Security', subcategory: 'Input validation' }),
    ]);
    const sec = categories.find(c => c.name === 'Security')!;
    const sub = sec.subcategories[0]!;
    // maxScore for SEC-002 is 6; 6 - 1 = 5
    expect(sub.score).toBe(5);
  });

  it('returns totalIssuesFound equal to number of findings', () => {
    const agg = new FindingAggregator();
    const findings = [makeClassicFinding(), makeDeepFinding({ subcategory: 'Input validation' })];
    const { totalIssuesFound } = agg.aggregate(findings);
    expect(totalIssuesFound).toBe(2);
  });

  it('produces issuesByType entries for findings', () => {
    const agg = new FindingAggregator();
    const { issuesByType } = agg.aggregate([makeClassicFinding()]);
    expect(issuesByType).toHaveLength(1);
    expect(issuesByType[0]!.category).toBe('Security');
  });

  it('includes locations for findings with file info', () => {
    const agg = new FindingAggregator();
    const { categories } = agg.aggregate([
      makeClassicFinding({ file: 'src/foo.ts', line: 42 }),
    ]);
    const sub = categories.find(c => c.name === 'Security')!.subcategories[0]!;
    expect(sub.locations).toContain('src/foo.ts:42');
  });
});

// ---------------------------------------------------------------------------
// normalizeFindings — end to end
// ---------------------------------------------------------------------------

describe('normalizeFindings (full pipeline)', () => {
  it('attaches ruleId to findings that have a matching rule', () => {
    const findings: Finding[] = [makeClassicFinding()];
    const { findings: out } = normalizeFindings(findings);
    expect(out[0]!.ruleId).toBe('SEC-001');
  });

  it('attaches id to every finding', () => {
    const { findings: out } = normalizeFindings([makeClassicFinding()]);
    expect(typeof out[0]!.id).toBe('string');
  });

  it('deduplicates findings from both engines', () => {
    const classic = makeClassicFinding({ confidence: 0.8 });
    const deep    = makeDeepFinding({ confidence: 0.95 });
    const { findings } = normalizeFindings([classic, deep]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.source).toBe('deep');
  });

  it('produces a valid ScanResult with totalIssuesFound', () => {
    const findings: Finding[] = [
      makeClassicFinding(),
      makeClassicFinding({ category: 'Testing', subcategory: 'Coverage ratio', source: 'classic' }),
    ];
    const { scanResult } = normalizeFindings(findings);
    expect(scanResult.totalIssuesFound).toBe(2);
    expect(scanResult.issuesByType).toHaveLength(2);
  });

  it('handles empty findings', () => {
    const { findings, scanResult } = normalizeFindings([]);
    expect(findings).toHaveLength(0);
    expect(scanResult.totalIssuesFound).toBe(0);
    expect(scanResult.categories).toHaveLength(0);
  });

  it('produces correct total score from multiple subcategory findings', () => {
    const findings: Finding[] = [
      // SEC-002 Input validation, medium → 6 - 1 = 5
      makeClassicFinding({ category: 'Security', subcategory: 'Input validation', severity: 'medium' }),
      // TST-001 Coverage ratio, low → 8 - 0.5 = 7.5 → 8 (rounded)
      makeClassicFinding({ category: 'Testing', subcategory: 'Coverage ratio', severity: 'low', source: 'classic' }),
    ];
    const { scanResult } = normalizeFindings(findings);
    expect(scanResult.total).toBeGreaterThan(0);
    expect(scanResult.maxTotal).toBeGreaterThan(0);
    expect(scanResult.total).toBeLessThanOrEqual(scanResult.maxTotal);
  });

  it('issuesByType severity follows finding severity', () => {
    const { scanResult } = normalizeFindings([
      makeClassicFinding({ severity: 'high' }),
    ]);
    expect(scanResult.issuesByType[0]!.severity).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// mergeScores — edge cases beyond scan-engine.test.ts
// ---------------------------------------------------------------------------

describe('mergeScores (extended)', () => {
  it('Classic 8/10 + Deep 5/10 — diff > 1 → Deep wins', () => {
    expect(mergeScores(8, 5)).toBe(5);
  });

  it('Classic 7/10 + Deep 7/10 — equal → average = 7', () => {
    expect(mergeScores(7, 7)).toBe(7);
  });

  it('Classic 7/10 + Deep 8/10 — diff = 1 → average rounds up', () => {
    // |8-7| = 1, not > 1 → average: (7+8)/2 = 7.5 → 8
    expect(mergeScores(7, 8)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// mergeResults
// ---------------------------------------------------------------------------

describe('mergeResults', () => {
  it('returns a valid ScanResult', () => {
    const a = makeScanResult();
    const b = makeScanResult({ total: 70 });
    const merged = mergeResults(a, b);
    expect(merged).toMatchObject({
      projectName: expect.any(String),
      total: expect.any(Number),
      maxTotal: expect.any(Number),
      categories: expect.any(Array),
      totalIssuesFound: expect.any(Number),
      issuesByType: expect.any(Array),
    });
  });

  it('uses classic projectName', () => {
    const classic = makeScanResult({ projectName: 'classic-project' });
    const deep    = makeScanResult({ projectName: 'deep-project' });
    expect(mergeResults(classic, deep).projectName).toBe('classic-project');
  });

  it('subcategory score uses mergeScores logic', () => {
    // Classic Testing/Coverage = 5, Deep = 2 → diff > 1 → Deep wins (2)
    const classic = makeScanResult();
    const deep = makeScanResult({
      categories: classic.categories.map(c =>
        c.name !== 'Testing' ? c : {
          ...c,
          score: 12,
          subcategories: c.subcategories.map(s =>
            s.name !== 'Coverage ratio' ? s : { ...s, score: 2 },
          ),
        },
      ),
    });
    const merged = mergeResults(classic, deep);
    const testCat = merged.categories.find(c => c.name === 'Testing')!;
    const coverageSub = testCat.subcategories.find(s => s.name === 'Coverage ratio')!;
    // classic=5, deep=2, diff=3>1 → deep wins → 2
    expect(coverageSub.score).toBe(2);
  });

  it('subcategory score averages when diff ≤ 1', () => {
    const classic = makeScanResult();
    const deep = makeScanResult({
      categories: classic.categories.map(c =>
        c.name !== 'Testing' ? c : {
          ...c,
          subcategories: c.subcategories.map(s =>
            s.name !== 'Coverage ratio' ? s : { ...s, score: 6 },
          ),
        },
      ),
    });
    const merged = mergeResults(classic, deep);
    const testCat = merged.categories.find(c => c.name === 'Testing')!;
    const coverageSub = testCat.subcategories.find(s => s.name === 'Coverage ratio')!;
    // classic=5, deep=6, diff=1 → average (5+6)/2=5.5 → 6
    expect(coverageSub.score).toBe(6);
  });

  it('prefers Deep summary when non-empty', () => {
    const classic = makeScanResult();
    const deep = makeScanResult({
      categories: classic.categories.map(c =>
        c.name !== 'Security' ? c : { ...c, summary: 'Deep security analysis' },
      ),
    });
    const merged = mergeResults(classic, deep);
    const secCat = merged.categories.find(c => c.name === 'Security')!;
    expect(secCat.summary).toBe('Deep security analysis');
  });

  it('combined total is sum of merged category scores', () => {
    const a = makeScanResult();
    const merged = mergeResults(a, a);
    const expectedTotal = merged.categories.reduce((s, c) => s + c.score, 0);
    expect(merged.total).toBe(expectedTotal);
  });

  it('deduplicates issuesByType by category+subcategory keeping max count', () => {
    const classic = makeScanResult({
      issuesByType: [
        { category: 'Testing', subcategory: 'Coverage ratio', count: 3, description: 'low', severity: 'high' },
      ],
    });
    const deep = makeScanResult({
      issuesByType: [
        { category: 'Testing', subcategory: 'Coverage ratio', count: 7, description: 'low (deep)', severity: 'high' },
      ],
    });
    const merged = mergeResults(classic, deep);
    const testIssue = merged.issuesByType.find(
      i => i.category === 'Testing' && i.subcategory === 'Coverage ratio',
    )!;
    expect(testIssue.count).toBe(7); // deep has higher count
  });
});

// ---------------------------------------------------------------------------
// removeResolvedFindings
// ---------------------------------------------------------------------------

describe('removeResolvedFindings', () => {
  function makeDeepResult(): ScanResult {
    return {
      projectName: 'test',
      total: 20,
      maxTotal: 40,
      totalIssuesFound: 4,
      issuesByType: [
        { category: 'Security', subcategory: 'Secrets & env vars', count: 2, description: 'secrets', severity: 'high' },
        { category: 'Testing',  subcategory: 'Coverage ratio',     count: 2, description: 'low',     severity: 'medium' },
      ],
      categories: [
        {
          name: 'Security',
          emoji: '🔒',
          score: 5,
          max: 15,
          summary: 'issues',
          subcategories: [
            {
              name: 'Secrets & env vars',
              score: 5, max: 15, summary: 'secrets', issuesFound: 2,
              locations: ['src/auth.ts:10', 'src/config.ts:5'],
            },
          ],
        },
        {
          name: 'Testing',
          emoji: '🧪',
          score: 15,
          max: 25,
          summary: 'ok',
          subcategories: [
            {
              name: 'Coverage ratio',
              score: 15, max: 25, summary: 'low', issuesFound: 2,
              locations: ['src/utils.ts:1', 'src/helpers.ts:1'],
            },
          ],
        },
      ],
    };
  }

  it('returns the same result when no files changed', () => {
    const result = makeDeepResult();
    expect(removeResolvedFindings(result, [])).toBe(result);
  });

  it('returns the same result when no changed files overlap with locations', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/unrelated.ts']);
    expect(filtered.total).toBe(result.total);
    expect(filtered.categories[0]!.subcategories[0]!.issuesFound).toBe(2);
  });

  it('removes locations for changed files', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.locations).toEqual(['src/config.ts:5']);
  });

  it('proportionally reduces issuesFound for changed files', () => {
    const result = makeDeepResult();
    // auth.ts is 1 of 2 locations → 50% remain → issuesFound: 2 * 0.5 = 1
    const filtered = removeResolvedFindings(result, ['src/auth.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.issuesFound).toBe(1);
  });

  it('proportionally restores score when issues removed', () => {
    const result = makeDeepResult();
    // Security sub: score=5, max=15, deduction=10. 1 of 2 locations removed → ratio=0.5
    // newDeduction = round(10 * 0.5) = 5, newScore = 15 - 5 = 10
    const filtered = removeResolvedFindings(result, ['src/auth.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.score).toBe(10);
  });

  it('sets issuesFound to 0 when all locations are in changed files', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts', 'src/config.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.issuesFound).toBe(0);
    expect(secSub.locations).toHaveLength(0);
  });

  it('restores score to max when all locations resolved', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts', 'src/config.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.score).toBe(secSub.max);
  });

  it('recalculates category score from updated subcategories', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts', 'src/config.ts']);
    const secCat = filtered.categories[0]!;
    // All Security sub locations resolved → sub score = 15 = cat max, cat score = 15
    expect(secCat.score).toBe(15);
  });

  it('updates total to reflect resolved findings', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts', 'src/config.ts']);
    // Security cat goes from 5 to 15 (+10), Testing unchanged (15)
    expect(filtered.total).toBe(30);
  });

  it('syncs issuesByType counts with updated subcategory data', () => {
    const result = makeDeepResult();
    const filtered = removeResolvedFindings(result, ['src/auth.ts', 'src/config.ts']);
    const secIssue = filtered.issuesByType.find(i => i.subcategory === 'Secrets & env vars');
    expect(secIssue).toBeUndefined(); // count became 0 → filtered out
  });

  it('leaves subcategories without locations unchanged', () => {
    const result = makeDeepResult();
    // Remove locations from Testing sub to simulate no-location data
    const noLocResult: ScanResult = {
      ...result,
      categories: result.categories.map(c =>
        c.name !== 'Testing' ? c : {
          ...c,
          subcategories: c.subcategories.map(s => ({ ...s, locations: [] })),
        },
      ),
    };
    const filtered = removeResolvedFindings(noLocResult, ['src/utils.ts']);
    const testSub = filtered.categories.find(c => c.name === 'Testing')!.subcategories[0]!;
    expect(testSub.issuesFound).toBe(2); // unchanged
  });

  it('handles absolute/relative path suffix matching', () => {
    const result = makeDeepResult();
    // changedFiles has full absolute path; locations have relative
    const filtered = removeResolvedFindings(result, ['/workspace/project/src/auth.ts']);
    const secSub = filtered.categories[0]!.subcategories[0]!;
    expect(secSub.locations).toEqual(['src/config.ts:5']);
  });
});

// ---------------------------------------------------------------------------
// RULE_REGISTRY completeness
// ---------------------------------------------------------------------------

describe('RULE_REGISTRY', () => {
  const EXPECTED_SUBCATEGORIES: Array<[string, string]> = [
    // Testing
    ['Testing', 'Coverage ratio'],
    ['Testing', 'Edge case depth'],
    ['Testing', 'Test quality'],
    // Security
    ['Security', 'Secrets & env vars'],
    ['Security', 'Input validation'],
    ['Security', 'Auth & rate limiting'],
    // Type Safety
    ['Type Safety', 'Strict config'],
    ['Type Safety', 'Any type count'],
    // Error Handling
    ['Error Handling', 'Coverage'],
    ['Error Handling', 'Empty catches'],
    ['Error Handling', 'Structured logging'],
    // Performance
    ['Performance', 'Async patterns'],
    ['Performance', 'Console cleanup'],
    ['Performance', 'Import hygiene'],
    // Code Quality
    ['Code Quality', 'Function length'],
    ['Code Quality', 'Line length'],
    ['Code Quality', 'Dead code'],
    ['Code Quality', 'Duplication'],
  ];

  it('has 18 rules total', () => {
    expect(Object.keys(RULE_REGISTRY)).toHaveLength(18);
  });

  it.each(EXPECTED_SUBCATEGORIES)('rule exists for %s / %s', (category, subcategory) => {
    const rule = getRuleBySubcategory(category, subcategory);
    expect(rule).toBeDefined();
    expect(rule!.id).toMatch(/^[A-Z]+-\d+$/);
  });

  it('maxScore sums to 100 across all rules', () => {
    const total = Object.values(RULE_REGISTRY).reduce((s, r) => s + r.maxScore, 0);
    expect(total).toBe(100);
  });

  it('every rule has a non-empty description', () => {
    for (const rule of Object.values(RULE_REGISTRY)) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ClassicEngine.analyzeWithFindings
// ---------------------------------------------------------------------------

describe('ClassicEngine.analyzeWithFindings', () => {
  it('returns both result and findings', async () => {
    const engine = new ClassicEngine();
    const { result, findings } = await engine.analyzeWithFindings(process.cwd());
    expect(result).toMatchObject({ total: expect.any(Number), categories: expect.any(Array) });
    expect(Array.isArray(findings)).toBe(true);
  });

  it('result matches analyze() output', async () => {
    const engine = new ClassicEngine();
    const [direct, withFindings] = await Promise.all([
      engine.analyze(process.cwd()),
      engine.analyzeWithFindings(process.cwd()),
    ]);
    expect(withFindings.result.total).toBe(direct.total);
    expect(withFindings.result.categories.length).toBe(direct.categories.length);
  });

  it('findings have source=classic', async () => {
    const engine = new ClassicEngine();
    const { findings } = await engine.analyzeWithFindings(process.cwd());
    for (const f of findings) {
      expect(f.source).toBe('classic');
    }
  });

  it('findings have confidence=1.0', async () => {
    const engine = new ClassicEngine();
    const { findings } = await engine.analyzeWithFindings(process.cwd());
    for (const f of findings) {
      expect(f.confidence).toBe(1.0);
    }
  });

  it('findings with ruleId reference valid rules', async () => {
    const engine = new ClassicEngine();
    const { findings } = await engine.analyzeWithFindings(process.cwd());
    for (const f of findings) {
      if (f.ruleId) {
        expect(RULE_REGISTRY[f.ruleId]).toBeDefined();
      }
    }
  });

  it('each subcategory in ClassicEngine has a matching rule', async () => {
    const engine = new ClassicEngine();
    const { result } = await engine.analyzeWithFindings(process.cwd());
    for (const cat of result.categories) {
      for (const sub of cat.subcategories) {
        const rule = getRuleBySubcategory(cat.name, sub.name);
        expect(rule).toBeDefined();
        expect(rule!.category).toBe(cat.name);
        expect(rule!.subcategory).toBe(sub.name);
      }
    }
  });
});
