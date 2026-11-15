/**
 * DICOM image display with Cornerstone3D 5.18.3.
 * Loaded lazily by the image pane, as its own chunk.
 *
 * Workarounds, each verified in a real VS Code webview:
 * 1. Zoom is our own right-drag handler calling viewport.setZoom: Cornerstone's
 *    ZoomTool collapses the image on the CPU path at devicePixelRatio ≠ 1.
 * 2. Frames change with our own wheel handler: StackScrollTool receives wheel events in
 *    a webview but does not scroll.
 * 3. Decode errors don't always reject setStack() (GPU path), so loading races it
 *    against the load-error events and a timeout.
 */
import {
  Enums,
  EVENTS,
  RenderingEngine,
  eventTarget,
  getShouldUseCPURendering,
  getWebWorkerManager,
  init as coreInit,
  utilities,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import { cache } from '@cornerstonejs/core';
import { init as loaderInit, wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  Enums as ToolEnums,
  PanTool,
  ToolGroupManager,
  WindowLevelTool,
  addTool,
  init as toolsInit,
} from '@cornerstonejs/tools';
import { clampZoom, dragZoom } from '../core/windowLevel';
import type { ImageControls, LeftTool } from './imageToolbar';

/** Each viewer gets its own ids, so an older decode can never collide with a newer one. */
let viewers = 0;
// The tool classes type their static toolName loosely; name them once, as strings.
const WINDOW_LEVEL = String(WindowLevelTool.toolName);
const PAN = String(PanTool.toolName);
const LOAD_TIMEOUT_MS = 15_000;

let initialised: Promise<void> | null = null;

/**
 * Webviews only allow single-file workers from blob: or data: URLs, so the decode
 * worker is fetched from the extension and started from a Blob URL.
 * https://code.visualstudio.com/api/extension-guides/webview#using-web-workers
 */
async function workerBlobUrl(workerUri: string): Promise<string> {
  const response = await fetch(workerUri);
  if (!response.ok) throw new Error('The image decoder could not be loaded.');
  // Never revoked: the worker manager may start a new worker from it at any time.
  return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
}

function init(workerUri: string): Promise<void> {
  if (initialised) return initialised;
  initialised = (async () => {
    // The fidelity indicator injects a <style> tag, which the strict CSP blocks. init()
    // deep-merges a partial config over its defaults, but its type asks for all of it.
    coreInit({
      dangerouslyDisableFidelityIndicator: true,
      rendering: { webGlContextCount: 1 },
    } as unknown as Parameters<typeof coreInit>[0]);
    const blobUrl = await workerBlobUrl(workerUri);
    // Internal detail (5.18.3): registerWorker returns early when the name exists, so
    // registering 'dicomImageLoader' before loaderInit() replaces the loader's own
    // `new Worker(new URL(..., import.meta.url))`, which a webview cannot start.
    getWebWorkerManager().registerWorker('dicomImageLoader', () => new Worker(blobUrl), {
      maxWorkerInstances: 1,
    });
    // The default v5 loader goes through dcmjs "naturalized" metadata, which finds no
    // frame data in implicit VR files (Pixel Data's VR is ambiguous there). The
    // dicom-parser path handles them; it is deprecated but present in 5.18.3. Pinned, and
    // covered by the implicit-VR acceptance test.
    loaderInit({ maxWebWorkers: 1, useLegacyMetadataProvider: true });
    toolsInit();
    addTool(WindowLevelTool);
    addTool(PanTool);
  })();
  // A failed start (the worker fetch, say) must not stick: the next image tries again.
  initialised.catch(() => {
    initialised = null;
  });
  return initialised;
}

export interface OverlayBitmap {
  readonly bits: Uint8Array;
  readonly rows: number;
  readonly columns: number;
  /** 1-based (row, column) of the overlay's first pixel in the image. */
  readonly origin: readonly [number, number];
}

export interface ViewState {
  readonly frame: number;
  readonly frames: number;
  readonly center: number;
  readonly width: number;
  readonly zoom: number;
  /** True when Cornerstone fell back to CPU rendering (no WebGL). */
  readonly cpu: boolean;
}

/** A shown DICOM image: the toolbar's controls plus what only the Cornerstone view has. */
export interface CornerstoneHandle extends ImageControls {
  /** Releases the viewport, its tools, its file and its cached frames. */
  readonly destroy: () => void;
  readonly setOverlaysVisible: (visible: boolean) => void;
  /** Shows frame `index` (zero-based, clamped). */
  readonly setFrame: (index: number) => void;
}

/**
 * A readable message from whatever Cornerstone rejects with: an Error, an object with a
 * `message`, or one wrapping the real error as `error` (the loader does each).
 */
function errorText(error: unknown, depth = 0): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null || depth > 3) return '';
  const { message, error: inner } = error as { message?: unknown; error?: unknown };
  if (typeof message === 'string' && message) return message;
  return errorText(inner, depth + 1);
}

/** `dicomfile:N` → N, the index wadouri's fileManager gave the Blob. */
function fileIndex(fileId: string): number | null {
  const n = Number(/^dicomfile:(\d+)$/.exec(fileId)?.[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Shows a DICOM file. Rejects (with a plain message) when the image cannot be decoded;
 * the caller shows that in the image pane only.
 */
export async function showDicom(
  element: HTMLDivElement,
  overlayCanvas: HTMLCanvasElement,
  bytes: Uint8Array,
  frames: number,
  workerUri: string,
  overlays: readonly OverlayBitmap[],
  onState: (state: ViewState) => void,
): Promise<CornerstoneHandle> {
  await init(workerUri);
  const fileId = wadouri.fileManager.add(new Blob([bytes as BlobPart]));
  // Multi-frame: one imageId per frame; `?frame=K` is 1-based (wadouri parseImageId).
  const imageIds =
    frames > 1 ? Array.from({ length: frames }, (_, i) => `${fileId}?frame=${i + 1}`) : [fileId];

  const n = ++viewers;
  const ENGINE_ID = `dt-engine-${n}`;
  const VIEWPORT_ID = `dt-viewport-${n}`;
  const TOOL_GROUP_ID = `dt-tools-${n}`;
  const engine = new RenderingEngine(ENGINE_ID);
  engine.enableElement({ viewportId: VIEWPORT_ID, type: Enums.ViewportType.STACK, element });
  const viewport = engine.getViewport<Types.IStackViewport>(VIEWPORT_ID);
  const group = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
  group?.addTool(WINDOW_LEVEL);
  group?.addTool(PAN);
  group?.setToolActive(WINDOW_LEVEL, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  });
  group?.setToolActive(PAN, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
  });
  group?.addViewport(VIEWPORT_ID, ENGINE_ID);

  const listeners: (() => void)[] = [];
  const listen = (
    target: HTMLElement | Window,
    type: string,
    fn: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, fn, options);
    listeners.push(() => {
      target.removeEventListener(type, fn, options);
    });
  };

  const destroy = (): void => {
    for (const off of listeners) off();
    ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
    engine.destroy();
    // Release only this viewer's file and cached frames. purge() would reset the file
    // index, so the next file would get the same `dicomfile:0` id and Cornerstone's caches
    // (keyed by id) would show the old pixels; it would also drop a newer viewer's file.
    for (const id of imageIds) {
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
    }
    const index = fileIndex(fileId);
    if (index !== null) {
      // The loader caches the parsed data set under the id without its scheme ("N").
      wadouri.dataSetCacheManager.unload(String(index));
      wadouri.fileManager.remove(index);
    }
  };

  // Workaround 3: race setStack against load errors and a timeout.
  let stopWatching = (): void => undefined;
  const failure = new Promise<never>((_, reject) => {
    const onError = (evt: Event): void => {
      const detail = (evt as CustomEvent<{ imageId?: unknown; error?: unknown } | undefined>)
        .detail;
      // The events are global: ignore failures of another viewer's images.
      if (typeof detail?.imageId === 'string' && !imageIds.includes(detail.imageId)) return;
      reject(new Error(errorText(detail?.error) || 'The image could not be decoded.'));
    };
    const timer = setTimeout(() => {
      reject(new Error(`The image did not decode within ${LOAD_TIMEOUT_MS / 1000} s.`));
    }, LOAD_TIMEOUT_MS);
    eventTarget.addEventListener(EVENTS.IMAGE_LOAD_ERROR, onError);
    eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, onError);
    stopWatching = () => {
      clearTimeout(timer);
      eventTarget.removeEventListener(EVENTS.IMAGE_LOAD_ERROR, onError);
      eventTarget.removeEventListener(EVENTS.IMAGE_LOAD_FAILED, onError);
    };
  });
  failure.catch(() => undefined);
  try {
    await Promise.race([viewport.setStack(imageIds, 0), failure]);
    viewport.render();
  } catch (error) {
    destroy();
    throw error;
  } finally {
    stopWatching();
  }

  let overlaysVisible = true;
  const overlayImages = overlays.map((o) => {
    const c = document.createElement('canvas');
    c.width = o.columns;
    c.height = o.rows;
    const ctx = c.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(o.columns, o.rows);
      for (let i = 0; i < o.bits.length; i++) {
        if (o.bits[i]) img.data.set([255, 216, 77, 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
    }
    return { overlay: o, canvas: c };
  });

  const drawOverlays = (): void => {
    const dpr = window.devicePixelRatio || 1;
    overlayCanvas.width = Math.round(element.clientWidth * dpr);
    overlayCanvas.height = Math.round(element.clientHeight * dpr);
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    // Overlay planes are drawn on frame 1 only: multi-frame overlays (60xx,0015 > 1) are
    // not supported, and a single-frame overlay belongs to the first frame.
    if (!overlaysVisible || viewport.getCurrentImageIdIndex() !== 0) return;
    const imageId = viewport.getCurrentImageId();
    for (const { overlay, canvas } of overlayImages) {
      const [r, c] = overlay.origin;
      const toCanvas = (x: number, y: number): Types.Point2 | null => {
        const world = utilities.imageToWorldCoords(imageId, [x, y]);
        return world ? viewport.worldToCanvas(world) : null;
      };
      const p0 = toCanvas(c - 1, r - 1);
      const p1 = toCanvas(c - 1 + overlay.columns, r - 1 + overlay.rows);
      if (!p0 || !p1) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, p0[0] * dpr, p0[1] * dpr, (p1[0] - p0[0]) * dpr, (p1[1] - p0[1]) * dpr);
    }
  };

  const report = (): void => {
    const voi = viewport.getProperties().voiRange;
    const width = voi ? voi.upper - voi.lower : 0;
    onState({
      frame: viewport.getCurrentImageIdIndex(),
      frames: imageIds.length,
      center: voi ? voi.lower + width / 2 : 0,
      width,
      zoom: viewport.getZoom(),
      cpu: getShouldUseCPURendering(),
    });
    drawOverlays();
  };
  listen(element, Enums.Events.IMAGE_RENDERED, report);

  // Panes can be resized or hidden and shown again; keep the canvas the size of its box.
  const resize = new ResizeObserver(() => {
    if (element.clientWidth > 0 && element.clientHeight > 0) engine.resize(true, true);
  });
  resize.observe(element);
  listeners.push(() => {
    resize.disconnect();
  });
  listen(element, Enums.Events.CAMERA_MODIFIED, drawOverlays);

  // Workaround 1: our own zoom on right-drag (and left-drag in Zoom mode).
  let leftTool: LeftTool = 'contrast';
  let zoomFrom: number | null = null;
  listen(element, 'contextmenu', (e) => {
    e.preventDefault();
  });
  listen(element, 'mousedown', (e) => {
    const button = (e as MouseEvent).button;
    if (button === 2 || (button === 0 && leftTool === 'zoom')) zoomFrom = (e as MouseEvent).clientY;
  });
  listen(window, 'mousemove', (e) => {
    if (zoomFrom === null) return;
    const y = (e as MouseEvent).clientY;
    viewport.setZoom(dragZoom(viewport.getZoom(), y - zoomFrom));
    zoomFrom = y;
    viewport.render();
  });
  for (const type of ['mouseup', 'blur']) {
    listen(window, type, () => {
      zoomFrom = null;
    });
  }

  // Workaround 2: our own frame scrolling on the wheel.
  listen(
    element,
    'wheel',
    (e) => {
      e.preventDefault();
      if (imageIds.length < 2) return;
      const next = Math.max(
        0,
        Math.min(
          imageIds.length - 1,
          viewport.getCurrentImageIdIndex() + ((e as WheelEvent).deltaY > 0 ? 1 : -1),
        ),
      );
      void viewport.setImageIdIndex(next);
    },
    { passive: false },
  );

  report();
  return {
    destroy,
    reset: () => {
      viewport.resetCamera();
      viewport.resetProperties();
      viewport.render();
    },
    setOverlaysVisible: (visible: boolean) => {
      overlaysVisible = visible;
      drawOverlays();
    },
    zoomBy: (factor: number) => {
      viewport.setZoom(clampZoom(viewport.getZoom() * factor));
      viewport.render();
    },
    setWindow: (center: number, width: number) => {
      const w = Math.max(width, Number.EPSILON);
      viewport.setProperties({ voiRange: { lower: center - w / 2, upper: center + w / 2 } });
      viewport.render();
    },
    fitWindow: () => {
      const image = viewport.getCornerstoneImage();
      const w = Math.max(image.maxPixelValue - image.minPixelValue, 1);
      viewport.setProperties({
        voiRange: { lower: image.minPixelValue, upper: image.minPixelValue + w },
      });
      viewport.render();
    },
    setLeftTool: (tool: LeftTool) => {
      leftTool = tool;
      // setToolPassive drops only a tool's left-button binding; Pan keeps the middle one.
      group?.setToolPassive(WINDOW_LEVEL);
      group?.setToolPassive(PAN);
      if (tool === 'contrast') {
        group?.setToolActive(WINDOW_LEVEL, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        });
      } else if (tool === 'pan') {
        group?.setToolActive(PAN, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] });
      }
    },
    setFrame: (index: number) => {
      const next = Math.max(0, Math.min(imageIds.length - 1, Math.trunc(index)));
      if (next !== viewport.getCurrentImageIdIndex()) void viewport.setImageIdIndex(next);
    },
  };
}
