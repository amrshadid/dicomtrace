/**
 * What the panes show for a NIfTI file: header fields with their byte ranges, made
 * honest for compressed files. A `.nii` range is physical; a `.nii.gz`
 * range is unavailable ('compressed'), because those bytes only exist after inflating.
 */
import type { NiftiHeader } from './nifti';
import type { RangeOrReason } from './ranges';
import { physicalRange } from './ranges';

export interface NiftiFieldView {
  readonly name: string;
  /** Display text of the value; arrays as space-separated numbers. */
  readonly text: string;
  readonly range: RangeOrReason;
}

export interface NiftiView {
  readonly version: 1 | 2;
  readonly littleEndian: boolean;
  readonly compressed: boolean;
  readonly shape: readonly number[];
  readonly datatypeName: string;
  readonly bitpix: number;
  readonly voxOffset: number;
  readonly voxOffsetInvalid: boolean;
  readonly fields: readonly NiftiFieldView[];
  readonly extensions: readonly { readonly code: number; readonly range: RangeOrReason }[];
  /** Voxel data as a whole (from vox_offset to the end of the stream). */
  readonly voxels: RangeOrReason;
}

const formatNumber = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);

/**
 * Builds the display model.
 *
 * @param header - Parsed from the (inflated) stream.
 * @param streamSize - Size of the stream the header was parsed from.
 * @param compressed - True for `.nii.gz`: ranges then refer to the inflated stream.
 */
export function niftiView(header: NiftiHeader, streamSize: number, compressed: boolean): NiftiView {
  const range = (start: number, end: number): RangeOrReason =>
    compressed
      ? { kind: 'unavailable', reason: 'compressed' }
      : physicalRange(start, end, streamSize);
  return {
    version: header.version,
    littleEndian: header.littleEndian,
    compressed,
    shape: header.shape,
    datatypeName: header.datatypeName,
    bitpix: header.bitpix,
    voxOffset: header.voxOffset,
    voxOffsetInvalid: header.voxOffsetInvalid,
    fields: header.fields.map((f) => ({
      name: f.name,
      text:
        typeof f.value === 'string'
          ? f.value
          : typeof f.value === 'number'
            ? formatNumber(f.value)
            : f.value.map(formatNumber).join(' '),
      range: range(f.range.start, f.range.end),
    })),
    extensions: header.extensions.map((e) => ({
      code: e.code,
      range: range(e.range.start, e.range.end),
    })),
    voxels: range(header.voxOffset, streamSize),
  };
}
