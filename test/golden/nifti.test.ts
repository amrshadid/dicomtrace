/**
 * Golden test for the NIfTI header parser: every field value must equal nibabel's
 * reading (recorded by scripts/record-nibabel-headers.py), and the field ranges must
 * tile the header exactly, so every highlighted byte belongs to exactly one field.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseNiftiHeader } from '../../src/core/nifti';

// Paths resolve from the repository root, where Vitest runs.
const DIR = resolve('test/fixtures/nifti');
const files = readdirSync(DIR)
  .filter((f) => /\.nii(\.gz)?$/.test(f))
  .sort();

interface Recording {
  version: 1 | 2;
  littleEndian: boolean;
  shape: number[];
  extensions: { code: number; size: number }[];
  fields: Record<string, number | string | (number | string)[]>;
}

const recordingName = (file: string): string =>
  file.endsWith('.gz') ? file.replace('.nii.gz', '.gz.json') : file.replace('.nii', '.json');

/** nibabel writes non-finite floats as strings ("nan", "inf"). */
const same = (ours: number | string, theirs: number | string): boolean =>
  typeof theirs === 'string' && typeof ours === 'number'
    ? String(ours).toLowerCase().replace('infinity', 'inf') === theirs
    : ours === theirs;

describe('NIfTI fixtures', () => {
  it('cover NIfTI-1 and NIfTI-2, plain and gzip', () => {
    expect(files).toEqual([
      'anatomical.nii',
      'example4d.nii.gz',
      'example_nifti2.nii',
      'example_nifti2.nii.gz',
      'standard.nii.gz',
    ]);
  });
});

describe.each(files)('%s: header matches nibabel', (file) => {
  const raw = readFileSync(resolve(DIR, file));
  const bytes = new Uint8Array(file.endsWith('.gz') ? gunzipSync(raw) : raw);
  const rec = JSON.parse(
    readFileSync(resolve(DIR, 'nibabel', recordingName(file)), 'utf8'),
  ) as Recording;
  const result = parseNiftiHeader(bytes);

  it('parses', () => {
    expect(result.ok ? 'ok' : result.error).toBe('ok');
  });
  if (!result.ok) return;
  const { header } = result;

  it('has the same version, byte order and shape', () => {
    expect(header.version).toBe(rec.version);
    expect(header.littleEndian).toBe(rec.littleEndian);
    expect(header.shape).toEqual(rec.shape);
  });

  it('reads every field nibabel reads, with the same value', () => {
    const mismatches: string[] = [];
    for (const [name, theirs] of Object.entries(rec.fields)) {
      const field = header.fields.find((x) => x.name === name);
      if (!field) {
        mismatches.push(`${name}: missing`);
        continue;
      }
      const ours = field.value;
      // Array.isArray widens readonly arrays to any[], so narrow by typeof instead.
      const equal = Array.isArray(theirs)
        ? typeof ours === 'object' &&
          ours.length === theirs.length &&
          theirs.every((t, i) => ours[i] !== undefined && same(ours[i], t))
        : typeof ours !== 'object' && same(ours, theirs);
      if (!equal)
        mismatches.push(
          `${name}: ours ${JSON.stringify(ours)} vs nibabel ${JSON.stringify(theirs)}`,
        );
    }
    expect(mismatches).toEqual([]);
    expect(header.fields.map((x) => x.name).sort()).toEqual(Object.keys(rec.fields).sort());
  });

  it('field ranges tile the header with no gap or overlap', () => {
    const sorted = [...header.fields].sort((a, b) => a.range.start - b.range.start);
    let cursor = 0;
    for (const field of sorted) {
      expect(field.range.start, field.name).toBe(cursor);
      cursor = field.range.end;
    }
    expect(cursor).toBe(header.version === 1 ? 348 : 540);
  });

  it('lists the same extensions as nibabel', () => {
    expect(
      header.extensions.map((e) => ({ code: e.code, size: e.range.end - e.range.start })),
    ).toEqual(rec.extensions);
  });
});
