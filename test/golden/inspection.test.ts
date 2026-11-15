/**
 * Golden test of the product's core promise: every range the production normaliser
 * marks as physical must hold against the real file bytes. A wrong highlight is worse
 * than none, so this runs over every fixture and every element.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGoDicom } from '../../src/core/goDicom';
import type { InspectedElement } from '../../src/core/inspection';
import type { RangeOrReason } from '../../src/core/ranges';

// Paths resolve from the repository root, where Vitest runs.
const fixtures = readdirSync(resolve('test/fixtures/dicom'))
  .filter((f) => f.endsWith('.dcm'))
  .sort();

const flatten = (els: readonly InspectedElement[]): InspectedElement[] =>
  els.flatMap((e) => [e, ...e.items.flatMap((i) => flatten(i.elements))]);

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

describe.each(fixtures)('%s: every physical range holds against the bytes', (name) => {
  const bytes = new Uint8Array(readFileSync(resolve('test/fixtures/dicom', name)));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json: unknown = JSON.parse(
    readFileSync(resolve('test/fixtures/go-dicom', name.replace(/\.dcm$/, '.json')), 'utf8'),
  );
  const result = normaliseGoDicom(json, bytes.byteLength);

  it('normalises', () => {
    expect(result.ok).toBe(true);
  });
  if (!result.ok) return;
  const { inspection } = result;

  const check = (el: InspectedElement, littleEndian: boolean): string[] => {
    const errors: string[] = [];
    const physical = (r: RangeOrReason) => (r.kind === 'physical' ? r.range : null);
    const tag = physical(el.ranges.tag);
    if (tag) {
      const read = `(${hex4(view.getUint16(tag.start, littleEndian))},${hex4(view.getUint16(tag.start + 2, littleEndian))})`;
      if (read !== el.tag) errors.push(`${el.id}: tag bytes are ${read}`);
      if (tag.end - tag.start !== 4) errors.push(`${el.id}: tag range is not 4 bytes`);
    }
    const vr = physical(el.ranges.vr);
    if (vr) {
      const read = String.fromCharCode(bytes[vr.start]!, bytes[vr.start + 1]!);
      if (read !== el.vr) errors.push(`${el.id}: VR bytes are ${read}`);
    }
    const element = physical(el.ranges.element);
    for (const [label, r] of Object.entries({
      vr: el.ranges.vr,
      length: el.ranges.length,
      value: el.ranges.value,
    })) {
      const p = physical(r);
      if (p && element && (p.start < element.start || p.end > element.end)) {
        errors.push(`${el.id}: ${label} range is outside the element`);
      }
    }
    const value = physical(el.ranges.value);
    if (value && !el.undefinedLength && value.end - value.start !== el.valueLength) {
      errors.push(`${el.id}: value range length != valueLength`);
    }
    if (el.ranges.delimiter) {
      const d = el.ranges.delimiter;
      const read = `(${hex4(view.getUint16(d.start, littleEndian))},${hex4(view.getUint16(d.start + 2, littleEndian))})`;
      if (read !== '(FFFE,E0DD)') errors.push(`${el.id}: delimiter bytes are ${read}`);
    }
    return errors;
  };

  it('file meta (always little endian)', () => {
    expect(inspection.fileMeta.flatMap((el) => check(el, true))).toEqual([]);
  });

  it('data set', () => {
    const els = flatten(inspection.dataSet);
    expect(els.flatMap((el) => check(el, inspection.transferSyntax.littleEndian))).toEqual([]);
    if (!inspection.dataSetOffsetsPhysical) {
      expect(els.every((el) => el.ranges.tag.kind === 'unavailable')).toBe(true);
    }
  });

  it('ids are unique', () => {
    const ids = [...inspection.fileMeta, ...flatten(inspection.dataSet)].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
