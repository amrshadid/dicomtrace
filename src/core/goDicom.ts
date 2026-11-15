/**
 * Normalises `go-dicom show --json` output (schemaVersion 1) into the inspection model.
 *
 * The input is untrusted (`unknown`): it describes a file the user opened, which may be
 * malformed or hostile. Every field is narrowed, every range is validated against the
 * file size, and anything that does not hold up becomes "unavailable" rather than a
 * wrong highlight.
 */
import type {
  ElementRanges,
  InspectedElement,
  InspectedFragment,
  InspectedItem,
  Inspection,
  PathStep,
  Region,
  Section,
  ValuePreview,
} from './inspection';
import type { ByteRange, RangeOrReason, UnavailableReason } from './ranges';
import { physicalRange, rangeProblem } from './ranges';

/** The go-dicom JSON schema this module understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;
/** Longest value preview sent to the webview, in characters (defence in depth). */
export const MAX_PREVIEW_CHARS = 1024;
/** Deepest sequence nesting accepted; deeper output is treated as a parse error. */
export const MAX_DEPTH = 64;

export type NormaliseResult =
  | { readonly ok: true; readonly inspection: Inspection }
  | { readonly ok: false; readonly error: string };

/** Thrown internally on a shape we don't accept; turned into `{ ok: false }`. */
class ShapeError extends Error {
  override readonly name = 'ShapeError';
}

type Obj = Readonly<Record<string, unknown>>;

function obj(u: unknown, where: string): Obj {
  if (typeof u !== 'object' || u === null || Array.isArray(u))
    throw new ShapeError(`${where} is not an object`);
  return u as Obj;
}

function int(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v))
    throw new ShapeError(`${where}.${key} is not an integer`);
  return v;
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new ShapeError(`${where}.${key} is not a string`);
  return v;
}

function optStr(o: Obj, key: string, where: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, where);
}

function bool(o: Obj, key: string): boolean {
  return o[key] === true;
}

function list(o: Obj, key: string, where: string): readonly unknown[] {
  const v = o[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ShapeError(`${where}.${key} is not an array`);
  return v as unknown[];
}

const TAG = /^\([0-9A-F]{4},[0-9A-F]{4}\)$/;

function tagOf(o: Obj, where: string): string {
  const tag = str(o, 'tag', where).toUpperCase();
  if (!TAG.test(tag)) throw new ShapeError(`${where}.tag is not a (GGGG,EEEE) tag`);
  return tag;
}

/** VRs whose values are bytes, not text. Matches ambiguous forms such as `OB or OW`. */
const BINARY_VR = /\b(OB|OW|OF|OD|OL|OV|UN)\b/;
const NUMERIC = /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*(\\\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*)*$/;
// C0 controls (except tab, LF, CR) and DEL render as nothing or as layout noise.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Decides how a value is shown. Binary VRs never become text, even if the parser sent
 * a value (go-dicom 1.9.0 does, for ambiguous VRs: #272). An ambiguous numeric VR such
 * as `US or SS` is shown only when its value really is numeric.
 */
export function previewValue(vr: string, value: string | undefined): ValuePreview {
  if (vr === 'SQ') return { kind: 'sequence' };
  if (BINARY_VR.test(vr)) return { kind: 'binary' };
  if (value === undefined || value === '') return { kind: 'empty' };
  if (vr.includes(' or ') && !NUMERIC.test(value)) return { kind: 'binary' };
  const clean = value.replace(CONTROL, '�');
  return clean.length > MAX_PREVIEW_CHARS
    ? { kind: 'text', text: clean.slice(0, MAX_PREVIEW_CHARS), truncated: true }
    : { kind: 'text', text: clean, truncated: false };
}

interface Context {
  readonly fileSize: number;
  readonly section: Section;
  /** When set, every range in this section is unavailable for this reason. */
  readonly unavailable?: UnavailableReason;
}

function range(ctx: Context, start: number, end: number): RangeOrReason {
  if (ctx.unavailable) return { kind: 'unavailable', reason: ctx.unavailable };
  return physicalRange(start, end, ctx.fileSize);
}

function delimiterOf(ctx: Context, o: Obj, where: string): ByteRange | undefined {
  if (o.delimiter === undefined || o.delimiter === null || ctx.unavailable) return undefined;
  const d = obj(o.delimiter, `${where}.delimiter`);
  const start = int(d, 'tagOffset', `${where}.delimiter`);
  const end = int(d, 'endOffset', `${where}.delimiter`);
  return rangeProblem(start, end, ctx.fileSize) === null ? { start, end } : undefined;
}

const stepsToId = (section: Section, path: readonly PathStep[]): string =>
  `${section === 'fileMeta' ? 'm' : 'd'}/${path.map((s) => (s.item === undefined ? s.tag : `${s.tag}[${s.item}]`)).join('/')}`;

function element(
  ctx: Context,
  u: unknown,
  parent: readonly PathStep[],
  depth: number,
): InspectedElement {
  if (depth > MAX_DEPTH) throw new ShapeError(`sequence nesting deeper than ${MAX_DEPTH}`);
  const where = parent.length ? stepsToId(ctx.section, parent) : ctx.section;
  const o = obj(u, where);
  const tag = tagOf(o, where);
  const at = `${where}/${tag}`;
  const path = [...parent, { tag }];
  const vr = optStr(o, 'vr', at) ?? '';
  const tagOffset = int(o, 'tagOffset', at);
  const vrOffset = o.vrOffset === null || o.vrOffset === undefined ? null : int(o, 'vrOffset', at);
  const lengthOffset = int(o, 'lengthOffset', at);
  const lengthSize = int(o, 'lengthSize', at);
  if (lengthSize !== 2 && lengthSize !== 4)
    throw new ShapeError(`${at}.lengthSize is ${lengthSize}`);
  const valueOffset = int(o, 'valueOffset', at);
  const valueLength = int(o, 'valueLength', at);
  const endOffset = int(o, 'endOffset', at);
  const undefinedLength = bool(o, 'undefinedLength');
  const delimiter = undefinedLength ? delimiterOf(ctx, o, at) : undefined;

  let value: RangeOrReason;
  if (!undefinedLength) value = range(ctx, valueOffset, valueOffset + valueLength);
  else if (delimiter) value = range(ctx, valueOffset, delimiter.start);
  else
    value = ctx.unavailable
      ? range(ctx, 0, 0)
      : { kind: 'unavailable', reason: 'undefinedLengthNoDelimiter' };

  const ranges: ElementRanges = {
    tag: range(ctx, tagOffset, tagOffset + 4),
    vr:
      vrOffset === null
        ? ctx.unavailable
          ? range(ctx, 0, 0)
          : { kind: 'unavailable', reason: 'notEncoded' }
        : range(ctx, vrOffset, vrOffset + 2),
    length: range(ctx, lengthOffset, lengthOffset + lengthSize),
    value,
    element: range(ctx, tagOffset, endOffset),
    ...(delimiter ? { delimiter } : {}),
  };

  const items: InspectedItem[] = list(o, 'items', at).map((itemU, index) => {
    const itemWhere = `${at}[${index}]`;
    const io = obj(itemU, itemWhere);
    const itemDelimiter = bool(io, 'undefinedLength') ? delimiterOf(ctx, io, itemWhere) : undefined;
    const itemPath = [...parent, { tag, item: index }];
    return {
      index,
      ranges: {
        item: range(ctx, int(io, 'tagOffset', itemWhere), int(io, 'endOffset', itemWhere)),
        ...(itemDelimiter ? { delimiter: itemDelimiter } : {}),
      },
      elements: list(io, 'elements', itemWhere).map((e) => element(ctx, e, itemPath, depth + 1)),
    };
  });

  const fragments: InspectedFragment[] = list(o, 'fragments', at).map((fragmentU, index) => {
    const fo = obj(fragmentU, `${at}.fragments[${index}]`);
    return {
      index,
      range: range(ctx, int(fo, 'tagOffset', at), int(fo, 'endOffset', at)),
      valueLength: int(fo, 'valueLength', at),
    };
  });

  return {
    id: stepsToId(ctx.section, path),
    section: ctx.section,
    path,
    tag,
    keyword: optStr(o, 'keyword', at) ?? '',
    name: optStr(o, 'name', at) ?? '',
    vr,
    vrFromDictionary: vrOffset === null,
    vm: typeof o.vm === 'number' && Number.isSafeInteger(o.vm) ? o.vm : 0,
    valueLength,
    undefinedLength,
    preview: previewValue(vr, optStr(o, 'value', at)),
    ranges,
    items,
    fragments,
  };
}

const REGION_NAMES = new Set(['preamble', 'prefix', 'fileMeta', 'dataSet']);

/**
 * Turns parsed go-dicom JSON into an `Inspection`.
 *
 * @param json - `JSON.parse` of `go-dicom show <file> --json`.
 * @param fileSize - The size of the file revision that was parsed. A mismatch means the
 *   file changed while it was being parsed, and the output is rejected.
 * @returns The inspection, or a user-facing error that contains no file data.
 */
export function normaliseGoDicom(json: unknown, fileSize: number): NormaliseResult {
  try {
    const doc = obj(json, 'document');
    const schemaVersion = doc.schemaVersion;
    if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Unsupported go-dicom output (schemaVersion ${String(schemaVersion)}); this version of the extension reads schemaVersion ${SUPPORTED_SCHEMA_VERSION}.`,
      };
    }
    const size = int(doc, 'size', 'document');
    if (size !== fileSize) {
      return {
        ok: false,
        error:
          'The file changed while it was being parsed. Reopen it to inspect the current version.',
      };
    }
    const ts = obj(doc.transferSyntax, 'transferSyntax');
    const transferSyntax = {
      uid: str(ts, 'uid', 'transferSyntax'),
      explicitVR: bool(ts, 'explicitVR'),
      littleEndian: bool(ts, 'littleEndian'),
      deflated: bool(ts, 'deflated'),
    };
    const relativeTo = str(doc, 'offsetsRelativeTo', 'document');
    const dataSetOffsetsPhysical = relativeTo === 'file';

    const regions: Region[] = list(doc, 'regions', 'document').flatMap((r, i) => {
      const ro = obj(r, `regions[${i}]`);
      const name = str(ro, 'name', `regions[${i}]`);
      const start = int(ro, 'offset', `regions[${i}]`);
      const end = int(ro, 'endOffset', `regions[${i}]`);
      if (rangeProblem(start, end, fileSize) !== null) return [];
      return [
        {
          name: (REGION_NAMES.has(name) ? name : 'other') as Region['name'],
          range: { start, end },
        },
      ];
    });

    const warnings = list(doc, 'warnings', 'document').map((w, i) => {
      if (typeof w !== 'string') throw new ShapeError(`warnings[${i}] is not a string`);
      return w;
    });

    const metaCtx: Context = { fileSize, section: 'fileMeta' };
    const dataCtx: Context = dataSetOffsetsPhysical
      ? { fileSize, section: 'dataSet' }
      : { fileSize, section: 'dataSet', unavailable: 'deflated' };

    return {
      ok: true,
      inspection: {
        fileSize,
        transferSyntax,
        dataSetOffsetsPhysical,
        hasPreamble: bool(doc, 'preamble'),
        regions,
        fileMeta: list(doc, 'fileMeta', 'document').map((e) => element(metaCtx, e, [], 0)),
        dataSet: list(doc, 'dataSet', 'document').map((e) => element(dataCtx, e, [], 0)),
        warnings,
        partial: warnings.some((w) => /\btruncated\b/i.test(w)),
      },
    };
  } catch (error) {
    if (error instanceof ShapeError) {
      return {
        ok: false,
        error: `go-dicom output was not in the expected shape: ${error.message}.`,
      };
    }
    throw error;
  }
}

/** The oldest go-dicom whose `show --json` this extension trusts (go-dicom #272 fixed). */
export const MIN_GO_DICOM_VERSION = [1, 9, 1] as const;

/**
 * Reads the version from `go-dicom version` output ("go-dicom version 1.9.1").
 *
 * @returns `[major, minor, patch]`, or null when the output has no version.
 */
export function parseGoDicomVersion(output: string): [number, number, number] | null {
  const m = /\bversion\s+v?(\d+)\.(\d+)\.(\d+)/.exec(output);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether a version is at least {@link MIN_GO_DICOM_VERSION}. */
export function isSupportedGoDicom(version: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const have = version[i] ?? 0;
    const need = MIN_GO_DICOM_VERSION[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}
