/**
 * The offset contract. A highlighted range is a claim about the file, so
 * every range is either a verified physical range or an explicit "unavailable"
 * with a reason. There is no third state, which forces every pane to handle both.
 */

/** Zero-based, half-open, physical file offsets: `[start, end)`. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** True when `offset` lies inside the half-open range `r`. */
export function rangeContains(r: ByteRange, offset: number): boolean {
  return offset >= r.start && offset < r.end;
}

/** Why a range cannot be shown as physical bytes. */
export type UnavailableReason =
  /** The data set is deflated; offsets refer to the inflated stream, not the file. */
  | 'deflated'
  /** Undefined length and the parser reported no delimiter. */
  | 'undefinedLengthNoDelimiter'
  /** The parser could not establish the element. */
  | 'parseError'
  /** The field does not exist in this encoding, e.g. the VR in implicit VR. */
  | 'notEncoded'
  /** The bytes are inside a compressed stream (`.nii.gz`); values come from inflating it. */
  | 'compressed';

export type RangeOrReason =
  | { readonly kind: 'physical'; readonly range: ByteRange }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

/**
 * Checks that `[start, end)` is a well-formed range inside a file of `fileSize`
 * bytes. Returns `null` when it is, or a short description of what is wrong.
 *
 * This is the last gate before a range is shown, so it rejects anything that is
 * not a safe integer rather than trusting the parser's output.
 */
export function rangeProblem(start: number, end: number, fileSize: number): string | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'offsets must be integers';
  if (!Number.isSafeInteger(fileSize) || fileSize < 0)
    return 'file size must be a non-negative integer';
  if (start < 0) return `start ${start} is negative`;
  if (end < start) return `end ${end} is before start ${start}`;
  if (end > fileSize) return `end ${end} is past the end of the file (${fileSize} bytes)`;
  return null;
}

/**
 * Builds a physical range after validating it against the file size, or returns
 * `unavailable: parseError` when the parser's offsets don't hold up. A wrong
 * highlight is worse than none, so a bad range is never passed through.
 */
export function physicalRange(start: number, end: number, fileSize: number): RangeOrReason {
  return rangeProblem(start, end, fileSize) === null
    ? { kind: 'physical', range: { start, end } }
    : { kind: 'unavailable', reason: 'parseError' };
}
