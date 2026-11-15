/**
 * Hex view paging. The webview never holds the whole file: it asks for fixed-size pages,
 * only those on screen, and draws only the visible rows (bounded work on huge files).
 * Pure arithmetic, shared by host and webview.
 */

/** Bytes per hex row. */
export const BYTES_PER_ROW = 16;
/** Bytes per page request. Also the host's cap on any single read. */
export const PAGE_SIZE = 64 * 1024;

/** The page that contains `offset`. */
export function pageOf(offset: number, pageSize = PAGE_SIZE): number {
  return Math.floor(Math.max(0, offset) / pageSize);
}

/** Number of rows needed to show `fileSize` bytes. */
export function rowCount(fileSize: number): number {
  return Math.ceil(fileSize / BYTES_PER_ROW);
}

/** Offset label as shown in the hex gutter: 8 upper-case hex digits (physical file offset). */
export function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Parses a "go to offset" entry: decimal (`1234`) or hex (`0x4D2`), nothing else.
 * Returns null for anything that isn't wholly a non-negative safe integer.
 */
export function parseOffset(text: string): number | null {
  const t = text.trim();
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  const n = /^0x/i.test(t) ? Number.parseInt(t.slice(2), 16) : Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
