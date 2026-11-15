import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGoDicom } from '../../src/core/goDicom';
import { parseQuery, search } from '../../src/core/search';

describe('parseQuery', () => {
  it.each([
    '(0028,0010)',
    '0028,0010',
    '(0028, 0010)',
    '0028 0010',
    '00280010',
    '0x00280010',
    ' (0028,0010) ',
  ])('reads %j as the tag (0028,0010)', (input) => {
    expect(parseQuery(input)).toEqual({ kind: 'tag', tag: '(0028,0010)' });
  });

  it('upper-cases hex tags', () => {
    expect(parseQuery('7fe00010')).toEqual({ kind: 'tag', tag: '(7FE0,0010)' });
  });

  it('treats anything else as text, and blank as no query', () => {
    expect(parseQuery('Pixel Spacing')).toEqual({ kind: 'text', text: 'pixel spacing' });
    expect(parseQuery('   ')).toBeNull();
  });
});

describe('search', () => {
  // Paths resolve from the repository root, where Vitest runs.
  const json: unknown = JSON.parse(
    readFileSync(resolve('test/fixtures/go-dicom/test-SR.json'), 'utf8'),
  );
  const result = normaliseGoDicom(
    json,
    readFileSync(resolve('test/fixtures/dicom/test-SR.dcm')).byteLength,
  );
  if (!result.ok) throw new Error(result.error);
  const { dataSet } = result.inspection;

  it('finds every occurrence of a repeated tag, inside sequences, in file order', () => {
    const ids = search(dataSet, { kind: 'tag', tag: '(0040,A040)' });
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.endsWith('/(0040,A040)'))).toBe(true);
  });

  it('finds by keyword or name, case-insensitively', () => {
    expect(search(dataSet, parseQuery('valuetype')!).length).toBeGreaterThan(0);
    expect(search(dataSet, parseQuery('Value Type')!).length).toBeGreaterThan(0);
    expect(search(dataSet, parseQuery('no such thing')!)).toEqual([]);
  });
});
