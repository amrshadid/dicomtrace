import { describe, expect, it } from 'vitest';
import { physicalRange, rangeContains, rangeProblem } from '../../src/core/ranges';

describe('rangeProblem', () => {
  it('accepts ranges inside the file, including empty and full-file ranges', () => {
    expect(rangeProblem(0, 0, 0)).toBeNull();
    expect(rangeProblem(10, 20, 20)).toBeNull();
    expect(rangeProblem(0, 9830, 9830)).toBeNull();
  });

  it.each([
    [-1, 4, 10, 'negative'],
    [5, 4, 10, 'before start'],
    [0, 11, 10, 'past the end'],
    [0.5, 4, 10, 'integers'],
    [0, Number.NaN, 10, 'integers'],
    [0, 4, -1, 'file size'],
    [0, 4, Number.POSITIVE_INFINITY, 'file size'],
  ])('rejects start=%s end=%s size=%s (%s)', (start, end, size, message) => {
    expect(rangeProblem(start, end, size)).toContain(message);
  });
});

describe('physicalRange', () => {
  it('returns a physical range when valid', () => {
    expect(physicalRange(132, 144, 9830)).toEqual({
      kind: 'physical',
      range: { start: 132, end: 144 },
    });
  });

  it('never passes an invalid range through: it becomes unavailable', () => {
    expect(physicalRange(9000, 10000, 9830)).toEqual({ kind: 'unavailable', reason: 'parseError' });
  });
});

describe('rangeContains', () => {
  it('is half-open: includes start, excludes end', () => {
    const r = { start: 10, end: 20 };
    expect(rangeContains(r, 9)).toBe(false);
    expect(rangeContains(r, 10)).toBe(true);
    expect(rangeContains(r, 19)).toBe(true);
    expect(rangeContains(r, 20)).toBe(false);
    expect(rangeContains({ start: 5, end: 5 }, 5)).toBe(false);
  });
});
