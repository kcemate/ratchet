/**
 * SVG badge generation for the Ratchet hosted badge service.
 * Ported from src/core/badge.ts with extensions for category and trend badges.
 */

import type { BadgeStyle } from './types.js';

export { BadgeStyle };

export interface BadgeColor {
  name: string;
  hex: string;
}

// --- Color scale ---

export function scoreToColor(score: number): BadgeColor {
  if (score >= 90) return { name: 'brightgreen', hex: '#44cc11' };
  if (score >= 75) return { name: 'green',       hex: '#97ca00' };
  if (score >= 60) return { name: 'yellow',       hex: '#dfb317' };
  if (score >= 40) return { name: 'orange',       hex: '#fe7d37' };
  return                   { name: 'red',         hex: '#e05d44' };
}

export function percentToColor(percent: number): BadgeColor {
  return scoreToColor(percent);
}

export function deltaToColor(delta: number): string {
  if (delta > 0) return '#44cc11';
  if (delta < 0) return '#e05d44';
  return '#9f9f9f';
}

// --- Text measurement ---

function charWidth(ch: string): number {
  const narrow = new Set(['f', 'i', 'j', 'l', 'r', 't', '1', '|', ':', ';', '.', ',', '/', '!']);
  const wide   = new Set(['m', 'w', 'M', 'W']);
  if (narrow.has(ch)) return 5;
  if (wide.has(ch))   return 10;
  return 7;
}

export function textWidth(text: string): number {
  return text.split('').reduce((sum, ch) => sum + charWidth(ch), 0);
}

// --- Overall score badge ---

export function generateScoreBadge(
  label: string,
  score: number,
  maxScore: number,
  style: BadgeStyle,
): string {
  const { hex: color } = scoreToColor(score);
  const value = `${score}/${maxScore}`;
  return generateBadge(label, value, color, style);
}

// --- Category badge ---

export function generateCategoryBadge(
  category: string,
  score: number,
  max: number,
  style: BadgeStyle,
): string {
  const percent = max > 0 ? (score / max) * 100 : 0;
  const { hex: color } = percentToColor(percent);
  const label = category;
  const value = `${score}/${max}`;
  return generateBadge(label, value, color, style);
}

// --- Trend badge ---

export function generateTrendBadge(
  score: number,
  maxScore: number,
  delta: number,
  style: BadgeStyle,
): string {
  const { hex: scoreColor } = scoreToColor(score);
  const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
  const value = `${score}/${maxScore} (${deltaStr})`;
  return generateBadge('ratchet', value, scoreColor, style);
}

// --- Core badge renderer ---

export function generateBadge(
  label: string,
  value: string,
  color: string,
  style: BadgeStyle,
): string {
  if (style === 'for-the-badge') {
    return forTheBadgeSvg(label.toUpperCase(), value.toUpperCase(), color);
  }
  const ltw = textWidth(label);
  const vtw = textWidth(value);
  const pad = 10;
  const lw  = ltw + pad * 2;
  const vw  = vtw + pad * 2;
  const tw  = lw + vw;
  const lmx = Math.round(lw / 2);
  const vmx = lw + Math.round(vw / 2);

  if (style === 'flat-square') {
    return flatSquareSvg(label, value, color, lw, vw, tw, ltw, vtw, lmx, vmx);
  }
  return flatSvg(label, value, color, lw, vw, tw, ltw, vtw, lmx, vmx);
}

function flatSvg(
  label: string, value: string, color: string,
  lw: number, vw: number, tw: number,
  ltw: number, vtw: number, lmx: number, vmx: number,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${tw}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${tw}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${tw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lmx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${lmx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text aria-hidden="true" x="${vmx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
    <text x="${vmx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
  </g>
</svg>`;
}

function flatSquareSvg(
  label: string, value: string, color: string,
  lw: number, vw: number, tw: number,
  ltw: number, vtw: number, lmx: number, vmx: number,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${tw}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <g shape-rendering="crispEdges">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lmx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${lmx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text aria-hidden="true" x="${vmx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
    <text x="${vmx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
  </g>
</svg>`;
}

function forTheBadgeSvg(label: string, value: string, color: string): string {
  const ltw = Math.round(textWidth(label) * 1.1);
  const vtw = Math.round(textWidth(value) * 1.1);
  const pad = 15;
  const lw  = ltw + pad * 2;
  const vw  = vtw + pad * 2;
  const tw  = lw + vw;
  const lmx = Math.round(lw / 2);
  const vmx = lw + Math.round(vw / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${tw}" height="28" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <g shape-rendering="crispEdges">
    <rect width="${lw}" height="28" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="28" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" text-rendering="geometricPrecision" font-size="100" font-weight="bold">
    <text x="${lmx * 10}" y="175" transform="scale(.1)" fill="#fff" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${vmx * 10}" y="175" transform="scale(.1)" fill="#fff" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
  </g>
</svg>`;
}

// --- Error badge (for unknown repos) ---

export function generateErrorBadge(label: string, message: string, style: BadgeStyle): string {
  return generateBadge(label, message, '#9f9f9f', style);
}
