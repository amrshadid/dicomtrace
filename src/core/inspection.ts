/**
 * The inspection model: what the panes show about one revision of one file.
 * Built in the host from parser output (see `goDicom.ts`); the webview only ever
 * receives this model, never raw parser output.
 */
import type { ByteRange, RangeOrReason } from './ranges';

/** One step of an element path: a tag, optionally inside a numbered item of a sequence. */
export interface PathStep {
  /** `(GGGG,EEEE)`, upper-case hex. */
  readonly tag: string;
  /** Zero-based item index within the sequence named by `tag`; absent on the last step. */
  readonly item?: number;
}

/**
 * Which part of the file an element lives in. File meta offsets are always physical;
 * data set offsets are physical unless the data set is deflated.
 */
export type Section = 'fileMeta' | 'dataSet';

/** The byte ranges of one element. */
export interface ElementRanges {
  readonly tag: RangeOrReason;
  readonly vr: RangeOrReason;
  readonly length: RangeOrReason;
  readonly value: RangeOrReason;
  /** The whole element, header to end (including any delimiter). */
  readonly element: RangeOrReason;
  /** Sequence or item delimitation item, when the length is undefined and one was found. */
  readonly delimiter?: ByteRange;
}

/** A short, display-safe rendering of a value, or why there is none. */
export type ValuePreview =
  | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
  /** Binary VRs (OB, OW, UN, …) are never shown as text; the bytes are in the hex pane. */
  | { readonly kind: 'binary' }
  /** Sequences show their items instead. */
  | { readonly kind: 'sequence' }
  | { readonly kind: 'empty' };

/** One item of a sequence: its range, its optional item delimiter, and its elements. */
export interface InspectedItem {
  readonly index: number;
  readonly ranges: { readonly item: RangeOrReason; readonly delimiter?: ByteRange };
  readonly elements: readonly InspectedElement[];
}

/** One fragment of encapsulated Pixel Data (an item of the fragment sequence). */
export interface InspectedFragment {
  readonly index: number;
  readonly range: RangeOrReason;
  readonly valueLength: number;
}

/** One data element as the panes show it, with every byte range under the offset contract. */
export interface InspectedElement {
  /** Stable, unique key for this element within the inspection, e.g. `d/(0008,1115)[1]/(0008,1150)`. */
  readonly id: string;
  readonly section: Section;
  readonly path: readonly PathStep[];
  readonly tag: string;
  readonly keyword: string;
  readonly name: string;
  /** As encoded, or as resolved from the dictionary in implicit VR (may be ambiguous, e.g. `US or SS`). */
  readonly vr: string;
  /** True when the VR is not in the file (implicit VR) and came from the dictionary. */
  readonly vrFromDictionary: boolean;
  readonly vm: number;
  /** Encoded value length in bytes; for undefined length, the length of the content. */
  readonly valueLength: number;
  readonly undefinedLength: boolean;
  readonly preview: ValuePreview;
  readonly ranges: ElementRanges;
  readonly items: readonly InspectedItem[];
  readonly fragments: readonly InspectedFragment[];
}

/** How the data set is encoded, from the Transfer Syntax UID. */
export interface TransferSyntaxInfo {
  /** Empty when the file meta has none (a malformed file). */
  readonly uid: string;
  readonly explicitVR: boolean;
  readonly littleEndian: boolean;
  readonly deflated: boolean;
}

/** A top-level stretch of the file: preamble, DICM prefix, file meta, data set. */
export interface Region {
  readonly name: 'preamble' | 'prefix' | 'fileMeta' | 'dataSet' | 'other';
  readonly range: ByteRange;
}

/** Everything the panes know about one DICOM file revision. */
export interface Inspection {
  readonly fileSize: number;
  readonly transferSyntax: TransferSyntaxInfo;
  /** False for a deflated data set: data set ranges are then all unavailable. */
  readonly dataSetOffsetsPhysical: boolean;
  readonly hasPreamble: boolean;
  readonly regions: readonly Region[];
  readonly fileMeta: readonly InspectedElement[];
  readonly dataSet: readonly InspectedElement[];
  /** Parser warnings, verbatim. Shown to the user; never logged (they can name tags). */
  readonly warnings: readonly string[];
  /** The parser stopped early (truncated file); elements before the cut are intact. */
  readonly partial: boolean;
}
