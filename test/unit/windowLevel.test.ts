import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  dragMultiplier,
  dragWindow,
  dragZoom,
  formatWindowValue,
  initialWindow,
} from '../../src/core/windowLevel';

describe('dragMultiplier (as Cornerstone WindowLevelTool)', () => {
  it.each([
    [4096, 4],
    [1024, 1],
    [1500, 1],
    [1600, 2],
    [65535, 64],
    [255, 255 / 1024],
    [1, 1 / 1024],
  ])('range %d → %d per pixel', (range, m) => {
    expect(dragMultiplier(range)).toBeCloseTo(m, 10);
  });

  it('falls back to 1 for an empty or broken range', () => {
    expect(dragMultiplier(0)).toBe(1);
    expect(dragMultiplier(Number.NaN)).toBe(1);
  });
});

describe('dragWindow', () => {
  it('moves width with x and centre with y, like DICOM', () => {
    expect(dragWindow({ center: 600, width: 1200 }, 10, -5, 4096)).toEqual({
      center: 580,
      width: 1240,
    });
  });

  it('keeps the width at least 1 for wide-range images', () => {
    expect(dragWindow({ center: 0, width: 10 }, -100, 0, 4096).width).toBe(1);
  });

  it('allows narrow windows on small-range (float) images', () => {
    const w = dragWindow({ center: 0.5, width: 0.5 }, -1000, 0, 1);
    expect(w.width).toBeCloseTo(1 / 1024, 10);
  });
});

describe('initialWindow', () => {
  it('uses the stored display window when it is usable', () => {
    expect(initialWindow(0, 1000, { low: 100, high: 300 })).toEqual({ center: 200, width: 200 });
  });

  it('falls back to min..max when the stored window is empty or reversed', () => {
    expect(initialWindow(0, 1000, { low: 0, high: 0 })).toEqual({ center: 500, width: 1000 });
    expect(initialWindow(10, 20)).toEqual({ center: 15, width: 10 });
  });
});

describe('zoom', () => {
  it('clamps to the shared limits', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
  });

  it('scales by the same ratio for the same drag, whatever the zoom', () => {
    expect(dragZoom(1, 0)).toBe(1);
    expect(dragZoom(1, -150)).toBeCloseTo(Math.E);
    expect(dragZoom(2, -60) / 2).toBeCloseTo(dragZoom(1, -60));
    expect(dragZoom(1, 150)).toBeCloseTo(1 / Math.E);
    expect(dragZoom(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
  });
});

describe('formatWindowValue', () => {
  it('rounds large or whole values and keeps four digits otherwise', () => {
    expect(formatWindowValue(500)).toBe('500');
    expect(formatWindowValue(1234.56)).toBe('1235');
    expect(formatWindowValue(-3)).toBe('-3');
    expect(formatWindowValue(0.123456)).toBe('0.1235');
    expect(formatWindowValue(12.3456)).toBe('12.35');
  });

  it('is empty for non-finite values', () => {
    expect(formatWindowValue(Number.NaN)).toBe('');
    expect(formatWindowValue(Number.POSITIVE_INFINITY)).toBe('');
  });
});
