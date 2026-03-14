import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Click } from '../types.js';

export type { ReportOptions } from './report.js';
import type { ReportOptions } from './report.js';

const CATEGORY_COLORS: Record<string, string> = {
  Testing: '#3b82f6',
  'Error Handling': '#f97316',
  Types: '#a855f7',
  Security: '#ef4444',
  Performance: '#eab308',
  Readability: '#22c55e',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function plainEnglishSummary(click: Click): string {
  const raw = click.proposal || click.analysis || '';
  if (!raw) return 'Applied code improvements';
  const firstSentence = raw.split(/[.!\n]/)[0]?.trim() ?? '';
  if (firstSentence.length > 0 && firstSentence.length <= 120) return firstSentence;
  return raw.slice(0, 120).trimEnd() + (raw.length > 120 ? '...' : '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a full standalone HTML page for the report.
 */
export function generateReportHTML(options: ReportOptions): string {
  const { run, scoreBefore, scoreAfter } = options;
  const projectName = (options as any).projectName ?? run.target.name;
  const targetName = run.target.name;

  const totalClicks = run.clicks.length;
  const landed = run.clicks.filter((c) => c.testsPassed);
  const rolledBack = run.clicks.filter((c) => !c.testsPassed);
  const durationMs = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : 0;
  const duration = formatDuration(durationMs);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // --- Hero score section ---
  let heroHtml = '';
  let categoryHtml = '';

  if (scoreBefore && scoreAfter) {
    const beforePct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
    const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
    const delta = afterPct - beforePct;
    const deltaStr = delta > 0 ? `+${delta}` : String(delta);

    // SVG arc gauge helpers
    const r = 38;
    const circ = +(2 * Math.PI * r).toFixed(2);
    const beforeOffset = +((1 - beforePct / 100) * circ).toFixed(2);
    const afterOffset = +((1 - afterPct / 100) * circ).toFixed(2);

    const deltaBg =
      delta > 0
        ? 'linear-gradient(135deg,#16a34a,#22c55e)'
        : delta < 0
          ? 'linear-gradient(135deg,#dc2626,#ef4444)'
          : 'linear-gradient(135deg,#374151,#4b5563)';
    const deltaGlow =
      delta > 0
        ? '0 0 14px rgba(34,197,94,0.55)'
        : delta < 0
          ? '0 0 14px rgba(239,68,68,0.55)'
          : 'none';

    heroHtml = `
    <div class="section-title">Production Readiness Score</div>
    <div class="hero-card">
      <div class="hero-side">
        <div class="hero-label">BEFORE</div>
        <div class="gauge-wrap">
          <svg viewBox="0 0 100 100" width="120" height="120" style="display:block">
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="#1e1e28" stroke-width="8"/>
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="#374151" stroke-width="8"
              stroke-dasharray="${circ}" stroke-dashoffset="${beforeOffset}"
              stroke-linecap="round" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="gauge-overlay">
            <div class="gauge-number before-number">${beforePct}</div>
            <div class="gauge-unit">/ 100</div>
          </div>
        </div>
      </div>

      <div class="hero-arrow">
        <div class="delta-badge" style="background:${deltaBg};box-shadow:${deltaGlow}">${esc(deltaStr)}</div>
        <svg width="36" height="12" viewBox="0 0 44 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="arrowGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.2"/>
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="1"/>
            </linearGradient>
          </defs>
          <line x1="2" y1="8" x2="34" y2="8" stroke="url(#arrowGrad)" stroke-width="2" stroke-linecap="round"/>
          <polyline points="28,3 38,8 28,13" stroke="#f59e0b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="hero-side">
        <div class="hero-label">AFTER</div>
        <div class="gauge-wrap after-gauge-wrap">
          <svg viewBox="0 0 100 100" width="160" height="160" style="display:block;position:relative;z-index:1">
            <defs>
              <linearGradient id="amberArc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#d97706"/>
                <stop offset="100%" stop-color="#fbbf24"/>
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="#1e1e28" stroke-width="8"/>
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="url(#amberArc)" stroke-width="8"
              stroke-dasharray="${circ}" stroke-dashoffset="${afterOffset}"
              stroke-linecap="round" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="gauge-overlay">
            <div class="gauge-number after-number">${afterPct}</div>
            <div class="gauge-unit after-unit">/ 100</div>
          </div>
        </div>
      </div>
    </div>`;

    const rows = scoreBefore.categories
      .map((before, i) => {
        const after = scoreAfter.categories[i];
        if (!after) return '';
        const catDelta = after.score - before.score;
        const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
        const pillClass =
          catDelta > 0 ? 'delta-pill-pos' : catDelta < 0 ? 'delta-pill-neg' : 'delta-pill-neu';
        const dotColor = CATEGORY_COLORS[after.name] ?? '#6b7280';
        const bPct = before.max > 0 ? (before.score / before.max) * 100 : 0;
        const aPct = after.max > 0 ? (after.score / after.max) * 100 : 0;
        const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
        return `
        <div class="cat-row" style="background:${rowBg}">
          <div class="cat-dot" style="background:${dotColor}"></div>
          <div class="cat-name">${esc(after.name)}</div>
          <div class="cat-bars">
            <div class="cat-score gray">${before.score}/${before.max}</div>
            <div class="mini-track"><div class="mini-fill before-mini" style="width:${Math.max(2, bPct)}%"></div></div>
          </div>
          <div class="cat-bars">
            <div class="cat-score white">${after.score}/${after.max}</div>
            <div class="mini-track"><div class="mini-fill after-mini" style="width:${Math.max(2, aPct)}%"></div></div>
          </div>
          <div class="cat-delta"><span class="delta-pill ${pillClass}">${esc(catDeltaStr)}</span></div>
        </div>`;
      })
      .join('');

    categoryHtml = `
    <div class="section-title" style="margin-top:16px">Category Breakdown</div>
    <div class="cat-header">
      <div style="flex:0 0 138px"></div>
      <div class="cat-col-label">BEFORE</div>
      <div class="cat-col-label">AFTER</div>
      <div class="cat-col-label" style="text-align:right;flex:0 0 50px">CHG</div>
    </div>
    <div class="cat-table">${rows}</div>`;
  }

  // --- Bullet lists ---
  const improvedItems =
    landed.length === 0
      ? `<div class="bullet-item"><span class="bullet-dot" style="background:#4b5563"></span><span class="bullet-text" style="color:#6b7280">Nothing landed this run.</span></div>`
      : landed
          .map(
            (click) =>
              `<div class="bullet-item"><span class="bullet-dot" style="background:#22c55e"></span><span class="bullet-text"><strong style="color:#f1f5f9">Click ${click.number}</strong> — ${esc(plainEnglishSummary(click))}</span></div>`,
          )
          .join('');

  const rolledItems =
    rolledBack.length === 0
      ? `<div class="bullet-item"><span class="bullet-dot" style="background:#22c55e"></span><span class="bullet-text" style="color:#4ade80">Nothing rolled back — clean run!</span></div>`
      : rolledBack
          .map((click) => {
            const reason = click.analysis
              ? (click.analysis.split(/[.!\n]/)[0]?.trim() ?? 'Tests failed')
              : 'Tests failed';
            return `<div class="bullet-item"><span class="bullet-dot" style="background:#ef4444"></span><span class="bullet-text"><strong style="color:#f1f5f9">Click ${click.number}</strong> — ${esc(reason.slice(0, 120))}</span></div>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 794px;
    background: #08080a;
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    position: relative;
  }

  /* Subtle grain texture */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 300px 300px;
  }

  .wrapper {
    position: relative;
    z-index: 1;
    padding: 36px 56px 30px;
  }

  /* ─── Header ─────────────────────────────────────────── */
  .logo-row {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 7px;
  }
  .gear-wrap {
    position: relative;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .gear-glow {
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(245,158,11,0.30) 0%, transparent 65%);
  }
  .gear {
    font-size: 22px;
    line-height: 1;
    position: relative;
    z-index: 1;
  }
  .logo-text {
    font-size: 26px;
    font-weight: 800;
    background: linear-gradient(135deg, #f59e0b, #fbbf24);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.5px;
  }
  .header-meta {
    font-size: 10.5px;
    color: #6b7280;
    line-height: 1.75;
    margin-left: 1px;
  }
  .header-meta strong { color: #cbd5e1; font-weight: 600; }

  /* Amber accent line below header */
  .header-accent {
    height: 1.5px;
    background: linear-gradient(90deg, #f59e0b 0%, rgba(245,158,11,0.25) 55%, transparent 100%);
    margin: 13px 0 16px;
  }

  /* ─── Summary Bar ────────────────────────────────────── */
  .summary-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-bottom: 4px;
    background: linear-gradient(180deg, #111116 0%, #0d0d10 100%);
    border: 1px solid #1e1e2a;
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 6px rgba(0,0,0,0.35);
  }
  .summary-item {
    padding: 13px 8px 12px;
    text-align: center;
    position: relative;
  }
  .summary-item:not(:last-child)::after {
    content: '';
    position: absolute;
    right: 0;
    top: 20%;
    height: 60%;
    width: 1px;
    background: rgba(255,255,255,0.1);
  }
  .summary-value {
    font-size: 28px;
    font-weight: 800;
    line-height: 1;
    margin-bottom: 5px;
    letter-spacing: -0.5px;
  }
  .summary-label {
    font-size: 8px;
    font-weight: 700;
    color: #4b5563;
    letter-spacing: 0.9px;
    text-transform: uppercase;
  }

  /* ─── Section title ──────────────────────────────────── */
  .section-title {
    font-size: 9.5px;
    font-weight: 700;
    color: #f59e0b;
    text-transform: uppercase;
    letter-spacing: 1.1px;
    margin-top: 18px;
    margin-bottom: 9px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(245,158,11,0.18) 0%, transparent 100%);
  }

  /* ─── Hero card ──────────────────────────────────────── */
  .hero-card {
    background: linear-gradient(180deg, #0f0f13 0%, #0b0b0e 100%);
    border: 1px solid #1e1e2a;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 32px 20px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .hero-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .hero-label {
    font-size: 8px;
    font-weight: 700;
    color: #4b5563;
    letter-spacing: 1.1px;
    text-transform: uppercase;
  }
  .gauge-wrap {
    position: relative;
    width: 120px;
    height: 120px;
  }
  .after-gauge-wrap {
    width: 160px;
    height: 160px;
    background: radial-gradient(circle at center, rgba(245,158,11,0.07) 0%, transparent 60%);
    border-radius: 50%;
  }
  .gauge-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .gauge-number {
    font-weight: 800;
    line-height: 1;
    letter-spacing: -1.5px;
  }
  .before-number { font-size: 30px; color: #4b5563; }
  .after-number { font-size: 46px; color: #ffffff; text-shadow: 0 0 24px rgba(245,158,11,0.75); }
  .gauge-unit {
    font-size: 9px;
    color: #4b5563;
    margin-top: 2px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .after-unit { color: #6b7280; }

  .hero-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .delta-badge {
    font-size: 24px;
    font-weight: 800;
    color: #fff;
    padding: 8px 24px;
    border-radius: 99px;
    letter-spacing: -0.2px;
  }

  /* ─── Category table ─────────────────────────────────── */
  .cat-header {
    display: flex;
    align-items: center;
    padding: 0 12px;
    margin-bottom: 4px;
    gap: 8px;
  }
  .cat-col-label {
    font-size: 8px;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    flex: 1;
    text-align: center;
    font-weight: 600;
  }
  .cat-table {
    border-radius: 9px;
    overflow: hidden;
    border: 1px solid #18181f;
  }
  .cat-row {
    display: flex;
    align-items: center;
    padding: 7px 12px;
    gap: 8px;
  }
  .cat-row:not(:last-child) { border-bottom: 1px solid #111116; }
  .cat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .cat-name { font-size: 9.5px; color: #d1d5db; flex: 0 0 122px; font-weight: 500; }
  .cat-bars { display: flex; align-items: center; gap: 6px; flex: 1; }
  .mini-track {
    flex: 1;
    height: 5px;
    background: #1a1a22;
    border-radius: 99px;
    overflow: hidden;
  }
  .mini-fill { height: 100%; border-radius: 99px; }
  .before-mini { background: #2d3748; }
  .after-mini {
    background: linear-gradient(90deg, #d97706, #fbbf24);
    box-shadow: 0 0 6px rgba(245,158,11,0.5);
  }
  .cat-score {
    font-size: 8.5px;
    flex: 0 0 34px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }
  .gray { color: #374151; }
  .white { color: #cbd5e1; }
  .cat-delta { flex: 0 0 50px; text-align: right; }
  .delta-pill {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 99px;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .delta-pill-pos { background: rgba(34,197,94,0.14); color: #4ade80; }
  .delta-pill-neg { background: rgba(239,68,68,0.14); color: #f87171; }
  .delta-pill-neu { background: rgba(107,114,128,0.12); color: #9ca3af; }

  /* ─── Improved / Rolled Back ─────────────────────────── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 4px;
    align-items: start;
  }
  .items-card {
    background: linear-gradient(180deg, #0f0f13 0%, #0b0b0e 100%);
    border: 1px solid #1e1e2a;
    border-radius: 10px;
    padding: 11px 11px 10px;
    overflow: hidden;
  }
  .items-card-green { border-left: 3px solid rgba(34,197,94,0.6); }
  .items-card-red   { border-left: 3px solid rgba(239,68,68,0.6); }
  .items-card-neutral { border-left: 3px solid #1e1e2a; }
  .bullet-list { display: flex; flex-direction: column; gap: 4px; }
  .bullet-item {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 6px;
    padding: 5px 8px;
    display: flex;
    align-items: flex-start;
    gap: 7px;
  }
  .bullet-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    margin-top: 4px;
    flex-shrink: 0;
  }
  .bullet-text { font-size: 8.5px; color: #94a3b8; line-height: 1.55; }

  /* ─── Footer ─────────────────────────────────────────── */
  .footer {
    padding-top: 11px;
    border-top: 1px solid #111116;
    margin-top: 16px;
  }
  .footer-text {
    font-size: 8px;
    color: #2d3748;
    text-align: center;
    letter-spacing: 0.2px;
  }
  .footer-accent { color: #92400e; font-weight: 600; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="logo-row">
    <div class="gear-wrap">
      <div class="gear-glow"></div>
      <span class="gear">⚙️</span>
    </div>
    <span class="logo-text">Ratchet Report</span>
  </div>
  <div class="header-meta">
    <div>${esc(dateStr)}</div>
    <div>Project: <strong>${esc(projectName)}</strong> &nbsp;·&nbsp; Target: <strong>${esc(targetName)}</strong></div>
  </div>
  <div class="header-accent"></div>

  <!-- Summary bar -->
  <div class="summary-bar">
    <div class="summary-item">
      <div class="summary-value" style="color:#f59e0b">${totalClicks}</div>
      <div class="summary-label">Clicks</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:#22c55e">${landed.length}</div>
      <div class="summary-label">Landed</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:${rolledBack.length > 0 ? '#ef4444' : '#22c55e'}">${rolledBack.length}</div>
      <div class="summary-label">Rolled Back</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:#f59e0b">${esc(duration)}</div>
      <div class="summary-label">Duration</div>
    </div>
  </div>

  ${heroHtml}
  ${categoryHtml}

  <!-- What improved + What was rolled back -->
  <div class="section-title" style="margin-top:18px;color:#94a3b8">Run Summary</div>
  ${rolledBack.length > 0 ? `
  <div class="two-col">
    <div class="items-card items-card-green">
      <div class="section-title" style="margin-top:0;margin-bottom:8px;color:#22c55e">&#10003; What improved</div>
      <div class="bullet-list">${improvedItems}</div>
    </div>
    <div class="items-card items-card-red">
      <div class="section-title" style="margin-top:0;margin-bottom:8px;color:#ef4444">&#10007; What was rolled back</div>
      <div class="bullet-list">${rolledItems}</div>
    </div>
  </div>` : `
  <div class="items-card items-card-green" style="margin-top:4px">
    <div class="section-title" style="margin-top:0;margin-bottom:8px;color:#22c55e">&#10003; What improved</div>
    <div class="bullet-list">${improvedItems}</div>
  </div>
  <div style="margin-top:8px;padding:10px 14px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;color:#4ade80;font-size:10px;font-weight:600;text-align:center">
    Nothing was rolled back — clean run!
  </div>`}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-text">
      Generated by <span class="footer-accent">Ratchet</span>
      &nbsp;—&nbsp;
      Scan your project free at <span class="footer-accent">ratchetcli.com</span>
    </div>
  </div>

</div>
</body>
</html>`;
}

/**
 * Generate a PDF Buffer by rendering the HTML report with Puppeteer.
 */
export async function generatePDF(options: ReportOptions): Promise<Buffer> {
  const html = generateReportHTML(options);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // Set viewport to A4 width at 96dpi
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    // Fit page height to actual content to eliminate bottom whitespace
    const contentHeight = await page.evaluate(() => document.body.scrollHeight);
    const pdf = await page.pdf({
      width: '794px',
      height: `${contentHeight}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Write the PDF report to docs/<target>-ratchet-report.pdf.
 * Returns the path to the written file.
 */
export async function writePDF(options: ReportOptions): Promise<string> {
  const { run, cwd } = options;
  const pdfPath = join(cwd, 'docs', `${run.target.name}-ratchet-report.pdf`);
  const buffer = await generatePDF(options);
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, buffer);
  return pdfPath;
}
