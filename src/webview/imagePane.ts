/**
 * The image pane. Independent of the tags and hex panes: whatever happens here (no
 * image, a decode failure, a timeout) is shown here only, and never blanks the others.
 */
import type { NiftiHeader } from '../core/nifti';
import { parseNiftiHeader } from '../core/nifti';
import { niftiVoxelReader } from '../core/niftiVoxels';
import type { ObjectInfo } from '../core/objectInfo';
import { unpackBits } from '../core/objectInfo';
import { formatWindowValue as fmt } from '../core/windowLevel';
import type { CornerstoneHandle, ViewState } from './cornerstoneView';
import { h, replace } from './dom';
import { FrameBar } from './frameBar';
import { ImageToolbar } from './imageToolbar';
import { RasterView } from './rasterView';

export type ImageStatus = (status: 'rendered' | 'failed', ms: number) => void;

/** A numeric header field as numbers (empty when absent or not numeric). */
function numbers(header: NiftiHeader, name: string): readonly number[] {
  const value = header.fields.find((f) => f.name === name)?.value;
  if (typeof value === 'number') return [value];
  return Array.isArray(value) ? (value as readonly number[]) : [];
}

export class ImagePane {
  private readonly info = h('span', { class: 'image-info' });
  private readonly overlayButton = h(
    'button',
    { title: 'Show or hide overlay planes (60xx)' },
    'Overlays',
  );
  private readonly toolbar = new ImageToolbar(() => this.cornerstone ?? this.raster);
  private cornerstone: CornerstoneHandle | null = null;
  private raster: RasterView | null = null;
  private overlaysOn = true;
  private generation = 0;
  /** Decodes in flight, and until when to keep absorbing after the last one settled. */
  private decodes = 0;
  private absorbUntil = 0;
  private readonly frameBar = new FrameBar(
    (index) => {
      this.cornerstone?.setFrame(index);
      this.raster?.setFrame(index);
    },
    (index) => {
      this.raster?.setVolume(index);
    },
  );

  constructor(
    head: HTMLElement,
    private readonly body: HTMLElement,
    private readonly workerUri: string,
    private readonly onStatus: ImageStatus,
  ) {
    replace(
      head,
      h('span', { class: 'label' }, 'Image'),
      this.info,
      h('span', { class: 'grow' }),
      this.overlayButton,
    );
    // Cornerstone reports some decode failures twice: to us (shown in this pane) and as an
    // unhandled rejection from its own internals. While it decodes, absorb the duplicate.
    addEventListener('unhandledrejection', (e) => {
      if (this.decodes > 0 || performance.now() < this.absorbUntil) e.preventDefault();
    });
    // The toolbar sits between the header and the image; the frame bar under the image.
    body.before(this.toolbar.element);
    body.after(this.frameBar.element);
    this.overlayButton.hidden = true;
    this.overlayButton.addEventListener('click', () => {
      this.overlaysOn = !this.overlaysOn;
      this.overlayButton.setAttribute('aria-pressed', String(this.overlaysOn));
      this.cornerstone?.setOverlaysVisible(this.overlaysOn);
    });
  }

  /** Removes whatever is shown (cancelling a decode in flight) and shows a note instead. */
  note(message: string, kind: 'info' | 'error' = 'info', detail?: string): void {
    this.teardown();
    this.info.textContent = '';
    replace(
      this.body,
      h(
        'div',
        { class: `image-note${kind === 'error' ? ' error' : ''}` },
        h('div', {}, message),
        detail ? h('div', {}, detail) : null,
      ),
    );
  }

  /**
   * Shows a DICOM image as its plan says: Cornerstone, our 1-bit renderer, or a note.
   * Settles when the image is shown or has failed; failures stay in this pane.
   */
  async showDicom(object: ObjectInfo, bytes: Uint8Array): Promise<void> {
    this.teardown();
    const gen = this.generation;
    const plan = object.image;
    if (plan.kind === 'none') {
      const doc = object.document;
      this.note(
        plan.reason,
        'info',
        doc
          ? `Encapsulated document: ${doc.mimeType || 'unknown type'}, ${doc.length.toLocaleString()} bytes. Select Encapsulated Document (0042,0011) to see its bytes.`
          : 'Tags and bytes are available in the other panes.',
      );
      return;
    }
    if (plan.kind === 'bitmap') {
      const data = bytes.subarray(plan.pixels.start, plan.pixels.end);
      const n = plan.rows * plan.columns;
      this.showRaster(
        {
          frames: plan.frames,
          volumes: 1,
          read: (f) => {
            const bits = unpackBits(data, f * n, n);
            return {
              width: plan.columns,
              height: plan.rows,
              data: Float32Array.from(bits),
              min: 0,
              max: 1,
            };
          },
          pixelSize: [1, 1],
          flipY: false,
          orientationNote: '1-bit',
        },
        'frame',
      );
      this.onStatus('rendered', 0);
      return;
    }

    const viewport = h('div', { class: 'viewport' });
    const overlayCanvas = h('canvas', { class: 'overlay-layer' });
    replace(this.body, viewport, overlayCanvas);
    this.info.textContent = 'Decoding…';
    const started = performance.now();
    const overlays = object.overlays.flatMap((o) => {
      if (!o.data || o.rows < 1 || o.columns < 1) return [];
      return [
        {
          bits: unpackBits(bytes.subarray(o.data.start, o.data.end), 0, o.rows * o.columns),
          rows: o.rows,
          columns: o.columns,
          origin: o.origin,
        },
      ];
    });
    this.decodes++;
    try {
      const { showDicom } = await import('./cornerstoneView');
      const handle = await showDicom(
        viewport,
        overlayCanvas,
        bytes,
        plan.frames,
        this.workerUri,
        overlays,
        (s) => {
          if (gen === this.generation) this.describe(s);
        },
      );
      if (gen !== this.generation) {
        handle.destroy();
        return;
      }
      this.cornerstone = handle;
      this.frameBar.configure(plan.frames, 1, 'frame');
      this.toolbar.attach();
      this.overlayButton.hidden = overlays.length === 0;
      this.overlayButton.setAttribute('aria-pressed', String(this.overlaysOn));
      this.onStatus('rendered', performance.now() - started);
    } catch (error) {
      if (gen !== this.generation) return;
      this.note(
        'Image unavailable: the pixels could not be decoded.',
        'error',
        error instanceof Error ? error.message : String(error),
      );
      this.onStatus('failed', performance.now() - started);
    } finally {
      // Cornerstone's duplicate rejections can arrive just after the promise settles;
      // keep absorbing briefly, then let every later rejection count as an error again.
      this.decodes--;
      this.absorbUntil = performance.now() + 2000;
    }
  }

  /** Shows a NIfTI volume (`bytes` is the inflated stream) with our renderer. */
  showNifti(bytes: Uint8Array): void {
    this.teardown();
    const parsed = parseNiftiHeader(bytes, true);
    if (!parsed.ok) {
      this.note('Image unavailable.', 'error', parsed.error);
      this.onStatus('failed', 0);
      return;
    }
    const reader = niftiVoxelReader(parsed.header, bytes);
    if (!reader.ok) {
      this.note('Image unavailable.', 'error', reader.error);
      this.onStatus('failed', 0);
      return;
    }
    // Exact values from the header, not the rounded text shown in the tags pane.
    const pixdim = numbers(parsed.header, 'pixdim');
    const size = (v: number | undefined): number =>
      v !== undefined && Number.isFinite(v) && v > 0 ? v : 1;
    this.showRaster(
      {
        frames: reader.geometry.slices,
        volumes: reader.geometry.volumes,
        read: (f, v) => reader.readSlice(f, v),
        pixelSize: [size(pixdim[1]), size(pixdim[2])],
        flipY: true,
        orientationNote: 'voxel order, not reoriented',
        storedWindow: {
          low: numbers(parsed.header, 'cal_min')[0] ?? Number.NaN,
          high: numbers(parsed.header, 'cal_max')[0] ?? Number.NaN,
        },
      },
      'slice',
    );
    this.onStatus('rendered', 0);
  }

  private showRaster(
    source: ConstructorParameters<typeof RasterView>[1],
    unit: 'slice' | 'frame',
  ): void {
    const container = h('div', { class: 'viewport' });
    replace(this.body, container);
    this.frameBar.configure(source.frames, source.volumes, unit);
    this.raster = new RasterView(container, source, (s) => {
      this.frameBar.update(s.frame, s.volume);
      this.toolbar.showWindow(s.center, s.width);
      const vol = source.volumes > 1 ? ` · volume ${s.volume + 1}/${source.volumes}` : '';
      this.info.textContent = `${unit} ${s.frame + 1}/${source.frames}${vol} · W ${fmt(s.width)} L ${fmt(s.center)} · zoom ${s.zoom.toFixed(2)} · ${source.orientationNote}`;
    });
    this.toolbar.attach();
  }

  private describe(s: ViewState): void {
    this.frameBar.update(s.frame);
    this.toolbar.showWindow(s.center, s.width);
    const frame = s.frames > 1 ? `frame ${s.frame + 1}/${s.frames} · ` : '';
    this.info.textContent = `${frame}W ${fmt(s.width)} L ${fmt(s.center)} · zoom ${s.zoom.toFixed(2)}${s.cpu ? ' · CPU rendering' : ''}`;
  }

  /**
   * Clears the pane. Bumping the generation makes any decode still in flight drop its
   * result when it lands.
   */
  private teardown(): void {
    this.generation++;
    this.cornerstone?.destroy();
    this.cornerstone = null;
    this.raster?.destroy();
    this.raster = null;
    this.overlayButton.hidden = true;
    this.frameBar.hide();
    this.toolbar.hide();
  }
}
