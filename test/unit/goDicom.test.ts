import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InspectedElement, Inspection } from '../../src/core/inspection';
import {
  MAX_PREVIEW_CHARS,
  isSupportedGoDicom,
  normaliseGoDicom,
  parseGoDicomVersion,
  previewValue,
} from '../../src/core/goDicom';

// Paths resolve from the repository root, where Vitest runs.
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(resolve('test/fixtures/go-dicom', `${name}.json`), 'utf8'));
const sizeOf = (name: string): number =>
  readFileSync(resolve('test/fixtures/dicom', `${name}.dcm`)).byteLength;

function inspect(name: string): Inspection {
  const result = normaliseGoDicom(recorded(name), sizeOf(name));
  if (!result.ok) throw new Error(result.error);
  return result.inspection;
}

const flatten = (els: readonly InspectedElement[]): InspectedElement[] =>
  els.flatMap((e) => [e, ...e.items.flatMap((i) => flatten(i.elements))]);
const find = (els: readonly InspectedElement[], tag: string): InspectedElement => {
  const el = flatten(els).find((e) => e.tag === tag);
  if (!el) throw new Error(`${tag} not found`);
  return el;
};

describe('normaliseGoDicom: explicit VR little endian (MR_small)', () => {
  const inspection = inspect('MR_small');

  it('separates file meta from the data set', () => {
    expect(inspection.fileMeta.every((e) => e.tag.startsWith('(0002,'))).toBe(true);
    expect(inspection.dataSet.some((e) => e.tag.startsWith('(0002,'))).toBe(false);
    expect(find(inspection.fileMeta, '(0002,0010)').id).toBe('m/(0002,0010)');
  });

  it('gives Rows exact physical ranges for tag, VR, length and value', () => {
    const rows = find(inspection.dataSet, '(0028,0010)');
    expect(rows.id).toBe('d/(0028,0010)');
    expect(rows.preview).toEqual({ kind: 'text', text: '64', truncated: false });
    const start = rows.ranges.tag.kind === 'physical' ? rows.ranges.tag.range.start : -1;
    expect(rows.ranges).toEqual({
      tag: { kind: 'physical', range: { start, end: start + 4 } },
      vr: { kind: 'physical', range: { start: start + 4, end: start + 6 } },
      length: { kind: 'physical', range: { start: start + 6, end: start + 8 } },
      value: { kind: 'physical', range: { start: start + 8, end: start + 10 } },
      element: { kind: 'physical', range: { start, end: start + 10 } },
    });
    expect(rows.vrFromDictionary).toBe(false);
  });

  it('reports the regions and that offsets are physical', () => {
    expect(inspection.dataSetOffsetsPhysical).toBe(true);
    expect(inspection.hasPreamble).toBe(true);
    expect(inspection.regions.map((r) => r.name)).toEqual([
      'preamble',
      'prefix',
      'fileMeta',
      'dataSet',
    ]);
    expect(inspection.partial).toBe(false);
  });

  it('never shows Pixel Data as text', () => {
    expect(find(inspection.dataSet, '(7FE0,0010)').preview).toEqual({ kind: 'binary' });
  });
});

describe('normaliseGoDicom: implicit VR', () => {
  const inspection = inspect('MR_small_implicit');

  it('marks the VR as not encoded, taken from the dictionary', () => {
    const rows = find(inspection.dataSet, '(0028,0010)');
    expect(rows.ranges.vr).toEqual({ kind: 'unavailable', reason: 'notEncoded' });
    expect(rows.vrFromDictionary).toBe(true);
    expect(rows.ranges.tag.kind).toBe('physical');
  });

  it('shows resolved ambiguous VRs as numbers (go-dicom ≥ 1.9.1)', () => {
    const largest = find(inspection.dataSet, '(0028,0107)');
    expect(largest.vr).toBe('SS');
    expect(largest.preview).toEqual({ kind: 'text', text: '4000', truncated: false });
    expect(find(inspection.dataSet, '(7FE0,0010)').preview).toEqual({ kind: 'binary' });
  });

  it('still hides binary values an older go-dicom dumps as text (#272 in 1.9.0)', () => {
    const json = recorded('MR_small_implicit') as { dataSet: Record<string, unknown>[] };
    const pixels = json.dataSet.find((e) => e.tag === '(7FE0,0010)')!;
    Object.assign(pixels, { vr: 'OB or OW', value: '\u00ff\u0003\u00ff\u0003' });
    const largest = json.dataSet.find((e) => e.tag === '(0028,0107)')!;
    Object.assign(largest, { vr: 'US or SS', value: '\u00a0\u000f' });
    const result = normaliseGoDicom(json, sizeOf('MR_small_implicit'));
    if (!result.ok) throw new Error(result.error);
    expect(find(result.inspection.dataSet, '(7FE0,0010)').preview).toEqual({ kind: 'binary' });
    expect(find(result.inspection.dataSet, '(0028,0107)').preview).toEqual({ kind: 'binary' });
  });
});

describe('normaliseGoDicom: deflated data set (image_dfl)', () => {
  const inspection = inspect('image_dfl');

  it('makes every data set range unavailable, never a wrong highlight', () => {
    expect(inspection.dataSetOffsetsPhysical).toBe(false);
    for (const el of flatten(inspection.dataSet)) {
      for (const r of [
        el.ranges.tag,
        el.ranges.vr,
        el.ranges.length,
        el.ranges.value,
        el.ranges.element,
      ]) {
        expect(r).toEqual({ kind: 'unavailable', reason: 'deflated' });
      }
      expect(el.ranges.delimiter).toBeUndefined();
    }
  });

  it('keeps file meta ranges physical', () => {
    expect(inspection.fileMeta.every((e) => e.ranges.tag.kind === 'physical')).toBe(true);
  });

  it('still shows the values', () => {
    expect(inspection.dataSet.some((e) => e.preview.kind === 'text')).toBe(true);
  });
});

describe('normaliseGoDicom: undefined length and nesting', () => {
  it('ends an undefined-length value where its delimiter starts', () => {
    const sq = inspect('nested_priv_SQ').dataSet[0]!;
    expect(sq.undefinedLength).toBe(true);
    expect(sq.preview).toEqual({ kind: 'sequence' });
    expect(sq.ranges.delimiter).toEqual({ start: 325, end: 333 });
    expect(sq.ranges.value).toEqual({ kind: 'physical', range: { start: 236, end: 325 } });
    expect(sq.items[0]!.ranges.delimiter).toEqual({ start: 317, end: 325 });
  });

  it('identifies nested elements by item path', () => {
    const inner = inspect('nested_priv_SQ').dataSet[0]!.items[0]!.elements[0]!;
    expect(inner.id).toBe('d/(0001,0001)[0]/(0001,0001)');
    expect(inner.path).toEqual([{ tag: '(0001,0001)', item: 0 }, { tag: '(0001,0001)' }]);
  });

  it('gives repeated tags in different items distinct ids', () => {
    const ids = flatten(inspect('test-SR').dataSet).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads Enhanced CT functional groups as items', () => {
    const perFrame = find(inspect('eCT_Supplemental').dataSet, '(5200,9230)');
    expect(perFrame.items).toHaveLength(2);
    expect(perFrame.items[1]!.elements.map((e) => e.keyword)).toContain('PlanePositionSequence');
  });

  it('reads encapsulated fragments with physical ranges', () => {
    const pixels = find(inspect('MR_small_RLE').dataSet, '(7FE0,0010)');
    expect(pixels.fragments.length).toBeGreaterThanOrEqual(2);
    expect(pixels.fragments.every((f) => f.range.kind === 'physical')).toBe(true);
    expect(pixels.ranges.delimiter).toBeDefined();
  });

  it('marks undefined length without a delimiter as unavailable', () => {
    const json = recorded('nested_priv_SQ') as { dataSet: Record<string, unknown>[] };
    delete json.dataSet[0]!.delimiter;
    const result = normaliseGoDicom(json, sizeOf('nested_priv_SQ'));
    expect(result.ok && result.inspection.dataSet[0]!.ranges.value).toEqual({
      kind: 'unavailable',
      reason: 'undefinedLengthNoDelimiter',
    });
  });
});

describe('normaliseGoDicom: broken files', () => {
  it('flags a truncated file as partial and keeps the intact elements', () => {
    const inspection = inspect('MR_truncated');
    expect(inspection.partial).toBe(true);
    expect(inspection.dataSet.length).toBeGreaterThan(50);
  });

  it('accepts a meta without a transfer syntax', () => {
    expect(inspect('meta_missing_tsyntax').transferSyntax.uid).toBe('');
  });

  it('rejects output for a different file size (the file changed)', () => {
    const result = normaliseGoDicom(recorded('MR_small'), 1234);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('changed') as unknown });
  });

  it('rejects an unknown schema version', () => {
    const json = { ...(recorded('MR_small') as object), schemaVersion: 2 };
    expect(normaliseGoDicom(json, sizeOf('MR_small'))).toEqual({
      ok: false,
      error: expect.stringContaining('schemaVersion 2') as unknown,
    });
  });

  it.each([
    ['not an object', 'nope'],
    ['missing fields', { schemaVersion: 1 }],
    ['a bad tag', { ...(recorded('MR_small') as object), dataSet: [{ tag: 'Rows' }] }],
  ])('rejects %s without throwing', (_label, json) => {
    const result = normaliseGoDicom(json, sizeOf('MR_small'));
    expect(result.ok).toBe(false);
  });

  it('turns an out-of-file range into unavailable, not a highlight', () => {
    const json = recorded('MR_small') as { dataSet: Record<string, unknown>[] };
    json.dataSet[0]!.endOffset = 10_000_000;
    const result = normaliseGoDicom(json, sizeOf('MR_small'));
    expect(result.ok && result.inspection.dataSet[0]!.ranges.element).toEqual({
      kind: 'unavailable',
      reason: 'parseError',
    });
  });

  it('refuses absurd nesting depth', () => {
    let el: Record<string, unknown> = {
      tag: '(0008,0100)',
      vr: 'SH',
      tagOffset: 0,
      vrOffset: 4,
      lengthOffset: 6,
      lengthSize: 2,
      valueOffset: 8,
      valueLength: 0,
      endOffset: 8,
    };
    for (let i = 0; i < 70; i++) {
      el = {
        ...el,
        tag: '(0040,A730)',
        vr: 'SQ',
        items: [{ tagOffset: 0, endOffset: 8, elements: [el] }],
      };
    }
    const json = { ...(recorded('MR_small') as object), dataSet: [el] };
    expect(normaliseGoDicom(json, sizeOf('MR_small'))).toEqual({
      ok: false,
      error: expect.stringContaining('nesting') as unknown,
    });
  });
});

describe('previewValue', () => {
  it('bounds long values', () => {
    const p = previewValue('LT', 'x'.repeat(MAX_PREVIEW_CHARS + 5));
    expect(p).toEqual({ kind: 'text', text: 'x'.repeat(MAX_PREVIEW_CHARS), truncated: true });
  });

  it('replaces control characters so they cannot hide or reflow text', () => {
    expect(previewValue('LO', 'a\u0000b\u001bc')).toEqual({
      kind: 'text',
      text: 'a�b�c',
      truncated: false,
    });
  });

  it('shows ambiguous numeric VRs only when numeric', () => {
    expect(previewValue('US or SS', '4095')).toEqual({
      kind: 'text',
      text: '4095',
      truncated: false,
    });
    expect(previewValue('US or SS', 'ÿ\u000f')).toEqual({ kind: 'binary' });
  });

  it.each(['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'UN', 'OB or OW'])(
    'never shows %s as text',
    (vr) => {
      expect(previewValue(vr, 'abc')).toEqual({ kind: 'binary' });
    },
  );

  it('distinguishes empty values and sequences', () => {
    expect(previewValue('PN', '')).toEqual({ kind: 'empty' });
    expect(previewValue('SQ', undefined)).toEqual({ kind: 'sequence' });
  });
});

describe('go-dicom version', () => {
  it('reads the version line', () => {
    expect(parseGoDicomVersion('go-dicom version 1.9.1\n')).toEqual([1, 9, 1]);
    expect(parseGoDicomVersion('go-dicom version v2.0.0')).toEqual([2, 0, 0]);
    expect(parseGoDicomVersion('usage: go-dicom')).toBeNull();
  });

  it.each([
    [[1, 9, 1], true],
    [[1, 10, 0], true],
    [[2, 0, 0], true],
    [[1, 9, 0], false],
    [[1, 5, 0], false],
    [[0, 99, 99], false],
  ] as const)('%j supported: %s', (version, ok) => {
    expect(isSupportedGoDicom(version)).toBe(ok);
  });
});
