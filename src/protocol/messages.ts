/**
 * The message protocol between the extension host and the webview.
 *
 * Every message carries the document id and revision it belongs to, so a pane never
 * shows bytes from one version of a file next to metadata from another.
 * Messages from the webview are untrusted: the host accepts only what
 * `parseWebviewMessage` returns, and checks reads with `checkRead`.
 */
import { PAGE_SIZE } from '../core/hexPaging';
import type { Inspection } from '../core/inspection';
import type { NiftiView } from '../core/niftiModel';
import type { ObjectInfo } from '../core/objectInfo';

/** Identifies one open document and one revision of its file. */
export interface Revisioned {
  readonly documentId: string;
  readonly revision: number;
}

// ── Webview → host ────────────────────────────────────────────────────────────

/** The webview loaded and wants the current state. */
export interface ReadyMessage {
  readonly type: 'ready';
}

/** Read `length` bytes at `offset` from the given revision (one hex page or less). */
export interface ReadBytesMessage extends Revisioned {
  readonly type: 'readBytes';
  readonly offset: number;
  readonly length: number;
}

/** The image pane failed or succeeded; only a category is reported, for the log. */
export interface ImageStatusMessage extends Revisioned {
  readonly type: 'imageStatus';
  readonly status: 'rendered' | 'failed';
  readonly ms: number;
}

/** Which panes are visible. At least one is always true. */
export interface PaneLayout {
  readonly image: boolean;
  readonly tags: boolean;
  readonly bytes: boolean;
}

/** The layout until the user changes it: image and tags; the hex pane is opt-in. */
export const DEFAULT_LAYOUT: PaneLayout = { image: true, tags: true, bytes: false };

/** The user showed or hid a pane; the host remembers it for the next files. */
export interface LayoutMessage extends PaneLayout {
  readonly type: 'layout';
}

export type WebviewMessage = ReadyMessage | ReadBytesMessage | ImageStatusMessage | LayoutMessage;

// ── Host → webview ────────────────────────────────────────────────────────────

/** File facts every opened document shares. Never contains the file path. */
interface OpenedBase extends Revisioned {
  readonly type: 'opened';
  readonly fileName: string;
  readonly fileSize: number;
}

/** A DICOM file, parsed by go-dicom and normalised in the host. */
export interface DicomOpenedMessage extends OpenedBase {
  readonly format: 'dicom';
  readonly inspection: Inspection;
  readonly object: ObjectInfo;
}

/** A NIfTI file, parsed in the host (inflated first for `.nii.gz`). */
export interface NiftiOpenedMessage extends OpenedBase {
  readonly format: 'nifti';
  readonly nifti: NiftiView;
}

export type OpenedMessage = DicomOpenedMessage | NiftiOpenedMessage;

/** Parsing failed: the panes show raw bytes and this message. */
export interface ParseFailedMessage extends Revisioned {
  readonly type: 'parseFailed';
  readonly format: 'dicom' | 'nifti';
  readonly fileName: string;
  readonly fileSize: number;
  readonly message: string;
}

/** Bytes read for a `readBytes` request. */
export interface BytesMessage extends Revisioned {
  readonly type: 'bytes';
  readonly offset: number;
  readonly data: Uint8Array;
}

/** A read was refused or failed; the hex pane shows the reason. */
export interface BytesFailedMessage extends Revisioned {
  readonly type: 'bytesFailed';
  readonly offset: number;
  readonly message: string;
}

/**
 * Bytes for the image pane, sent once per revision: the whole DICOM file (Cornerstone
 * reads it itself; 1-bit pixels and overlays are cut from it by their ranges), or the
 * inflated NIfTI stream. Absent when the file is too large to show.
 */
export interface ImageDataMessage extends Revisioned {
  readonly type: 'imageData';
  readonly data: Uint8Array;
}

/** The image pane will not get bytes for this revision, and why. */
export interface ImageUnavailableMessage extends Revisioned {
  readonly type: 'imageUnavailable';
  readonly message: string;
}

/** The remembered pane layout, sent when a webview starts. */
export interface HostLayoutMessage extends PaneLayout {
  readonly type: 'layout';
}

export type HostMessage =
  | HostLayoutMessage
  | OpenedMessage
  | ParseFailedMessage
  | BytesMessage
  | BytesFailedMessage
  | ImageDataMessage
  | ImageUnavailableMessage;

// ── Validation ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 64;
const isObject = (u: unknown): u is Record<string, unknown> =>
  typeof u === 'object' && u !== null && !Array.isArray(u);
const isCount = (u: unknown): u is number =>
  typeof u === 'number' && Number.isSafeInteger(u) && u >= 0;
const isId = (u: unknown): u is string =>
  typeof u === 'string' && u.length > 0 && u.length <= MAX_ID_LENGTH;

/**
 * Narrows a message from the webview to a known shape, or returns null. Unknown
 * fields are dropped; nothing from the input is passed through unchecked.
 */
export function parseWebviewMessage(u: unknown): WebviewMessage | null {
  if (!isObject(u)) return null;
  switch (u.type) {
    case 'ready':
      return { type: 'ready' };
    case 'readBytes':
      if (!isId(u.documentId) || !isCount(u.revision) || !isCount(u.offset) || !isCount(u.length))
        return null;
      return {
        type: 'readBytes',
        documentId: u.documentId,
        revision: u.revision,
        offset: u.offset,
        length: u.length,
      };
    case 'layout': {
      const { image, tags, bytes } = u;
      if (typeof image !== 'boolean' || typeof tags !== 'boolean' || typeof bytes !== 'boolean') {
        return null;
      }
      if (!image && !tags && !bytes) return null;
      return { type: 'layout', image, tags, bytes };
    }
    case 'imageStatus':
      if (!isId(u.documentId) || !isCount(u.revision) || !isCount(u.ms)) return null;
      if (u.status !== 'rendered' && u.status !== 'failed') return null;
      return {
        type: 'imageStatus',
        documentId: u.documentId,
        revision: u.revision,
        status: u.status,
        ms: u.ms,
      };
    default:
      return null;
  }
}

/** The host's view of the document a read targets. */
export interface CurrentDocument extends Revisioned {
  readonly fileSize: number;
}

export type ReadCheck =
  | { readonly ok: true; readonly offset: number; readonly length: number }
  | {
      readonly ok: false;
      readonly reason: 'wrongDocument' | 'staleRevision' | 'outOfRange' | 'tooLong';
    };

/**
 * Decides whether a read may touch the file: right document, current revision, inside
 * the file, at most one page. A read that runs past the end is shortened, not refused,
 * so the last page works.
 */
export function checkRead(
  msg: ReadBytesMessage,
  doc: CurrentDocument,
  maxLength = PAGE_SIZE,
): ReadCheck {
  if (msg.documentId !== doc.documentId) return { ok: false, reason: 'wrongDocument' };
  if (msg.revision !== doc.revision) return { ok: false, reason: 'staleRevision' };
  if (msg.length > maxLength) return { ok: false, reason: 'tooLong' };
  if (msg.offset > doc.fileSize) return { ok: false, reason: 'outOfRange' };
  return { ok: true, offset: msg.offset, length: Math.min(msg.length, doc.fileSize - msg.offset) };
}

/** Whether a host message belongs to what the webview is showing; stale ones are dropped. */
export function isCurrent(msg: Revisioned, shown: Revisioned | null): boolean {
  return shown !== null && msg.documentId === shown.documentId && msg.revision === shown.revision;
}
