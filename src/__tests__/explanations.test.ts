import { describe, it, expect } from 'vitest';
import {
  EXPLANATIONS,
  getExplanation,
  type Explanation,
} from '../core/explanations.js';

describe('EXPLANATIONS', () => {
  it('exports a non-empty lookup table', () => {
    expect(typeof EXPLANATIONS).toBe('object');
    expect(Object.keys(EXPLANATIONS).length).toBeGreaterThan(0);
  });

  it('has all 18 expected subcategory entries', () => {
    const expected = [
      'Coverage ratio',
      'Edge case depth',
      'Test quality',
      'Secrets & env vars',
      'Input validation',
      'Auth & rate limiting',
      'Strict config',
      'Any type count',
      'Coverage',
      'Empty catches',
      'Structured logging',
      'Async patterns',
      'Console cleanup',
      'Import hygiene',
      'Function length',
      'Line length',
      'Dead code',
      'Duplication',
    ];

    for (const key of expected) {
      expect(EXPLANATIONS).toHaveProperty(key);
    }
  });

  it('each explanation has why and fix fields', () => {
    for (const [key, exp] of Object.entries(EXPLANATIONS)) {
      expect(typeof (exp as Explanation).why, `${key}: why should be a string`).toBe('string');
      expect((exp as Explanation).why.length, `${key}: why should be non-empty`).toBeGreaterThan(0);
      expect(typeof (exp as Explanation).fix, `${key}: fix should be a string`).toBe('string');
      expect((exp as Explanation).fix.length, `${key}: fix should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('some explanations include an example field', () => {
    const withExample = Object.entries(EXPLANATIONS).filter(
      ([, exp]) => exp.example !== undefined,
    );
    // At least a few should have examples
    expect(withExample.length).toBeGreaterThan(5);
    for (const [, exp] of withExample) {
      expect(typeof (exp as Explanation).example).toBe('string');
      expect((exp as Explanation).example!.length).toBeGreaterThan(0);
    }
  });

  it('Coverage ratio has why, fix, and example', () => {
    const exp = EXPLANATIONS['Coverage ratio'];
    expect(exp.why).toBeTruthy();
    expect(exp.fix).toBeTruthy();
    expect(exp.example).toBeTruthy();
  });

  it('Secrets & env vars explains why hardcoded secrets are dangerous', () => {
    const exp = EXPLANATIONS['Secrets & env vars'];
    expect(exp.why.toLowerCase()).toContain('secret');
    expect(exp.why.toLowerCase()).toContain('leak');
  });

  it('Empty catches explains the silent-swallow problem', () => {
    const exp = EXPLANATIONS['Empty catches'];
    expect(exp.why.toLowerCase()).toContain('empty');
    expect(exp.why.toLowerCase()).toContain('error');
  });

  it('Async patterns explains await-in-loop performance problem', () => {
    const exp = EXPLANATIONS['Async patterns'];
    expect(exp.why.toLowerCase()).toContain('loop');
    expect(exp.why.toLowerCase()).toContain('performance');
  });

  it('Strict config explains strict mode benefits', () => {
    const exp = EXPLANATIONS['Strict config'];
    expect(exp.why.toLowerCase()).toContain('strict');
    expect(exp.fix.toLowerCase()).toContain('tsconfig');
  });

  it('Dead code has no example (allowed)', () => {
    const exp = EXPLANATIONS['Dead code'];
    expect(exp.why).toBeTruthy();
    expect(exp.fix).toBeTruthy();
    // example is optional
    expect(exp.example).toBeUndefined();
  });

  it('Duplication has why and fix', () => {
    const exp = EXPLANATIONS['Duplication'];
    expect(exp.why.toLowerCase()).toContain('duplicat');
    expect(exp.fix.toLowerCase()).toContain('extract');
  });
});

describe('getExplanation', () => {
  it('returns the explanation for a known subcategory', () => {
    const exp = getExplanation('Coverage ratio');
    expect(exp).toBeDefined();
    expect(exp!.why).toBeTruthy();
    expect(exp!.fix).toBeTruthy();
  });

  it('returns the explanation for Edge case depth', () => {
    const exp = getExplanation('Edge case depth');
    expect(exp).toBeDefined();
    expect(exp!.why.toLowerCase()).toContain('boundary');
  });

  it('returns the explanation for Input validation', () => {
    const exp = getExplanation('Input validation');
    expect(exp).toBeDefined();
    expect(exp!.why.toLowerCase()).toContain('injection');
  });

  it('returns undefined for unknown subcategory', () => {
    expect(getExplanation('Not a real subcategory')).toBeUndefined();
    expect(getExplanation('')).toBeUndefined();
    expect(getExplanation('coverage')).toBeUndefined(); // case-sensitive
  });

  it('returns undefined for subcategories not in the table', () => {
    expect(getExplanation('foo bar')).toBeUndefined();
  });

  it('is case-sensitive', () => {
    expect(getExplanation('coverage ratio')).toBeUndefined();
    expect(getExplanation('COVERAGE RATIO')).toBeUndefined();
  });

  it('covers all keys in the table', () => {
    for (const key of Object.keys(EXPLANATIONS)) {
      expect(getExplanation(key)).not.toBeUndefined();
    }
  });
});
