import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from '../src/math';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('handles negative numbers', () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it('handles zero', () => {
    expect(add(0, 0)).toBe(0);
  });
});

describe('subtract', () => {
  it('subtracts correctly', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  it('handles negative result', () => {
    expect(subtract(1, 5)).toBe(-4);
  });
});

describe('multiply', () => {
  it('multiplies two numbers', () => {
    expect(multiply(3, 4)).toBe(12);
  });

  it('handles zero', () => {
    expect(multiply(5, 0)).toBe(0);
  });
});

describe('divide', () => {
  it('divides correctly', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('throws on invalid division by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
  });

  it('handles boundary with negative divisor', () => {
    expect(divide(-10, 2)).toBe(-5);
  });
});
