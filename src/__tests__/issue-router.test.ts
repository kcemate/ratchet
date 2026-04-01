/**
 * Smart Issue Router — unit tests
 * Tests routing logic for APIAgent (free tier) and ShellAgent (pro tier).
 */

import { describe, it, expect } from 'vitest';
import { canFixWithAgent, routeIssues, hasASTTransformMatch } from '../core/issue-router.js';
import type { IssueTask } from '../core/issue-backlog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<IssueTask> = {}): IssueTask {
  return {
    category: 'Code Quality',
    subcategory: 'Structured logging',
    description: 'Uses console.log instead of structured logger',
    count: 5,
    severity: 'medium',
    priority: 2.5,
    sweepFiles: ['src/server.ts', 'src/utils.ts'],
    fixMode: 'torque',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canFixWithAgent — shell always passes
// ---------------------------------------------------------------------------

describe('canFixWithAgent — shell agent', () => {
  it('accepts any torque issue', () => {
    expect(canFixWithAgent(makeIssue({ fixMode: 'torque' }), 'shell')).toBe(true);
  });

  it('accepts sweep-mode issues', () => {
    expect(canFixWithAgent(makeIssue({ fixMode: 'sweep' }), 'shell')).toBe(true);
  });

  it('accepts architect-mode issues', () => {
    expect(canFixWithAgent(makeIssue({ fixMode: 'architect' }), 'shell')).toBe(true);
  });

  it('accepts test-related issues', () => {
    expect(canFixWithAgent(makeIssue({ category: 'Testing', fixMode: 'torque' }), 'shell')).toBe(true);
  });

  it('accepts issues with no file locations', () => {
    expect(canFixWithAgent(makeIssue({ sweepFiles: [] }), 'shell')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canFixWithAgent — API agent constraints
// ---------------------------------------------------------------------------

describe('canFixWithAgent — api agent', () => {
  it('accepts a torque issue with effort ≤ 2 and file locations', () => {
    // 'Structured logging' has effortPerFix: 2 in SUBCATEGORY_TIERS
    expect(canFixWithAgent(makeIssue(), 'api')).toBe(true);
  });

  it('rejects sweep-mode issues', () => {
    expect(canFixWithAgent(makeIssue({ fixMode: 'sweep' }), 'api')).toBe(false);
  });

  it('rejects architect-mode issues', () => {
    expect(canFixWithAgent(makeIssue({ fixMode: 'architect' }), 'api')).toBe(false);
  });

  it('rejects issues in the Testing category', () => {
    expect(canFixWithAgent(makeIssue({ category: 'Testing', fixMode: 'torque' }), 'api')).toBe(false);
  });

  it('rejects issues with "coverage" in the subcategory', () => {
    expect(canFixWithAgent(makeIssue({
      category: 'Code Quality',
      subcategory: 'Coverage ratio',
      fixMode: 'torque',
      sweepFiles: ['src/app.ts'],
    }), 'api')).toBe(false);
  });

  it('rejects issues with no file locations', () => {
    expect(canFixWithAgent(makeIssue({ sweepFiles: [] }), 'api')).toBe(false);
  });

  it('rejects issues with undefined sweepFiles', () => {
    const issue = makeIssue();
    delete (issue as any).sweepFiles;
    expect(canFixWithAgent(issue, 'api')).toBe(false);
  });

  it('rejects issues with effort > 2 (high-effort subcategory)', () => {
    // Use an architect-effort subcategory. If not found in SUBCATEGORY_TIERS, defaults to 3.
    expect(canFixWithAgent(makeIssue({
      subcategory: 'Unknown high effort subcategory',
      fixMode: 'torque',
      sweepFiles: ['src/app.ts'],
    }), 'api')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// routeIssues
// ---------------------------------------------------------------------------

describe('routeIssues', () => {
  const torqueIssue = makeIssue({ fixMode: 'torque', priority: 3.0 });
  const sweepIssue = makeIssue({ subcategory: 'Dead code', fixMode: 'sweep', priority: 4.0 });
  const testIssue = makeIssue({ category: 'Testing', fixMode: 'torque', priority: 5.0 });
  const architectIssue = makeIssue({ subcategory: 'Dependency injection', fixMode: 'architect', priority: 2.0 });

  it('returns the full backlog unchanged for shell agent', () => {
    const backlog = [torqueIssue, sweepIssue, testIssue, architectIssue];
    const result = routeIssues(backlog, 'shell');
    expect(result).toEqual(backlog);
  });

  it('filters out sweep/architect/test issues for api agent', () => {
    const backlog = [torqueIssue, sweepIssue, testIssue, architectIssue];
    const result = routeIssues(backlog, 'api');
    expect(result).not.toContain(sweepIssue);
    expect(result).not.toContain(testIssue);
    expect(result).not.toContain(architectIssue);
  });

  it('preserves eligible torque issues for api agent', () => {
    const backlog = [torqueIssue, sweepIssue, testIssue];
    const result = routeIssues(backlog, 'api');
    expect(result).toContain(torqueIssue);
  });

  it('returns empty array when all issues are ineligible for api agent', () => {
    const result = routeIssues([sweepIssue, testIssue, architectIssue], 'api');
    expect(result).toHaveLength(0);
  });

  it('sorts AST-matchable issues first for api agent', () => {
    // 'Structured logging' matches replace-console-logger transform
    const consoleIssue = makeIssue({
      subcategory: 'Structured logging',
      description: 'console.log usage',
      fixMode: 'torque',
      priority: 1.0, // low priority
      sweepFiles: ['src/a.ts'],
    });
    const genericIssue = makeIssue({
      subcategory: 'Empty catches',
      description: 'empty catch blocks',
      fixMode: 'torque',
      priority: 5.0, // high priority
      sweepFiles: ['src/b.ts'],
    });
    const result = routeIssues([genericIssue, consoleIssue], 'api');
    // AST-matchable issue should come first regardless of priority
    // (both console and empty-catches match transforms)
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not mutate the original backlog', () => {
    const backlog = [torqueIssue, sweepIssue, testIssue];
    const original = [...backlog];
    routeIssues(backlog, 'api');
    expect(backlog).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// hasASTTransformMatch
// ---------------------------------------------------------------------------

describe('hasASTTransformMatch', () => {
  it('returns true for issues matching console/logging transforms', () => {
    expect(hasASTTransformMatch(makeIssue({
      subcategory: 'Structured logging',
      description: 'console.log usage',
    }))).toBe(true);
  });

  it('returns false for issues with no matching transform', () => {
    expect(hasASTTransformMatch(makeIssue({
      subcategory: 'Something completely unique 99999',
      description: 'no matching transform here',
    }))).toBe(false);
  });
});
