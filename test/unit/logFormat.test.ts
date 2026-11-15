import { describe, expect, it } from 'vitest';
import type { LogData, LogEvent } from '../../src/core/logFormat';
import { formatLogEvent } from '../../src/core/logFormat';

describe('formatLogEvent (no values, paths or bytes in logs)', () => {
  it('formats an event with numbers and booleans', () => {
    expect(formatLogEvent('parsed', { ms: 41.23456, elements: 81, partial: false })).toBe(
      'parsed ms=41.235 elements=81 partial=false',
    );
    expect(formatLogEvent('closed')).toBe('closed');
  });

  it.each([
    ['a string value (a tag value or path)', { patient: 'Doe^Jane' }],
    ['a path', { file: '/home/user/scan.dcm' }],
    ['bytes', { data: new Uint8Array([1, 2]) }],
    ['an object', { nested: { a: 1 } }],
    ['a non-finite number', { ms: Number.NaN }],
    ['a key that is not a plain name', { 'a b': 1 }],
  ])('refuses %s', (_label, data) => {
    expect(formatLogEvent('parsed', data as unknown as LogData)).toBeNull();
  });

  it('refuses an unknown event name', () => {
    expect(formatLogEvent('Doe^Jane' as LogEvent)).toBeNull();
  });
});
