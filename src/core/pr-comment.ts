import type { ScanResult } from '../core/scanner';

// --- Emoji indicators ---

function scoreEmoji(beforeScore: number, afterScore: number, max: number): string {
  if (afterScore === max && beforeScore < max) return '✅';
  if (afterScore > beforeScore) return '⬆️';
  if (afterScore === beforeScore) return '➡️';
  return '⬇️';
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

// --- Score card (compact, for commit messages and inline display) ---

export function generateScoreCard(
  before: ScanResult,
  after: ScanResult,
  options: { footer?: boolean } = {},
): string {
  const { footer = true } = options;

  const overallDelta = after.total - before.total;
  const overallEmoji = scoreEmoji(before.total, after.total, after.maxTotal);

  const lines: string[] = [
    '🔩 Ratchet improved this codebase:',
    `  Overall: ${before.total} → ${after.total} (${formatDelta(overallDelta)}) ${overallEmoji}`,
  ];

  for (const afterCat of after.categories) {
    const beforeCat = before.categories.find((c) => c.name === afterCat.name);
    if (!beforeCat) continue;
    if (afterCat.score === beforeCat.score) continue;

    const delta = afterCat.score - beforeCat.score;
    const emoji = scoreEmoji(beforeCat.score, afterCat.score, afterCat.max);
    lines.push(
      `  ${afterCat.name}: ${beforeCat.score}/${afterCat.max} → ` +
      `${afterCat.score}/${afterCat.max} (${formatDelta(delta)}) ${emoji}`,
    );
  }

  if (footer) {
    lines.push('');
    lines.push('Powered by Ratchet · Scan your repo free → https://ratchetcli.com');
  }

  return lines.join('\n');
}

// --- Commit suffix (compact 2-3 lines for appending to git commit messages) ---

export function generateCommitSuffix(
  before: ScanResult,
  after: ScanResult,
  options: { footer?: boolean } = {},
): string {
  const { footer = true } = options;

  const delta = after.total - before.total;

  const changedCats = after.categories
    .filter((c) => {
      const bc = before.categories.find((b) => b.name === c.name);
      return bc !== undefined && bc.score !== c.score;
    })
    .map((c) => {
      const bc = before.categories.find((b) => b.name === c.name)!;
      const d = c.score - bc.score;
      return `${c.name} ${d > 0 ? '+' : ''}${d}`;
    });

  const lines = [`🔩 Ratchet: score ${before.total} → ${after.total} (${formatDelta(delta)})`];
  if (changedCats.length > 0) {
    lines.push(`   ${changedCats.join(' · ')}`);
  }
  if (footer) {
    lines.push('   https://ratchetcli.com');
  }

  return lines.join('\n');
}

// --- Full PR description (markdown, for PR body) ---

export function generatePRDescription(
  before: ScanResult,
  after: ScanResult,
  changes: string[],
  options: { footer?: boolean } = {},
): string {
  const { footer = true } = options;

  const delta = after.total - before.total;
  const overallEmoji = scoreEmoji(before.total, after.total, after.maxTotal);

  const lines: string[] = [
    '## 🔩 Ratchet Score Improvement',
    '',
    `**Overall: ${before.total}/${before.maxTotal} → ${after.total}/${after.maxTotal} ` +
    `(${formatDelta(delta)}) ${overallEmoji}**`,
    '',
    '| | Dimension | Before | After | Δ |',
    '|---|---|---|---|---|',
  ];

  for (const afterCat of after.categories) {
    const beforeCat = before.categories.find((c) => c.name === afterCat.name);
    if (!beforeCat) continue;
    const catDelta = afterCat.score - beforeCat.score;
    const emoji = scoreEmoji(beforeCat.score, afterCat.score, afterCat.max);
    const deltaStr = catDelta === 0 ? '±0' : formatDelta(catDelta);
    lines.push(
      `| ${emoji} | ${afterCat.emoji} ${afterCat.name} | ${beforeCat.score}/${afterCat.max} | ` +
      `${afterCat.score}/${afterCat.max} | ${deltaStr} |`,
    );
  }

  if (changes.length > 0) {
    lines.push('', '### Files changed', '');
    for (const change of changes) {
      lines.push(`- \`${change}\``);
    }
  }

  if (footer) {
    lines.push('', '---', '*Powered by [Ratchet](https://ratchetcli.com) · Scan your repo free*');
  }

  return lines.join('\n');
}
