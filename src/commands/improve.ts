import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { printHeader, exitWithError, validateInt, severityColor, printFields, validateProjectEnv, CLICK_PHASE_LABELS, formatScoreDelta } from '../lib/cli.js';
import { STATE_FILE } from './status.js';
import { saveRun } from '../core/history.js';
import { runSweepEngine, runArchitectEngine } from '../core/engine.js';
import { runTierEngine, planTierTargets } from '../core/tier-engine.js';
import type { ClickPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { RatchetLogger } from '../core/logger.js';
import { writePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import type { Click, RatchetRun, SwarmConfig } from '../types.js';
import { formatDuration } from '../core/utils.js';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { LearningStore } from '../core/learning.js';
import { SimulationEngine, aggregateResults } from '../core/simulate.js';
import type { SimulationResult } from '../core/simulate.js';
import { allocateClicks } from '../core/allocator.js';
import { generateScorePlan } from '../core/score-optimizer.js';

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

/**
 * Build a 2-3 sentence executive summary from run data.
 */
function buildExecutiveSummary(before: ScanResult, after: ScanResult, runMeta: {
  totalClicks: number; landedClicks: number; rolledBack: number; duration: string;
}): string {
  const issuesFixed = before.totalIssuesFound - after.totalIssuesFound;
  const catDeltas = (after.categories || []).map((a, i) => {
    const b = (before.categories || [])[i];
    if (!b) return null;
    return { name: a.name, diff: a.score - b.score };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const bestCat = catDeltas.reduce((best, c) => (c.diff > (best?.diff ?? -Infinity) ? c : best), catDeltas[0]);

  let summary = `Ratchet ran ${runMeta.totalClicks} click${runMeta.totalClicks !== 1 ? 's' : ''} in ${runMeta.duration}`;
  if (issuesFixed > 0) {
    summary += `, fixing ${issuesFixed} issue${issuesFixed !== 1 ? 's' : ''}`;
  }
  summary += '.';

  if (bestCat && bestCat.diff > 0) {
    summary += ` ${bestCat.name} improved the most (+${bestCat.diff} point${bestCat.diff !== 1 ? 's' : ''}).`;
  }

  if (runMeta.rolledBack > 0) {
    summary += ` ${runMeta.rolledBack} click${runMeta.rolledBack !== 1 ? 's were' : ' was'} rolled back due to test failures.`;
  }

  return summary;
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
  const projectName = before.projectName || 'project';

  // Executive summary
  const execSummary = buildExecutiveSummary(before, after, runMeta);

  // Top 3 wins (biggest issue count reductions)
  const topWins = issueDeltaRows
    .filter(r => r.diff < 0)
    .slice(0, 3)
    .map(r => ({ desc: r.desc, reduction: Math.abs(r.diff) }));

  // Footer HTML
  const footerHtml = `<div class="page-footer">Generated by Ratchet · ${esc(dateStr)} · ${esc(projectName)} · ratchetcli.com</div>`;

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
  .page-footer { position:absolute; bottom:18px; left:52px; right:52px; font-size:9px; color:#3f3f46; text-align:center; letter-spacing:0.3px; }
  .exec-summary { background:#1a1708; border:1px solid #3d2e0a; border-radius:12px; padding:16px 20px; margin-top:20px; font-size:13px; color:#d4d4d8; line-height:1.6; }
  .exec-summary::before { content:'📋'; margin-right:8px; }
  .top-wins { background:#0a1a0a; border:1px solid #14532d; border-radius:12px; padding:16px 20px; margin-bottom:20px; }
  .top-wins-title { font-size:13px; font-weight:700; color:#22c55e; margin-bottom:10px; }
  .top-win-item { font-size:13px; color:#d4d4d8; padding:4px 0; }
  .top-win-arrow { color:#22c55e; font-weight:700; margin-right:6px; }
  .cat-bars { display:flex; gap:3px; align-items:flex-end; height:24px; margin:4px 0; }
  .cat-bar { border-radius:2px; min-width:1px; }
  .timeline { display:flex; align-items:center; justify-content:center; padding:20px 0 24px; position:relative; }
  .timeline-line { position:absolute; top:50%; left:40px; right:40px; height:2px; background:#27272a; transform:translateY(-50%); }
  .timeline-dot { width:14px; height:14px; border-radius:50%; position:relative; z-index:1; border:2px solid #0a0a0a; }
  .timeline-dots { display:flex; justify-content:space-between; width:100%; padding:0 40px; position:relative; z-index:1; }
  .timeline-dot-wrap { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .timeline-dot-label { font-size:9px; color:#71717a; }
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

  <div class="exec-summary">${esc(execSummary)}</div>

  ${footerHtml}
</div>

<!-- PAGE 2: ISSUE DELTA TABLE ──────────────────────────────── -->
<div class="page">
  <div class="section-title">Issues Fixed</div>
  <div class="section-sub">All issue types detected — counts before and after the run</div>

  ${topWins.length > 0 ? `<div class="top-wins">
    <div class="top-wins-title">🏆 Top ${topWins.length} Win${topWins.length !== 1 ? 's' : ''}</div>
    ${topWins.map(w => `<div class="top-win-item"><span class="top-win-arrow">↓ ${w.reduction}</span>${esc(w.desc)}</div>`).join('')}
  </div>` : ''}

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

  ${footerHtml}
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
        const beforePct = Math.round((row.scoreBefore / row.max) * 100);
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
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="flex:1; position:relative; height:16px;">
                <div style="position:absolute; top:0; left:0; width:${beforePct}%; height:6px; background:#52525b; border-radius:2px; opacity:0.5;"></div>
                <div style="position:absolute; top:9px; left:0; width:${afterPct}%; height:6px; background:${scoreColor(row.scoreAfter / row.max)}; border-radius:2px;"></div>
              </div>
              <div style="font-size:9px; color:#71717a; white-space:nowrap; width:55px; text-align:right;">
                <span style="color:#52525b;">before</span> / <span style="color:${scoreColor(row.scoreAfter / row.max)};">after</span>
              </div>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  ${footerHtml}
</div>

<!-- PAGE 4: CLICK LOG ──────────────────────────────────────── -->
<div class="page">
  <div class="section-title">What Ratchet Did</div>
  <div class="section-sub">Every change made — ${runMeta.totalClicks} clicks, each tested before committing</div>

  <div class="timeline">
    <div class="timeline-line"></div>
    <div class="timeline-dots">
      ${runMeta.clickDetails.map(c => {
        const dotColor = c.landed ? '#22c55e' : '#f59e0b';
        return `<div class="timeline-dot-wrap">
          <div class="timeline-dot" style="background:${dotColor};"></div>
          <div class="timeline-dot-label">${c.num}</div>
        </div>`;
      }).join('')}
    </div>
  </div>

  ${runMeta.clickDetails.map(c => renderClickCard(c)).join('')}

  ${footerHtml}
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

  ${footerHtml}
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
    .option('--no-architect', 'Disable architect phase (architect+surgical is the default)')
    .addHelpText('after', '\nExample:\n  $ ratchet improve\n  $ ratchet improve --clicks 14\n  $ ratchet improve --no-swarm --no-adversarial --no-simulate\n')
    .action(async (options: { clicks: string; out?: string; swarm: boolean; adversarial: boolean; simulate: boolean; architect: boolean }) => {
      const cwd = process.cwd();

      printHeader('⚙  Ratchet Improve');

      const config = await validateProjectEnv(cwd);

      const clickCount = validateInt(options.clicks, 'clicks', 1);

      const outPath = options.out ?? join(cwd, 'docs', 'improve-report.pdf');

      printFields([
        ['Clicks', chalk.yellow(String(clickCount))],
        ['Tests',  chalk.dim(config.defaults.testCommand)],
        ['Output', chalk.dim(outPath)],
      ]);

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
      process.stdout.write('\n' + chalk.dim('  Issues to fix:') + '\n');
      (scoreBefore.issuesByType || [])
        .filter(i => i.count > 0)
        .slice(0, 8)
        .forEach(i => {
          const sev = severityColor(i.severity)('●');
          process.stdout.write(`    ${sev} ${chalk.bold(String(i.count))} ${chalk.dim(i.description)}\n`);
        });
      process.stdout.write('\n');

      // ── Step 2: Fix (architect phase → surgical phase) ──
      // Default: first half of clicks = architect mode (structural, high-leverage)
      //          second half          = surgical sweep (cleanup what's left)
      // Opt out of architect phase with --no-architect.
      const target = { name: 'improve', path: '.', description: 'Improve all issue types across the codebase' };
      config.guards = { maxLinesChanged: 40, maxFilesChanged: 10 };

      const baseScore = scoreBefore.total;
      // Smart swarm: auto-disable on high-score codebases (>75) unless explicitly requested
      const useSwarm = options.swarm !== false && baseScore <= 75;
      const useAdversarial = options.adversarial !== false;
      const useArchitect = options.architect !== false;

      if (options.swarm !== false && baseScore > 75) {
        process.stdout.write(chalk.dim(`  Auto-skipping swarm (score ${baseScore}/100 > 75 — diminishing returns)\n`));
      }

      const allocation = allocateClicks(scoreBefore, clickCount);
      const architectClicks = useArchitect ? allocation.architectClicks : 0;
      const surgicalClicks = useArchitect ? allocation.surgicalClicks : clickCount;
      if (useArchitect) {
        process.stdout.write(chalk.dim(`  Allocation: ${allocation.reasoning}\n`));
      }

      if (useSwarm) {
        config.swarm = {
          enabled: true,
          agentCount: 3,
          specializations: ['security', 'quality', 'errors'],
          parallel: true,
          worktreeDir: '/tmp/ratchet-swarm',
        };
      }

      const modeFields: Array<[string, string]> = [
        ['Swarm',       useSwarm ? `${chalk.green('on')} ${chalk.dim('(3 agents)')}` : chalk.dim('off')],
        ['Adversarial', useAdversarial ? chalk.green('on') : chalk.dim('off')],
      ];
      if (useArchitect) {
        modeFields.push(['Strategy', `${chalk.cyan(`${architectClicks} architect`)} ${chalk.dim('→')} ${chalk.green(`${surgicalClicks} surgical`)}`]);
      }
      printFields(modeFields);

      // Print score optimization plan
      const scorePlan = generateScorePlan(scoreBefore);
      process.stdout.write('\n' + chalk.dim(scorePlan) + '\n\n');

      // Model tiering: architect phase gets the configured (expensive) model,
      // surgical phase uses sonnet for mechanical fixes (70%+ cost reduction)
      const architectModel = config.model; // Opus or whatever is configured
      const surgicalModel = config.model?.includes('opus') ? config.model.replace('opus', 'sonnet') : config.model;
      const architectAgent = new ShellAgent({ model: architectModel, cwd });
      const surgicalAgent = new ShellAgent({ model: surgicalModel, cwd });
      if (surgicalModel !== architectModel) {
        process.stdout.write(chalk.dim(`  Model tiering: architect=${architectModel || 'default'}, surgical=${surgicalModel || 'default'}\n`));
      }
      // Legacy alias for phases that don't need tiering
      const agent = architectAgent;
      const logger = new RatchetLogger(target.name, cwd);

      const learningStore = new LearningStore(cwd);
      await learningStore.load();

      acquireLock(cwd);

      let run: RatchetRun;
      let spinner: ReturnType<typeof ora> | null = null;

      const makeCallbacks = (totalClicks: number, clickOffset: number = 0) => ({
        onScanComplete: () => {},
        onClickStart: async (n: number, total: number) => {
          const globalN = n + clickOffset;
          const phase = clickOffset === 0 && useArchitect ? chalk.cyan('[architect] ') : chalk.green('[surgical] ');
          spinner = ora(`  ${phase}Click ${chalk.bold(String(globalN))}/${totalClicks} — fixing…`).start();
          if (globalN === 1) {
            await logger.initLog({ id: 'pending', target, clicks: [], startedAt: new Date(), status: 'running' }).catch(() => {});
          }
        },
        onClickPhase: (phase: ClickPhase, n: number) => {
          const globalN = n + clickOffset;
          if (spinner) spinner.text = `  Click ${chalk.bold(String(globalN))}/${totalClicks} — ${CLICK_PHASE_LABELS[phase]}`;
        },
        onClickComplete: async (click: Click, _rolledBack: boolean) => {
          if (spinner) {
            const globalN = click.number + clickOffset;
            if (click.testsPassed) {
              spinner.succeed(
                `  Click ${chalk.bold(String(globalN))} — ${chalk.green('✓ landed')}` +
                  (click.commitHash ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`) : '') +
                  (click.issuesFixedCount ? chalk.dim(` — ${click.issuesFixedCount} issues fixed`) : ''),
              );
            } else {
              spinner.warn(`  Click ${chalk.bold(String(globalN))} — ${chalk.yellow('✗ rolled back')}`);
            }
            spinner = null;
          }
        },
        onError: (err: Error, n: number) => {
          if (spinner) { spinner.fail(`  Click ${n + clickOffset} — error: ${err.message}`); spinner = null; }
        },
      });

      try {
        // Phase 1: Architect (structural, high-leverage)
        let architectRun: RatchetRun | null = null;
        let scanAfterArchitect = scoreBefore;

        if (useArchitect && architectClicks > 0) {
          process.stdout.write(chalk.cyan('  ◆ Architect phase\n'));
          architectRun = await runArchitectEngine({
            target,
            clicks: architectClicks,
            config,
            cwd,
            agent,
            createBranch: true,
            adversarial: useAdversarial,
            scanResult: scoreBefore,
            learningStore,
            scoreOptimized: true,
            callbacks: makeCallbacks(clickCount, 0),
          });
          // Use scan after architect as input to surgical
          if (architectRun.clicks.length > 0) {
            try { scanAfterArchitect = await runScan(cwd); } catch { /* fallback */ }
          }
        }

        // Phase 2: Tier-aware surgical (targets tier boundaries for max score gain)
        // Relax guards for tier engine: larger batches for mechanical fixes
        config.guards = { maxLinesChanged: 200, maxFilesChanged: 16 };
        process.stdout.write(chalk.green('  ◆ Surgical phase (tier-aware)\n'));

        // Show tier plan
        const tierPlan = planTierTargets(scanAfterArchitect, surgicalClicks);
        if (tierPlan.length > 0) {
          for (const t of tierPlan) {
            const arrow = `${t.gap.currentScore}→${t.gap.currentScore + t.gap.pointsAtNextTier}/${t.gap.maxScore}`;
            process.stdout.write(
              chalk.dim(`    ${t.gap.subcategory}: ${t.clickBudget} clicks, +${t.gap.pointsAtNextTier}pt (${arrow}), ${t.gap.files.length} files\n`)
            );
          }
          process.stdout.write('\n');
        }

        const surgicalRun = await runTierEngine({
          target,
          clicks: surgicalClicks,
          config,
          cwd,
          agent: surgicalAgent,
          createBranch: architectClicks === 0, // only create branch if no architect phase
          adversarial: useAdversarial,
          scanResult: scanAfterArchitect,
          learningStore,
          callbacks: makeCallbacks(clickCount, architectClicks),
        });

        // Merge: combine architect + surgical clicks into one run for the report
        if (architectRun) {
          // Renumber clicks sequentially and merge
          const archClicks = architectRun.clicks.map(c => ({ ...c }));
          const surgClicks = surgicalRun.clicks.map(c => ({ ...c, number: c.number + architectClicks }));
          run = {
            ...surgicalRun,
            id: architectRun.id,
            startedAt: architectRun.startedAt,
            clicks: [...archClicks, ...surgClicks],
          };
        } else {
          run = surgicalRun;
        }
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
        rescanSpinner.succeed(
          `  Rescan complete: ${chalk.bold(`${scoreAfter.total}/100`)} (${formatScoreDelta(scoreBefore.total, scoreAfter.total)}) · ${scoreAfter.totalIssuesFound} issues remaining`,
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
      const issuesFixed = scoreBefore.totalIssuesFound - scoreAfter.totalIssuesFound;

      process.stdout.write(`\n${chalk.bold('  ' + '─'.repeat(46))}\n\n  ${chalk.bold('Done.')}\n  Score:  ${scoreBefore.total} → ${chalk.bold(String(scoreAfter.total))} (${formatScoreDelta(scoreBefore.total, scoreAfter.total)})\n  Issues: ${scoreBefore.totalIssuesFound} → ${scoreAfter.totalIssuesFound}${issuesFixed > 0 ? chalk.green(` (${issuesFixed} fixed)`) : ''}\n  Clicks: ${landed.length} landed · ${rolledBack.length} rolled back\n  Time:   ${duration}\n  PDF:    ${chalk.cyan(outPath)}\n\n`);

      if (landed.length > 0) {
        process.stdout.write(chalk.dim(`  Run ${chalk.cyan('ratchet tighten --pr')} to open a pull request.\n`) + '\n');
      }
    });

  return cmd;
}
