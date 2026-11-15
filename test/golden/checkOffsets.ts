/**
 * Golden offset check: every range go-dicom reports must hold against the actual
 * file bytes. Ported from an earlier standalone check script and extended.
 *
 * Checks, for every element including those inside items:
 * - the bytes at `tagOffset` decode to the element's tag;
 * - explicit VR: the two bytes at `vrOffset` equal the VR;
 * - the length field equals `valueLength`, or is FFFFFFFF for undefined length;
 * - `valueOffset` is right after the length field;
 * - defined length: the element ends at `valueOffset + valueLength`;
 * - undefined length: the element ends with a Sequence Delimitation Item;
 * - every range is inside the file (`rangeProblem` from the core);
 * - items and fragments start with an Item tag, and items end with an Item
 *   Delimitation Item when their length is undefined;
 * - items, fragments and top-level elements tile with no gap or overlap.
 * And for the document: the regions tile the whole file, and the top-level data set
 * covers its region (up to the truncation point for a truncated file).
 *
 * Deflated data sets have offsets into the inflated stream, not the file, so only
 * the file meta is checked against bytes there.
 */
import { rangeProblem } from '../../src/core/ranges';
import type { GoDicomDocument, GoDicomElement } from './goDicomJson';

const ITEM = '(FFFE,E000)';
const ITEM_DELIMITER = '(FFFE,E00D)';
const SEQUENCE_DELIMITER = '(FFFE,E0DD)';
const UNDEFINED_LENGTH = 0xffffffff;

export interface OffsetReport {
  /** Elements visited, including nested ones. */
  readonly elements: number;
  /** Elements whose ranges were checked against the bytes. */
  readonly checked: number;
  readonly errors: readonly string[];
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const normaliseTag = (tag: string): string => tag.toUpperCase().replace(/\s/g, '');

/** Checks every offset in `doc` against `bytes`. */
export function checkOffsets(bytes: Uint8Array, doc: GoDicomDocument): OffsetReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = bytes.byteLength;
  const errors: string[] = [];
  let elements = 0;
  let checked = 0;

  const inFile = (where: string, start: number, end: number): boolean => {
    const problem = rangeProblem(start, end, size);
    if (problem !== null) errors.push(`${where}: ${problem}`);
    return problem === null;
  };

  const tagAt = (offset: number, le: boolean): string =>
    `(${hex4(view.getUint16(offset, le))},${hex4(view.getUint16(offset + 2, le))})`;

  const tiles = (
    where: string,
    ranges: readonly { tagOffset: number; endOffset: number }[],
    from: number,
    to: number,
  ): void => {
    let cursor = from;
    for (const r of ranges) {
      if (r.tagOffset !== cursor)
        errors.push(`${where}: gap or overlap at ${cursor}..${r.tagOffset}`);
      cursor = r.endOffset;
    }
    if (ranges.length > 0 && cursor !== to)
      errors.push(`${where}: children end at ${cursor}, expected ${to}`);
  };

  const checkElement = (el: GoDicomElement, le: boolean, where: string): void => {
    checked++;
    if (!inFile(where, el.tagOffset, el.endOffset)) return;
    if (!inFile(`${where} header`, el.tagOffset, el.valueOffset)) return;

    const tag = tagAt(el.tagOffset, le);
    if (tag !== normaliseTag(el.tag))
      errors.push(`${where}: bytes at tagOffset ${el.tagOffset} are ${tag}`);

    if (el.vrOffset !== null) {
      const vr = String.fromCharCode(bytes[el.vrOffset] ?? 0, bytes[el.vrOffset + 1] ?? 0);
      if (vr !== el.vr) errors.push(`${where}: VR bytes '${vr}' != '${String(el.vr)}'`);
    }

    const length =
      el.lengthSize === 2
        ? view.getUint16(el.lengthOffset, le)
        : view.getUint32(el.lengthOffset, le);
    if (el.undefinedLength) {
      if (length !== UNDEFINED_LENGTH)
        errors.push(`${where}: undefined length but the field is ${length}`);
      if (el.endOffset - 8 < el.valueOffset || tagAt(el.endOffset - 8, le) !== SEQUENCE_DELIMITER) {
        errors.push(`${where}: undefined length does not end with ${SEQUENCE_DELIMITER}`);
      }
    } else {
      if (length !== el.valueLength)
        errors.push(`${where}: length field ${length} != valueLength ${el.valueLength}`);
      if (el.endOffset !== el.valueOffset + el.valueLength) {
        errors.push(`${where}: endOffset ${el.endOffset} != valueOffset + valueLength`);
      }
    }
    if (el.valueOffset !== el.lengthOffset + el.lengthSize)
      errors.push(`${where}: valueOffset is not right after the length`);

    // An undefined-length element's children end where its delimiter starts.
    const childrenEnd = el.undefinedLength ? el.endOffset - 8 : el.endOffset;

    el.items.forEach((item, i) => {
      const at = `${where}[${i}]`;
      if (!inFile(at, item.tagOffset, item.endOffset)) return;
      if (tagAt(item.tagOffset, le) !== ITEM) errors.push(`${at}: not an item tag`);
      const itemLength = view.getUint32(item.tagOffset + 4, le);
      const contentEnd = itemLength === UNDEFINED_LENGTH ? item.endOffset - 8 : item.endOffset;
      if (itemLength === UNDEFINED_LENGTH) {
        if (tagAt(item.endOffset - 8, le) !== ITEM_DELIMITER)
          errors.push(`${at}: no ${ITEM_DELIMITER}`);
      } else if (item.endOffset !== item.tagOffset + 8 + itemLength) {
        errors.push(`${at}: endOffset != item length`);
      }
      walk(item.elements, le, at, item.tagOffset + 8, contentEnd);
    });
    if (el.items.length > 0) tiles(`${where} items`, el.items, el.valueOffset, childrenEnd);

    el.fragments.forEach((fragment, i) => {
      const at = `${where} fragment ${i}`;
      if (!inFile(at, fragment.tagOffset, fragment.endOffset)) return;
      if (tagAt(fragment.tagOffset, le) !== ITEM) errors.push(`${at}: not an item tag`);
      if (
        fragment.endOffset !==
        fragment.tagOffset + 8 + view.getUint32(fragment.tagOffset + 4, le)
      ) {
        errors.push(`${at}: endOffset != fragment length`);
      }
    });
    if (el.fragments.length > 0)
      tiles(`${where} fragments`, el.fragments, el.valueOffset, childrenEnd);
  };

  const count = (els: readonly GoDicomElement[]): number =>
    els.reduce((n, e) => n + 1 + e.items.reduce((m, item) => m + count(item.elements), 0), 0);

  function walk(
    els: readonly GoDicomElement[],
    le: boolean,
    path: string,
    from: number,
    to: number,
  ): void {
    for (const el of els) checkElement(el, le, `${path}/${el.tag}`);
    tiles(path === '' ? 'data set' : path, els, from, to);
  }

  // Regions tile the whole file.
  if (doc.size !== size) errors.push(`document size ${doc.size} != file size ${size}`);
  tiles(
    'regions',
    doc.regions.map((r) => ({ tagOffset: r.offset, endOffset: r.endOffset })),
    0,
    size,
  );
  const region = (name: string) => doc.regions.find((r) => r.name === name);

  elements += count(doc.fileMeta);
  const meta = region('fileMeta');
  if (meta) walk(doc.fileMeta, true, '/meta', meta.offset, meta.endOffset);

  elements += count(doc.dataSet);
  const data = region('dataSet');
  if (doc.offsetsRelativeTo === 'file' && data) {
    const truncated = doc.warnings.some((w) => w.includes('truncated'));
    const last = doc.dataSet.at(-1);
    // A truncated file's data set stops at the dropped element; everything before it must still tile.
    const end = truncated && last ? last.endOffset : data.endOffset;
    walk(doc.dataSet, doc.transferSyntax.littleEndian, '', data.offset, end);
  }

  return { elements, checked, errors };
}
