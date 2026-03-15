import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { loadConfig } from '../core/config.js';
import { saveRun } from '../core/history.js';
import { checkStaleBinary } from '../core/stale-check.js';
import { runSweepEngine } from '../core/engine.js';
import type { ClickPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { RatchetLogger } from '../core/logger.js';
import { writePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { isRepo, status as gitStatus } from '../core/git.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import type { Click, RatchetRun, SwarmConfig } from '../types.js';
import { formatDuration } from '../core/utils.js';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { LearningStore } from '../core/learning.js';
import { SimulationEngine, aggregateResults } from '../core/simulate.js';
import type { SimulationResult } from '../core/simulate.js';

const STATE_FILE = '.ratchet-state.json';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function sevColor(s: string): string {
  return s === 'high' ? '#ef4444' : s === 'medium' ? '#f59e0b' : '#6b7280';
}
function sevBg(s: string): string {
  return s === 'high' ? '#2d1215' : s === 'medium' ? '#2d2412' : '#1f1f23';
}
function scoreColor(pct: number): string {
  if (pct >= 0.8) return '#22c55e';
  if (pct >= 0.6) return '#f59e0b';
  return '#ef4444';
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sanitize a click's raw proposal (which contains agent prompt instructions)
 * into a clean, customer-safe summary. Also strips absolute file paths.
 */
function sanitizeProposal(raw: string, fileCount: number): string {
  if (!raw) return 'Fixed issues across ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '');
  // The proposal field often contains the full agent prompt, not a summary.
  // Extract the issue type and generate a clean description.
  const issueMatch = raw.match(/ISSUE:\s*(.+)/i);
  const issueType = issueMatch ? issueMatch[1].trim() : null;
  if (issueType) {
    const plural = fileCount !== 1 ? 's' : '';
    return `Fixed ${issueType} across ${fileCount} file${plural}`;
  }
  return 'Fixed issues across ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '');
}

function sanitizeFilePath(f: string): string {
  // Strip absolute path prefixes, keep relative from project root
  return f.replace(/^.*?\/(?=(?:src|server|client|lib|routes|tests|scripts|components)\/)/, '')
          .replace(/^\/Users\/[^/]+\/[^/]+\/[^/]+\//, '');
}

function renderClickCard(c: {
  num: number; landed: boolean; filesModified: string[]; proposal: string;
  swarmSpecialization?: string; adversarialResult?: { challenged: boolean; passed: boolean; reasoning: string };
}): string {
  const icon = c.landed ? '✅' : '↩️';
  const label = c.landed ? 'Landed' : 'Rolled back';
  const labelColor = c.landed ? '#22c55e' : '#f59e0b';
  const cleanFiles = c.filesModified.map(sanitizeFilePath);
  const files = cleanFiles.slice(0, 4).map(f => f.split('/').slice(-2).join('/')).join(', ');
  const extraFiles = cleanFiles.length > 4 ? ' +' + (cleanFiles.length - 4) + ' more' : '';
  const summary = sanitizeProposal(c.proposal, cleanFiles.length);

  // Swarm + adversarial metadata badges
  let badges = '';
  if (c.swarmSpecialization) {
    badges += '<span class="pill" style="background:#1a1a2e;color:#818cf8;margin-right:6px;">swarm:' + esc(c.swarmSpecialization) + '</span>';
  }
  if (c.adversarialResult?.challenged) {
    const advColor = c.adversarialResult.passed ? '#22c55e' : '#ef4444';
    const advLabel = c.adversarialResult.passed ? 'QA passed' : 'QA failed';
    badges += '<span class="pill" style="background:#1a1a2e;color:' + advColor + ';">' + advLabel + '</span>';
  }

  return '<div class="click-row">' +
    '<div class="click-head">' +
    '<span class="click-icon">' + icon + '</span>' +
    '<span class="click-label">Click ' + c.num + '</span>' +
    '<span style="color:' + labelColor + '; font-size:12px; font-weight:600;">' + label + '</span>' +
    (badges ? '<span style="margin-left:auto;">' + badges + '</span>' : '') +
    '</div>' +
    (summary ? '<div class="click-proposal">' + esc(summary) + '</div>' : '') +
    (files ? '<div class="click-files" style="margin-top:4px;">' + esc(files) + esc(extraFiles) + '</div>' : '') +
    '</div>';
}

function buildResultsPDF(before: ScanResult, after: ScanResult, runMeta: {
  totalClicks: number;
  landedClicks: number;
  rolledBack: number;
  duration: string;
  clickDetails: Array<{
    num: number; landed: boolean; filesModified: string[]; proposal: string;
    swarmSpecialization?: string;
    adversarialResult?: { challenged: boolean; passed: boolean; reasoning: string };
  }>;
  simulationResult?: SimulationResult | null;
}): string {
  const scoreBefore = before.total;
  const scoreAfter = after.total;
  const scoreDelta = scoreAfter - scoreBefore;
  const deltaStr = scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta);
  const deltaColor = scoreDelta > 0 ? '#22c55e' : scoreDelta < 0 ? '#ef4444' : '#9ca3af';
  const issuesBefore = before.totalIssuesFound;
  const issuesAfter = after.totalIssuesFound;
  const issuesFixed = issuesBefore - issuesAfter;

  // Build issue delta table
  const beforeMap: Record<string, { count: number; severity: string }> = {};
  (before.issuesByType || []).forEach(i => { beforeMap[i.description] = { count: i.count, severity: i.severity }; });

  const issueDeltaRows = (after.issuesByType || [])
    .map(a => {
      const b = beforeMap[a.description];
      if (!b) return null;
      const diff = a.count - b.count;
      return { desc: a.description, severity: a.severity, before: b.count, after: a.count, diff };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.diff - b.diff);

  // Category delta rows
  const catRows = (after.categories || []).map((a, i) => {
    const b = (before.categories || [])[i];
    if (!b) return null;
    const diff = a.score - b.score;
    return { name: a.name, emoji: a.emoji, scoreBefore: b.score, scoreAfter: a.score, max: a.max, diff };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: A4; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    background: #0a0a0a;
    color: #fafafa;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 44px 52px;
    position: relative;
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child { page-break-after: auto; }
  .section-title { font-size:22px; font-weight:700; margin-bottom:5px; }
  .section-sub { font-size:13px; color:#71717a; margin-bottom:24px; }
  .watermark { position:absolute; bottom:20px; right:52px; font-size:10px; color:#3f3f46; }
  .tag { display:inline-block; background:#1f1a0f; color:#f59e0b; padding:4px 12px; border-radius:14px;
    font-size:11px; font-weight:600; letter-spacing:0.3px; border:1px solid #3d2e0a; margin-bottom:22px; }
  .score-block { background:#151518; border:1px solid #27272a; border-radius:16px; padding:28px 36px; margin-bottom:24px; }
  .score-row { display:flex; align-items:center; justify-content:center; gap:40px; margin-bottom:16px; }
  .score-col { text-align:center; }
  .score-label { font-size:10px; color:#71717a; font-weight:700; letter-spacing:0.8px; margin-bottom:8px; }
  .score-num { font-size:56px; font-weight:800; line-height:1; }
  .score-track { width:120px; height:6px; background:#27272a; border-radius:3px; margin:8px auto 0; }
  .score-fill { height:6px; border-radius:3px; }
  .score-arrow { font-size:28px; color:#3f3f46; }
  .delta-big { font-size:32px; font-weight:800; text-align:center; }
  .stat-grid { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:14px; }
  .stat-box { background:#151518; border:1px solid #27272a; border-radius:12px; padding:18px; text-align:center; }
  .stat-num { font-size:28px; font-weight:800; margin-bottom:3px; }
  .stat-label { font-size:11px; color:#71717a; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:9px 12px; font-size:10px; color:#71717a; font-weight:700;
    text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #27272a; }
  td { padding:10px 12px; font-size:13px; border-bottom:1px solid #18181b; }
  .pill { display:inline-block; padding:2px 9px; border-radius:9px; font-size:10px; font-weight:600; }
  .click-row { background:#151518; border:1px solid #27272a; border-radius:10px; padding:14px 18px; margin-bottom:8px; }
  .click-head { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .click-icon { font-size:14px; }
  .click-label { font-size:13px; font-weight:600; }
  .click-files { font-size:11px; color:#71717a; }
  .click-proposal { font-size:11px; color:#a1a1aa; line-height:1.5; margin-top:4px; }
</style>
</head>
<body>

<!-- PAGE 1: RESULTS HERO ──────────────────────────────────── -->
<div class="page">
  <div class="tag">⚙️ RATCHET IMPROVEMENT REPORT · ${esc(dateStr)}</div>

  <div class="section-title">Before &amp; After</div>
  <div class="section-sub">Autonomous code improvement run on ${esc(before.projectName || 'project')}</div>

  <div class="score-block">
    <div class="score-row">
      <div class="score-col">
        <div class="score-label">BEFORE</div>
        <div class="score-num" style="color:${scoreColor(scoreBefore / 100)}">${scoreBefore}</div>
        <div class="score-track"><div class="score-fill" style="width:${scoreBefore}%; background:${scoreColor(scoreBefore / 100)};"></div></div>
      </div>
      <div class="score-col">
        <div class="score-arrow">→</div>
        <div class="delta-big" style="color:${deltaColor}">${esc(deltaStr)}</div>
        <div style="font-size:11px; color:#71717a; margin-top:4px; text-align:center;">points</div>
      </div>
      <div class="score-col">
        <div class="score-label">AFTER</div>
        <div class="score-num" style="color:${scoreColor(scoreAfter / 100)}">${scoreAfter}</div>
        <div class="score-track"><div class="score-fill" style="width:${scoreAfter}%; background:${scoreColor(scoreAfter / 100)};"></div></div>
      </div>
    </div>
    <div style="text-align:center; font-size:13px; color:#71717a;">
      Issues: <strong style="color:#fafafa;">${issuesBefore}</strong> → <strong style="color:#fafafa;">${issuesAfter}</strong>
      ${issuesFixed > 0 ? `<span style="color:#22c55e;"> (${issuesFixed} fixed)</span>` : ''}
    </div>
  </div>

  <div class="stat-grid">
    <div class="stat-box">
      <div class="stat-num" style="color:#f59e0b;">${runMeta.totalClicks}</div>
      <div class="stat-label">Clicks run</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" style="color:#22c55e;">${runMeta.landedClicks}</div>
      <div class="stat-label">Landed clean</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" style="color:${runMeta.rolledBack > 0 ? '#ef4444' : '#71717a'};">${runMeta.rolledBack}</div>
      <div class="stat-label">Rolled back</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" style="color:#3b82f6;">${esc(runMeta.duration)}</div>
      <div class="stat-label">Total time</div>
    </div>
  </div>

  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- PAGE 2: ISSUE DELTA TABLE ──────────────────────────────── -->
<div class="page">
  <div class="section-title">Issues Fixed</div>
  <div class="section-sub">All issue types detected — counts before and after the run</div>

  <table>
    <thead>
      <tr>
        <th>Issue</th>
        <th>Severity</th>
        <th style="text-align:right;">Before</th>
        <th style="text-align:right;">After</th>
        <th style="text-align:right;">Change</th>
      </tr>
    </thead>
    <tbody>
      ${issueDeltaRows.map(row => {
        const diffStr = row.diff < 0 ? `−${Math.abs(row.diff)}` : row.diff > 0 ? `+${row.diff}` : '—';
        const diffColor = row.diff < 0 ? '#22c55e' : row.diff > 0 ? '#ef4444' : '#71717a';
        return `<tr>
          <td>${esc(row.desc)}</td>
          <td><span class="pill" style="background:${sevBg(row.severity)};color:${sevColor(row.severity)};">${row.severity}</span></td>
          <td style="text-align:right; color:#a1a1aa;">${row.before}</td>
          <td style="text-align:right; font-weight:600;">${row.after}</td>
          <td style="text-align:right; font-weight:700; color:${diffColor};">${diffStr}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- PAGE 3: CATEGORY SCORES ──────────────────────────────── -->
<div class="page">
  <div class="section-title">Score Breakdown</div>
  <div class="section-sub">Category-by-category improvement</div>

  <table style="margin-bottom:32px;">
    <thead>
      <tr>
        <th>Category</th>
        <th style="text-align:right;">Before</th>
        <th style="text-align:right;">After</th>
        <th style="text-align:right;">Max</th>
        <th style="text-align:right;">Change</th>
      </tr>
    </thead>
    <tbody>
      ${catRows.map(row => {
        const diffStr = row.diff > 0 ? `+${row.diff}` : row.diff < 0 ? String(row.diff) : '—';
        const diffColor = row.diff > 0 ? '#22c55e' : row.diff < 0 ? '#ef4444' : '#71717a';
        const afterPct = Math.round((row.scoreAfter / row.max) * 100);
        return `<tr>
          <td>${esc(row.emoji)} ${esc(row.name)}</td>
          <td style="text-align:right; color:#a1a1aa;">${row.scoreBefore}</td>
          <td style="text-align:right; font-weight:600; color:${scoreColor(row.scoreAfter / row.max)};">${row.scoreAfter}</td>
          <td style="text-align:right; color:#3f3f46;">${row.max}</td>
          <td style="text-align:right; font-weight:700; color:${diffColor};">${diffStr}</td>
        </tr>
        <tr>
          <td colspan="5" style="padding:4px 12px 12px;">
            <div style="width:100%; height:4px; background:#27272a; border-radius:2px;">
              <div style="width:${afterPct}%; height:4px; background:${scoreColor(row.scoreAfter / row.max)}; border-radius:2px;"></div>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- PAGE 4: CLICK LOG ──────────────────────────────────────── -->
<div class="page">
  <div class="section-title">What Ratchet Did</div>
  <div class="section-sub">Every change made — ${runMeta.totalClicks} clicks, each tested before committing</div>

  ${runMeta.clickDetails.map(c => renderClickCard(c)).join('')}

  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

${runMeta.simulationResult ? `
<!-- PAGE 5: USER IMPACT ASSESSMENT ────────────────────── -->
<div class="page">
  <div class="section-title">User Impact Assessment</div>
  <div class="section-sub">Persona simulation — how real users would experience these changes</div>

  <div class="score-block" style="margin-bottom:20px;">
    <div class="score-label" style="margin-bottom:12px;">OVERALL SENTIMENT</div>
    <div style="font-size:16px; line-height:1.6;">${esc(runMeta.simulationResult.summary.overallSentiment)}</div>
  </div>

  ${runMeta.simulationResult.summary.topPainPoints.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:14px; font-weight:700; margin-bottom:8px;">Top Pain Points</div>
    ${runMeta.simulationResult.summary.topPainPoints.slice(0, 5).map(p =>
      '<div style="font-size:12px; color:#f59e0b; padding:4px 0;">• ' + esc(p) + '</div>'
    ).join('')}
  </div>` : ''}

  ${runMeta.simulationResult.summary.topSuggestions.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:14px; font-weight:700; margin-bottom:8px;">Top Suggestions</div>
    ${runMeta.simulationResult.summary.topSuggestions.slice(0, 5).map(s =>
      '<div style="font-size:12px; color:#22c55e; padding:4px 0;">• ' + esc(s) + '</div>'
    ).join('')}
  </div>` : ''}

  ${runMeta.simulationResult.summary.criticalDropoffs.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:14px; font-weight:700; margin-bottom:8px;">Critical Drop-offs</div>
    ${runMeta.simulationResult.summary.criticalDropoffs.slice(0, 3).map(d =>
      '<div style="font-size:12px; color:#ef4444; padding:4px 0;">• ' + esc(d) + '</div>'
    ).join('')}
  </div>` : ''}

  <div style="margin-top:16px;">
    <div style="font-size:14px; font-weight:700; margin-bottom:12px;">Persona Results</div>
    ${runMeta.simulationResult.personas.map(p => {
      const sentColor = p.sentiment === 'positive' ? '#22c55e' : p.sentiment === 'negative' ? '#ef4444' : '#71717a';
      return '<div class="click-row" style="margin-bottom:8px;">' +
        '<div class="click-head">' +
        '<span class="click-label">' + esc(p.persona.name) + '</span>' +
        '<span style="font-size:11px; color:#71717a;">(' + esc(p.persona.type) + ')</span>' +
        '<span class="pill" style="margin-left:auto; background:#151518; color:' + sentColor + ';">' + esc(p.sentiment) + '</span>' +
        '</div>' +
        (p.droppedAt ? '<div style="font-size:11px; color:#ef4444; margin-top:4px;">Dropped at: ' + esc(p.droppedAt) + '</div>' : '') +
        '</div>';
    }).join('')}
  </div>

  <div class="watermark">ratchet — autonomous code improvement</div>
</div>` : ''}

</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Command
// ──────────────────────────────────────────────────────────────────────────────

export function improveCommand(): Command {
  const cmd = new Command('improve');

  cmd
    .description(
      'Scan → fix → rescan → report. One command.\n\n' +
        'Runs a multi-sweep across all high-severity issue types, then generates\n' +
        'a before/after PDF showing exactly what was fixed and how the score changed.',
    )
    .option('-n, --clicks <number>', 'Total clicks to run across all issue types (default: 10)', '10')
    .option('--out <path>', 'Output PDF path (default: docs/improve-report.pdf)')
    .option('--no-swarm', 'Disable swarm mode (swarm is on by default)')
    .option('--no-adversarial', 'Disable adversarial QA (adversarial is on by default)')
    .option('--no-simulate', 'Disable post-run persona simulation')
    .addHelpText('after', '\nExample:\n  $ ratchet improve\n  $ ratchet improve --clicks 15\n  $ ratchet improve --no-swarm --no-adversarial --no-simulate\n')
    .action(async (options: { clicks: string; out?: string; swarm: boolean; adversarial: boolean; simulate: boolean }) => {
      const cwd = process.cwd();

      console.log(chalk.bold('\n⚙  Ratchet Improve\n'));

      const staleWarning = checkStaleBinary();
      if (staleWarning) console.warn(chalk.yellow(`  ${staleWarning}\n`));

      if (!(await isRepo(cwd))) {
        console.error(chalk.red('  Not a git repository. Ratchet requires git.\n'));
        process.exit(1);
      }

      const ws = await gitStatus(cwd);
      const dirtyFiles = [...ws.staged, ...ws.unstaged, ...ws.untracked].length;
      if (dirtyFiles > 0) {
        const shown = [...ws.staged, ...ws.unstaged, ...ws.untracked].slice(0, 3).join(', ');
        const extra = dirtyFiles > 3 ? ` +${dirtyFiles - 3} more` : '';
        console.warn(
          chalk.yellow(`  ⚠  Dirty worktree: ${dirtyFiles} uncommitted files`) +
            chalk.dim(` (${shown}${extra}). Will stash before each click.\n`),
        );
      }

      let config;
      try {
        config = loadConfig(cwd);
      } catch (err) {
        console.error(chalk.red('Error loading .ratchet.yml: ') + String(err));
        process.exit(1);
      }

      const clickCount = parseInt(options.clicks, 10);
      if (isNaN(clickCount) || clickCount < 1) {
        console.error(chalk.red(`  Invalid --clicks value: ${options.clicks}\n`));
        process.exit(1);
      }

      const outPath = options.out ?? join(cwd, 'docs', 'improve-report.pdf');

      console.log(`  Clicks : ${chalk.yellow(String(clickCount))}`);
      console.log(`  Tests  : ${chalk.dim(config.defaults.testCommand)}`);
      console.log(`  Output : ${chalk.dim(outPath)}`);
      console.log('');

      // ── Step 1: Scan (before) ──
      const scanSpinner = ora('  Scanning codebase…').start();
      let scoreBefore: ScanResult;
      try {
        scoreBefore = await runScan(cwd);
        scanSpinner.succeed(
          `  Scan complete: ${chalk.bold(`${scoreBefore.total}/100`)} · ${chalk.yellow(String(scoreBefore.totalIssuesFound))} issues`,
        );
      } catch (err) {
        scanSpinner.fail('  Scan failed: ' + String(err));
        process.exit(1);
      }

      // Print issue breakdown
      console.log('');
      console.log(chalk.dim('  Issues to fix:'));
      (scoreBefore.issuesByType || [])
        .filter(i => i.count > 0)
        .slice(0, 8)
        .forEach(i => {
          const sev = i.severity === 'high' ? chalk.red('●') : i.severity === 'medium' ? chalk.yellow('●') : chalk.dim('●');
          console.log(`    ${sev} ${chalk.bold(String(i.count))} ${chalk.dim(i.description)}`);
        });
      console.log('');

      // ── Step 2: Fix (sweep all issue types) ──
      const target = { name: 'improve', path: '.', description: 'Improve all issue types across the codebase' };
      config.guards = { maxLinesChanged: 40, maxFilesChanged: 10 };

      // Wire swarm mode as default (opt out with --no-swarm)
      const useSwarm = options.swarm !== false;
      const useAdversarial = options.adversarial !== false;

      if (useSwarm) {
        config.swarm = {
          enabled: true,
          agentCount: 3,
          specializations: ['security', 'quality', 'errors'],
          parallel: true,
          worktreeDir: '/tmp/ratchet-swarm',
        };
        console.log(`  Swarm : ${chalk.green('on')} ${chalk.dim('(3 agents)')}`);
      } else {
        console.log(`  Swarm : ${chalk.dim('off')}`);
      }
      console.log(`  Adversarial : ${useAdversarial ? chalk.green('on') : chalk.dim('off')}`);
      console.log('');

      const agent = new ShellAgent({ model: config.model, cwd });
      const logger = new RatchetLogger(target.name, cwd);

      // Initialize learning store for cross-run learning
      const learningStore = new LearningStore(cwd);
      await learningStore.load();

      acquireLock(cwd);

      let run: RatchetRun;
      let spinner: ReturnType<typeof ora> | null = null;

      try {
        run = await runSweepEngine({
          target,
          clicks: clickCount,
          config,
          cwd,
          agent,
          createBranch: true,
          adversarial: useAdversarial,
          scanResult: scoreBefore,
          learningStore,
          callbacks: {
            onScanComplete: () => {},
            onClickStart: async (n, total) => {
              spinner = ora(`  Click ${chalk.bold(String(n))}/${total} — fixing…`).start();
              if (n === 1) {
                await logger.initLog({ id: 'pending', target, clicks: [], startedAt: new Date(), status: 'running' }).catch(() => {});
              }
            },
            onClickPhase: (phase: ClickPhase, n: number) => {
              const labels: Record<ClickPhase, string> = {
                analyzing: 'analyzing…', proposing: 'proposing…',
                building: 'building…', testing: 'testing…', committing: 'committing…',
              };
              if (spinner) spinner.text = `  Click ${chalk.bold(String(n))}/${clickCount} — ${labels[phase]}`;
            },
            onClickComplete: async (click: Click, rolledBack: boolean) => {
              if (spinner) {
                if (click.testsPassed) {
                  spinner.succeed(
                    `  Click ${chalk.bold(String(click.number))} — ${chalk.green('✓ landed')}` +
                      (click.commitHash ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`) : '') +
                      (click.issuesFixedCount ? chalk.dim(` — ${click.issuesFixedCount} issues fixed`) : ''),
                  );
                } else {
                  spinner.warn(`  Click ${chalk.bold(String(click.number))} — ${chalk.yellow('✗ rolled back')}`);
                }
                spinner = null;
              }
            },
            onError: (err, n) => {
              if (spinner) { spinner.fail(`  Click ${n} — error: ${err.message}`); spinner = null; }
            },
          },
        });
      } catch (err) {
        if (spinner) (spinner as ReturnType<typeof ora>).fail();
        console.error(chalk.red('\nFatal error: ') + String(err));
        releaseLock(cwd);
        process.exit(1);
      }

      releaseLock(cwd);
      await logger.finalizeLog(run).catch(() => {});

      // ── Step 3: Rescan (after) ──
      const rescanSpinner = ora('  Rescanning codebase…').start();
      let scoreAfter: ScanResult;
      try {
        scoreAfter = await runScan(cwd);
        const delta = scoreAfter.total - scoreBefore.total;
        const deltaStr = delta > 0 ? chalk.green(`+${delta}`) : delta < 0 ? chalk.red(String(delta)) : chalk.dim('±0');
        rescanSpinner.succeed(
          `  Rescan complete: ${chalk.bold(`${scoreAfter.total}/100`)} (${deltaStr}) · ${scoreAfter.totalIssuesFound} issues remaining`,
        );
      } catch (err) {
        rescanSpinner.fail('  Rescan failed: ' + String(err));
        scoreAfter = scoreBefore; // fallback to before
      }

      // ── Step 3.5: Persona simulation (opt-out with --no-simulate) ──
      const landed = run.clicks.filter(c => c.testsPassed);
      let simResult: SimulationResult | null = null;
      const useSimulate = options.simulate !== false;
      if (useSimulate && landed.length > 0) {
        const simSpinner = ora('  Running persona simulation…').start();
        try {
          const modifiedFiles = run.clicks
            .filter(c => c.testsPassed)
            .flatMap(c => c.filesModified || [])
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 10);
          const scenario = `Use the features that were just modified: ${modifiedFiles.map(f => f.split('/').pop()).join(', ')}`;

          const simEngine = new SimulationEngine({
            personas: 3,
            scenario,
            cwd,
            model: config.model,
            timeout: 60_000,
          });
          simResult = await simEngine.run();
          simSpinner.succeed(`  Simulation complete: ${simResult.summary.overallSentiment}`);
        } catch {
          simSpinner.warn('  Simulation skipped (timed out or failed)');
        }
      }

      // ── Step 4: Generate PDF ──
      const pdfSpinner = ora('  Generating results PDF…').start();
      const rolledBack = run.clicks.filter(c => !c.testsPassed);
      const duration = run.finishedAt
        ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
        : formatDuration(Date.now() - run.startedAt.getTime());

      const html = buildResultsPDF(scoreBefore, scoreAfter, {
        totalClicks: run.clicks.length,
        landedClicks: landed.length,
        rolledBack: rolledBack.length,
        duration,
        clickDetails: run.clicks.map(c => ({
          num: c.number,
          landed: c.testsPassed,
          filesModified: c.filesModified || [],
          proposal: c.proposal || c.analysis || '',
          swarmSpecialization: c.swarmSpecialization,
          adversarialResult: c.adversarialResult,
        })),
        simulationResult: simResult,
      });

      try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({
          path: outPath,
          width: '210mm',
          height: '297mm',
          printBackground: true,
          margin: { top: '0', bottom: '0', left: '0', right: '0' },
          preferCSSPageSize: true,
        });
        await browser.close();

        const size = Math.round(readFileSync(outPath).length / 1024);
        pdfSpinner.succeed(`  PDF saved: ${chalk.cyan(outPath)} (${size} KB)`);
      } catch (err) {
        pdfSpinner.fail('  PDF generation failed: ' + String(err));
      }

      // Persist run
      await saveRun(cwd, run, scoreBefore, scoreAfter).catch(() => {});
      await writeFile(join(cwd, STATE_FILE), JSON.stringify(run, null, 2), 'utf-8').catch(() => {});

      // ── Summary ──
      const scoreDelta = scoreAfter.total - scoreBefore.total;
      const issuesFixed = scoreBefore.totalIssuesFound - scoreAfter.totalIssuesFound;

      process.stdout.write(`\n${chalk.bold('  ' + '─'.repeat(46))}\n\n  ${chalk.bold('Done.')}\n  Score:  ${scoreBefore.total} → ${chalk.bold(String(scoreAfter.total))} (${scoreDelta > 0 ? chalk.green(`+${scoreDelta}`) : chalk.yellow(String(scoreDelta))})\n  Issues: ${scoreBefore.totalIssuesFound} → ${scoreAfter.totalIssuesFound}${issuesFixed > 0 ? chalk.green(` (${issuesFixed} fixed)`) : ''}\n  Clicks: ${landed.length} landed · ${rolledBack.length} rolled back\n  Time:   ${duration}\n  PDF:    ${chalk.cyan(outPath)}\n\n`);

      if (landed.length > 0) {
        console.log(chalk.dim(`  Run ${chalk.cyan('ratchet tighten --pr')} to open a pull request.\n`));
      }
    });

  return cmd;
}
