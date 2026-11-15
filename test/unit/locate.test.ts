import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGoDicom } from '../../src/core/goDicom';
import type { InspectedElement, Inspection } from '../../src/core/inspection';
import { elementAt } from '../../src/core/locate';

// Paths resolve from the repository root, where Vitest runs.
function inspect(name: string): Inspection {
  const json: unknown = JSON.parse(
    readFileSync(resolve('test/fixtures/go-dicom', `${name}.json`), 'utf8'),
  );
  const result = normaliseGoDicom(
    json,
    readFileSync(resolve('test/fixtures/dicom', `${name}.dcm`)).byteLength,
  );
  if (!result.ok) throw new Error(result.error);
  return result.inspection;
}
const all = (i: Inspection): InspectedElement[] => [...i.fileMeta, ...i.dataSet];
const flatten = (els: readonly InspectedElement[]): InspectedElement[] =>
  els.flatMap((e) => [e, ...e.items.flatMap((it) => flatten(it.elements))]);

describe('elementAt', () => {
  it('finds the element for every byte of every top-level element (MR_small)', () => {
    const inspection = inspect('MR_small');
    for (const el of all(inspection)) {
      if (el.ranges.element.kind !== 'physical') continue;
      const { start, end } = el.ranges.element.range;
      expect(elementAt(all(inspection), start)?.id).toBe(el.id);
      expect(elementAt(all(inspection), end - 1)?.id).toBe(el.id);
    }
  });

  it('returns the deepest nested element (test-SR)', () => {
    const inspection = inspect('test-SR');
    const deepest = flatten(inspection.dataSet).find(
      (e) => e.path.length >= 4 && e.items.length === 0 && e.ranges.value.kind === 'physical',
    )!;
    const r =
      deepest.ranges.value.kind === 'physical'
        ? deepest.ranges.value.range
        : { start: -1, end: -1 };
    expect(elementAt(inspection.dataSet, r.start)?.id).toBe(deepest.id);
  });

  it('returns the sequence itself for bytes of an item header', () => {
    const inspection = inspect('nested_priv_SQ');
    const sq = inspection.dataSet[0]!;
    const item = sq.items[0]!.ranges.item;
    const at = item.kind === 'physical' ? item.range.start : -1;
    expect(elementAt(inspection.dataSet, at)?.id).toBe(sq.id);
  });

  it('claims nothing for the preamble or for a deflated data set', () => {
    expect(elementAt(all(inspect('MR_small')), 0)).toBeNull();
    const dfl = inspect('image_dfl');
    expect(elementAt(dfl.dataSet, 400)).toBeNull();
    expect(elementAt(dfl.fileMeta, 140)).not.toBeNull();
  });

  it('claims nothing past a truncation', () => {
    const inspection = inspect('MR_truncated');
    expect(elementAt(all(inspection), inspection.fileSize - 1)).toBeNull();
  });
});
