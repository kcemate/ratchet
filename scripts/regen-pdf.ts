import { writePDF } from '../src/core/pdf-report.js';
import { runScan } from '../src/commands/scan.js';
import { readFileSync } from 'fs';

const state = JSON.parse(readFileSync('.ratchet-state.json', 'utf-8'));

// Reconstruct dates
state.startedAt = new Date(state.startedAt);
state.finishedAt = state.finishedAt ? new Date(state.finishedAt) : undefined;

const cwd = process.cwd();

// Run a scan to get current scores
console.log('Scanning for current scores...');
const scoreAfter = await runScan(cwd);
console.log(`Score: ${scoreAfter.total}/100`);

const outPath = await writePDF({
  run: state,
  cwd,
  scoreAfter,
  projectName: 'ratchet',
});

console.log(`PDF generated: ${outPath}`);
const size = Math.round(readFileSync(outPath).length / 1024);
console.log(`Size: ${size} KB`);
