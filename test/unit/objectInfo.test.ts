import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGoDicom } from '../../src/core/goDicom';
import type { Inspection } from '../../src/core/inspection';
import { objectInfo, sopClassName, unpackBits } from '../../src/core/objectInfo';

// Paths resolve from the repository root, where Vitest runs.
const bytesOf = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve('test/fixtures/dicom', `${name}.dcm`)));
function inspect(name: string): Inspection {
  const json: unknown = JSON.parse(
    readFileSync(resolve('test/fixtures/go-dicom', `${name}.json`), 'utf8'),
  );
  const result = normaliseGoDicom(json, bytesOf(name).byteLength);
  if (!result.ok) throw new Error(result.error);
  return result.inspection;
}

describe('objectInfo', () => {
  it.each([
    ['MR_small', 'MR Image', 1],
    ['MR_small_RLE', 'MR Image', 1],
    ['emri_small', 'Enhanced MR Image', 10],
    ['eCT_Supplemental', 'Enhanced CT Image', 2],
    ['rtdose', 'RT Dose', 15],
    ['image_dfl', 'Secondary Capture Image', 1],
  ])('%s: Cornerstone shows %s with %i frame(s)', (name, sop, frames) => {
    const info = objectInfo(inspect(name));
    expect(info.sopClassName).toBe(sop);
    expect(info.image).toEqual({ kind: 'cornerstone', frames });
  });

  it.each([
    ['synthetic_encapsulated_pdf', 'Encapsulated PDF'],
    ['rtstruct', 'RT Structure Set'],
    ['sr_document', 'Comprehensive 3D SR'],
    ['synthetic_gsps', 'Grayscale Softcopy Presentation State'],
  ])('%s: no image, and says it is a %s', (name, sop) => {
    const info = objectInfo(inspect(name));
    expect(info.image).toEqual({ kind: 'none', reason: `No image in this object (${sop}).` });
  });

  it('describes an encapsulated PDF and where its bytes are', () => {
    const info = objectInfo(inspect('synthetic_encapsulated_pdf'));
    expect(info.document?.mimeType).toBe('application/pdf');
    expect(info.document?.length).toBe(598);
    const range = info.document!.data!;
    const pdf = bytesOf('synthetic_encapsulated_pdf').subarray(range.start, range.end);
    expect(new TextDecoder('latin1').decode(pdf.subarray(0, 8))).toBe('%PDF-1.4');
  });

  it('plans 1-bit SEG frames for our own renderer, and they unpack like pydicom', () => {
    const info = objectInfo(inspect('seg_image_ct_binary'));
    expect(info.image).toMatchObject({ kind: 'bitmap', frames: 3, rows: 16, columns: 16 });
    if (info.image.kind !== 'bitmap') return;
    const { pixels } = info.image;
    const data = bytesOf('seg_image_ct_binary').subarray(pixels.start, pixels.end);
    const perFrame = [0, 1, 2].map((f) =>
      unpackBits(data, f * 256, 256).reduce((a, b) => a + b, 0),
    );
    expect(perFrame).toEqual([127, 256, 255]);
  });

  it('finds the overlay plane, and its bits unpack like pydicom', () => {
    const info = objectInfo(inspect('examples_overlay'));
    expect(info.overlays).toHaveLength(1);
    const overlay = info.overlays[0]!;
    expect(overlay).toMatchObject({ group: 0x6000, rows: 300, columns: 484, origin: [1, 1] });
    const data = bytesOf('examples_overlay').subarray(overlay.data!.start, overlay.data!.end);
    expect(unpackBits(data, 0, 300 * 484).reduce((a, b) => a + b, 0)).toBe(222);
  });

  it('does not try to show Pixel Data without Rows and Columns', () => {
    expect(objectInfo(inspect('nested_priv_SQ')).image).toEqual({
      kind: 'none',
      reason: 'Pixel Data has no valid Rows and Columns, so it cannot be shown as an image.',
    });
  });

  it('does not try to show empty Pixel Data', () => {
    const inspection = inspect('MR_small');
    const empty = {
      ...inspection,
      dataSet: inspection.dataSet.map((e) =>
        e.tag === '(7FE0,0010)' ? { ...e, valueLength: 0 } : e,
      ),
    };
    expect(objectInfo(empty).image).toEqual({
      kind: 'none',
      reason: 'Pixel Data is empty (length 0).',
    });
  });

  it('reads the SOP class from the file meta when the data set lacks it', () => {
    const inspection = inspect('MR_small');
    const withoutSop = {
      ...inspection,
      dataSet: inspection.dataSet.filter((e) => e.tag !== '(0008,0016)'),
    };
    expect(objectInfo(withoutSop).sopClassName).toBe('MR Image');
  });

  it('names unknown SOP classes by UID', () => {
    expect(sopClassName('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('unpackBits', () => {
  it('reads bits least significant first, across byte boundaries', () => {
    expect([...unpackBits(new Uint8Array([0b00000101, 0b10000000]), 0, 16)]).toEqual([
      1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    expect([...unpackBits(new Uint8Array([0b00000100]), 2, 2)]).toEqual([1, 0]);
  });

  it('treats bits past the end as 0', () => {
    expect([...unpackBits(new Uint8Array([0xff]), 6, 4)]).toEqual([1, 1, 0, 0]);
  });
});
