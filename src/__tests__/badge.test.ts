import { describe, it, expect } from 'vitest';
import {
  scoreToColor,
  generateBadgeUrl,
  generateBadgeSvg,
  generateReadmeSnippet,
} from '../../src/core/badge.js';

// --- scoreToColor ---

describe('scoreToColor', () => {
  it('returns red for scores 0-39', () => {
    expect(scoreToColor(0).name).toBe('red');
    expect(scoreToColor(39).name).toBe('red');
  });

  it('returns orange for scores 40-59', () => {
    expect(scoreToColor(40).name).toBe('orange');
    expect(scoreToColor(59).name).toBe('orange');
  });

  it('returns yellow for scores 60-74', () => {
    expect(scoreToColor(60).name).toBe('yellow');
    expect(scoreToColor(74).name).toBe('yellow');
  });

  it('returns green for scores 75-89', () => {
    expect(scoreToColor(75).name).toBe('green');
    expect(scoreToColor(89).name).toBe('green');
  });

  it('returns brightgreen for scores 90-100', () => {
    expect(scoreToColor(90).name).toBe('brightgreen');
    expect(scoreToColor(100).name).toBe('brightgreen');
  });

  it('includes the hex color', () => {
    expect(scoreToColor(100).hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scoreToColor(0).hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// --- generateBadgeUrl ---

describe('generateBadgeUrl', () => {
  it('builds a shields.io URL with the correct label', () => {
    const url = generateBadgeUrl(84, 100, 'flat');
    expect(url).toContain('shields.io');
    expect(url).toContain('ratchet');
  });

  it('URL-encodes the score fraction', () => {
    const url = generateBadgeUrl(84, 100, 'flat');
    // "/" must be encoded as %2F
    expect(url).toContain('84%2F100');
  });

  it('includes the correct color name for the score', () => {
    expect(generateBadgeUrl(84, 100, 'flat')).toContain('green');
    expect(generateBadgeUrl(30, 100, 'flat')).toContain('red');
    expect(generateBadgeUrl(50, 100, 'flat')).toContain('orange');
  });

  it('includes the style parameter', () => {
    expect(generateBadgeUrl(84, 100, 'flat-square')).toContain('style=flat-square');
    expect(generateBadgeUrl(84, 100, 'for-the-badge')).toContain('style=for-the-badge');
  });
});

// --- generateBadgeSvg ---

describe('generateBadgeSvg', () => {
  it('returns a valid SVG string for flat style', () => {
    const svg = generateBadgeSvg(84, 100, 'flat');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('ratchet');
    expect(svg).toContain('84/100');
  });

  it('flat style includes rounded corners clip-path', () => {
    const svg = generateBadgeSvg(84, 100, 'flat');
    expect(svg).toContain('rx="3"');
  });

  it('flat-square style has no rounded corners', () => {
    const svg = generateBadgeSvg(84, 100, 'flat-square');
    expect(svg).not.toContain('rx="3"');
    expect(svg).toContain('crispEdges');
  });

  it('for-the-badge style is taller (28px)', () => {
    const svg = generateBadgeSvg(84, 100, 'for-the-badge');
    expect(svg).toContain('height="28"');
  });

  it('for-the-badge uses uppercase label', () => {
    const svg = generateBadgeSvg(84, 100, 'for-the-badge');
    expect(svg).toContain('RATCHET');
  });

  it('embeds the correct fill color', () => {
    const svgGreen = generateBadgeSvg(84, 100, 'flat');
    const { hex } = scoreToColor(84);
    expect(svgGreen).toContain(hex);
  });

  it('includes score in the SVG for all styles', () => {
    for (const style of ['flat', 'flat-square', 'for-the-badge'] as const) {
      const svg = generateBadgeSvg(42, 100, style);
      expect(svg).toContain('42/100');
    }
  });

  it('total width grows with longer score text', () => {
    // "100/100" is longer than "5/100"
    const svgFull = generateBadgeSvg(100, 100, 'flat');
    const svgLow  = generateBadgeSvg(5, 100, 'flat');
    const widthFull = parseInt(svgFull.match(/width="(\d+)"/)?.[1] ?? '0');
    const widthLow  = parseInt(svgLow.match(/width="(\d+)"/)?.[1] ?? '0');
    expect(widthFull).toBeGreaterThanOrEqual(widthLow);
  });
});

// --- generateReadmeSnippet ---

describe('generateReadmeSnippet', () => {
  it('returns markdown by default', () => {
    const snippet = generateReadmeSnippet(84, 100, 'flat', 'markdown');
    expect(snippet).toMatch(/^!\[/);
    expect(snippet).toContain('Ratchet Score');
    expect(snippet).toContain('shields.io');
  });

  it('returns an HTML img tag when format is html', () => {
    const snippet = generateReadmeSnippet(84, 100, 'flat', 'html');
    expect(snippet).toContain('<img');
    expect(snippet).toContain('shields.io');
  });

  it('includes local badge path comment when provided', () => {
    const snippet = generateReadmeSnippet(84, 100, 'flat', 'markdown', '.ratchet/badge.svg');
    expect(snippet).toContain('.ratchet/badge.svg');
  });

  it('does not include local path comment when not provided', () => {
    const snippet = generateReadmeSnippet(84, 100, 'flat', 'markdown');
    expect(snippet).not.toContain('.ratchet/badge.svg');
  });

  it('displays correct score in alt text', () => {
    const snippet = generateReadmeSnippet(73, 100, 'flat', 'markdown');
    expect(snippet).toContain('73/100');
  });
});
