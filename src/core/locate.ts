/**
 * Byte → element: which element encloses a byte the user clicked in the hex pane.
 * Used to link the panes back from bytes to tags.
 */
import type { InspectedElement } from './inspection';
import type { ByteRange } from './ranges';
import { rangeContains } from './ranges';

const physicalRange = (el: InspectedElement): ByteRange | null =>
  el.ranges.element.kind === 'physical' ? el.ranges.element.range : null;

/** The sibling whose range contains `offset`. Siblings are disjoint and in file order. */
function siblingAt(elements: readonly InspectedElement[], offset: number): InspectedElement | null {
  let lo = 0;
  let hi = elements.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const el = elements[mid];
    const r = el ? physicalRange(el) : null;
    // A sibling without a physical range breaks the ordering argument; scan instead.
    if (!r) {
      return (
        elements.find((e) => {
          const er = physicalRange(e);
          return er !== null && rangeContains(er, offset);
        }) ?? null
      );
    }
    if (offset < r.start) hi = mid - 1;
    else if (offset >= r.end) lo = mid + 1;
    else return el ?? null;
  }
  return null;
}

/**
 * Finds the deepest element whose physical range contains `offset`: a binary search per
 * level, descending into the matching element's items. Elements without a physical
 * range (deflated data sets) are never returned: no claim is made about those bytes.
 *
 * @returns The element, or null when no element with a physical range covers the byte
 *   (the preamble, the prefix, or bytes after a truncation).
 */
export function elementAt(
  elements: readonly InspectedElement[],
  offset: number,
): InspectedElement | null {
  const el = siblingAt(elements, offset);
  if (!el) return null;
  for (const item of el.items) {
    if (item.ranges.item.kind === 'physical' && rangeContains(item.ranges.item.range, offset)) {
      return elementAt(item.elements, offset) ?? el;
    }
  }
  return el;
}
