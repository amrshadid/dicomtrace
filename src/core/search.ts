/**
 * Tag search for the tags pane: by tag number in any common spelling, by keyword, or
 * by name. Value text is deliberately not searched in Phase 1: the panes are about
 * structure, and values may be PHI that shouldn't be indexed.
 */
import type { InspectedElement } from './inspection';

/** A parsed query: either an exact tag or free text. */
export type Query =
  { readonly kind: 'tag'; readonly tag: string } | { readonly kind: 'text'; readonly text: string };

const TAG_FORMS = [
  /^\(?\s*([0-9a-f]{4})\s*[,|\s]\s*([0-9a-f]{4})\s*\)?$/i, // (0028,0010)  0028,0010  0028 0010
  /^([0-9a-f]{4})([0-9a-f]{4})$/i, //                            00280010
  /^0x([0-9a-f]{4})([0-9a-f]{4})$/i, //                          0x00280010
];

/** Parses user input into a query. Returns null for blank input. */
export function parseQuery(input: string): Query | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  for (const form of TAG_FORMS) {
    const m = form.exec(trimmed);
    if (m?.[1] && m[2])
      return { kind: 'tag', tag: `(${m[1].toUpperCase()},${m[2].toUpperCase()})` };
  }
  return { kind: 'text', text: trimmed.toLowerCase() };
}

/** Whether one element matches a query (its own fields only, not its children). */
export function matches(el: InspectedElement, query: Query): boolean {
  if (query.kind === 'tag') return el.tag === query.tag;
  return (
    el.keyword.toLowerCase().includes(query.text) || el.name.toLowerCase().includes(query.text)
  );
}

/**
 * All matching elements, depth-first in file order, including those inside sequences.
 * Returns their ids, which the tags pane uses to reveal and select them.
 */
export function search(elements: readonly InspectedElement[], query: Query): string[] {
  const out: string[] = [];
  const walk = (els: readonly InspectedElement[]): void => {
    for (const el of els) {
      if (matches(el, query)) out.push(el.id);
      for (const item of el.items) walk(item.elements);
    }
  };
  walk(elements);
  return out;
}
