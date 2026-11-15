/**
 * Golden test for NIfTI voxel decoding: the middle slice of the first volume must match
 * nibabel's get_fdata (scaled) exactly at the probe voxels, and in min, max and mean.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseNiftiHeader } from '../../src/core/nifti';
import { niftiVoxelReader } from '../../src/core/niftiVoxels';

// Paths resolve from the repository root, where Vitest runs.
const DIR = resolve('test/fixtures/nifti');
const files = readdirSync(DIR)
  .filter((f) => /\.nii(\.gz)?$/.test(f))
  .sort();

interface SliceTruth {
  z: number;
  min: number;
  max: number;
  mean: number;
  probes: { x: number; y: number; value: number }[];
}

describe.each(files)('%s: voxels match nibabel', (file) => {
  const raw = readFileSync(resolve(DIR, file));
  const bytes = new Uint8Array(file.endsWith('.gz') ? gunzipSync(raw) : raw);
  const name = file.endsWith('.gz')
    ? file.replace('.nii.gz', '.gz.json')
    : file.replace('.nii', '.json');
  const truth = (
    JSON.parse(readFileSync(resolve(DIR, 'nibabel', name), 'utf8')) as { slice: SliceTruth }
  ).slice;
  const parsed = parseNiftiHeader(bytes);
  if (!parsed.ok) throw new Error(parsed.error);
  const reader = niftiVoxelReader(parsed.header, bytes);

  it('decodes', () => {
    expect(reader.ok ? 'ok' : reader.error).toBe('ok');
  });
  if (!reader.ok) return;
  const slice = reader.readSlice(truth.z, 0);

  it('has the same values at the probe voxels', () => {
    for (const p of truth.probes) {
      expect(slice.data[p.y * slice.width + p.x], `(${p.x},${p.y})`).toBeCloseTo(p.value, 4);
    }
  });

  it('has the same min, max and mean', () => {
    expect(slice.min).toBeCloseTo(truth.min, 4);
    expect(slice.max).toBeCloseTo(truth.max, 4);
    const mean = slice.data.reduce((a, b) => a + b, 0) / slice.data.length;
    expect(mean).toBeCloseTo(truth.mean, 3);
  });
});

describe('niftiVoxelReader', () => {
  const bytes = new Uint8Array(readFileSync(resolve(DIR, 'example_nifti2.nii')));
  const parsed = parseNiftiHeader(bytes);
  if (!parsed.ok) throw new Error(parsed.error);
  const { header } = parsed;

  it('reports geometry and clamps slice and volume indices', () => {
    const reader = niftiVoxelReader(header, bytes);
    if (!reader.ok) throw new Error(reader.error);
    expect(reader.geometry).toEqual({ width: 32, height: 20, slices: 12, volumes: 2 });
    expect(reader.readSlice(99, 99).data).toEqual(reader.readSlice(11, 1).data);
    expect(reader.readSlice(-5).data).toEqual(reader.readSlice(0, 0).data);
  });

  it('refuses a file shorter than its header says', () => {
    const r = niftiVoxelReader(header, bytes.subarray(0, 2000));
    expect(r.ok ? '' : r.error).toContain('shorter than its header');
  });

  it('refuses unsupported datatypes', () => {
    const r = niftiVoxelReader({ ...header, datatype: 128, datatypeName: 'rgb24' }, bytes);
    expect(r.ok ? '' : r.error).toContain('rgb24');
  });

  it('refuses non-positive dimensions', () => {
    const r = niftiVoxelReader({ ...header, shape: [32, 0, 12] }, bytes);
    expect(r.ok).toBe(false);
  });
});

describe('niftiVoxelReader datatypes', () => {
  const base = new Uint8Array(readFileSync(resolve(DIR, 'example_nifti2.nii'))).slice(0, 544);
  const parsedBase = parseNiftiHeader(base);
  if (!parsedBase.ok) throw new Error(parsedBase.error);

  const cases: [
    number,
    string,
    number,
    (v: DataView, at: number, x: number, le: boolean) => void,
  ][] = [
    [
      2,
      'uint8',
      1,
      (v, at, x) => {
        v.setUint8(at, x);
      },
    ],
    [
      256,
      'int8',
      1,
      (v, at, x) => {
        v.setInt8(at, x);
      },
    ],
    [
      4,
      'int16',
      2,
      (v, at, x, le) => {
        v.setInt16(at, x, le);
      },
    ],
    [
      512,
      'uint16',
      2,
      (v, at, x, le) => {
        v.setUint16(at, x, le);
      },
    ],
    [
      8,
      'int32',
      4,
      (v, at, x, le) => {
        v.setInt32(at, x, le);
      },
    ],
    [
      768,
      'uint32',
      4,
      (v, at, x, le) => {
        v.setUint32(at, x, le);
      },
    ],
    [
      16,
      'float32',
      4,
      (v, at, x, le) => {
        v.setFloat32(at, x, le);
      },
    ],
    [
      64,
      'float64',
      8,
      (v, at, x, le) => {
        v.setFloat64(at, x, le);
      },
    ],
    [
      1024,
      'int64',
      8,
      (v, at, x, le) => {
        v.setBigInt64(at, BigInt(x), le);
      },
    ],
    [
      1280,
      'uint64',
      8,
      (v, at, x, le) => {
        v.setBigUint64(at, BigInt(x), le);
      },
    ],
  ];

  it.each(cases.flatMap((c) => [true, false].map((le) => [...c, le] as const)))(
    'decodes %s (%s), little endian %s',
    (datatype, name, size, write, le) => {
      const values = [0, 1, 2, 3, 4, 5].map((v) => (name.startsWith('int') ? v - 2 : v));
      const bytes = new Uint8Array(544 + values.length * size);
      bytes.set(base.subarray(0, 544));
      const view = new DataView(bytes.buffer);
      values.forEach((x, i) => {
        write(view, 544 + i * size, x, le);
      });
      const header = {
        ...parsedBase.header,
        datatype,
        datatypeName: name,
        littleEndian: le,
        voxOffset: 544,
        shape: [3, 2, 1, 1],
        fields: parsedBase.header.fields.map((f) =>
          f.name === 'scl_slope'
            ? { ...f, value: 2 }
            : f.name === 'scl_inter'
              ? { ...f, value: 1 }
              : f,
        ),
      };
      const reader = niftiVoxelReader(header, bytes);
      if (!reader.ok) throw new Error(reader.error);
      const slice = reader.readSlice(0);
      expect([...slice.data]).toEqual(values.map((x) => x * 2 + 1));
      expect([slice.min, slice.max]).toEqual([
        Math.min(...values) * 2 + 1,
        Math.max(...values) * 2 + 1,
      ]);
    },
  );
});
