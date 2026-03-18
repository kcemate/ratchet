/**
 * Badge generation utilities.
 * Produces shields.io-compatible URLs and self-contained SVG badges
 * for embedding Ratchet scores in GitHub READMEs.
 */

export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge';
export type BadgeFormat = 'markdown' | 'html';

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

// --- shields.io URL ---

export function generateBadgeUrl(score: number, maxScore: number, style: BadgeStyle): string {
  const label = 'ratchet';
  const value = encodeURIComponent(`${score}/${maxScore}`);
  const { name: color } = scoreToColor(score);
  return `https://img.shields.io/badge/${label}-${value}-${color}?style=${style}`;
}

// --- SVG generation ---

/** Approximate character width in pixels at 11px DejaVu Sans. */
function charWidth(ch: string): number {
  const narrow = new Set(['f', 'i', 'j', 'l', 'r', 't', '1', '|', ':', ';', '.', ',', '/', '!']);
  const wide   = new Set(['m', 'w', 'M', 'W']);
  if (narrow.has(ch)) return 5;
  if (wide.has(ch))   return 10;
  return 7;
}

function textWidth(text: string): number {
  return text.split('').reduce((sum, ch) => sum + charWidth(ch), 0);
}

/** Generate a self-contained SVG badge (shields.io visual style). */
export function generateBadgeSvg(score: number, maxScore: number, style: BadgeStyle): string {
  const { hex: color } = scoreToColor(score);

  if (style === 'for-the-badge') {
    const label = 'RATCHET';
    const value = `${score}/${maxScore}`;
    return forTheBadgeSvg(label, value, color);
  }

  const label = 'ratchet';
  const value = `${score}/${maxScore}`;
  const ltw = textWidth(label);
  const vtw = textWidth(value);
  const pad = 10;
  const lw  = ltw + pad * 2;
  const vw  = vtw + pad * 2;
  const tw  = lw + vw;
  const lmx = Math.round(lw / 2);
  const vmx = lw + Math.round(vw / 2);

  if (style === 'flat') return flatSvg(label, value, color, lw, vw, tw, ltw, vtw, lmx, vmx);
  return flatSquareSvg(label, value, color, lw, vw, tw, ltw, vtw, lmx, vmx);
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
  // Bold uppercase style: taller (28px), font-weight bold, no gradient
  const ltw = Math.round(textWidth(label) * 1.1);  // bold is ~10% wider
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

// --- README snippet ---

export function generateReadmeSnippet(
  score: number,
  maxScore: number,
  style: BadgeStyle,
  format: BadgeFormat,
  localBadgePath?: string,
): string {
  const url = generateBadgeUrl(score, maxScore, style);
  const altText = `Ratchet Score: ${score}/${maxScore}`;

  if (format === 'html') {
    const lines = [`<img alt="${altText}" src="${url}"/>`];
    if (localBadgePath) {
      lines.push(`<!-- Local badge: <img alt="${altText}" src="${localBadgePath}"/> -->`);
    }
    return lines.join('\n');
  }

  // markdown
  const lines = [`![${altText}](${url})`];
  if (localBadgePath) {
    lines.push(`<!-- Local: ![${altText}](${localBadgePath}) -->`);
  }
  return lines.join('\n');
}
