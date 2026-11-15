/**
 * A minimal, independent reader for go-dicom `show --json` (schemaVersion 1), used
 * only as a test oracle. It is deliberately separate from the production
 * normaliser in `src/core/`, so a bug there cannot hide the same bug here.
 * It throws on any shape it does not expect, so a schema change fails loudly.
 */

export interface GoDicomElement {
  readonly tag: string;
  readonly vr: string | undefined;
  readonly value: string | undefined;
  readonly tagOffset: number;
  readonly vrOffset: number | null;
  readonly lengthOffset: number;
  readonly lengthSize: 2 | 4;
  readonly valueOffset: number;
  readonly valueLength: number;
  readonly undefinedLength: boolean;
  readonly endOffset: number;
  readonly items: readonly GoDicomItem[];
  readonly fragments: readonly GoDicomFragment[];
}

export interface GoDicomItem {
  readonly tagOffset: number;
  readonly endOffset: number;
  readonly elements: readonly GoDicomElement[];
}

export interface GoDicomFragment {
  readonly tagOffset: number;
  readonly endOffset: number;
}

export interface GoDicomRegion {
  readonly name: string;
  readonly offset: number;
  readonly endOffset: number;
}

export interface GoDicomDocument {
  readonly schemaVersion: number;
  readonly file: string;
  readonly size: number;
  readonly regions: readonly GoDicomRegion[];
  readonly transferSyntax: { readonly littleEndian: boolean; readonly deflated: boolean };
  readonly offsetsRelativeTo: string;
  readonly warnings: readonly string[];
  readonly fileMeta: readonly GoDicomElement[];
  readonly dataSet: readonly GoDicomElement[];
}

type Obj = Record<string, unknown>;

function obj(u: unknown, where: string): Obj {
  if (typeof u !== 'object' || u === null || Array.isArray(u))
    throw new Error(`${where}: not an object`);
  return u as Obj;
}

function num(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v))
    throw new Error(`${where}.${key}: not an integer`);
  return v;
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new Error(`${where}.${key}: not a string`);
  return v;
}

function optStr(o: Obj, key: string, where: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, where);
}

function arr(o: Obj, key: string, where: string): readonly unknown[] {
  const v = o[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${where}.${key}: not an array`);
  return v as unknown[];
}

function element(u: unknown, where: string): GoDicomElement {
  const o = obj(u, where);
  const tag = str(o, 'tag', where);
  const at = `${where}/${tag}`;
  const lengthSize = num(o, 'lengthSize', at);
  if (lengthSize !== 2 && lengthSize !== 4) throw new Error(`${at}.lengthSize: ${lengthSize}`);
  const vrOffset = o.vrOffset === null ? null : num(o, 'vrOffset', at);
  return {
    tag,
    vr: optStr(o, 'vr', at),
    value: optStr(o, 'value', at),
    tagOffset: num(o, 'tagOffset', at),
    vrOffset,
    lengthOffset: num(o, 'lengthOffset', at),
    lengthSize,
    valueOffset: num(o, 'valueOffset', at),
    valueLength: num(o, 'valueLength', at),
    undefinedLength: o.undefinedLength === true,
    endOffset: num(o, 'endOffset', at),
    items: arr(o, 'items', at).map((item, i) => {
      const io = obj(item, `${at}[${i}]`);
      return {
        tagOffset: num(io, 'tagOffset', `${at}[${i}]`),
        endOffset: num(io, 'endOffset', `${at}[${i}]`),
        elements: arr(io, 'elements', `${at}[${i}]`).map((e) => element(e, `${at}[${i}]`)),
      };
    }),
    fragments: arr(o, 'fragments', at).map((f, i) => {
      const fo = obj(f, `${at} fragment ${i}`);
      return { tagOffset: num(fo, 'tagOffset', at), endOffset: num(fo, 'endOffset', at) };
    }),
  };
}

/** Narrows parsed JSON to the fields the golden test checks. Throws on anything else. */
export function readGoDicomDocument(u: unknown): GoDicomDocument {
  const o = obj(u, 'document');
  const ts = obj(o.transferSyntax, 'transferSyntax');
  return {
    schemaVersion: num(o, 'schemaVersion', 'document'),
    file: str(o, 'file', 'document'),
    size: num(o, 'size', 'document'),
    regions: arr(o, 'regions', 'document').map((r, i) => {
      const ro = obj(r, `regions[${i}]`);
      return {
        name: str(ro, 'name', `regions[${i}]`),
        offset: num(ro, 'offset', `regions[${i}]`),
        endOffset: num(ro, 'endOffset', `regions[${i}]`),
      };
    }),
    transferSyntax: { littleEndian: ts.littleEndian === true, deflated: ts.deflated === true },
    offsetsRelativeTo: str(o, 'offsetsRelativeTo', 'document'),
    warnings: arr(o, 'warnings', 'document').map((w, i) => {
      if (typeof w !== 'string') throw new Error(`warnings[${i}]: not a string`);
      return w;
    }),
    fileMeta: arr(o, 'fileMeta', 'document').map((e) => element(e, '/meta')),
    dataSet: arr(o, 'dataSet', 'document').map((e) => element(e, '')),
  };
}
