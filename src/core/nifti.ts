/**
 * NIfTI-1 and NIfTI-2 header parsing with exact byte ranges.
 *
 * Both headers are fixed layouts, so every field has a known offset and size. The
 * parser reads the header bytes it is given and reports each field's value and range.
 * Whether those ranges are physical depends on the file: for `.nii` they are; for
 * `.nii.gz` the header bytes only exist after inflating, so the caller marks them
 * unavailable (`compressed`), exactly like a deflated DICOM data set.
 *
 * Layouts: NIfTI-1 https://nifti.nimh.nih.gov/pub/dist/src/niftilib/nifti1.h,
 * NIfTI-2 https://nifti.nimh.nih.gov/pub/dist/doc/nifti2.h
 */
import type { ByteRange } from './ranges';

type Kind = 'i8' | 'u8' | 'i16' | 'i32' | 'i64' | 'f32' | 'f64' | 'char';

interface FieldSpec {
  readonly name: string;
  readonly offset: number;
  readonly kind: Kind;
  /** Number of elements (array fields) or characters (`char`). */
  readonly count: number;
}

const SIZE: Readonly<Record<Kind, number>> = {
  i8: 1,
  u8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  f32: 4,
  f64: 8,
  char: 1,
};

const f = (name: string, offset: number, kind: Kind, count = 1): FieldSpec => ({
  name,
  offset,
  kind,
  count,
});

/** NIfTI-1: 348 bytes. Field names follow nifti1.h (and nibabel). */
const NIFTI1: readonly FieldSpec[] = [
  f('sizeof_hdr', 0, 'i32'),
  f('data_type', 4, 'char', 10),
  f('db_name', 14, 'char', 18),
  f('extents', 32, 'i32'),
  f('session_error', 36, 'i16'),
  f('regular', 38, 'char', 1),
  f('dim_info', 39, 'u8'),
  f('dim', 40, 'i16', 8),
  f('intent_p1', 56, 'f32'),
  f('intent_p2', 60, 'f32'),
  f('intent_p3', 64, 'f32'),
  f('intent_code', 68, 'i16'),
  f('datatype', 70, 'i16'),
  f('bitpix', 72, 'i16'),
  f('slice_start', 74, 'i16'),
  f('pixdim', 76, 'f32', 8),
  f('vox_offset', 108, 'f32'),
  f('scl_slope', 112, 'f32'),
  f('scl_inter', 116, 'f32'),
  f('slice_end', 120, 'i16'),
  f('slice_code', 122, 'u8'),
  f('xyzt_units', 123, 'u8'),
  f('cal_max', 124, 'f32'),
  f('cal_min', 128, 'f32'),
  f('slice_duration', 132, 'f32'),
  f('toffset', 136, 'f32'),
  f('glmax', 140, 'i32'),
  f('glmin', 144, 'i32'),
  f('descrip', 148, 'char', 80),
  f('aux_file', 228, 'char', 24),
  f('qform_code', 252, 'i16'),
  f('sform_code', 254, 'i16'),
  f('quatern_b', 256, 'f32'),
  f('quatern_c', 260, 'f32'),
  f('quatern_d', 264, 'f32'),
  f('qoffset_x', 268, 'f32'),
  f('qoffset_y', 272, 'f32'),
  f('qoffset_z', 276, 'f32'),
  f('srow_x', 280, 'f32', 4),
  f('srow_y', 296, 'f32', 4),
  f('srow_z', 312, 'f32', 4),
  f('intent_name', 328, 'char', 16),
  f('magic', 344, 'char', 4),
];

/** NIfTI-2: 540 bytes. */
const NIFTI2: readonly FieldSpec[] = [
  f('sizeof_hdr', 0, 'i32'),
  f('magic', 4, 'char', 4),
  // The second half of the 8-byte NIfTI-2 magic: \r \n \x1a \n, to detect line-ending damage.
  f('eol_check', 8, 'i8', 4),
  f('datatype', 12, 'i16'),
  f('bitpix', 14, 'i16'),
  f('dim', 16, 'i64', 8),
  f('intent_p1', 80, 'f64'),
  f('intent_p2', 88, 'f64'),
  f('intent_p3', 96, 'f64'),
  f('pixdim', 104, 'f64', 8),
  f('vox_offset', 168, 'i64'),
  f('scl_slope', 176, 'f64'),
  f('scl_inter', 184, 'f64'),
  f('cal_max', 192, 'f64'),
  f('cal_min', 200, 'f64'),
  f('slice_duration', 208, 'f64'),
  f('toffset', 216, 'f64'),
  f('slice_start', 224, 'i64'),
  f('slice_end', 232, 'i64'),
  f('descrip', 240, 'char', 80),
  f('aux_file', 320, 'char', 24),
  f('qform_code', 344, 'i32'),
  f('sform_code', 348, 'i32'),
  f('quatern_b', 352, 'f64'),
  f('quatern_c', 360, 'f64'),
  f('quatern_d', 368, 'f64'),
  f('qoffset_x', 376, 'f64'),
  f('qoffset_y', 384, 'f64'),
  f('qoffset_z', 392, 'f64'),
  f('srow_x', 400, 'f64', 4),
  f('srow_y', 432, 'f64', 4),
  f('srow_z', 464, 'f64', 4),
  f('slice_code', 496, 'i32'),
  f('xyzt_units', 500, 'i32'),
  f('intent_code', 504, 'i32'),
  f('intent_name', 508, 'char', 16),
  f('dim_info', 524, 'u8'),
  f('unused_str', 525, 'char', 15),
];

/** Datatype codes from nifti1.h. */
const DATATYPES: Readonly<Record<number, string>> = {
  0: 'unknown',
  1: 'binary',
  2: 'uint8',
  4: 'int16',
  8: 'int32',
  16: 'float32',
  32: 'complex64',
  64: 'float64',
  128: 'rgb24',
  256: 'int8',
  512: 'uint16',
  768: 'uint32',
  1024: 'int64',
  1280: 'uint64',
  1536: 'float128',
  1792: 'complex128',
  2048: 'complex256',
  2304: 'rgba32',
};

export type FieldValue = number | string | readonly number[];

export interface NiftiField {
  readonly name: string;
  readonly value: FieldValue;
  /** Byte range of the field within the (inflated) header stream. */
  readonly range: ByteRange;
}

export interface NiftiExtension {
  readonly code: number;
  /** Byte range of the whole extension (esize, ecode and data) in the (inflated) stream. */
  readonly range: ByteRange;
}

export interface NiftiHeader {
  readonly version: 1 | 2;
  readonly littleEndian: boolean;
  readonly fields: readonly NiftiField[];
  /** `dim[1..dim[0]]`. */
  readonly shape: readonly number[];
  readonly datatype: number;
  readonly datatypeName: string;
  readonly bitpix: number;
  /** Where voxel data starts. For a single-file `.nii` with vox_offset < header + 4, the
   *  spec's minimum (352 or 544) is used, and `voxOffsetInvalid` says so. */
  readonly voxOffset: number;
  readonly voxOffsetInvalid: boolean;
  /** The 4-byte extension flag after the header, when present in the bytes given. */
  readonly extensionFlag: ByteRange | null;
  readonly extensions: readonly NiftiExtension[];
}

export type NiftiParseResult =
  | { readonly ok: true; readonly header: NiftiHeader }
  | { readonly ok: false; readonly error: string };

/** Smallest prefix needed to parse any header (NIfTI-2 plus its extension flag). */
export const NIFTI_HEADER_PREFIX = 544;
/** At most this many extensions are listed (defence against hostile files). */
const MAX_EXTENSIONS = 64;

function readField(view: DataView, spec: FieldSpec, le: boolean): FieldValue {
  if (spec.kind === 'char') {
    let text = '';
    for (let i = 0; i < spec.count; i++) {
      const c = view.getUint8(spec.offset + i);
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    return text;
  }
  const size = SIZE[spec.kind];
  const read = (at: number): number => {
    switch (spec.kind) {
      case 'i8':
        return view.getInt8(at);
      case 'u8':
        return view.getUint8(at);
      case 'i16':
        return view.getInt16(at, le);
      case 'i32':
        return view.getInt32(at, le);
      case 'i64': {
        const v = view.getBigInt64(at, le);
        // Values outside 2^53 can't be exact numbers; report them as NaN, never wrongly.
        return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(v)
          : Number.NaN;
      }
      case 'f32':
        return view.getFloat32(at, le);
      default:
        return view.getFloat64(at, le);
    }
  };
  if (spec.count === 1) return read(spec.offset);
  return Array.from({ length: spec.count }, (_, i) => read(spec.offset + i * size));
}

/**
 * Parses a NIfTI-1 or NIfTI-2 header from the start of a (possibly inflated) stream.
 *
 * @param bytes - At least the header; pass {@link NIFTI_HEADER_PREFIX} bytes or more to
 *   also read the extension flag, and more again to list extensions.
 * @param singleFile - True for `.nii` (header and data in one file), where the voxel
 *   offset must leave room for the header and the extension flag.
 */
export function parseNiftiHeader(bytes: Uint8Array, singleFile = true): NiftiParseResult {
  if (bytes.byteLength < 4) return { ok: false, error: 'Too short to be a NIfTI file.' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let version: 1 | 2 | null = null;
  let le = true;
  for (const [size, v] of [
    [348, 1],
    [540, 2],
  ] as const) {
    if (view.getInt32(0, true) === size) [version, le] = [v, true];
    else if (view.getInt32(0, false) === size) [version, le] = [v, false];
    if (version) break;
  }
  if (!version) return { ok: false, error: 'Not a NIfTI file: sizeof_hdr is neither 348 nor 540.' };
  const headerSize = version === 1 ? 348 : 540;
  if (bytes.byteLength < headerSize) {
    return {
      ok: false,
      error: `The file ends inside the NIfTI-${version} header (${bytes.byteLength} of ${headerSize} bytes).`,
    };
  }

  const specs = version === 1 ? NIFTI1 : NIFTI2;
  const fields: NiftiField[] = specs.map((spec) => ({
    name: spec.name,
    value: readField(view, spec, le),
    range: { start: spec.offset, end: spec.offset + SIZE[spec.kind] * spec.count },
  }));
  const value = (name: string): FieldValue | undefined =>
    fields.find((x) => x.name === name)?.value;

  const magic = value('magic');
  const magicOk =
    version === 1
      ? magic === 'n+1' || magic === 'ni1'
      : typeof magic === 'string' && magic.startsWith('n+2');
  if (!magicOk)
    return { ok: false, error: `Unexpected NIfTI-${version} magic ${JSON.stringify(magic)}.` };

  const dim = value('dim');
  const dims = Array.isArray(dim) ? (dim as readonly number[]) : [];
  const rank = dims[0] ?? 0;
  if (!Number.isInteger(rank) || rank < 1 || rank > 7) {
    return { ok: false, error: `Invalid dim[0] = ${String(rank)} (must be 1 to 7).` };
  }
  const shape = dims.slice(1, rank + 1);

  const minOffset = headerSize + 4;
  const rawOffset = Number(value('vox_offset'));
  const voxOffsetInvalid = singleFile && !(rawOffset >= minOffset);
  const voxOffset = voxOffsetInvalid ? minOffset : Math.floor(rawOffset);

  let extensionFlag: ByteRange | null = null;
  const extensions: NiftiExtension[] = [];
  if (bytes.byteLength >= minOffset) {
    extensionFlag = { start: headerSize, end: minOffset };
    if (view.getUint8(headerSize) !== 0) {
      let at = minOffset;
      while (
        at + 8 <= bytes.byteLength &&
        at + 8 <= voxOffset &&
        extensions.length < MAX_EXTENSIONS
      ) {
        const esize = view.getInt32(at, le);
        // esize is a positive multiple of 16 that includes its own 8-byte header (nifti1.h).
        if (esize < 16 || esize % 16 !== 0 || at + esize > voxOffset) break;
        extensions.push({ code: view.getInt32(at + 4, le), range: { start: at, end: at + esize } });
        at += esize;
      }
    }
  }

  const datatype = Number(value('datatype'));
  return {
    ok: true,
    header: {
      version,
      littleEndian: le,
      fields,
      shape,
      datatype,
      datatypeName: DATATYPES[datatype] ?? `unknown (${datatype})`,
      bitpix: Number(value('bitpix')),
      voxOffset,
      voxOffsetInvalid,
      extensionFlag,
      extensions,
    },
  };
}
