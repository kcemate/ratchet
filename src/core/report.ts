import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { RatchetRun, Click } from '../types.js';
import type { ScanResult } from '../commands/scan.js';
import { formatDuration } from './utils.js';

export interface ReportOptions {
  run: RatchetRun;
  cwd: string;
  scoreBefore?: ScanResult;
  scoreAfter?: ScanResult;
  projectName?: string;
}

function plainEnglishSummary(click: Click): string {
  const raw = click.proposal || click.analysis || '';
  if (!raw) return 'Applied code improvements';
  // Take first sentence or first 120 chars, whichever is shorter
  const firstSentence = raw.split(/[.!\n]/)[0]?.trim() ?? '';
  if (firstSentence.length > 0 && firstSentence.length <= 120) return firstSentence;
  return raw.slice(0, 120).trimEnd() + (raw.length > 120 ? '…' : '');
}

function scoreLabel(score: number, maxTotal: number): string {
  const pct = score / maxTotal;
  if (pct >= 0.8) return '🟢';
  if (pct >= 0.5) return '🟡';
  return '🔴';
}

/**
 * Generate a human-readable Ratchet Report markdown string.
 * Can be printed to terminal, written to a file, or used as a PR body.
 */
export function generateReport(options: ReportOptions): string {
  const { run, scoreBefore, scoreAfter } = options;

  const totalClicks = run.clicks.length;
  const landed = run.clicks.filter((c) => c.testsPassed);
  const rolledBack = run.clicks.filter((c) => !c.testsPassed);
  const durationMs = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : 0;
  const duration = formatDuration(durationMs);

  const lines: string[] = [];

  // --- Header ---
  lines.push('# 🔧 Ratchet Report');
  lines.push('');
  lines.push(
    `**${totalClicks} click${totalClicks !== 1 ? 's' : ''} · ` +
      `${landed.length} landed · ` +
      `${rolledBack.length} rolled back · ` +
      `${duration}**`,
  );
  lines.push('');

  // --- What improved ---
  lines.push('## What improved:');
  lines.push('');
  if (landed.length === 0) {
    lines.push('- Nothing landed this run.');
  } else {
    for (const click of landed) {
      lines.push(`- **Click ${click.number}** — ${plainEnglishSummary(click)}`);
    }
  }
  lines.push('');

  // --- What was rolled back ---
  lines.push('## What was rolled back:');
  lines.push('');
  if (rolledBack.length === 0) {
    lines.push('- Nothing was rolled back — clean run! 🎉');
  } else {
    for (const click of rolledBack) {
      const reason = click.analysis
        ? click.analysis.split(/[.!\n]/)[0]?.trim() ?? 'Tests failed'
        : 'Tests failed';
      lines.push(`- **Click ${click.number}** — ${reason.slice(0, 120)}`);
    }
  }
  lines.push('');

  // --- Before/After ---
  if (scoreBefore && scoreAfter) {
    lines.push('## Before/After:');
    lines.push('');

    const beforePct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
    const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
    const delta = afterPct - beforePct;
    const deltaStr = delta > 0 ? `+${delta}` : String(delta);
    const icon = scoreLabel(scoreAfter.total, scoreAfter.maxTotal);

    // Issues fixed metric
    const issuesBefore = scoreBefore.totalIssuesFound ?? 0;
    const issuesAfter = scoreAfter.totalIssuesFound ?? 0;
    const issuesFixed = issuesBefore - issuesAfter;

    lines.push(`**Score: ${beforePct} → ${afterPct}${issuesBefore > 0 ? `  |  Issues: ${issuesBefore} → ${issuesAfter}${issuesFixed > 0 ? ` (${issuesFixed} fixed)` : ''}` : ''}**`);
    lines.push('');

    lines.push(`| | Before | After | Change |`);
    lines.push(`|---|---|---|---|`);
    lines.push(
      `| ${icon} **Production Readiness Score** | ${beforePct}/100 | ${afterPct}/100 | **${deltaStr}** |`,
    );

    for (let i = 0; i < scoreBefore.categories.length; i++) {
      const before = scoreBefore.categories[i];
      const after = scoreAfter.categories[i];
      if (!before || !after) continue;
      const catDelta = after.score - before.score;
      const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
      lines.push(
        `| ${after.emoji} ${after.name} | ${before.score}/${before.max} | ${after.score}/${after.max} | ${catDeltaStr} |`,
      );

      // Show subcategories if available
      if (after.subcategories && before.subcategories) {
        for (let j = 0; j < after.subcategories.length; j++) {
          const subBefore = before.subcategories[j];
          const subAfter = after.subcategories[j];
          if (!subBefore || !subAfter) continue;
          const subDelta = subAfter.score - subBefore.score;
          const subDeltaStr = subDelta > 0 ? `+${subDelta}` : String(subDelta);
          lines.push(
            `| &nbsp;&nbsp;&nbsp;&nbsp;↳ ${subAfter.name} | ${subBefore.score}/${subBefore.max} | ${subAfter.score}/${subAfter.max} | ${subDeltaStr} |`,
          );
        }
      }
    }
    lines.push('');

    // Issues Fixed section
    if (issuesBefore > 0 && scoreAfter.issuesByType) {
      lines.push('## Issues Fixed:');
      lines.push('');

      const beforeIssues = new Map<string, number>();
      if (scoreBefore.issuesByType) {
        for (const issue of scoreBefore.issuesByType) {
          beforeIssues.set(`${issue.category}::${issue.subcategory}`, issue.count);
        }
      }

      let hasIssues = false;
      for (const afterIssue of scoreAfter.issuesByType) {
        const key = `${afterIssue.category}::${afterIssue.subcategory}`;
        const beforeCount = beforeIssues.get(key) ?? 0;
        const fixed = beforeCount - afterIssue.count;
        if (fixed > 0) {
          lines.push(`- ✅ **${fixed} ${afterIssue.description} fixed** (${beforeCount} → ${afterIssue.count})`);
          hasIssues = true;
        }
      }

      // Issues that were completely resolved
      if (scoreBefore.issuesByType) {
        const afterKeys = new Set(scoreAfter.issuesByType.map(i => `${i.category}::${i.subcategory}`));
        for (const beforeIssue of scoreBefore.issuesByType) {
          const key = `${beforeIssue.category}::${beforeIssue.subcategory}`;
          if (!afterKeys.has(key) && beforeIssue.count > 0) {
            lines.push(`- ✅ **All ${beforeIssue.count} ${beforeIssue.description} resolved**`);
            hasIssues = true;
          }
        }
      }

      if (!hasIssues) {
        lines.push('- No issue count changes detected.');
      }
      lines.push('');
    }
  }

  // --- Footer ---
  lines.push(
    `---\n*Generated by [Ratchet](https://github.com/ratchet-run/ratchet) · ${new Date().toISOString()}*`,
  );

  return lines.join('\n');
}

/**
 * Write the report to docs/<target>-ratchet-report.md.
 */
export async function writeReport(options: ReportOptions): Promise<string> {
  const { run, cwd } = options;
  const reportPath = join(cwd, 'docs', `${run.target.name}-ratchet-report.md`);
  const content = generateReport(options);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, 'utf-8');
  return reportPath;
}
