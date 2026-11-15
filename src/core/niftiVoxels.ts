/**
 * NIfTI voxel decoding for the image pane. Pure: the webview hands it the
 * (inflated) file bytes and a parsed header, and gets back one 2D slice as floats.
 *
 * Layout (nifti1.h): x varies fastest, then y, z, t. A slice is the x-y plane at
 * index z of volume t. Values are scaled by scl_slope/scl_inter when the slope is
 * finite and non-zero, as nibabel's get_fdata does.
 */
import type { NiftiHeader } from './nifti';

interface Decoder {
  readonly bytes: number;
  readonly read: (view: DataView, at: number, le: boolean) => number;
}

/** Scalar datatypes we can show. Complex and RGB types are reported as unsupported. */
const DECODERS: Readonly<Record<number, Decoder>> = {
  2: { bytes: 1, read: (v, at) => v.getUint8(at) },
  256: { bytes: 1, read: (v, at) => v.getInt8(at) },
  4: { bytes: 2, read: (v, at, le) => v.getInt16(at, le) },
  512: { bytes: 2, read: (v, at, le) => v.getUint16(at, le) },
  8: { bytes: 4, read: (v, at, le) => v.getInt32(at, le) },
  768: { bytes: 4, read: (v, at, le) => v.getUint32(at, le) },
  16: { bytes: 4, read: (v, at, le) => v.getFloat32(at, le) },
  64: { bytes: 8, read: (v, at, le) => v.getFloat64(at, le) },
  1024: { bytes: 8, read: (v, at, le) => Number(v.getBigInt64(at, le)) },
  1280: { bytes: 8, read: (v, at, le) => Number(v.getBigUint64(at, le)) },
};

export interface Slice {
  readonly width: number;
  readonly height: number;
  /** Row-major: index `y * width + x`. */
  readonly data: Float32Array;
  readonly min: number;
  readonly max: number;
}

export interface VolumeGeometry {
  readonly width: number;
  readonly height: number;
  /** Number of z slices per volume. */
  readonly slices: number;
  /** Number of volumes (t); 1 for 3D. */
  readonly volumes: number;
}

export type VoxelReader =
  | {
      readonly ok: true;
      readonly geometry: VolumeGeometry;
      readonly readSlice: (z: number, t?: number) => Slice;
    }
  | { readonly ok: false; readonly error: string };

/** Largest slice we decode (pixels); a defence against hostile dims. */
const MAX_SLICE_PIXELS = 64 * 1024 * 1024;

const numberField = (header: NiftiHeader, name: string): number => {
  const v = header.fields.find((f) => f.name === name)?.value;
  return typeof v === 'number' ? v : Number.NaN;
};

/**
 * Prepares slice access for a NIfTI file.
 *
 * @param header - From `parseNiftiHeader` on the same bytes.
 * @param bytes - The whole (inflated) single-file `.nii` stream.
 */
export function niftiVoxelReader(header: NiftiHeader, bytes: Uint8Array): VoxelReader {
  const decoder = DECODERS[header.datatype];
  if (!decoder)
    return { ok: false, error: `Showing ${header.datatypeName} voxels is not supported yet.` };
  const [width = 1, height = 1, slices = 1, volumes = 1] = header.shape;
  const geometry = { width, height, slices, volumes };
  if ([width, height, slices, volumes].some((n) => !Number.isSafeInteger(n) || n < 1)) {
    return { ok: false, error: 'The image dimensions are not positive whole numbers.' };
  }
  if (width * height > MAX_SLICE_PIXELS)
    return { ok: false, error: 'A slice is too large to show.' };

  const sliceBytes = width * height * decoder.bytes;
  const needed = header.voxOffset + sliceBytes * slices * volumes;
  if (needed > bytes.byteLength) {
    return {
      ok: false,
      error: `The file is shorter than its header says: ${needed} bytes of voxel data expected, ${bytes.byteLength} present.`,
    };
  }

  const slope = numberField(header, 'scl_slope');
  const inter = numberField(header, 'scl_inter');
  const scaled = Number.isFinite(slope) && slope !== 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = header.littleEndian;

  const readSlice = (z: number, t = 0): Slice => {
    const zi = Math.min(Math.max(0, Math.trunc(z)), slices - 1);
    const ti = Math.min(Math.max(0, Math.trunc(t)), volumes - 1);
    const base = header.voxOffset + (ti * slices + zi) * sliceBytes;
    const data = new Float32Array(width * height);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i++) {
      let v = decoder.read(view, base + i * decoder.bytes, le);
      if (scaled) v = v * slope + (Number.isFinite(inter) ? inter : 0);
      data[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { width, height, data, min, max };
  };

  return { ok: true, geometry, readSlice };
}
