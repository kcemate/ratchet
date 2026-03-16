import { writePDF } from '../src/core/pdf-report.js';
import { runScan } from '../src/commands/scan.js';
import { readFileSync } from 'fs';

const state = JSON.parse(readFileSync('.ratchet-state.json', 'utf-8'));

// Reconstruct dates
state.startedAt = new Date(state.startedAt);
state.finishedAt = state.finishedAt ? new Date(state.finishedAt) : undefined;

const cwd = process.cwd();

// Use saved scores if available, otherwise scan fresh
const scoreBefore = state._scoreBefore ?? undefined;
let scoreAfter = state._scoreAfter ?? undefined;

if (!scoreAfter) {
  console.log('No saved scoreAfter — scanning for current scores...');
  scoreAfter = await runScan(cwd);
}

if (scoreBefore && scoreAfter) {
  console.log(`Score: ${scoreBefore.total} → ${scoreAfter.total} / ${scoreAfter.maxTotal}`);
} else {
  console.log(`Score: ${scoreAfter?.total ?? 'unknown'} / ${scoreAfter?.maxTotal ?? '?'} (no before-score available)`);
}

const outPath = await writePDF({
  run: state,
  cwd,
  scoreBefore,
  scoreAfter,
  projectName: 'ratchet',
});

console.log(`PDF generated: ${outPath}`);
const size = Math.round(readFileSync(outPath).length / 1024);
console.log(`Size: ${size} KB`);
