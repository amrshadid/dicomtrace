/**
 * Webview entry point: lays out the three panes, routes host messages, and links the
 * panes (tag → bytes, byte → tag). UI state only; it never parses DICOM structure
 * itself and never sees a file path.
 */
import './styles.css';
import { PAGE_SIZE, formatOffset } from '../core/hexPaging';
import type { Inspection } from '../core/inspection';
import { elementAt } from '../core/locate';
import type { NiftiView } from '../core/niftiModel';
import type { ObjectInfo } from '../core/objectInfo';
import type {
  HostMessage,
  OpenedMessage,
  PaneLayout,
  Revisioned,
  WebviewMessage,
} from '../protocol/messages';
import { DEFAULT_LAYOUT, isCurrent } from '../protocol/messages';
import { h, replace } from './dom';
import { HexPane } from './hexPane';
import { ImagePane } from './imagePane';
import type { Selection } from './tagsPane';
import { TagsPane } from './tagsPane';
import { installTestHooks } from './testHooks';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const post = (m: WebviewMessage): void => {
  vscode.postMessage(m);
};
interface SavedState {
  selected?: string | undefined;
  grouped?: boolean | undefined;
}
let saved = (vscode.getState() ?? {}) as SavedState;
/** Webview state survives the editor being hidden and shown again. */
const save = (patch: SavedState): void => {
  saved = { ...saved, ...patch };
  vscode.setState(saved);
};

// ── Layout ────────────────────────────────────────────────────────────────────

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const titlebar = h('header', { class: 'titlebar' }, h('span', { class: 'name' }, 'Opening…'));
const banners = h('div', { class: 'banners', role: 'status' });
const paneHead = (): HTMLElement => h('div', { class: 'pane-head' });
const imageHead = paneHead();
const imageBody = h('div', { class: 'pane-body' });
const tagsHead = paneHead();
const tagsBody = h('div', { class: 'pane-body' });
const hexHead = paneHead();
const hexBody = h('div', { class: 'pane-body' });
const status = h('footer', { class: 'statusbar' });
const statusSelection = h('span');
const statusHover = h('span');
status.append(statusSelection, statusHover);

const panes = h('main', { class: 'panes' });

/** A drag ends on release, or when the browser takes the pointer away. */
const END_DRAG = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

const splitter = (side: 'left' | 'right'): HTMLElement => {
  const el = h('div', { class: 'splitter', role: 'separator', aria: { orientation: 'vertical' } });
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev: PointerEvent): void => {
      const rect = panes.getBoundingClientRect();
      const x = Math.max(120, Math.min(rect.width - 120, ev.clientX - rect.left));
      // CSSOM custom-property writes are allowed by the CSP (no style attribute).
      if (side === 'left') panes.style.setProperty('--col-image', `${x}px`);
      else panes.style.setProperty('--col-hex', `${rect.width - x}px`);
    };
    const up = (): void => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      for (const type of END_DRAG) el.removeEventListener(type, up);
    };
    el.addEventListener('pointermove', move);
    for (const type of END_DRAG) el.addEventListener(type, up);
  });
  return el;
};

const sections = {
  image: h('section', { class: 'pane', aria: { label: 'Image' } }, imageHead, imageBody),
  tags: h('section', { class: 'pane', aria: { label: 'Tags' } }, tagsHead, tagsBody),
  bytes: h('section', { class: 'pane', aria: { label: 'Bytes' } }, hexHead, hexBody),
};
const leftSplitter = splitter('left');
const rightSplitter = splitter('right');
panes.append(sections.image, leftSplitter, sections.tags, rightSplitter, sections.bytes);

// ── Showing and hiding panes ──────────────────────────────────────────────────

type PaneName = keyof typeof sections;
const PANE_LABELS: Readonly<Record<PaneName, string>> = {
  image: 'Image',
  tags: 'Tags',
  bytes: 'Bytes',
};
let layout: PaneLayout = DEFAULT_LAYOUT;
const toggles = h('div', {
  class: 'pane-toggles',
  role: 'group',
  aria: { label: 'Show or hide panes' },
});
const toggleButtons = (Object.keys(sections) as PaneName[]).map((name) => {
  const button = h(
    'button',
    { class: 'pane-toggle', title: `Show or hide the ${PANE_LABELS[name]} pane` },
    PANE_LABELS[name],
  );
  button.addEventListener('click', () => {
    const next = { ...layout, [name]: !layout[name] };
    if (!next.image && !next.tags && !next.bytes) return; // keep at least one pane
    applyLayout(next);
    post({ type: 'layout', ...next });
  });
  toggles.append(button);
  return [name, button] as const;
});

/** Shows the visible panes side by side; the last one fills when Tags is hidden. */
function applyLayout(next: PaneLayout): void {
  layout = next;
  const visible = (Object.keys(sections) as PaneName[]).filter((n) => layout[n]);
  const columns = visible.map((n, i) => {
    if (n === 'tags' || (!layout.tags && i === visible.length - 1)) return 'minmax(0, 1fr)';
    return n === 'image' ? 'var(--col-image, 32%)' : 'var(--col-hex, 38%)';
  });
  if (visible.length === 1) columns.splice(0, 1, 'minmax(0, 1fr)');
  for (const n of Object.keys(sections) as PaneName[]) sections[n].hidden = !layout[n];
  // Splitters sit between visible panes: left after Image, right before Bytes.
  leftSplitter.hidden = !(layout.image && (layout.tags || layout.bytes));
  rightSplitter.hidden = !(layout.bytes && layout.tags);
  // CSSOM custom-property writes are allowed by the CSP (no style attribute).
  panes.style.setProperty('--panes', columns.join(' 4px '));
  for (const [name, button] of toggleButtons)
    button.setAttribute('aria-pressed', String(layout[name]));
}
applyLayout(layout);

app.append(titlebar, banners, panes, status);

// ── State ─────────────────────────────────────────────────────────────────────

let shown: Revisioned | null = null;
/** What the image pane draws for the shown revision, once its bytes arrive. */
let imageSource:
  { readonly format: 'dicom'; readonly object: ObjectInfo } | { readonly format: 'nifti' } | null =
  null;
let imageBytes: Uint8Array | null = null;
let dicom: Inspection | null = null;
let nifti: NiftiView | null = null;

const hex = new HexPane(hexHead, hexBody, {
  requestPage: (page) => {
    if (shown) post({ type: 'readBytes', ...shown, offset: page * PAGE_SIZE, length: PAGE_SIZE });
  },
  onByteClick: (offset) => {
    selectByte(offset);
  },
  onHover: (offset) => {
    statusHover.textContent =
      offset === null ? '' : `offset 0x${formatOffset(offset)} (${offset.toLocaleString()})`;
  },
});

const tags = new TagsPane(
  tagsHead,
  tagsBody,
  (selection) => {
    onSelection(selection);
  },
  saved.grouped ?? true,
  (grouped) => {
    save({ grouped });
  },
);

const image = new ImagePane(
  imageHead,
  imageBody,
  document.body.dataset.workerUri ?? '',
  (s, ms) => {
    if (shown) post({ type: 'imageStatus', ...shown, status: s, ms: Math.round(ms) });
  },
);

function onSelection(selection: Selection | null): void {
  hex.setSelection(selection, true);
  save({ selected: selection?.id });
  if (!selection) {
    statusSelection.textContent = '';
    return;
  }
  const where =
    selection.whole.kind === 'physical'
      ? `bytes 0x${formatOffset(selection.whole.range.start)}–0x${formatOffset(selection.whole.range.end)} (${(selection.whole.range.end - selection.whole.range.start).toLocaleString()} bytes, physical file offsets)`
      : 'bytes unavailable';
  statusSelection.textContent = `${selection.label} · ${where}`;
}

/** Byte → tag: select the deepest element (or NIfTI field) that encloses the byte. */
function selectByte(offset: number): void {
  if (dicom) {
    const el = elementAt([...dicom.fileMeta, ...dicom.dataSet], offset);
    if (el) tags.select(el.id, true);
    else
      statusSelection.textContent = `0x${formatOffset(offset)} is not inside an element the parser reported.`;
  } else if (nifti && !nifti.compressed) {
    const field = nifti.fields.find(
      (f) =>
        f.range.kind === 'physical' && offset >= f.range.range.start && offset < f.range.range.end,
    );
    const inVoxels = nifti.voxels.kind === 'physical' && offset >= nifti.voxels.range.start;
    const ext = nifti.extensions.findIndex(
      (e) =>
        e.range.kind === 'physical' && offset >= e.range.range.start && offset < e.range.range.end,
    );
    if (field) tags.select(`n/${field.name}`, true);
    else if (ext >= 0) tags.select(`n/ext${ext}`, true);
    else if (inVoxels) tags.select('n/voxels', true);
  }
}

// ── Header and banners ────────────────────────────────────────────────────────

const TS_NAMES: Readonly<Record<string, string>> = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
};

function setTitle(name: string, ...facts: string[]): void {
  replace(
    titlebar,
    h('span', { class: 'name' }, name),
    ...facts.filter(Boolean).map((f) => h('span', { class: 'fact' }, f)),
    h('span', { class: 'grow' }),
    toggles,
  );
}
setTitle('Opening…');

function banner(text: string, kind: 'warn' | 'error' = 'warn'): HTMLElement {
  return h('div', { class: `banner${kind === 'error' ? ' error' : ''}` }, text);
}

function showDicom(m: Extract<OpenedMessage, { format: 'dicom' }>): void {
  const { inspection, object } = m;
  dicom = inspection;
  nifti = null;
  const ts = inspection.transferSyntax.uid;
  setTitle(
    m.fileName,
    object.sopClassName,
    ts ? (TS_NAMES[ts] ?? ts) : 'no transfer syntax in file meta',
    `${m.fileSize.toLocaleString()} bytes`,
  );
  const notes: HTMLElement[] = [];
  if (inspection.fileMeta.length + inspection.dataSet.length === 0) {
    notes.push(
      banner(
        'Could not parse the file as DICOM: no elements could be read. The raw bytes are still shown.',
        'error',
      ),
    );
  } else if (inspection.partial) {
    notes.push(
      banner(
        'Partial: the file is truncated. Tags before the cut are intact; all bytes are shown.',
      ),
    );
  }
  if (!inspection.dataSetOffsetsPhysical) {
    notes.push(
      banner(
        'Deflated data set: values are shown, but data set byte ranges are unavailable because the bytes on disk are compressed. File meta ranges are exact.',
      ),
    );
  }
  for (const w of inspection.warnings) notes.push(banner(`go-dicom: ${w}`));
  replace(banners, ...notes);
  tags.showDicom(inspection);
}

function showNifti(m: Extract<OpenedMessage, { format: 'nifti' }>): void {
  const v = m.nifti;
  nifti = v;
  dicom = null;
  setTitle(
    m.fileName,
    `NIfTI-${v.version}${v.compressed ? ' (gzip)' : ''}`,
    `${v.shape.join(' × ')} ${v.datatypeName}`,
    v.littleEndian ? 'little endian' : 'big endian',
    `${m.fileSize.toLocaleString()} bytes on disk`,
  );
  const notes: HTMLElement[] = [];
  if (v.compressed) {
    notes.push(
      banner(
        'Compressed (.nii.gz): header values are shown, but their byte ranges are unavailable; the bytes pane shows the file as stored (gzip).',
      ),
    );
  }
  if (v.voxOffsetInvalid) {
    notes.push(
      banner(
        `vox_offset overlaps the header; voxels are read from byte ${v.voxOffset}, the minimum for a single-file NIfTI.`,
      ),
    );
  }
  replace(banners, ...notes);
  tags.showNifti(v);
}

// ── Messages ──────────────────────────────────────────────────────────────────

function isNewer(m: Revisioned): boolean {
  return shown?.documentId !== m.documentId || m.revision >= shown.revision;
}

const isShown = (m: Revisioned): boolean => isCurrent(m, shown);

/**
 * When go-dicom can't parse a DICOM file, Cornerstone may still decode its pixels: the
 * image pane tries one frame, independently of the failed tags (partial failure stays
 * useful).
 */
const UNPARSED_DICOM: ObjectInfo = {
  sopClassUid: '',
  sopClassName: '',
  image: { kind: 'cornerstone', frames: 1 },
  overlays: [],
  document: null,
};

function startRevision(m: Revisioned, fileSize: number): void {
  shown = { documentId: m.documentId, revision: m.revision };
  imageSource = null;
  imageBytes = null;
  hex.reset(fileSize);
}

function maybeShowImage(): void {
  // Both are reset by startRevision, so here they belong to the shown revision.
  if (!imageSource || !imageBytes) return;
  if (imageSource.format === 'dicom') void image.showDicom(imageSource.object, imageBytes);
  else image.showNifti(imageBytes);
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const m = event.data;
  switch (m.type) {
    case 'layout':
      applyLayout(m);
      return;
    case 'opened': {
      if (!isNewer(m)) return;
      startRevision(m, m.fileSize);
      imageSource =
        m.format === 'dicom' ? { format: 'dicom', object: m.object } : { format: 'nifti' };
      image.note('Loading the image…');
      if (m.format === 'dicom') showDicom(m);
      else showNifti(m);
      if (saved.selected && tags.selectionOf(saved.selected)) tags.select(saved.selected, true);
      maybeShowImage();
      return;
    }
    case 'parseFailed': {
      if (!isNewer(m)) return;
      startRevision(m, m.fileSize);
      dicom = null;
      nifti = null;
      setTitle(
        m.fileName,
        m.format === 'nifti' ? 'NIfTI' : 'DICOM',
        `${m.fileSize.toLocaleString()} bytes`,
      );
      replace(
        banners,
        banner(`Could not parse the file: ${m.message} The raw bytes are still shown.`, 'error'),
      );
      tags.clear('No tags: the file could not be parsed. The bytes pane shows the raw file.');
      if (m.format === 'dicom') {
        imageSource = { format: 'dicom', object: UNPARSED_DICOM };
        image.note('Trying to decode the image…');
        maybeShowImage();
      } else {
        image.note('No image: the file could not be parsed.');
      }
      return;
    }
    case 'bytes':
      if (isShown(m)) hex.setPage(m.offset, m.data);
      return;
    case 'bytesFailed':
      if (isShown(m)) hex.pageFailed(m.offset, m.message);
      return;
    case 'imageData':
      if (!isShown(m)) return;
      imageBytes = m.data;
      maybeShowImage();
      return;
    case 'imageUnavailable':
      if (isShown(m)) image.note(m.message);
      return;
  }
});

installTestHooks({
  select: (id) => {
    tags.select(id, true);
  },
  clickByte: (offset) => {
    selectByte(offset);
  },
  post: (message) => {
    // Test replies bypass the typed protocol; the host only reads them under test.
    (vscode.postMessage as (m: unknown) => void)(message);
  },
});

post({ type: 'ready' });
