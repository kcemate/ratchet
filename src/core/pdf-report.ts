import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Click } from '../types.js';
import { formatDuration } from './utils.js';

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

function extractFilename(raw: string): string {
  // filesModified can be bare paths or verbose descriptions like "`src/foo.ts` — added ..."
  // Extract just the filename from any format
  const backtickMatch = raw.match(/`([^`]+)`/);
  const path = backtickMatch ? backtickMatch[1] : raw.split(/\s[—–-]\s/)[0].trim();
  return path.split('/').pop() ?? path;
}

function filesSummary(click: Click): string {
  if (!click.filesModified?.length) return 'Applied code improvements';
  const names = click.filesModified.map(extractFilename);
  const shown = names.slice(0, 3).join(', ');
  const extra = names.length > 3 ? '…' : '';
  return `Modified ${names.length} file${names.length > 1 ? 's' : ''}: ${shown}${extra}`;
}

function plainEnglishSummary(click: Click): string {
  let raw = click.proposal || click.analysis || '';
  if (!raw) return filesSummary(click);
  // Strip leaked agent system prompts (double-wrapped prompt bug)
  if (/^You are (a |an |the )/i.test(raw)) return filesSummary(click);
  // Clean up code artifacts that don't belong in a summary
  let clean = raw.split('\n')[0].trim();
  clean = clean.replace(/`/g, '').replace(/\s{2,}/g, ' ');
  // If the first line is still too verbose or looks like code, fall back to files
  if (clean.length > 100 || /^(import |const |let |var |function |class |export )/.test(clean)) {
    return filesSummary(click);
  }
  const firstSentence = clean.split(/[.!]/)[0]?.trim() ?? '';
  if (firstSentence.length > 0 && firstSentence.length <= 100) return firstSentence;
  return clean.slice(0, 100).trimEnd() + (clean.length > 100 ? '…' : '');
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
  const projectName = options.projectName ?? run.target.name;
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

    const issuesBefore = scoreBefore.totalIssuesFound ?? 0;
    const issuesAfter = scoreAfter.totalIssuesFound ?? 0;
    const issuesFixed = issuesBefore - issuesAfter;

    const deltaBg =
      delta > 0
        ? 'linear-gradient(135deg,#16a34a,#22c55e)'
        : delta < 0
          ? 'linear-gradient(135deg,#dc2626,#ef4444)'
          : 'linear-gradient(135deg,#374151,#4b5563)';
    const deltaGlow =
      delta > 0
        ? '0 2px 12px rgba(34,197,94,0.4)'
        : delta < 0
          ? '0 2px 12px rgba(239,68,68,0.4)'
          : 'none';

    const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#9ca3af';

    const issuesHeroHtml = '';

    heroHtml = `
    <div class="hero-card">
      <div class="hero-score-label">PRODUCTION READINESS SCORE</div>
      <div class="hero-score-row">
        <div class="hero-score-col">
          <div class="hero-col-label">BEFORE</div>
          <div class="hero-num before-num">${beforePct}</div>
          <div class="hero-sub-score">${beforePct} / 100</div>
          <div class="hero-track"><div class="hero-fill before-fill" style="width:${beforePct}%"></div></div>
        </div>
        <div class="hero-center-col">
          <div class="hero-arrow">→</div>
          <div class="hero-delta-inline" style="color:${deltaColor}">${esc(deltaStr)}</div>
        </div>
        <div class="hero-score-col">
          <div class="hero-col-label">AFTER</div>
          <div class="hero-num after-num">${afterPct}</div>
          <div class="hero-sub-score">${afterPct} / 100</div>
          <div class="hero-track"><div class="hero-fill after-fill" style="width:${afterPct}%"></div></div>
        </div>
      </div>
      ${issuesHeroHtml}
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

        return `
        <div class="cat-row">
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
              `<div class="bullet-item"><span class="bullet-dot" style="background:#4ADE80"></span><span class="bullet-text"><strong>Click ${click.number}</strong> — ${esc(plainEnglishSummary(click))}</span></div>`,
          )
          .join('');

  const rolledItems =
    rolledBack.length === 0
      ? `<div class="bullet-item"><span class="bullet-dot" style="background:#22c55e"></span><span class="bullet-text" style="color:#4ade80">Nothing rolled back — clean run!</span></div>`
      : rolledBack
          .map((click) => {
            const reason = plainEnglishSummary(click) || 'Tests failed';
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
    background: #0D1117;
    color: #C9D1D9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .wrapper {
    padding: 40px 48px 36px;
  }

  /* ─── Header ─────────────────────────────────────────── */
  .logo-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .gear { font-size: 32px; line-height: 1; }
  .logo-text {
    font-size: 32px;
    font-weight: 700;
    color: #E8A030;
    letter-spacing: -0.5px;
  }
  .header-meta {
    font-size: 14px;
    color: #8B949E;
    line-height: 1.7;
  }
  .header-meta strong { color: #C9D1D9; font-weight: 600; }

  .header-divider {
    height: 2px;
    background: linear-gradient(90deg, #E8A030 0%, rgba(232,160,48,0.3) 60%, transparent 100%);
    margin: 16px 0 24px;
  }

  /* ─── Summary Bar ────────────────────────────────────── */
  .summary-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 12px;
    margin-bottom: 24px;
  }
  .summary-item {
    padding: 24px 8px;
    text-align: center;
    position: relative;
  }
  .summary-item:not(:last-child)::after {
    content: '';
    position: absolute;
    right: 0; top: 20%; height: 60%; width: 1px;
    background: #30363D;
  }
  .summary-value {
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 8px;
    letter-spacing: -1px;
  }
  .summary-label {
    font-size: 11px;
    font-weight: 600;
    color: #8B949E;
    letter-spacing: 3px;
    text-transform: uppercase;
  }

  /* ─── Section title ──────────────────────────────────── */
  .section-title {
    font-size: 12px;
    font-weight: 700;
    color: #E8A030;
    text-transform: uppercase;
    letter-spacing: 3px;
    margin-top: 32px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #30363D;
  }

  /* ─── Hero card ──────────────────────────────────────── */
  .hero-card {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 12px;
    padding: 32px 40px;
  }
  .hero-score-label {
    font-size: 13px;
    font-weight: 700;
    color: #E8A030;
    letter-spacing: 4px;
    text-transform: uppercase;
    text-align: center;
    margin-bottom: 30px;
  }
  .hero-score-row {
    display: flex;
    align-items: center;
    justify-content: space-around;
  }
  .hero-score-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .hero-col-label {
    font-size: 11px;
    font-weight: 700;
    color: #8B949E;
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .hero-num {
    font-size: 80px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -3px;
    margin-bottom: 6px;
  }
  .before-num { color: #8B949E; }
  .after-num  { color: #FFFFFF; font-size: 88px; }
  .hero-sub-score {
    font-size: 14px;
    color: #8B949E;
    margin-bottom: 12px;
  }
  .hero-track {
    width: 220px;
    height: 8px;
    background: #30363D;
    border-radius: 4px;
    overflow: hidden;
  }
  .hero-fill { height: 100%; border-radius: 4px; }
  .before-fill { background: #8B949E; }
  .after-fill  { background: #E8A030; }

  .hero-center-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .hero-arrow { font-size: 28px; color: #8B949E; }
  .hero-delta-inline { font-size: 28px; font-weight: 800; }

  .hero-issues-row {
    text-align: center;
    margin-top: 16px;
    font-size: 13px;
    color: #8B949E;
  }
  .hero-issues-before { color: #8B949E; font-weight: 700; }
  .hero-issues-arrow  { color: #8B949E; }
  .hero-issues-after  { color: #C9D1D9; font-weight: 700; }
  .hero-issues-fixed  { color: #4ADE80; font-weight: 700; }

  /* ─── Category table ─────────────────────────────────── */
  .cat-header {
    display: flex;
    align-items: center;
    padding: 0 16px;
    margin-bottom: 6px;
    gap: 8px;
  }
  .cat-col-label {
    font-size: 10px;
    font-weight: 600;
    color: #8B949E;
    text-transform: uppercase;
    letter-spacing: 2px;
    flex: 1;
    text-align: center;
  }
  .cat-table {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 8px;
    overflow: hidden;
  }
  .cat-row {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    gap: 8px;
  }
  .cat-row:not(:last-child) { border-bottom: 1px solid #30363D; }
  .cat-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .cat-name { font-size: 14px; color: #C9D1D9; flex: 0 0 130px; font-weight: 500; }
  .sub-row  { padding: 6px 16px 6px 22px; }
  .sub-name { font-size: 12px; color: #8B949E; flex: 0 0 130px; font-weight: 400; }
  .cat-bars { display: flex; align-items: center; gap: 8px; flex: 1; }
  .mini-track {
    flex: 1;
    height: 5px;
    background: #30363D;
    border-radius: 99px;
    overflow: hidden;
  }
  .mini-fill { height: 100%; border-radius: 99px; }
  .before-mini { background: #8B949E; }
  .after-mini  { background: #E8A030; }
  .cat-score {
    font-size: 13px;
    flex: 0 0 38px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 400;
    white-space: nowrap;
  }
  .gray  { color: #8B949E; }
  .white { color: #C9D1D9; }
  .cat-delta { flex: 0 0 50px; text-align: right; }
  .delta-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 700;
  }
  .delta-pill-pos { background: rgba(74,222,128,0.15); color: #4ADE80; }
  .delta-pill-neg { background: rgba(239,68,68,0.15); color: #f87171; }
  .delta-pill-neu { background: #21262D; color: #8B949E; }

  /* ─── Improved / Rolled Back ─────────────────────────── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 4px;
    align-items: start;
  }
  .items-card {
    background: #161B22;
    border: 1px solid #30363D;
    border-radius: 12px;
    padding: 20px 24px;
    overflow: hidden;
  }
  .items-card-green { border-left: 3px solid #4ADE80; }
  .items-card-red   { border-left: 3px solid #f87171; }
  .bullet-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .bullet-item {
    background: #0D1117;
    border: 1px solid #21262D;
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .bullet-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 3px;
    flex-shrink: 0;
  }
  .bullet-text { font-size: 13px; color: #8B949E; line-height: 1.5; }
  .bullet-text strong { color: #C9D1D9; }

  /* Sub-header inside card */
  .card-subheader {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card-subheader::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #30363D;
  }

  /* Clean-run banner */
  .clean-banner {
    margin-top: 16px;
    padding: 16px;
    background: rgba(74,222,128,0.08);
    border: 1px solid rgba(74,222,128,0.25);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    color: #4ADE80;
    text-align: center;
  }

  /* ─── Footer ─────────────────────────────────────────── */
  .footer {
    padding-top: 16px;
    border-top: 1px solid #30363D;
    margin-top: 24px;
  }
  .footer-text {
    font-size: 12px;
    color: #8B949E;
    text-align: center;
  }
  .footer-accent { color: #E8A030; font-weight: 600; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="logo-row">
    <span class="gear">⚙️</span>
    <span class="logo-text">Ratchet Report</span>
  </div>
  <div class="header-meta">
    <div>${esc(dateStr)}</div>
    <div>Project: <strong>${esc(projectName)}</strong> &nbsp;·&nbsp; Target: <strong>${esc(targetName)}</strong></div>
  </div>
  <div class="header-divider"></div>

  <!-- Summary bar -->
  <div class="summary-bar">
    <div class="summary-item">
      <div class="summary-value" style="color:#4ADE80">${totalClicks}</div>
      <div class="summary-label">Clicks</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:#4ADE80">${landed.length}</div>
      <div class="summary-label">Landed</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:${rolledBack.length > 0 ? '#f87171' : '#4ADE80'}">${rolledBack.length}</div>
      <div class="summary-label">Rolled Back</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color:#E8A030">${esc(duration)}</div>
      <div class="summary-label">Duration</div>
    </div>
  </div>

  ${heroHtml}
  ${categoryHtml}

  <!-- Run Summary -->
  <div class="section-title">Run Summary</div>
  ${rolledBack.length > 0 ? `
  <div class="two-col">
    <div class="items-card items-card-green">
      <div class="card-subheader" style="color:#4ADE80">&#10003; What improved</div>
      <div class="bullet-list">${improvedItems}</div>
    </div>
    <div class="items-card items-card-red">
      <div class="card-subheader" style="color:#f87171">&#10007; Rolled back</div>
      <div class="bullet-list">${rolledItems}</div>
    </div>
  </div>` : `
  <div class="items-card items-card-green">
    <div class="card-subheader" style="color:#4ADE80">&#10003; What improved</div>
    <div class="bullet-list">${improvedItems}</div>
  </div>
  <div class="clean-banner">Nothing was rolled back — clean run!</div>`}

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
    const contentHeight = await page.evaluate(() => (globalThis as unknown as { document: { body: { scrollHeight: number } } }).document.body.scrollHeight);
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
