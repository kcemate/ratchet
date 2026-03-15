#!/usr/bin/env node
/**
 * Ratchet Showcase PDF Generator
 * Creates a customer-facing PDF demonstrating Ratchet's capabilities
 * with real scan data from a target project.
 * 
 * Fixed: uses solid hex colors (no rgba), no flexbox for page layout,
 * no viewport units, explicit page dimensions for Puppeteer print.
 */

import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';

const scanData = {
  projectName: 'DeuceDiary',
  score: 67,
  maxScore: 100,
  totalIssues: 1614,
  issuesFixed: 6,
  sweepResult: {
    clicksRun: 1,
    clicksLanded: 1,
    duration: '4m 6s',
    issueType: 'source files without tests',
    before: 118,
    after: 112,
  },
  categories: [
    { name: 'Testing', emoji: '🧪', score: 17, max: 20, items: ['41 test files, 27% ratio', '149 edge/error test cases', '2.2 assertions per test'] },
    { name: 'Security', emoji: '🔒', score: 14, max: 16, items: ['No hardcoded secrets', 'Validation on 13 files', 'Auth middleware + rate limiting'] },
    { name: 'Type Safety', emoji: '📝', score: 8, max: 12, items: ['Strict mode enabled', '182 any types (moderate)'] },
    { name: 'Error Handling', emoji: '⚠️', score: 9, max: 14, items: ['167 try/catch blocks', '3 empty catches', 'No structured logger'] },
    { name: 'Performance', emoji: '⚡', score: 8, max: 14, items: ['3 await-in-loop patterns', '37 console.log calls', 'Clean imports'] },
    { name: 'Code Quality', emoji: '📖', score: 11, max: 24, items: ['Avg 62-line functions', '481 long lines', '685 repeated lines'] },
  ],
  topIssues: [
    { count: 112, desc: 'source files without tests', severity: 'high' },
    { count: 45, desc: 'async functions without error handling', severity: 'high' },
    { count: 3, desc: 'empty catch blocks', severity: 'high' },
    { count: 685, desc: 'repeated code lines', severity: 'medium' },
    { count: 182, desc: 'any types', severity: 'medium' },
    { count: 64, desc: 'functions >50 lines', severity: 'medium' },
    { count: 37, desc: 'console.log calls', severity: 'medium' },
    { count: 481, desc: 'long lines (>120 chars)', severity: 'low' },
  ],
};

function sevColor(s) {
  return s === 'high' ? '#ef4444' : s === 'medium' ? '#f59e0b' : '#6b7280';
}
function sevBg(s) {
  return s === 'high' ? '#2d1215' : s === 'medium' ? '#2d2412' : '#1f1f23';
}
function scoreColor(pct) {
  if (pct >= 0.8) return '#22c55e';
  if (pct >= 0.6) return '#f59e0b';
  return '#ef4444';
}

function categoryBlock(cat) {
  const pct = Math.round(cat.score / cat.max * 100);
  const color = scoreColor(cat.score / cat.max);
  return `
    <div style="background:#151518; border:1px solid #27272a; border-radius:12px; padding:18px 20px; break-inside:avoid;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:600; font-size:14px;">${cat.emoji} ${cat.name}</span>
        <span style="font-weight:700; font-size:14px; color:${color};">${cat.score}/${cat.max}</span>
      </div>
      <div style="width:100%; height:5px; background:#27272a; border-radius:3px; margin-bottom:10px;">
        <div style="width:${pct}%; height:5px; background:${color}; border-radius:3px;"></div>
      </div>
      ${cat.items.map(i => `<div style="font-size:11px; color:#a1a1aa; margin-bottom:2px;">✓ ${i}</div>`).join('')}
    </div>
  `;
}

const html = `<!DOCTYPE html>
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
    height: 297mm;
    padding: 40px 48px;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child { page-break-after: auto; }
  .watermark {
    position: absolute;
    bottom: 20px;
    right: 48px;
    font-size: 10px;
    color: #3f3f46;
    font-weight: 500;
  }
</style>
</head>
<body>

<!-- ═══ PAGE 1: HERO ═══ -->
<div class="page" style="padding-top: 80px;">
  <div style="display:inline-block; background:#1f1a0f; color:#f59e0b; padding:5px 14px; border-radius:16px; font-size:12px; font-weight:600; letter-spacing:0.4px; border:1px solid #3d2e0a; margin-bottom:28px;">
    ⚙️ AUTONOMOUS CODE IMPROVEMENT
  </div>
  
  <div style="font-size:48px; font-weight:800; line-height:1.1; margin-bottom:8px; color:#e4e4e7;">
    Your codebase has
  </div>
  <div style="font-size:48px; font-weight:800; line-height:1.1; margin-bottom:8px; color:#f59e0b;">
    ${scanData.totalIssues} issues.
  </div>
  <div style="font-size:48px; font-weight:800; line-height:1.1; color:#e4e4e7;">
    Ratchet fixes them
  </div>
  <div style="font-size:48px; font-weight:800; line-height:1.1; margin-bottom:28px; color:#e4e4e7;">
    while you sleep.
  </div>
  
  <div style="font-size:17px; color:#71717a; line-height:1.55; max-width:520px; margin-bottom:56px;">
    AI-powered autonomous code improvement. Scans your codebase, identifies production risks, and fixes them iteratively — with tests passing after every change.
  </div>
  
  <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:16px;">
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:22px 20px;">
      <div style="font-size:36px; font-weight:800; color:#f59e0b; margin-bottom:4px;">${scanData.totalIssues}</div>
      <div style="font-size:12px; color:#71717a; font-weight:500;">Issues detected</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:22px 20px;">
      <div style="font-size:36px; font-weight:800; color:#22c55e; margin-bottom:4px;">6</div>
      <div style="font-size:12px; color:#71717a; font-weight:500;">Categories scanned</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:22px 20px;">
      <div style="font-size:36px; font-weight:800; color:#3b82f6; margin-bottom:4px;">12</div>
      <div style="font-size:12px; color:#71717a; font-weight:500;">Subcategories</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:22px 20px;">
      <div style="font-size:36px; font-weight:800; color:#a855f7; margin-bottom:4px;">100%</div>
      <div style="font-size:12px; color:#71717a; font-weight:500;">Tests passing</div>
    </div>
  </div>
  
  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- ═══ PAGE 2: SCAN BREAKDOWN ═══ -->
<div class="page">
  <div style="font-size:28px; font-weight:700; margin-bottom:6px;">Production Readiness Scan</div>
  <div style="font-size:14px; color:#71717a; margin-bottom:28px;">Real results from a live Express/TypeScript/PostgreSQL app (809+ tests)</div>
  
  <div style="background:#151518; border:1px solid #27272a; border-radius:16px; padding:24px 32px; margin-bottom:28px; display:flex; align-items:center; gap:28px;">
    <div style="width:100px; height:100px; border-radius:50%; border:5px solid ${scoreColor(scanData.score / scanData.maxScore)}; display:flex; align-items:center; justify-content:center; font-size:38px; font-weight:800; color:${scoreColor(scanData.score / scanData.maxScore)}; flex-shrink:0;">
      ${scanData.score}
    </div>
    <div>
      <div style="font-size:18px; font-weight:600; margin-bottom:4px;">Score: ${scanData.score} / ${scanData.maxScore}</div>
      <div style="font-size:13px; color:#a1a1aa; line-height:1.55;">
        Ratchet scans 6 dimensions of production readiness: testing, security, type safety, 
        error handling, performance, and code quality. Each uses granular proportional scoring — no cliff edges.
      </div>
    </div>
  </div>
  
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
    ${scanData.categories.map(categoryBlock).join('')}
  </div>
  
  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- ═══ PAGE 3: ISSUES + SWEEP RESULTS ═══ -->
<div class="page">
  <div style="font-size:28px; font-weight:700; margin-bottom:6px;">Issues Detected</div>
  <div style="font-size:14px; color:#71717a; margin-bottom:24px;">${scanData.totalIssues} issues across ${scanData.topIssues.length} categories, prioritized by severity</div>
  
  <table style="width:100%; border-collapse:collapse; margin-bottom:28px;">
    <thead>
      <tr style="border-bottom:1px solid #27272a;">
        <th style="text-align:left; padding:10px 14px; font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.4px;">Count</th>
        <th style="text-align:left; padding:10px 14px; font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.4px;">Issue</th>
        <th style="text-align:left; padding:10px 14px; font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.4px;">Severity</th>
      </tr>
    </thead>
    <tbody>
      ${scanData.topIssues.map(i => `
        <tr style="border-bottom:1px solid #18181b;">
          <td style="padding:11px 14px; font-weight:700; font-size:16px;">${i.count}</td>
          <td style="padding:11px 14px; font-size:13px;">${i.desc}</td>
          <td style="padding:11px 14px;">
            <span style="display:inline-block; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:600; background:${sevBg(i.severity)}; color:${sevColor(i.severity)};">${i.severity}</span>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  
  <div style="background:#0f1f14; border:1px solid #1a3d24; border-radius:16px; padding:28px 32px;">
    <div style="font-size:20px; font-weight:700; color:#22c55e; margin-bottom:6px;">🧹 Sweep Mode — First Run</div>
    <div style="font-size:13px; color:#a1a1aa; margin-bottom:18px;">
      Cross-cutting fix: targeted "${scanData.sweepResult.issueType}" across the entire codebase in a single autonomous run.
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:20px; text-align:center;">
      <div>
        <div style="font-size:26px; font-weight:800;">${scanData.sweepResult.clicksRun}</div>
        <div style="font-size:11px; color:#a1a1aa; margin-top:2px;">Clicks run</div>
      </div>
      <div>
        <div style="font-size:26px; font-weight:800;">${scanData.sweepResult.clicksLanded}</div>
        <div style="font-size:11px; color:#a1a1aa; margin-top:2px;">Landed clean</div>
      </div>
      <div>
        <div style="font-size:22px; font-weight:800;">${scanData.sweepResult.before} → ${scanData.sweepResult.after}</div>
        <div style="font-size:11px; color:#a1a1aa; margin-top:2px;">Files without tests</div>
      </div>
      <div>
        <div style="font-size:26px; font-weight:800;">${scanData.sweepResult.duration}</div>
        <div style="font-size:11px; color:#a1a1aa; margin-top:2px;">Total time</div>
      </div>
    </div>
  </div>
  
  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

<!-- ═══ PAGE 4: HOW IT WORKS + CTA ═══ -->
<div class="page">
  <div style="font-size:28px; font-weight:700; margin-bottom:6px;">How Ratchet Works</div>
  <div style="font-size:14px; color:#71717a; margin-bottom:28px;">One command. Autonomous improvement. Tests pass after every change.</div>
  
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:32px;">
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:24px; break-inside:avoid;">
      <div style="font-size:32px; font-weight:800; color:#f59e0b; margin-bottom:6px;">01</div>
      <div style="font-size:16px; font-weight:600; margin-bottom:6px;">Scan</div>
      <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">Deep analysis across 6 dimensions and 12 subcategories. Detects real production risks — not style nits.</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:24px; break-inside:avoid;">
      <div style="font-size:32px; font-weight:800; color:#f59e0b; margin-bottom:6px;">02</div>
      <div style="font-size:16px; font-weight:600; margin-bottom:6px;">Prioritize</div>
      <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">Issues ranked by severity × frequency × impact. High-severity items rise to the top automatically.</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:24px; break-inside:avoid;">
      <div style="font-size:32px; font-weight:800; color:#f59e0b; margin-bottom:6px;">03</div>
      <div style="font-size:16px; font-weight:600; margin-bottom:6px;">Fix</div>
      <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">AI agent makes targeted changes — surgical single-file fixes or cross-cutting sweeps. Every change tested before commit.</div>
    </div>
    <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:24px; break-inside:avoid;">
      <div style="font-size:32px; font-weight:800; color:#f59e0b; margin-bottom:6px;">04</div>
      <div style="font-size:16px; font-weight:600; margin-bottom:6px;">Verify</div>
      <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">Full test suite after every click. Broken tests = automatic rollback. Score recalculated to track real progress.</div>
    </div>
  </div>
  
  <div style="background:#151518; border:1px solid #27272a; border-radius:14px; padding:24px 28px; margin-bottom:32px;">
    <div style="font-size:16px; font-weight:600; margin-bottom:14px;">Two Modes, One Goal</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <div style="font-weight:600; color:#f59e0b; margin-bottom:4px; font-size:13px;">⚡ Surgical Mode</div>
        <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">Target a specific file or module. Up to 3 files, 40 lines per click. Focused improvements on hot paths.</div>
      </div>
      <div>
        <div style="font-weight:600; color:#22c55e; margin-bottom:4px; font-size:13px;">🧹 Sweep Mode</div>
        <div style="font-size:12px; color:#a1a1aa; line-height:1.55;">Fix one issue type across the entire codebase. Up to 10 files per click, batched automatically.</div>
      </div>
    </div>
  </div>
  
  <div style="text-align:center; margin-top:40px;">
    <div style="font-size:30px; font-weight:800; margin-bottom:10px;">Ship better code. Automatically.</div>
    <div style="font-size:14px; color:#71717a; margin-bottom:24px;">Install Ratchet and run your first scan in 30 seconds.</div>
    <div style="display:inline-block; background:#1f1a0f; border:1px solid #3d2e0a; border-radius:10px; padding:14px 32px; font-family:'SF Mono','Fira Code','Courier New',monospace; font-size:16px; color:#f59e0b; font-weight:600;">
      npx ratchet scan
    </div>
  </div>
  
  <div class="watermark">ratchet — autonomous code improvement</div>
</div>

</body>
</html>`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });

const outPath = process.argv[2] || join(process.cwd(), 'docs', 'ratchet-showcase.pdf');
await page.pdf({
  path: outPath,
  width: '210mm',
  height: '297mm',
  printBackground: true,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
  preferCSSPageSize: true,
});

await browser.close();
console.log(`✅ PDF generated: ${outPath}`);
console.log(`   Size: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
