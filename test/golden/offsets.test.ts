/**
 * Golden test: every offset in the recorded go-dicom output must hold against the
 * committed fixture bytes. Runs without go-dicom installed.
 * Re-record with `npm run fixtures:go-dicom -- <path>` after a go-dicom upgrade.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Paths resolve from the repository root, where Vitest runs.
import { describe, expect, it } from 'vitest';
import { checkOffsets } from './checkOffsets';
import type { GoDicomDocument, GoDicomElement } from './goDicomJson';
import { readGoDicomDocument } from './goDicomJson';

const FIXTURES = resolve('test/fixtures/dicom');
const RECORDED = resolve('test/fixtures/go-dicom');
const recordedVersion = readFileSync(join(RECORDED, 'VERSION'), 'utf8').trim();

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.dcm'))
  .sort();

const load = (name: string): { bytes: Uint8Array; doc: GoDicomDocument } => ({
  bytes: new Uint8Array(readFileSync(join(FIXTURES, name))),
  doc: readGoDicomDocument(
    JSON.parse(readFileSync(join(RECORDED, name.replace(/\.dcm$/, '.json')), 'utf8')),
  ),
});

const flatten = (els: readonly GoDicomElement[]): GoDicomElement[] =>
  els.flatMap((e) => [e, ...e.items.flatMap((item) => flatten(item.elements))]);

const find = (doc: GoDicomDocument, tag: string): GoDicomElement => {
  const el = flatten(doc.dataSet).find((e) => e.tag === tag);
  if (!el) throw new Error(`${tag} not found`);
  return el;
};

describe(`go-dicom offsets match fixture bytes (recorded with ${recordedVersion})`, () => {
  it('has a recording for every fixture', () => {
    expect(fixtures).toHaveLength(21);
    const recorded = readdirSync(RECORDED).filter((f) => f.endsWith('.json'));
    expect(recorded.sort()).toEqual(fixtures.map((f) => f.replace(/\.dcm$/, '.json')));
  });

  it.each(fixtures)('%s: every reported range holds against the bytes', (name) => {
    const { bytes, doc } = load(name);
    expect(doc.schemaVersion).toBe(1);
    // Recordings are committed, so they must not carry a local absolute path.
    expect(doc.file).toBe(`test/fixtures/dicom/${name}`);

    const report = checkOffsets(bytes, doc);
    expect(report.errors).toEqual([]);
    expect(report.elements).toBeGreaterThan(0);
  });
});

describe('the cases the offset contract depends on', () => {
  it('explicit VR LE: Rows (0028,0010) is at exact, readable bytes (A1)', () => {
    const { bytes, doc } = load('MR_small.dcm');
    const rows = find(doc, '(0028,0010)');
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(rows.vr).toBe('US');
    expect(rows.valueLength).toBe(2);
    expect(view.getUint16(rows.valueOffset, true)).toBe(64);
    expect(rows.value).toBe('64');
  });

  it('explicit VR BE: the same Rows value decodes big-endian', () => {
    const { bytes, doc } = load('MR_small_bigendian.dcm');
    const rows = find(doc, '(0028,0010)');
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint16(rows.valueOffset, false)).toBe(
      64,
    );
  });

  it('implicit VR: no element has a VR offset (notEncoded)', () => {
    const { doc } = load('MR_small_implicit.dcm');
    expect(flatten(doc.dataSet).every((e) => e.vrOffset === null)).toBe(true);
  });

  it('deflated: data set offsets are not file offsets, file meta still is (A2)', () => {
    const { bytes, doc } = load('image_dfl.dcm');
    expect(doc.transferSyntax.deflated).toBe(true);
    expect(doc.offsetsRelativeTo).toBe('inflatedDataSet');
    expect(checkOffsets(bytes, doc).errors).toEqual([]);
    // The first data set element claims offset 0, which is inside the preamble: proof
    // these numbers must never be shown as physical ranges.
    expect(doc.dataSet[0]?.tagOffset).toBe(0);
  });

  it('undefined length: sequences and items end in delimiters', () => {
    const { doc } = load('nested_priv_SQ.dcm');
    const undefinedLength = flatten(doc.dataSet).filter((e) => e.undefinedLength);
    expect(undefinedLength.length).toBeGreaterThan(0);
  });

  it('deep nesting: test-SR reaches depth 5', () => {
    const { doc } = load('test-SR.dcm');
    const depth = (els: readonly GoDicomElement[]): number =>
      Math.max(
        0,
        ...els.map((e) =>
          e.items.length ? 1 + Math.max(...e.items.map((i) => depth(i.elements))) : 0,
        ),
      );
    expect(depth(doc.dataSet)).toBeGreaterThanOrEqual(5);
  });

  it('RLE: Pixel Data is encapsulated in fragments', () => {
    const { doc } = load('MR_small_RLE.dcm');
    const pixels = find(doc, '(7FE0,0010)');
    expect(pixels.undefinedLength).toBe(true);
    expect(pixels.fragments.length).toBeGreaterThanOrEqual(2);
  });

  it('truncated: partial tags plus a warning that names the cut (A4)', () => {
    const { doc } = load('MR_truncated.dcm');
    expect(doc.warnings.some((w) => w.includes('truncated'))).toBe(true);
    expect(flatten(doc.dataSet).some((e) => e.tag === '(7FE0,0010)')).toBe(false);
  });
});

/**
 * go-dicom #272 (fixed in 1.9.1, the minimum version): binary values under an
 * ambiguous VR were written into `value` as raw bytes. Guard against regressions.
 */
const BINARY_VR = /\b(OB|OW|OF|OD|OL|OV|UN)\b/;
const NUMERIC = /^-?\d+(\.\d+)?(\\-?\d+(\.\d+)?)*$/;

describe('binary values are never dumped as text (go-dicom #272)', () => {
  for (const name of fixtures) {
    it(name, () => {
      const { doc } = load(name);
      for (const el of flatten([...doc.fileMeta, ...doc.dataSet])) {
        if (el.vr !== undefined && BINARY_VR.test(el.vr))
          expect(el.value, `${el.tag} ${el.vr}`).toBeUndefined();
        if (el.vr === 'US or SS' && el.value)
          expect(el.value, `${el.tag} ${el.vr}`).toMatch(NUMERIC);
      }
    });
  }
});

/** The oracle itself must catch a wrong offset, or the golden test proves nothing. */
describe('the offset check rejects tampered recordings', () => {
  const tamper = (
    name: string,
    edit: (json: Record<string, unknown>) => void,
  ): readonly string[] => {
    const json = JSON.parse(
      readFileSync(join(RECORDED, name.replace(/\.dcm$/, '.json')), 'utf8'),
    ) as Record<string, unknown>;
    edit(json);
    return checkOffsets(
      new Uint8Array(readFileSync(join(FIXTURES, name))),
      readGoDicomDocument(json),
    ).errors;
  };
  type Raw = Record<string, unknown> & { items?: { elements: Raw[] }[] };
  const dataSet = (json: Record<string, unknown>): Raw[] => json.dataSet as Raw[];

  it('a tag offset shifted by one byte', () => {
    const errors = tamper('MR_small.dcm', (j) => {
      const el = dataSet(j)[5]!;
      el.tagOffset = (el.tagOffset as number) + 1;
    });
    expect(errors.join('\n')).toMatch(/bytes at tagOffset|gap or overlap/);
  });

  it('a wrong value length', () => {
    const errors = tamper('MR_small.dcm', (j) => {
      const el = dataSet(j)[5]!;
      el.valueLength = (el.valueLength as number) + 2;
    });
    expect(errors.join('\n')).toMatch(/length field/);
  });

  it('a range past the end of the file', () => {
    const errors = tamper('MR_small.dcm', (j) => {
      dataSet(j).at(-1)!.endOffset = 9831;
    });
    expect(errors.join('\n')).toMatch(/past the end of the file/);
  });

  it('a wrong VR', () => {
    const errors = tamper('MR_small.dcm', (j) => {
      dataSet(j)[0]!.vr = 'LO';
    });
    expect(errors.join('\n')).toMatch(/VR bytes/);
  });

  it('a nested element moved inside its item', () => {
    const errors = tamper('test-SR.dcm', (j) => {
      const seq = dataSet(j).find((e) => e.items?.length)!;
      const nested = seq.items![0]!.elements[0]!;
      nested.tagOffset = (nested.tagOffset as number) + 2;
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('inflated offsets treated as file offsets', () => {
    const errors = tamper('image_dfl.dcm', (j) => {
      j.offsetsRelativeTo = 'file';
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('a schema change (missing field) fails loudly', () => {
    expect(() =>
      tamper('MR_small.dcm', (j) => {
        delete dataSet(j)[0]!.lengthOffset;
      }),
    ).toThrow(/lengthOffset/);
  });
});
