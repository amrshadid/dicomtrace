import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, formatOffset, pageOf, parseOffset, rowCount } from '../../src/core/hexPaging';

describe('hex paging', () => {
  it('maps offsets to pages', () => {
    expect(pageOf(0)).toBe(0);
    expect(pageOf(PAGE_SIZE - 1)).toBe(0);
    expect(pageOf(PAGE_SIZE)).toBe(1);
    expect(pageOf(-5)).toBe(0);
  });

  it('counts rows', () => {
    expect(rowCount(0)).toBe(0);
    expect(rowCount(16)).toBe(1);
    expect(rowCount(9830)).toBe(615);
  });

  it('formats offsets as 8 hex digits', () => {
    expect(formatOffset(0)).toBe('00000000');
    expect(formatOffset(0x1a2b)).toBe('00001A2B');
  });
});

describe('parseOffset', () => {
  it('accepts decimal and 0x hex', () => {
    expect(parseOffset('1234')).toBe(1234);
    expect(parseOffset(' 0x4d2 ')).toBe(1234);
    expect(parseOffset('0X4D2')).toBe(1234);
    expect(parseOffset('0')).toBe(0);
  });

  it('rejects partial numbers, signs, fractions and empty input', () => {
    for (const bad of ['12zz', '0x', '0xg1', '-1', '1.5', '1e3', '', '  ', '9007199254740993']) {
      expect(parseOffset(bad)).toBeNull();
    }
  });
});
