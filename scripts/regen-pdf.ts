import { writePDF } from '../src/core/pdf-report.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const runsDir = join(cwd, '.ratchet', 'runs');

// Find the run to regenerate: use CLI arg or latest
const runId = process.argv[2];
let runFile: string;

if (runId) {
  runFile = join(runsDir, `${runId}.json`);
} else {
  // Find most recent run by savedAt
  const files = readdirSync(runsDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No saved runs found in .ratchet/runs/');
    process.exit(1);
  }
  let latest = { file: '', savedAt: '' };
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(runsDir, f), 'utf-8'));
    if (data.savedAt > latest.savedAt) {
      latest = { file: f, savedAt: data.savedAt };
    }
  }
  runFile = join(runsDir, latest.file);
}

console.log(`Reading run from: ${runFile}`);
const entry = JSON.parse(readFileSync(runFile, 'utf-8'));

// Reconstruct dates on the run object
const run = entry.run;
run.startedAt = new Date(run.startedAt);
run.finishedAt = run.finishedAt ? new Date(run.finishedAt) : undefined;

const scoreBefore = entry.scoreBefore ?? undefined;
const scoreAfter = entry.scoreAfter ?? undefined;

if (scoreBefore && scoreAfter) {
  const bPct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
  const aPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
  console.log(`Score: ${bPct} → ${aPct} ` +
    `(${scoreBefore.total}/${scoreBefore.maxTotal} → ${scoreAfter.total}/${scoreAfter.maxTotal})`);
  console.log(`Issues: ${scoreBefore.totalIssuesFound} → ${scoreAfter.totalIssuesFound}` +
    ` (${scoreBefore.totalIssuesFound - scoreAfter.totalIssuesFound} fixed)`);
} else {
  console.log('Warning: No before/after scores available — hero card will not render');
}

const outPath = await writePDF({
  run,
  cwd,
  scoreBefore,
  scoreAfter,
  projectName: 'ratchet',
});

console.log(`PDF generated: ${outPath}`);
const size = Math.round(readFileSync(outPath).length / 1024);
console.log(`Size: ${size} KB`);
