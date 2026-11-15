import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGoDicom } from '../../src/core/goDicom';
import type { Inspection } from '../../src/core/inspection';
import { TAG_GROUPS, groupElements, tagGroup } from '../../src/core/tagGroups';

// Paths resolve from the repository root, where Vitest runs.
function inspect(name: string): Inspection {
  const json: unknown = JSON.parse(
    readFileSync(resolve('test/fixtures/go-dicom', `${name}.json`), 'utf8'),
  );
  const size = readFileSync(resolve('test/fixtures/dicom', `${name}.dcm`)).byteLength;
  const r = normaliseGoDicom(json, size);
  if (!r.ok) throw new Error(r.error);
  return r.inspection;
}

describe('tagGroup', () => {
  it.each([
    ['(0010,0010)', 'patient'],
    ['(0010,0030)', 'patient'],
    ['(0008,0020)', 'study'],
    ['(0020,000D)', 'study'],
    ['(0032,1060)', 'study'],
    ['(0008,0060)', 'series'],
    ['(0020,000E)', 'series'],
    ['(0018,0015)', 'series'],
    ['(0008,0070)', 'equipment'],
    ['(0018,1020)', 'equipment'],
    ['(0020,0052)', 'frameOfReference'],
    ['(0008,0016)', 'sopCommon'],
    ['(0008,0005)', 'sopCommon'],
    ['(0018,0050)', 'acquisition'],
    ['(0008,0022)', 'acquisition'],
    ['(0028,0010)', 'image'],
    ['(0020,0032)', 'image'],
    ['(5200,9230)', 'multiFrame'],
    ['(6000,3000)', 'overlay'],
    ['(601E,0010)', 'overlay'],
    ['(3006,0020)', 'radiotherapy'],
    ['(300A,0010)', 'radiotherapy'],
    ['(0040,A730)', 'structuredReport'],
    ['(0040,0275)', 'study'],
    ['(0062,0002)', 'segmentation'],
    ['(0070,0001)', 'presentation'],
    ['(0042,0011)', 'document'],
    ['(0009,1001)', 'private'],
    ['(0029,0010)', 'private'],
    ['(7FE0,0010)', 'pixelData'],
    ['(0002,0010)', 'other'],
    ['(00E1,0010)', 'private'],
    ['not a tag', 'other'],
  ])('%s → %s', (tag, group) => {
    expect(tagGroup(tag)).toBe(group);
  });

  it('is case-insensitive', () => {
    expect(tagGroup('(7fe0,0010)')).toBe('pixelData');
  });
});

describe('groupElements', () => {
  it('orders MR_small by module, keeps every element once, and file order within groups', () => {
    const { dataSet } = inspect('MR_small');
    const groups = groupElements(dataSet);
    const ids = groups.map((g) => g.id);
    expect(ids.slice(0, 3)).toEqual(['patient', 'study', 'series']);
    expect(ids.at(-1)).toBe('pixelData');
    const order = TAG_GROUPS.map((g) => g.id);
    expect(ids).toEqual([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(groups.flatMap((g) => g.elements).length).toBe(dataSet.length);
    for (const g of groups) {
      const positions = g.elements.map((e) => dataSet.indexOf(e));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
    expect(groups.find((g) => g.id === 'patient')?.elements.map((e) => e.tag)).toContain(
      '(0010,0010)',
    );
  });

  it('puts an RT Structure Set and an SR in their own groups', () => {
    expect(groupElements(inspect('rtstruct').dataSet).map((g) => g.id)).toContain('radiotherapy');
    expect(groupElements(inspect('sr_document').dataSet).map((g) => g.id)).toContain(
      'structuredReport',
    );
  });

  it('leaves empty groups out', () => {
    expect(groupElements([])).toEqual([]);
  });
});
