/**
 * What kind of DICOM object a file holds, and so what the image pane can do with it.
 * Derived only from the inspection (parser output), never by parsing in the webview.
 */
import type { InspectedElement, Inspection } from './inspection';
import type { ByteRange } from './ranges';

/** Common SOP classes by UID, for "No image: <name>" and the header line. */
const SOP_CLASSES: Readonly<Record<string, string>> = {
  '1.2.840.10008.5.1.4.1.1.1': 'Computed Radiography Image',
  '1.2.840.10008.5.1.4.1.1.1.1': 'Digital X-Ray Image',
  '1.2.840.10008.5.1.4.1.1.2': 'CT Image',
  '1.2.840.10008.5.1.4.1.1.2.1': 'Enhanced CT Image',
  '1.2.840.10008.5.1.4.1.1.4': 'MR Image',
  '1.2.840.10008.5.1.4.1.1.4.1': 'Enhanced MR Image',
  '1.2.840.10008.5.1.4.1.1.6.1': 'Ultrasound Image',
  '1.2.840.10008.5.1.4.1.1.7': 'Secondary Capture Image',
  '1.2.840.10008.5.1.4.1.1.11.1': 'Grayscale Softcopy Presentation State',
  '1.2.840.10008.5.1.4.1.1.20': 'Nuclear Medicine Image',
  '1.2.840.10008.5.1.4.1.1.66.4': 'Segmentation',
  '1.2.840.10008.5.1.4.1.1.88.11': 'Basic Text SR',
  '1.2.840.10008.5.1.4.1.1.88.22': 'Enhanced SR',
  '1.2.840.10008.5.1.4.1.1.88.33': 'Comprehensive SR',
  '1.2.840.10008.5.1.4.1.1.88.34': 'Comprehensive 3D SR',
  '1.2.840.10008.5.1.4.1.1.104.1': 'Encapsulated PDF',
  '1.2.840.10008.5.1.4.1.1.104.2': 'Encapsulated CDA',
  '1.2.840.10008.5.1.4.1.1.128': 'PET Image',
  '1.2.840.10008.5.1.4.1.1.481.1': 'RT Image',
  '1.2.840.10008.5.1.4.1.1.481.2': 'RT Dose',
  '1.2.840.10008.5.1.4.1.1.481.3': 'RT Structure Set',
  '1.2.840.10008.5.1.4.1.1.481.5': 'RT Plan',
  '1.2.840.10008.5.1.4.1.1.481.8': 'RT Ion Plan',
};

export interface OverlayInfo {
  /** The overlay group, e.g. 0x6000. */
  readonly group: number;
  readonly rows: number;
  readonly columns: number;
  /** 1-based row and column of the overlay's top-left pixel in the image (60xx,0050). */
  readonly origin: readonly [number, number];
  /** Physical byte range of Overlay Data (60xx,3000); null when not physical. */
  readonly data: ByteRange | null;
}

/** How the image pane should show this object. */
export type ImagePlan =
  /** Cornerstone stack viewport, `frames` frames. */
  | { readonly kind: 'cornerstone'; readonly frames: number }
  /** 1-bit pixels (e.g. SEG masks), drawn by our own renderer from the Pixel Data bytes. */
  | {
      readonly kind: 'bitmap';
      readonly frames: number;
      readonly rows: number;
      readonly columns: number;
      readonly pixels: ByteRange;
    }
  /** No pixel data, or pixels we can't reach; the pane says why. */
  | { readonly kind: 'none'; readonly reason: string };

export interface ObjectInfo {
  readonly sopClassUid: string;
  /** A readable SOP class name, or the UID when unknown, or '' when absent. */
  readonly sopClassName: string;
  readonly image: ImagePlan;
  readonly overlays: readonly OverlayInfo[];
  /** Encapsulated document (PDF, CDA…): its MIME type and the bytes of (0042,0011). */
  readonly document: {
    readonly mimeType: string;
    readonly length: number;
    readonly data: ByteRange | null;
  } | null;
}

const text = (el: InspectedElement | undefined): string =>
  el?.preview.kind === 'text' ? el.preview.text.trim() : '';

const int = (el: InspectedElement | undefined, fallback: number): number => {
  const n = Number.parseInt(text(el).split('\\')[0] ?? '', 10);
  return Number.isSafeInteger(n) ? n : fallback;
};

const physical = (el: InspectedElement | undefined): ByteRange | null =>
  el?.ranges.value.kind === 'physical' ? el.ranges.value.range : null;

/** Name for a SOP class UID: the known name, else the UID itself. */
export function sopClassName(uid: string): string {
  return SOP_CLASSES[uid] ?? uid;
}

/** Works out what the image pane can do with this inspection. */
export function objectInfo(inspection: Inspection): ObjectInfo {
  const top = new Map(inspection.dataSet.map((e) => [e.tag, e]));
  const sopClassUid =
    text(top.get('(0008,0016)')) || text(inspection.fileMeta.find((e) => e.tag === '(0002,0002)'));
  const name = sopClassUid ? sopClassName(sopClassUid) : '';

  const overlays: OverlayInfo[] = [];
  for (let group = 0x6000; group <= 0x601e; group += 2) {
    const g = group.toString(16).toUpperCase();
    const data = top.get(`(${g},3000)`);
    if (!data) continue;
    const [r, c] = text(top.get(`(${g},0050)`))
      .split('\\')
      .map((v) => {
        const n = Number.parseInt(v, 10);
        return Number.isSafeInteger(n) ? n : 1;
      });
    overlays.push({
      group,
      rows: int(top.get(`(${g},0010)`), 0),
      columns: int(top.get(`(${g},0011)`), 0),
      origin: [r ?? 1, c ?? 1],
      data: physical(data),
    });
  }

  const docEl = top.get('(0042,0011)');
  const document = docEl
    ? { mimeType: text(top.get('(0042,0012)')), length: docEl.valueLength, data: physical(docEl) }
    : null;

  const pixelData = top.get('(7FE0,0010)') ?? top.get('(7FE0,0008)') ?? top.get('(7FE0,0009)');
  let image: ImagePlan;
  if (!pixelData) {
    image = {
      kind: 'none',
      reason: name
        ? `No image in this object (${name}).`
        : 'No image in this file (no Pixel Data).',
    };
  } else if (pixelData.valueLength === 0 && !pixelData.undefinedLength) {
    image = { kind: 'none', reason: 'Pixel Data is empty (length 0).' };
  } else if (!inspection.dataSetOffsetsPhysical && int(top.get('(0028,0100)'), 0) === 1) {
    image = { kind: 'none', reason: '1-bit pixels in a deflated data set cannot be shown yet.' };
  } else {
    const frames = Math.max(1, int(top.get('(0028,0008)'), 1));
    const rows = int(top.get('(0028,0010)'), 0);
    const columns = int(top.get('(0028,0011)'), 0);
    if (rows < 1 || columns < 1) {
      image = {
        kind: 'none',
        reason: 'Pixel Data has no valid Rows and Columns, so it cannot be shown as an image.',
      };
    } else if (int(top.get('(0028,0100)'), 0) === 1) {
      const pixels = physical(pixelData);
      image =
        pixels && !pixelData.undefinedLength
          ? { kind: 'bitmap', frames, rows, columns, pixels }
          : {
              kind: 'none',
              reason: 'These 1-bit pixels are not stored in a way the viewer can show yet.',
            };
    } else {
      image = { kind: 'cornerstone', frames };
    }
  }

  return { sopClassUid, sopClassName: name, image, overlays, document };
}

/**
 * Unpacks DICOM 1-bit data (overlays, BINARY segmentations): bits are packed least
 * significant first within each byte, continuously across rows and frames (PS3.5 8.1.1).
 *
 * @param bytes - The packed bytes.
 * @param bitOffset - Where to start, in bits (frame index × rows × columns).
 * @param count - Number of pixels to unpack.
 * @returns One byte per pixel, 0 or 1.
 */
export function unpackBits(bytes: Uint8Array, bitOffset: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const bit = bitOffset + i;
    const byte = bytes[bit >> 3];
    out[i] = byte === undefined ? 0 : (byte >> (bit & 7)) & 1;
  }
  return out;
}
