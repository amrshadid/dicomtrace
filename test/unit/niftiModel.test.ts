import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseNiftiHeader } from '../../src/core/nifti';
import { niftiView } from '../../src/core/niftiModel';

// Paths resolve from the repository root, where Vitest runs.
const header = (bytes: Uint8Array) => {
  const r = parseNiftiHeader(bytes);
  if (!r.ok) throw new Error(r.error);
  return r.header;
};

describe('niftiView', () => {
  it('gives .nii fields physical ranges and readable values', () => {
    const bytes = new Uint8Array(readFileSync(resolve('test/fixtures/nifti/anatomical.nii')));
    const view = niftiView(header(bytes), bytes.byteLength, false);
    expect(view.compressed).toBe(false);
    expect(view.fields.find((f) => f.name === 'dim')).toEqual({
      name: 'dim',
      text: '3 33 41 25 1 1 1 1',
      range: { kind: 'physical', range: { start: 40, end: 56 } },
    });
    expect(view.fields.find((f) => f.name === 'descrip')?.text).toBe('spm - 3D normalized');
    expect(view.voxels).toEqual({ kind: 'physical', range: { start: 352, end: bytes.byteLength } });
  });

  it('makes every .nii.gz range unavailable (compressed) but keeps the values', () => {
    const bytes = new Uint8Array(
      gunzipSync(readFileSync(resolve('test/fixtures/nifti/example4d.nii.gz'))),
    );
    const view = niftiView(header(bytes), bytes.byteLength, true);
    expect(
      view.fields.every((f) => f.range.kind === 'unavailable' && f.range.reason === 'compressed'),
    ).toBe(true);
    expect(view.voxels).toEqual({ kind: 'unavailable', reason: 'compressed' });
    expect(view.fields.find((f) => f.name === 'dim')?.text).toBe('4 128 96 24 2 1 1 1');
  });

  it('rounds long floats for display', () => {
    const bytes = new Uint8Array(readFileSync(resolve('test/fixtures/nifti/example_nifti2.nii')));
    const pixdim = niftiView(header(bytes), bytes.byteLength, false).fields.find(
      (f) => f.name === 'pixdim',
    );
    expect(pixdim?.text.split(' ').every((t) => t.length <= 12)).toBe(true);
  });
});
