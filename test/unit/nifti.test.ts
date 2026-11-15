import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NIFTI_HEADER_PREFIX, parseNiftiHeader } from '../../src/core/nifti';

// Paths resolve from the repository root, where Vitest runs.
const load = (name: string): Uint8Array => {
  const raw = readFileSync(resolve('test/fixtures/nifti', name));
  return new Uint8Array(name.endsWith('.gz') ? gunzipSync(raw) : raw);
};
const parse = (bytes: Uint8Array, singleFile = true) => {
  const r = parseNiftiHeader(bytes, singleFile);
  if (!r.ok) throw new Error(r.error);
  return r.header;
};

describe('parseNiftiHeader', () => {
  it('reads a big-endian NIfTI-1 file', () => {
    const h = parse(load('anatomical.nii'));
    expect(h).toMatchObject({
      version: 1,
      littleEndian: false,
      shape: [33, 41, 25],
      datatypeName: 'int16',
      bitpix: 16,
    });
    expect(h.fields.find((x) => x.name === 'descrip')?.value).toBe('spm - 3D normalized');
  });

  it('flags a single-file vox_offset that overlaps the header and uses the minimum', () => {
    expect(parse(load('anatomical.nii')).voxOffsetInvalid).toBe(false);
    const bytes = load('anatomical.nii').slice(0, 352);
    new DataView(bytes.buffer).setFloat32(108, 0, false); // big-endian file
    const h = parse(bytes);
    expect(h.fields.find((x) => x.name === 'vox_offset')?.value).toBe(0);
    expect(h.voxOffsetInvalid).toBe(true);
    expect(h.voxOffset).toBe(352);
    // A header-only (.hdr) file has no data in it, so 0 is fine there.
    expect(parse(bytes, false).voxOffsetInvalid).toBe(false);
  });

  it('reads NIfTI-2 with 64-bit dims and the extension flag', () => {
    const h = parse(load('example_nifti2.nii'));
    expect(h).toMatchObject({ version: 2, littleEndian: true, shape: [32, 20, 12, 2] });
    expect(h.extensionFlag).toEqual({ start: 540, end: 544 });
  });

  it('gives each field its byte range', () => {
    const h = parse(load('example4d.nii.gz'));
    expect(h.fields.find((x) => x.name === 'dim')?.range).toEqual({ start: 40, end: 56 });
    expect(h.fields.find((x) => x.name === 'magic')?.range).toEqual({ start: 344, end: 348 });
  });

  it('needs only the header prefix', () => {
    const h = parse(load('example_nifti2.nii').subarray(0, NIFTI_HEADER_PREFIX));
    expect(h.shape).toEqual([32, 20, 12, 2]);
  });

  it.each([
    ['empty input', new Uint8Array(0), 'Too short'],
    [
      'a DICOM file',
      new Uint8Array(readFileSync(resolve('test/fixtures/dicom/MR_small.dcm'))),
      'neither 348 nor 540',
    ],
    ['a truncated header', load('example_nifti2.nii').subarray(0, 300), 'ends inside'],
  ])('rejects %s', (_label, bytes, message) => {
    const r = parseNiftiHeader(bytes);
    expect(r.ok ? '' : r.error).toContain(message);
  });

  it('rejects a bad magic and a bad dim[0]', () => {
    const badMagic = load('example4d.nii.gz').slice(0, 352);
    badMagic.set([0x78, 0x78, 0x78, 0], 344);
    expect(parseNiftiHeader(badMagic).ok).toBe(false);
    const badDim = load('example4d.nii.gz').slice(0, 352);
    new DataView(badDim.buffer).setInt16(40, 9, true);
    const r = parseNiftiHeader(badDim);
    expect(r.ok ? '' : r.error).toContain('dim[0]');
  });

  it('reports a 64-bit value beyond 2^53 as NaN rather than a wrong number', () => {
    const bytes = load('example_nifti2.nii').slice(0, NIFTI_HEADER_PREFIX);
    new DataView(bytes.buffer).setBigInt64(168, 2n ** 60n, true);
    expect(parse(bytes).fields.find((x) => x.name === 'vox_offset')?.value).toBeNaN();
  });

  it('lists well-formed extensions and stops at a malformed one', () => {
    const bytes = new Uint8Array(352 + 32 + 16);
    bytes.set(load('example4d.nii.gz').subarray(0, 348));
    const view = new DataView(bytes.buffer);
    view.setFloat32(108, 352 + 32 + 16, true); // vox_offset after two extensions
    bytes[348] = 1; // extension flag
    view.setInt32(352, 32, true); // esize
    view.setInt32(356, 6, true); // ecode (comment)
    view.setInt32(384, 7, true); // malformed esize: not a multiple of 16
    const h = parse(bytes);
    expect(h.extensions).toEqual([{ code: 6, range: { start: 352, end: 384 } }]);
  });
});
