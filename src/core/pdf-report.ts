import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Click } from '../types.js';
import { formatDuration } from './utils.js';

export type { ReportOptions } from './report.js';
import type { ReportOptions, ComplianceLevel } from './report.js';

/**
 * ─── Design Standard v2 (Locked 2026-03-26) ───
 *
 * CANONICAL PDF TEMPLATE — All Ratchet PDF reports MUST use this module.
 * Do NOT create alternative PDF generators. Any new report type should
 * extend generateReportHTML() or add a variant here.
 *
 * Design: dark theme (#0A0A0F bg), system fonts, SVG score rings,
 * KPI strip, category table with bars + delta pills, click timeline.
 * Single-page output enforced via pageRanges: '1'.
 */

const COLORS = {
  bgPrimary: '#0A0A0F',
  bgSurface: '#141822',
  bgRowAlt: '#0F1319',
  border: '#1E242E',
  accent: '#00D4AA',
  accentBlue: '#00D4FF',
  success: '#00FF88',
  warning: '#FFB800',
  error: '#FF4466',
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#656C76',
} as const;

const CATEGORY_COLORS: Record<string, string> = {
  Testing: '#3b82f6',
  'Error Handling': '#f97316',
  'Type Safety': '#a855f7',
  Types: '#a855f7',
  Security: '#ef4444',
  Performance: '#eab308',
  'Code Quality': '#22c55e',
  Readability: '#22c55e',
};

function extractFilename(raw: string): string {
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
  const files = filesSummary(click);
  const issuesFixed = (click as Click & { issuesFixedCount?: number }).issuesFixedCount;
  let raw = click.proposal || click.analysis || '';
  let proposalSummary = '';
  if (raw && !/^You are (a |an |the )/i.test(raw)) {
    let clean = raw.split('\n')[0].trim();
    clean = clean.replace(/`/g, '').replace(/\s{2,}/g, ' ');
    const codeLinePattern = /^(import |const |let |var |function |class |export |TOP ISSUES|ARCHITECTURAL)/;
    if (clean.length <= 100 && !codeLinePattern.test(clean)) {
      const firstSentence = clean.split(/[.!]/)[0]?.trim() ?? '';
      if (firstSentence.length > 0 && firstSentence.length <= 100) {
        proposalSummary = firstSentence;
      }
    }
  }
  const base = proposalSummary || files;
  if (issuesFixed && issuesFixed > 0) {
    return `${base} — fixed ${issuesFixed} issue${issuesFixed > 1 ? 's' : ''}`;
  }
  return base;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** SVG score ring: circular progress indicator */
function scoreRingSVG(score: number, max: number, size: number, label?: string): string {
  const pct = max > 0 ? score / max : 0;
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const center = size / 2;

  // Color based on percentage
  let strokeColor = COLORS.error;
  if (pct >= 0.9) strokeColor = COLORS.success;
  else if (pct >= 0.7) strokeColor = COLORS.accent;
  else if (pct >= 0.5) strokeColor = COLORS.warning;

  const fontSize = size >= 120 ? 42 : 24;
  const subFontSize = size >= 120 ? 13 : 10;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
      stroke="${COLORS.border}" stroke-width="8"/>
    <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
      stroke="${strokeColor}" stroke-width="8"
      stroke-linecap="round"
      stroke-dasharray="${circumference}"
      stroke-dashoffset="${dashOffset}"
      transform="rotate(-90 ${center} ${center})"/>
    <text x="${center}" y="${center - 4}" text-anchor="middle" dominant-baseline="central"
      font-family="'SF Mono', 'Menlo', 'Consolas', monospace" font-size="${fontSize}" font-weight="700"
      fill="${COLORS.textPrimary}">${score}</text>
    <text x="${center}" y="${center + (fontSize / 2) + 4}" text-anchor="middle"
      font-family="'SF Mono', 'Menlo', 'Consolas', monospace" font-size="${subFontSize}" font-weight="400"
      fill="${COLORS.textSecondary}">/ ${max}</text>
    ${label ? `<text x="${center}" y="${size - 2}" text-anchor="middle"
      font-family="-apple-system, sans-serif" font-size="11" font-weight="500"
      letter-spacing="0.5" fill="${COLORS.textSecondary}">${esc(label)}</text>` : ''}
  </svg>`;
}

/**
 * Generate a full standalone HTML page for the report (Design Standard v2).
 */
export function generateReportHTML(options: ReportOptions): string {
  const { run, scoreBefore, scoreAfter } = options;
  // Derive project name from cwd (actual directory), not target.name
  const cwdBasename = options.cwd.split('/').filter(Boolean).pop() ?? 'Unknown';
  const projectName = options.projectName ?? cwdBasename;
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

  // --- Hero score section with rings ---
  let heroHtml = '';
  let categoryHtml = '';

  if (scoreBefore && scoreAfter) {
    const beforePct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
    const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
    const delta = afterPct - beforePct;
    const deltaStr = delta > 0 ? `+${delta}` : String(delta);
    const deltaColor = delta > 0 ? COLORS.success : delta < 0 ? COLORS.error : COLORS.textSecondary;

    heroHtml = `
    <div class="hero-card">
      <div class="hero-label">PRODUCTION READINESS SCORE</div>
      <div class="hero-rings">
        <div class="ring-col">
          <div class="ring-label">BEFORE</div>
          ${scoreRingSVG(beforePct, 100, 140)}
        </div>
        <div class="ring-delta">
          <div class="delta-arrow">→</div>
          <div class="delta-value" style="color:${deltaColor}">${esc(deltaStr)}</div>
        </div>
        <div class="ring-col">
          <div class="ring-label">AFTER</div>
          ${scoreRingSVG(afterPct, 100, 160)}
        </div>
      </div>
    </div>`;

    // Category breakdown
    const rows = scoreBefore.categories
      .map((before, i) => {
        const after = scoreAfter.categories[i];
        if (!after) return '';
        const catDelta = after.score - before.score;
        const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
        const pillClass =
          catDelta > 0 ? 'pill-pos' : catDelta < 0 ? 'pill-neg' : 'pill-neu';
        const dotColor = CATEGORY_COLORS[after.name] ?? '#6b7280';
        const aPct = after.max > 0 ? (after.score / after.max) * 100 : 0;

        type SubCategory = { name: string; score: number; max: number };
        const subRows = (after.subcategories ?? []).map((subAfter: SubCategory, j: number) => {
          const subBefore = (before.subcategories ?? [])[j] as SubCategory | undefined;
          if (!subBefore) return '';
          const subDelta = subAfter.score - subBefore.score;
          const subDeltaStr = subDelta > 0 ? `+${subDelta}` : String(subDelta);
          const subPillClass = subDelta > 0 ? 'pill-pos' : subDelta < 0 ? 'pill-neg' : 'pill-neu';
          const saPct = subAfter.max > 0 ? (subAfter.score / subAfter.max) * 100 : 0;
          return `
          <div class="cat-row cat-sub">
            <div class="cat-dot-wrap"><div class="cat-dot-ring" style="border-color:${dotColor}"></div></div>
            <div class="cat-name sub">${esc(subAfter.name)}</div>
            <div class="cat-before">${subBefore.score}/${subBefore.max}</div>
            <div class="cat-bar-wrap">
              <div class="cat-bar" style="width:${Math.max(2, saPct)}%;background:${dotColor}"></div>
            </div>
            <div class="cat-after">${subAfter.score}/${subAfter.max}</div>
            <div class="cat-chg"><span class="pill ${subPillClass}">${esc(subDeltaStr)}</span></div>
          </div>`;
        }).join('');

        return `
        <div class="cat-row">
          <div class="cat-dot-wrap"><div class="cat-dot" style="background:${dotColor}"></div></div>
          <div class="cat-name">${esc(after.name)}</div>
          <div class="cat-before">${before.score}/${before.max}</div>
          <div class="cat-bar-wrap">
            <div class="cat-bar" style="width:${Math.max(2, aPct)}%;background:${dotColor}"></div>
          </div>
          <div class="cat-after">${after.score}/${after.max}</div>
          <div class="cat-chg"><span class="pill ${pillClass}">${esc(catDeltaStr)}</span></div>
        </div>${subRows}`;
      })
      .join('');

    categoryHtml = `
    <div class="section-title">Category Breakdown</div>
    <div class="cat-header">
      <div style="width:24px"></div>
      <div class="cat-head-name">Category</div>
      <div class="cat-head-score">Before</div>
      <div class="cat-head-bar"></div>
      <div class="cat-head-score">After</div>
      <div class="cat-head-chg">Δ</div>
    </div>
    <div class="cat-table">${rows}</div>`;
  } else if (scoreAfter) {
    // Scan-only report (no before)
    const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
    heroHtml = `
    <div class="hero-card" style="text-align:center">
      <div class="hero-label">RATCHET SCORE</div>
      <div style="display:flex;justify-content:center;padding:16px 0">
        ${scoreRingSVG(afterPct, 100, 180)}
      </div>
    </div>`;

    const rows = scoreAfter.categories.map((cat) => {
      const pct = cat.max > 0 ? (cat.score / cat.max) * 100 : 0;
      const dotColor = CATEGORY_COLORS[cat.name] ?? '#6b7280';
      return `
      <div class="cat-row">
        <div class="cat-dot-wrap"><div class="cat-dot" style="background:${dotColor}"></div></div>
        <div class="cat-name">${esc(cat.name)}</div>
        <div class="cat-bar-wrap" style="flex:2">
          <div class="cat-bar" style="width:${Math.max(2, pct)}%;background:${dotColor}"></div>
        </div>
        <div class="cat-after">${cat.score}/${cat.max}</div>
      </div>`;
    }).join('');

    categoryHtml = `
    <div class="section-title">Category Breakdown</div>
    <div class="cat-table">${rows}</div>`;
  }

  // --- Click timeline ---
  const clickTimelineItems = run.clicks.map((click) => {
    const passed = click.testsPassed;
    const dotColor = passed ? COLORS.success : COLORS.error;
    const icon = passed ? '✓' : '✗';
    const summary = plainEnglishSummary(click);
    return `<div class="timeline-item">
      <div class="timeline-dot" style="background:${dotColor}">${icon}</div>
      <div class="timeline-content">
        <span class="timeline-click">Click ${click.number}</span>
        <span class="timeline-desc">${esc(summary.slice(0, 100))}</span>
      </div>
    </div>`;
  }).join('');

  const timelineHtml = run.clicks.length > 0 ? `
    <div class="section-title">Run Timeline</div>
    <div class="timeline">${clickTimelineItems}</div>` : '';

  // --- Deep Analysis sections ---
  let execSummaryHtml = '';
  let deepFindingsHtml = '';
  const deep = options.deepAnalysis;

  if (deep) {
    const levelClass = `compliance-${deep.complianceLevel}` as `compliance-${ComplianceLevel}`;
    execSummaryHtml = `
    <div class="exec-summary-block">
      <div class="exec-summary-label">Executive Summary &nbsp;·&nbsp;
        <span class="compliance-badge ${levelClass}">${esc(deep.complianceLevel)}</span>
      </div>
      <div class="exec-summary-text">${esc(deep.executiveSummary)}</div>
    </div>`;

    if (deep.findings.length > 0) {
      const rows = deep.findings.map(f => {
        const sevClass = `sev-${f.severity}`;
        const sevLabel = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
        const fileName = f.file ? (f.file.split('/').pop() ?? f.file) : '—';
        const pct = Math.round(f.confidence * 100);
        return `<div class="deep-row">
          <div class="deep-sev ${sevClass}">${esc(sevLabel)}</div>
          <div class="deep-cat">${esc(f.category)}</div>
          <div class="deep-msg">${esc(f.message.slice(0, 90))}</div>
          <div class="deep-file">${esc(fileName)}</div>
          <div class="deep-conf">${pct}%</div>
        </div>`;
      }).join('');

      deepFindingsHtml = `
    <div class="section-title">Deep Findings</div>
    <div class="deep-table">${rows}</div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 794px;
    background-color: ${COLORS.bgPrimary} !important;
    color: ${COLORS.textPrimary};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  .wrapper { padding: 40px 48px 36px; }

  /* ─── Header ─── */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .logo-icon { font-size: 28px; line-height: 1; }
  .logo-text { font-size: 28px; font-weight: 700; color: ${COLORS.accent}; letter-spacing: -0.5px; }
  .header-right { text-align: right; }
  .header-date { font-size: 13px; color: ${COLORS.textSecondary}; }
  .header-project { font-size: 13px; color: ${COLORS.textMuted}; margin-top: 2px; }
  .header-project strong { color: ${COLORS.textSecondary}; font-weight: 500; }

  .header-divider {
    height: 1px;
    background: linear-gradient(90deg, ${COLORS.accent}, rgba(0,212,170,0.2) 60%, transparent);
    margin-bottom: 28px;
  }

  /* ─── KPI Strip ─── */
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 28px;
  }
  .kpi-card {
    background: ${COLORS.bgSurface};
    border-radius: 10px;
    padding: 18px 12px;
    text-align: center;
  }
  .kpi-value {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 36px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 6px;
    font-variant-numeric: tabular-nums;
  }
  .kpi-label {
    font-size: 11px;
    font-weight: 600;
    color: ${COLORS.textSecondary};
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* ─── Section Title ─── */
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: ${COLORS.accent};
    text-transform: uppercase;
    letter-spacing: 2.5px;
    margin-top: 28px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${COLORS.border};
  }

  /* ─── Hero Card ─── */
  .hero-card {
    background: ${COLORS.bgSurface};
    border-radius: 12px;
    padding: 28px 32px;
  }
  .hero-label {
    font-size: 12px;
    font-weight: 600;
    color: ${COLORS.accent};
    letter-spacing: 3px;
    text-transform: uppercase;
    text-align: center;
    margin-bottom: 20px;
  }
  .hero-rings {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
  }
  .ring-col { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ring-label {
    font-size: 11px;
    font-weight: 600;
    color: ${COLORS.textSecondary};
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .ring-delta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .delta-arrow { font-size: 24px; color: ${COLORS.textMuted}; }
  .delta-value {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 28px;
    font-weight: 700;
  }

  /* ─── Category Table ─── */
  .cat-header {
    display: flex;
    align-items: center;
    padding: 0 16px;
    margin-bottom: 4px;
    gap: 8px;
  }
  .cat-head-name { flex: 1; font-size: 10px; font-weight: 600; color: ${COLORS.textMuted}; text-transform: uppercase; letter-spacing: 1.5px; }
  .cat-head-score { width: 52px; text-align: right; font-size: 10px; font-weight: 600; color: ${COLORS.textMuted}; text-transform: uppercase; letter-spacing: 1.5px; }
  .cat-head-bar { flex: 1; }
  .cat-head-chg { width: 48px; text-align: right; font-size: 10px; font-weight: 600; color: ${COLORS.textMuted}; text-transform: uppercase; letter-spacing: 1.5px; }

  .cat-table { border-radius: 10px; overflow: hidden; }
  .cat-row {
    display: flex;
    align-items: center;
    padding: 11px 16px;
    gap: 8px;
    background: ${COLORS.bgSurface};
  }
  .cat-row:nth-child(even) { background: ${COLORS.bgRowAlt}; }
  .cat-sub { padding: 7px 16px 7px 24px; }
  .cat-sub .cat-name { color: ${COLORS.textSecondary}; font-size: 12px; }

  .cat-dot-wrap { width: 24px; display: flex; justify-content: center; flex-shrink: 0; }
  .cat-dot { width: 10px; height: 10px; border-radius: 50%; }
  .cat-dot-ring { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid; opacity: 0.6; }
  .cat-name { flex: 1; font-size: 14px; font-weight: 500; color: ${COLORS.textPrimary}; }

  .cat-before, .cat-after {
    width: 52px;
    text-align: right;
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .cat-before { color: ${COLORS.textSecondary}; }
  .cat-after { color: ${COLORS.textPrimary}; font-weight: 500; }

  .cat-bar-wrap {
    flex: 1;
    height: 6px;
    background: ${COLORS.border};
    border-radius: 3px;
    overflow: hidden;
  }
  .cat-bar { height: 100%; border-radius: 3px; }

  .cat-chg { width: 48px; text-align: right; }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 99px;
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 11px;
    font-weight: 600;
  }
  .pill-pos { background: rgba(0,255,136,0.12); color: ${COLORS.success}; }
  .pill-neg { background: rgba(255,68,102,0.12); color: ${COLORS.error}; }
  .pill-neu { background: rgba(101,108,118,0.15); color: ${COLORS.textMuted}; }

  /* ─── Timeline ─── */
  .timeline { display: flex; flex-direction: column; gap: 0; }
  .timeline-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: ${COLORS.bgSurface};
  }
  .timeline-item:nth-child(even) { background: ${COLORS.bgRowAlt}; }
  .timeline-item:first-child { border-radius: 10px 10px 0 0; }
  .timeline-item:last-child { border-radius: 0 0 10px 10px; }
  .timeline-item:only-child { border-radius: 10px; }

  .timeline-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: ${COLORS.bgPrimary};
    flex-shrink: 0;
  }
  .timeline-content { font-size: 13px; color: ${COLORS.textSecondary}; line-height: 1.4; }
  .timeline-click {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-weight: 600;
    color: ${COLORS.textPrimary};
    margin-right: 8px;
  }

  /* ─── Footer ─── */
  .footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid ${COLORS.border};
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-text {
    font-size: 12px;
    color: ${COLORS.textMuted};
  }
  .footer-accent { color: ${COLORS.accent}; font-weight: 600; }

  /* ─── Deep Analysis ─── */
  .exec-summary-block {
    background: ${COLORS.bgSurface};
    border-radius: 10px;
    border-left: 3px solid ${COLORS.accentBlue};
    padding: 16px 20px;
    margin-bottom: 8px;
  }
  .exec-summary-label {
    font-size: 10px;
    font-weight: 700;
    color: ${COLORS.accentBlue};
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .exec-summary-text {
    font-size: 13px;
    color: ${COLORS.textSecondary};
    line-height: 1.6;
  }
  .compliance-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .compliance-Platinum { background: rgba(0,212,255,0.15); color: #00D4FF; }
  .compliance-Gold     { background: rgba(255,184,0,0.15);  color: #FFB800; }
  .compliance-Silver   { background: rgba(186,186,186,0.15); color: #C0C0C0; }
  .compliance-Bronze   { background: rgba(205,127,50,0.15); color: #CD7F32; }

  .deep-table { border-radius: 10px; overflow: hidden; }
  .deep-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px;
    background: ${COLORS.bgSurface};
    font-size: 12px;
  }
  .deep-row:nth-child(even) { background: ${COLORS.bgRowAlt}; }
  .deep-sev { width: 60px; font-weight: 600; flex-shrink: 0; }
  .sev-high   { color: ${COLORS.error}; }
  .sev-medium { color: ${COLORS.warning}; }
  .sev-low    { color: ${COLORS.success}; }
  .deep-cat { width: 110px; color: ${COLORS.textSecondary}; flex-shrink: 0; }
  .deep-msg { flex: 1; color: ${COLORS.textPrimary}; }
  .deep-file { width: 120px; color: ${COLORS.textMuted}; font-family: 'SF Mono', monospace; font-size: 11px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .deep-conf { width: 44px; text-align: right; color: ${COLORS.textMuted}; font-family: 'SF Mono', monospace; font-size: 11px; flex-shrink: 0; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <span class="logo-icon">⚙️</span>
      <span class="logo-text">Ratchet</span>
    </div>
    <div class="header-right">
      <div class="header-date">${esc(dateStr)}</div>
      <div class="header-project">Project: <strong>${esc(projectName)}</strong> · Target: <strong>${esc(targetName)}</strong></div>
    </div>
  </div>
  <div class="header-divider"></div>

  <!-- KPI Strip -->
  <div class="kpi-strip">
    <div class="kpi-card">
      <div class="kpi-value" style="color:${COLORS.textPrimary}">${totalClicks}</div>
      <div class="kpi-label">Clicks</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:${COLORS.success}">${landed.length}</div>
      <div class="kpi-label">Landed</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:${rolledBack.length > 0 ? COLORS.error : COLORS.success}">${rolledBack.length}</div>
      <div class="kpi-label">Rolled Back</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:${COLORS.accent}">${esc(duration)}</div>
      <div class="kpi-label">Duration</div>
    </div>
  </div>

  ${execSummaryHtml}
  ${heroHtml}
  ${categoryHtml}
  ${deepFindingsHtml}
  ${timelineHtml}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-text">
      Generated by <span class="footer-accent">Ratchet</span> · <span class="footer-accent">ratchetcli.com</span>
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
  // Debug: dump HTML to /tmp for inspection
  if (process.env.RATCHET_DEBUG_HTML) {
    const { writeFileSync } = await import('fs');
    writeFileSync('/tmp/ratchet-report-debug.html', html);
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });
    type PageGlobal = { document: { body: { scrollHeight: number } } };
    const contentHeight = await page.evaluate(
      () => (globalThis as unknown as PageGlobal).document.body.scrollHeight,
    );
    // Single-page PDF: set page height to exact content so no blank page 2
    const pdf = await page.pdf({
      width: '794px',
      height: `${contentHeight + 2}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges: '1',
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Write the PDF report to docs/<target>-ratchet-report.pdf.
 */
export async function writePDF(options: ReportOptions): Promise<string> {
  const { run, cwd } = options;
  const pdfPath = join(cwd, 'docs', `${run.target.name}-ratchet-report.pdf`);
  const buffer = await generatePDF(options);
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, buffer);
  return pdfPath;
}
