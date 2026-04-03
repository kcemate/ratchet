import { describe, it, expect } from 'vitest';
import { buildConstraints, buildScoreContext } from '../core/agents/shell.js';
import { buildBacklog } from '../core/issue-backlog.js';
import { SUBCATEGORY_TIERS } from '../core/score-optimizer.js';
import type { IssueTask } from '../core/issue-backlog.js';
import type { ScanResult } from '../core/scanner';

// ─── buildConstraints ────────────────────────────────────────────────────────

describe('buildConstraints', () => {
  it('returns sweep-appropriate constraints when sweepFiles present', () => {
    const issues: IssueTask[] = [{
      category: 'performance',
      subcategory: 'Console cleanup',
      description: 'console.log calls',
      count: 14,
      severity: 'low',
      priority: 1,
      sweepFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    }];

    const result = buildConstraints(issues);

    expect(result).toContain('Modify ONLY the listed files');
    expect(result).toContain('No line limit');
    expect(result).toContain('All existing tests MUST still pass');
    expect(result).not.toContain('AT MOST 30 lines');
    expect(result).not.toContain('AT MOST 2 files');
  });

  it('returns expanded constraints for high-count issues (count > 10)', () => {
    const issues: IssueTask[] = [{
      category: 'error-handling',
      subcategory: 'Coverage',
      description: 'missing error handling',
      count: 15,
      severity: 'high',
      priority: 5,
      sweepFiles: [], // empty — not sweep mode
    }];

    const result = buildConstraints(issues);

    expect(result).toContain('AT MOST 80 lines');
    expect(result).toContain('AT MOST 5 files');
    expect(result).toContain('All existing tests MUST still pass');
    expect(result).not.toContain('AT MOST 30 lines');
    expect(result).not.toContain('AT MOST 2 files');
  });

  it('returns standard constraints for normal issues (count <= 10, no sweepFiles)', () => {
    const issues: IssueTask[] = [{
      category: 'security',
      subcategory: 'Auth & rate limiting',
      description: 'unprotected routes',
      count: 2,
      severity: 'high',
      priority: 8,
    }];

    const result = buildConstraints(issues);

    expect(result).toContain('AT MOST 30 lines');
    expect(result).toContain('AT MOST 2 files');
    expect(result).toContain('All existing tests MUST still pass');
    expect(result).not.toContain('AT MOST 80 lines');
    expect(result).not.toContain('AT MOST 5 files');
  });
});

// ─── buildScoreContext ────────────────────────────────────────────────────────

describe('buildScoreContext', () => {
  it('generates correct score context text for a known subcategory', () => {
    // Auth & rate limiting: tiers [0→6, 1→4, 3→2, 999→0], maxScore=6
    // currentScore=2, count=2 → count(2) > tier.threshold(1) and score(4) > currentScore(2)
    // issuesNeeded = 2 - 1 = 1, pointsGained = 4 - 2 = 2
    const issues: IssueTask[] = [{
      category: 'security',
      subcategory: 'Auth & rate limiting',
      description: 'unprotected routes',
      count: 2,
      severity: 'high',
      priority: 8,
      currentScore: 2,
    }];

    const result = buildScoreContext(issues);

    expect(result).toContain('Auth & rate limiting');
    expect(result).toContain('2/6');
    expect(result).toContain('Target the highest-severity issue first');
    expect(result).toMatch(/Fixing \d+ issues? gains \+\d+ points?/);
  });

  it('returns empty string for unknown subcategory', () => {
    const issues: IssueTask[] = [{
      category: 'mystery',
      subcategory: 'Unknown subcategory XYZ',
      description: 'some issue',
      count: 5,
      severity: 'medium',
      priority: 3,
      currentScore: 1,
    }];

    const result = buildScoreContext(issues);
    expect(result).toBe('');
  });
});

// ─── buildBacklog populates fixInstruction ────────────────────────────────────

describe('buildBacklog', () => {
  it('populates fixInstruction from SUBCATEGORY_TIERS for matching subcategory', () => {
    const tierDef = SUBCATEGORY_TIERS.find(t => t.name === 'Console cleanup');
    expect(tierDef).toBeDefined();

    const mockScan: ScanResult = {
      projectName: 'test',
      total: 10,
      maxTotal: 50,
      totalIssuesFound: 5,
      categories: [
        {
          name: 'performance',
          emoji: '⚡',
          score: 3,
          max: 10,
          summary: '',
          subcategories: [
            { name: 'Console cleanup', score: 3, max: 5, issuesFound: 5, summary: '' },
          ],
        },
      ],
      issuesByType: [
        {
          category: 'performance',
          subcategory: 'Console cleanup',
          description: 'console.log calls found',
          count: 5,
          severity: 'low',
          locations: ['src/a.ts', 'src/b.ts'],
        },
      ],
    };

    const backlog = buildBacklog(mockScan);
    const task = backlog.find(t => t.subcategory === 'Console cleanup');

    expect(task).toBeDefined();
    expect(task!.fixInstruction).toBe(tierDef!.fixInstruction);
    expect(task!.fixInstruction).toContain('console.log');
  });
});
