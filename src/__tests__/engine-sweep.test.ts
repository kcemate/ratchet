import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunk } from '../core/engine-sweep.js';

describe('chunk', () => {
  it('splits array into chunks of specified size', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = chunk(arr, 3);
    expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
  });

  it('handles empty array', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('handles chunk size larger than array', () => {
    const arr = [1, 2];
    expect(chunk(arr, 5)).toEqual([[1, 2]]);
  });

  it('handles chunk size of 1', () => {
    const arr = [1, 2, 3];
    expect(chunk(arr, 1)).toEqual([[1], [2], [3]]);
  });

  it('handles non-integer array elements', () => {
    const arr = ['a', 'b', 'c', 'd'];
    expect(chunk(arr, 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles uneven division', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(chunk(arr, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles single element array', () => {
    expect(chunk([42], 10)).toEqual([[42]]);
  });
});

describe('runSweepEngine integration', () => {
  it('should export chunk function', () => {
    // This is a basic integration test to ensure the module exports work
    expect(typeof chunk).toBe('function');
    
    // Test the imported function works
    const result = chunk([1, 2, 3, 4], 2);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });
});