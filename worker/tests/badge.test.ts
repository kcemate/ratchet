import { describe, it, expect } from 'vitest';
import {
  scoreToColor,
  percentToColor,
  textWidth,
  generateBadge,
  generateScoreBadge,
  generateCategoryBadge,
  generateTrendBadge,
  generateErrorBadge,
} from '../src/badge.js';

describe('scoreToColor', () => {
  it('returns brightgreen for 90+', () => {
    expect(scoreToColor(90).hex).toBe('#44cc11');
    expect(scoreToColor(100).hex).toBe('#44cc11');
  });
  it('returns green for 75-89', () => {
    expect(scoreToColor(75).hex).toBe('#97ca00');
    expect(scoreToColor(89).hex).toBe('#97ca00');
  });
  it('returns yellow for 60-74', () => {
    expect(scoreToColor(60).hex).toBe('#dfb317');
    expect(scoreToColor(74).hex).toBe('#dfb317');
  });
  it('returns orange for 40-59', () => {
    expect(scoreToColor(40).hex).toBe('#fe7d37');
    expect(scoreToColor(59).hex).toBe('#fe7d37');
  });
  it('returns red for <40', () => {
    expect(scoreToColor(0).hex).toBe('#e05d44');
    expect(scoreToColor(39).hex).toBe('#e05d44');
  });
});

describe('percentToColor', () => {
  it('maps percentage to same color scale as scoreToColor', () => {
    expect(percentToColor(95).hex).toBe(scoreToColor(95).hex);
    expect(percentToColor(50).hex).toBe(scoreToColor(50).hex);
  });
});

describe('textWidth', () => {
  it('returns 0 for empty string', () => {
    expect(textWidth('')).toBe(0);
  });
  it('assigns 5 for narrow chars', () => {
    expect(textWidth('i')).toBe(5);
    expect(textWidth('l')).toBe(5);
  });
  it('assigns 10 for wide chars', () => {
    expect(textWidth('m')).toBe(10);
    expect(textWidth('w')).toBe(10);
  });
  it('assigns 7 for regular chars', () => {
    expect(textWidth('a')).toBe(7);
    expect(textWidth('b')).toBe(7);
  });
  it('sums widths of a multi-char string', () => {
    // 'ratchet' = r(5)+a(7)+t(5)+c(7)+h(7)+e(7)+t(5) = 43
    expect(textWidth('ratchet')).toBe(43);
  });
});

describe('generateBadge', () => {
  it('produces valid SVG for flat style', () => {
    const svg = generateBadge('ratchet', '92/100', '#44cc11', 'flat');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('ratchet');
    expect(svg).toContain('92/100');
    expect(svg).toContain('#44cc11');
    expect(svg).toContain('linearGradient'); // flat has gradient
  });

  it('produces valid SVG for flat-square style', () => {
    const svg = generateBadge('ratchet', '92/100', '#44cc11', 'flat-square');
    expect(svg).toContain('<svg');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toContain('linearGradient');
  });

  it('produces valid SVG for for-the-badge style', () => {
    const svg = generateBadge('ratchet', '92/100', '#44cc11', 'for-the-badge');
    expect(svg).toContain('height="28"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('RATCHET'); // uppercased
    expect(svg).toContain('92/100');  // value uppercased too
  });

  it('sets aria-label with label and value', () => {
    const svg = generateBadge('testing', '22/25', '#97ca00', 'flat');
    expect(svg).toContain('aria-label="testing: 22/25"');
  });
});

describe('generateScoreBadge', () => {
  it('uses score color for right panel', () => {
    const svg = generateScoreBadge('ratchet', 92, 100, 'flat');
    expect(svg).toContain('#44cc11'); // brightgreen
    expect(svg).toContain('92/100');
  });

  it('uses custom label', () => {
    const svg = generateScoreBadge('my-label', 80, 100, 'flat');
    expect(svg).toContain('my-label');
  });

  it('uses red for low scores', () => {
    const svg = generateScoreBadge('ratchet', 20, 100, 'flat');
    expect(svg).toContain('#e05d44');
  });
});

describe('generateCategoryBadge', () => {
  it('calculates color from percentage of max', () => {
    // 22/25 = 88% → green
    const svg = generateCategoryBadge('testing', 22, 25, 'flat');
    expect(svg).toContain('#97ca00');
    expect(svg).toContain('22/25');
  });

  it('uses brightgreen for 100%', () => {
    const svg = generateCategoryBadge('security', 15, 15, 'flat');
    expect(svg).toContain('#44cc11');
  });

  it('handles zero max gracefully', () => {
    const svg = generateCategoryBadge('perf', 0, 0, 'flat');
    expect(svg).toContain('<svg');
    expect(svg).toContain('0/0');
  });
});

describe('generateTrendBadge', () => {
  it('shows positive delta with +N notation', () => {
    const svg = generateTrendBadge(92, 100, 4, 'flat');
    expect(svg).toContain('+4');
    expect(svg).toContain('92/100');
  });

  it('shows negative delta with -N notation', () => {
    const svg = generateTrendBadge(78, 100, -2, 'flat');
    expect(svg).toContain('-2');
    expect(svg).toContain('78/100');
  });

  it('shows = for no change', () => {
    const svg = generateTrendBadge(85, 100, 0, 'flat');
    expect(svg).toContain('(=)');
  });

  it('colors by current score, not delta', () => {
    const svg = generateTrendBadge(92, 100, -1, 'flat');
    expect(svg).toContain('#44cc11'); // score 92 = brightgreen despite negative delta
  });
});

describe('generateErrorBadge', () => {
  it('renders gray unknown badge', () => {
    const svg = generateErrorBadge('ratchet', 'unknown', 'flat');
    expect(svg).toContain('#9f9f9f');
    expect(svg).toContain('unknown');
  });
});
