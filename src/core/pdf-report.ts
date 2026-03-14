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
    const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#6b7280';

    heroHtml = `
    <div class="section-title">Production Readiness Score</div>
    <div class="hero-card">
      <div class="hero-side">
        <div class="hero-label">BEFORE</div>
        <div class="hero-score before-score">${beforePct}</div>
        <div class="progress-track">
          <div class="progress-fill before-fill" style="width:${beforePct}%"></div>
        </div>
      </div>
      <div class="hero-arrow">
        <div class="arrow-text">→</div>
        <div class="delta-badge" style="background:${deltaColor}">${esc(deltaStr)}</div>
      </div>
      <div class="hero-side">
        <div class="hero-label">AFTER</div>
        <div class="hero-score after-score">${afterPct}</div>
        <div class="progress-track">
          <div class="progress-fill after-fill" style="width:${afterPct}%"></div>
        </div>
      </div>
    </div>`;

    const rows = scoreBefore.categories
      .map((before, i) => {
        const after = scoreAfter.categories[i];
        if (!after) return '';
        const catDelta = after.score - before.score;
        const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
        const catDeltaColor = catDelta > 0 ? '#22c55e' : catDelta < 0 ? '#ef4444' : '#6b7280';
        const dotColor = CATEGORY_COLORS[after.name] ?? '#6b7280';
        const bPct = before.max > 0 ? (before.score / before.max) * 100 : 0;
        const aPct = after.max > 0 ? (after.score / after.max) * 100 : 0;
        const rowBg = i % 2 === 0 ? '#111113' : '#0d0d0f';
        return `
        <div class="cat-row" style="background:${rowBg}">
          <div class="cat-dot" style="background:${dotColor}"></div>
          <div class="cat-name">${esc(after.name)}</div>
          <div class="cat-bars">
            <div class="mini-track"><div class="mini-fill before-mini" style="width:${Math.max(2, bPct)}%"></div></div>
            <div class="cat-score gray">${before.score}/${before.max}</div>
          </div>
          <div class="cat-bars">
            <div class="mini-track"><div class="mini-fill after-mini" style="width:${Math.max(2, aPct)}%"></div></div>
            <div class="cat-score white">${after.score}/${after.max}</div>
          </div>
          <div class="cat-delta" style="color:${catDeltaColor}">${esc(catDeltaStr)}</div>
        </div>`;
      })
      .join('');

    categoryHtml = `
    <div class="section-title" style="margin-top:16px">Category Breakdown</div>
    <div class="cat-header">
      <div style="flex:0 0 140px"></div>
      <div class="cat-col-label">BEFORE</div>
      <div class="cat-col-label">AFTER</div>
      <div class="cat-col-label" style="text-align:right;min-width:36px">CHG</div>
    </div>
    <div class="cat-table">${rows}</div>`;
  }

  // --- Bullet lists ---
  const improvedItems =
    landed.length === 0
      ? `<div class="bullet-item"><span class="bullet-dot" style="background:#6b7280"></span><span class="bullet-text" style="color:#6b7280">Nothing landed this run.</span></div>`
      : landed
          .map(
            (click) =>
              `<div class="bullet-item"><span class="bullet-dot" style="background:#22c55e"></span><span class="bullet-text">Click ${click.number} — ${esc(plainEnglishSummary(click))}</span></div>`,
          )
          .join('');

  const rolledItems =
    rolledBack.length === 0
      ? `<div class="bullet-item"><span class="bullet-dot" style="background:#22c55e"></span><span class="bullet-text" style="color:#22c55e">Nothing rolled back — clean run!</span></div>`
      : rolledBack
          .map((click) => {
            const reason = click.analysis
              ? (click.analysis.split(/[.!\n]/)[0]?.trim() ?? 'Tests failed')
              : 'Tests failed';
            return `<div class="bullet-item"><span class="bullet-dot" style="background:#ef4444"></span><span class="bullet-text">${esc(`Click ${click.number} — ${reason.slice(0, 120)}`)}</span></div>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 210mm;
    min-height: 297mm;
    background: #0a0a0b;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .wrapper {
    display: flex;
    flex-direction: column;
    min-height: 297mm;
    padding: 40px 48px 32px;
  }
  .main { flex: 1; }

  /* Header */
  .logo-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .gear { font-size: 24px; line-height: 1; }
  .logo-text { font-size: 28px; font-weight: 800; color: #f59e0b; letter-spacing: -0.5px; }
  .header-meta { font-size: 11px; color: #6b7280; line-height: 1.8; }
  .header-meta strong { color: #d1d5db; font-weight: 600; }

  /* Divider */
  .divider { height: 1.5px; background: linear-gradient(90deg, #f59e0b 0%, #f59e0b80 100%); margin: 14px 0 18px; }

  /* Summary bar */
  .summary-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: #111113;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .summary-item { text-align: center; padding: 14px 8px; }
  .summary-item + .summary-item { border-left: 1px solid #1e1e24; }
  .summary-value { font-size: 26px; font-weight: 800; line-height: 1; margin-bottom: 5px; }
  .summary-label { font-size: 9px; font-weight: 600; color: #6b7280; letter-spacing: 0.8px; text-transform: uppercase; }

  /* Section title */
  .section-title {
    font-size: 11px; font-weight: 700; color: #f59e0b;
    text-transform: uppercase; letter-spacing: 0.8px;
    margin-top: 20px; margin-bottom: 10px;
  }

  /* Hero card */
  .hero-card {
    background: #111113;
    border-radius: 10px;
    display: flex;
    align-items: center;
    padding: 18px 28px;
    gap: 0;
  }
  .hero-side { flex: 1; }
  .hero-label { font-size: 9px; font-weight: 600; color: #6b7280; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 2px; }
  .hero-score { font-size: 68px; font-weight: 800; line-height: 1; margin-bottom: 10px; }
  .before-score { color: #6b7280; }
  .after-score { color: #ffffff; }
  .progress-track { height: 8px; background: #1a1a1e; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; }
  .before-fill { background: #6b7280; }
  .after-fill { background: #f59e0b; }
  .hero-arrow { flex: 0 0 90px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .arrow-text { font-size: 30px; color: #f59e0b; font-weight: 800; }
  .delta-badge { font-size: 14px; font-weight: 700; color: #fff; padding: 4px 14px; border-radius: 20px; }

  /* Category table */
  .cat-header { display: flex; align-items: center; padding: 0 12px; margin-bottom: 3px; gap: 8px; }
  .cat-col-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; flex: 1; text-align: center; }
  .cat-table { border-radius: 8px; overflow: hidden; }
  .cat-row { display: flex; align-items: center; padding: 6px 12px; gap: 8px; }
  .cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .cat-name { font-size: 10px; color: #fff; flex: 0 0 124px; }
  .cat-bars { display: flex; align-items: center; gap: 6px; flex: 1; }
  .mini-track { flex: 1; height: 6px; background: #1a1a1e; border-radius: 3px; overflow: hidden; }
  .mini-fill { height: 100%; border-radius: 3px; }
  .before-mini { background: #6b7280; }
  .after-mini { background: #f59e0b; }
  .cat-score { font-size: 9px; flex: 0 0 32px; text-align: right; }
  .gray { color: #6b7280; }
  .white { color: #fff; }
  .cat-delta { font-size: 10px; font-weight: 700; flex: 0 0 30px; text-align: right; }

  /* Bullets */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 4px; }
  .bullet-list { display: flex; flex-direction: column; gap: 5px; }
  .bullet-item { display: flex; align-items: flex-start; gap: 8px; }
  .bullet-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .bullet-text { font-size: 9.5px; color: #e5e7eb; line-height: 1.5; }

  /* Footer */
  .footer { padding-top: 16px; border-top: 1px solid #1e1e24; margin-top: 20px; }
  .footer-text { font-size: 9px; color: #4b5563; text-align: center; }
  .footer-accent { color: #f59e0b; font-weight: 600; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="main">

    <!-- Header -->
    <div class="logo-row">
      <span class="gear">⚙️</span>
      <span class="logo-text">Ratchet Report</span>
    </div>
    <div class="header-meta">
      <div>${esc(dateStr)}</div>
      <div>Project: <strong>${esc(projectName)}</strong> &nbsp;·&nbsp; Target: <strong>${esc(targetName)}</strong></div>
    </div>

    <div class="divider"></div>

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
        <div class="summary-value" style="color:${rolledBack.length > 0 ? '#ef4444' : '#f59e0b'}">${rolledBack.length}</div>
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
    <div class="two-col">
      <div>
        <div class="section-title" style="color:#22c55e">✓ What improved</div>
        <div class="bullet-list">${improvedItems}</div>
      </div>
      <div>
        <div class="section-title" style="color:${rolledBack.length > 0 ? '#ef4444' : '#6b7280'}">✗ What was rolled back</div>
        <div class="bullet-list">${rolledItems}</div>
      </div>
    </div>

  </div>

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
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
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
