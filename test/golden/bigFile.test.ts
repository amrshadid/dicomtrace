/**
 * Bounded work on huge files (story: HCD focus area 5). Generates a ≥ 200 MB file
 * from a small fixture by growing Pixel Data, runs the real go-dicom on it, and
 * checks that the JSON stays metadata-sized and the offsets still hold.
 *
 * Needs the go-dicom executable: set GO_DICOM_PATH to its absolute path. Skipped
 * otherwise, so `npm run check` stays offline and fast. The generated file lives
 * in the OS temp folder and is never committed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Paths resolve from the repository root, where Vitest runs.
import { afterAll, describe, expect, it } from 'vitest';
import { readGoDicomDocument } from './goDicomJson';

const GO_DICOM = process.env.GO_DICOM_PATH ?? '';
const PIXEL_BYTES = 200 * 1024 * 1024;
/** The JSON must stay about metadata size; 1 MB is ~10× what the fixtures produce. */
const MAX_JSON_BYTES = 1024 * 1024;

const version = GO_DICOM ? execFileSync(GO_DICOM, ['version'], { encoding: 'utf8' }).trim() : '';
const scratch = GO_DICOM ? mkdtempSync(join(tmpdir(), 'dt-big-')) : '';

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/**
 * Copies everything before Pixel Data's value, rewrites its length, and appends
 * non-zero bytes. Non-zero matters: all-zero pixels hid go-dicom #272, because
 * trailing NUL padding is trimmed from text values.
 */
function growPixelData(fixture: string, out: string): void {
  const source = readFileSync(resolve('test/fixtures/dicom', fixture));
  const doc = readGoDicomDocument(
    JSON.parse(
      execFileSync(GO_DICOM, ['show', join('test/fixtures/dicom', fixture), '--json'], {
        encoding: 'utf8',
      }),
    ),
  );
  const pixels = doc.dataSet.find((e) => e.tag === '(7FE0,0010)');
  if (pixels?.lengthSize !== 4) throw new Error(`${fixture}: no 32-bit-length Pixel Data`);

  const header = Buffer.from(source.subarray(0, pixels.valueOffset));
  header.writeUInt32LE(PIXEL_BYTES, pixels.lengthOffset);
  writeFileSync(out, header);
  writeFileSync(out, Buffer.alloc(PIXEL_BYTES, 0xa5), { flag: 'a' });
}

/** Runs `show --json` with stdout going straight to a file, so a huge output can be measured. */
function showToFile(input: string, output: string): void {
  const fd = openSync(output, 'w');
  try {
    const result = spawnSync(GO_DICOM, ['show', input, '--json'], {
      stdio: ['ignore', fd, 'pipe'],
      timeout: 120_000,
    });
    if (result.status !== 0) throw new Error(`go-dicom exited with ${String(result.status)}`);
  } finally {
    closeSync(fd);
  }
}

function checkBigFile(fixture: string): void {
  const input = join(scratch, fixture);
  const output = `${input}.json`;
  growPixelData(fixture, input);
  showToFile(input, output);

  const jsonBytes = statSync(output).size;
  expect(jsonBytes, `JSON is ${jsonBytes} bytes for a ${PIXEL_BYTES}-byte Pixel Data`).toBeLessThan(
    MAX_JSON_BYTES,
  );

  const doc = readGoDicomDocument(JSON.parse(readFileSync(output, 'utf8')));
  const pixels = doc.dataSet.find((e) => e.tag === '(7FE0,0010)');
  expect(pixels?.value).toBeUndefined();
  expect(pixels?.valueLength).toBe(PIXEL_BYTES);
  expect(pixels?.endOffset).toBe(statSync(input).size);
}

describe.skipIf(!GO_DICOM)(
  `≥ 200 MB file through go-dicom (${version || 'GO_DICOM_PATH not set'})`,
  () => {
    it('explicit VR: JSON stays metadata-sized and Pixel Data spans to the end', () => {
      checkBigFile('MR_small.dcm');
    }, 180_000);

    it('implicit VR: JSON stays metadata-sized (#272, fixed in go-dicom 1.9.1)', () => {
      checkBigFile('MR_small_implicit.dcm');
    }, 180_000);
  },
);
