/**
 * Our own canvas renderer: NIfTI slices and 1-bit DICOM frames (SEG masks).
 * It draws one 2D frame at a time with window/level, zoom and pan, the same on GPU,
 * CPU and CI. Controls match the Cornerstone view: left-drag W/L, middle-drag pan,
 * right-drag zoom, wheel for frames (slices).
 */
import type { Slice } from '../core/niftiVoxels';
import { clampZoom, dragWindow, dragZoom, initialWindow } from '../core/windowLevel';
import type { LeftTool } from './imageToolbar';

export interface RasterSource {
  /** Frames (slices) per volume. */
  readonly frames: number;
  /** Volumes (NIfTI t); 1 otherwise. */
  readonly volumes: number;
  readonly read: (frame: number, volume: number) => Slice;
  /** Physical size of a pixel (x, y), for aspect; [1, 1] when unknown. */
  readonly pixelSize: readonly [number, number];
  /** Flip vertically for display (NIfTI j axis points up). */
  readonly flipY: boolean;
  /** Short note on orientation, shown with the frame info. */
  readonly orientationNote: string;
  /** The file's own display window (NIfTI cal_min/cal_max), when it gives one. */
  readonly storedWindow?: { readonly low: number; readonly high: number };
}

export interface RasterState {
  readonly frame: number;
  readonly volume: number;
  readonly center: number;
  readonly width: number;
  readonly zoom: number;
}

export class RasterView {
  private readonly canvas = document.createElement('canvas');
  private readonly buffer = document.createElement('canvas');
  private frame: number;
  private volume = 0;
  private slice: Slice;
  private center = 0;
  private width = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { button: number; x: number; y: number } | null = null;
  private leftTool: LeftTool = 'contrast';
  private readonly resize: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly source: RasterSource,
    private readonly onChange: (state: RasterState) => void,
  ) {
    this.canvas.className = 'raster';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      'Image. Wheel or arrow keys change the slice; drag to adjust.',
    );
    container.append(this.canvas);
    this.frame = Math.floor(source.frames / 2);
    this.slice = source.read(this.frame, 0);
    this.autoWindow();
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      // A left drag does what the toolbar says; middle always pans, right always zooms.
      const left = { contrast: 0, pan: 1, zoom: 2 }[this.leftTool];
      this.drag = { button: e.button === 0 ? left : e.button, x: e.clientX, y: e.clientY };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointers can't be captured; dragging still works.
      }
      this.canvas.focus();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.onDrag(e);
    });
    // A drag ends on release, or when the browser takes the pointer away (a system
    // gesture, the window losing focus): otherwise the next move would keep dragging.
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(type, () => {
        this.drag = null;
      });
    }
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setFrame(this.frame + (e.deltaY > 0 ? 1 : -1));
      },
      { passive: false },
    );
    this.canvas.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    this.resize = new ResizeObserver(() => {
      this.draw();
    });
    this.resize.observe(container);
    this.render();
  }

  destroy(): void {
    this.resize.disconnect();
    this.canvas.remove();
  }

  reset(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.autoWindow();
    this.render();
  }

  setLeftTool(tool: LeftTool): void {
    this.leftTool = tool;
  }

  zoomBy(factor: number): void {
    this.zoom = clampZoom(this.zoom * factor);
    this.draw();
    this.report();
  }

  setWindow(center: number, width: number): void {
    this.center = center;
    this.width = Math.max(width, Number.EPSILON);
    this.render();
  }

  /** Fits the window to this slice's minimum and maximum. */
  fitWindow(): void {
    const w = initialWindow(this.slice.min, this.slice.max);
    this.setWindow(w.center, w.width);
  }

  /** Shows volume `volume` (4D), keeping the current slice. */
  setVolume(volume: number): void {
    this.setFrame(this.frame, volume);
  }

  setFrame(frame: number, volume = this.volume): void {
    const f = Math.max(0, Math.min(this.source.frames - 1, frame));
    const v = Math.max(0, Math.min(this.source.volumes - 1, volume));
    if (f === this.frame && v === this.volume) return;
    this.frame = f;
    this.volume = v;
    this.slice = this.source.read(f, v);
    this.render();
  }

  private autoWindow(): void {
    const w = initialWindow(this.slice.min, this.slice.max, this.source.storedWindow);
    this.width = w.width;
    this.center = w.center;
  }

  private onDrag(e: PointerEvent): void {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag = { ...this.drag, x: e.clientX, y: e.clientY };
    if (this.drag.button === 0) {
      // The same response as Cornerstone's window/level tool on DICOM images.
      const w = dragWindow(
        { center: this.center, width: this.width },
        dx,
        dy,
        this.slice.max - this.slice.min,
      );
      this.width = w.width;
      this.center = w.center;
      this.render();
    } else if (this.drag.button === 1) {
      this.panX += dx;
      this.panY += dy;
      this.draw();
    } else if (this.drag.button === 2) {
      this.zoom = dragZoom(this.zoom, dy);
      this.draw();
      this.report();
    }
  }

  private onKey(e: KeyboardEvent): void {
    const keys: Record<string, () => void> = {
      ArrowUp: () => {
        this.setFrame(this.frame + 1);
      },
      ArrowDown: () => {
        this.setFrame(this.frame - 1);
      },
      ArrowRight: () => {
        this.setFrame(this.frame + 1);
      },
      ArrowLeft: () => {
        this.setFrame(this.frame - 1);
      },
      ']': () => {
        this.setFrame(this.frame, this.volume + 1);
      },
      '[': () => {
        this.setFrame(this.frame, this.volume - 1);
      },
      r: () => {
        this.reset();
      },
      R: () => {
        this.reset();
      },
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  /** Window/level the slice into the 8-bit buffer, then draw. */
  private render(): void {
    const { width, height, data } = this.slice;
    this.buffer.width = width;
    this.buffer.height = height;
    const ctx = this.buffer.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    const lo = this.center - this.width / 2;
    const scale = 255 / this.width;
    for (let y = 0; y < height; y++) {
      const srcRow = this.source.flipY ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const v = data[srcRow * width + x] ?? 0;
        const g = Math.max(0, Math.min(255, (v - lo) * scale));
        const i = (y * width + x) * 4;
        img.data[i] = g;
        img.data[i + 1] = g;
        img.data[i + 2] = g;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.draw();
    this.report();
  }

  private report(): void {
    this.onChange({
      frame: this.frame,
      volume: this.volume,
      center: this.center,
      width: this.width,
      zoom: this.zoom,
    });
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const hgt = this.container.clientHeight;
    if (!w || !hgt) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hgt * dpr);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const [sx, sy] = this.source.pixelSize;
    const physW = this.slice.width * sx;
    const physH = this.slice.height * sy;
    const fit = Math.min(w / physW, hgt / physH) * this.zoom;
    const drawW = physW * fit;
    const drawH = physH * fit;
    const x0 = (w - drawW) / 2 + this.panX;
    const y0 = (hgt - drawH) / 2 + this.panY;
    // Smooth like Cornerstone's default (linear) interpolation, so both renderers look alike.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.buffer, x0 * dpr, y0 * dpr, drawW * dpr, drawH * dpr);
  }
}
