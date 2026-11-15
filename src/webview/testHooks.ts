/**
 * Integration-test hooks. Active only when the host renders the page with
 * data-test-hooks="1", which it does only under the test runner (DT_TEST_HOOKS=1).
 * They report what is on screen and perform user actions, so tests can check the real
 * UI in real VS Code. In normal use this module does nothing.
 */

export interface TestControls {
  readonly select: (id: string) => void;
  readonly clickByte: (offset: number) => void;
  readonly post: (message: unknown) => void;
}

const violations: string[] = [];
const errors: string[] = [];

function canvasStats(canvas: HTMLCanvasElement | null): Record<string, number> | null {
  if (!canvas?.width || !canvas.height) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  let opaque = 0;
  let hash = 2166136261;
  const values = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] ?? 0;
    if (v > 0) lit++;
    if ((data[i + 3] ?? 0) > 0) opaque++;
    values.add(v);
    hash = Math.imul(hash ^ v, 16777619) >>> 0;
  }
  const pixels = data.length / 4;
  return {
    width: canvas.width,
    height: canvas.height,
    litFraction: lit / pixels,
    opaque,
    distinct: values.size,
    hash,
  };
}

const text = (sel: string): string => document.querySelector(sel)?.textContent.trim() ?? '';
const texts = (sel: string): string[] =>
  [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());

function snapshot(): Record<string, unknown> {
  const imagePane = document.querySelectorAll('.pane')[0];
  const canvases = [...(imagePane?.querySelectorAll('canvas') ?? [])];
  const imageCanvas = canvases.find((c) => !c.classList.contains('overlay-layer')) ?? null;
  const overlay = canvases.find((c) => c.classList.contains('overlay-layer')) ?? null;
  const overlayButton = [...(imagePane?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === 'Overlays',
  );
  return {
    title: texts('.titlebar > *'),
    banners: texts('.banner'),
    tagRows: document.querySelectorAll('.tag-row').length,
    tagSections: texts('.tag-section'),
    selectedRow: text('.tag-row.selected'),
    status: text('.statusbar'),
    hexRows: document.querySelectorAll('.hex-row').length,
    hexFirstRow: text('.hex-row'),
    hexSelectedBytes: document.querySelectorAll('.hex-b.sel').length,
    hexTagBytes: document.querySelectorAll('.hex-b.sel-tag').length,
    hexPendingBytes: document.querySelectorAll('.hex-b.pending').length,
    hexNote: text('.unavailable'),
    imageInfo: text('.pane:first-child .image-info'),
    imageNote: text('.image-note'),
    image: canvasStats(imageCanvas),
    overlay: canvasStats(overlay),
    overlayButtonVisible: overlayButton ? !overlayButton.hidden : false,
    panes: [...document.querySelectorAll<HTMLElement>('.pane')].map((p) => !p.hidden),
    frameBar: (() => {
      const bar = document.querySelector<HTMLElement>('.frame-bar');
      const slider = bar?.querySelector<HTMLInputElement>('.frame-slider:not(.volume-slider)');
      return {
        visible: bar ? !bar.hidden : false,
        value: slider ? Number(slider.value) : 0,
        max: slider ? Number(slider.max) : 0,
        label: bar?.querySelector('.frame-label')?.textContent ?? '',
      };
    })(),
    violations: [...violations],
    errors: [...errors],
  };
}

/** Installs the hooks when the page was rendered for tests. */
export function installTestHooks(controls: TestControls): void {
  if (document.body.dataset.testHooks !== '1') return;
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.violatedDirective} ${e.blockedURI}`);
  });
  addEventListener('error', (e) => {
    errors.push(e.message);
  });
  addEventListener('unhandledrejection', (e) => {
    // Rejections the image pane absorbed (Cornerstone duplicates) are not errors.
    queueMicrotask(() => {
      if (!e.defaultPrevented) errors.push(String(e.reason));
    });
  });
  addEventListener('message', (event: MessageEvent<unknown>) => {
    const m = event.data as { type?: unknown; token?: unknown; action?: Record<string, unknown> };
    if (m.type !== 'test' || typeof m.token !== 'string') return;
    void perform(m.token, m.action ?? {}, controls);
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The element in the image pane that receives mouse input. */
function imageTarget(): HTMLElement | null {
  const pane = document.querySelector('.pane');
  return (
    pane?.querySelector<HTMLElement>('canvas.raster') ??
    pane?.querySelector<HTMLElement>('.viewport') ??
    null
  );
}

/**
 * A real-looking drag: press, wait out Cornerstone's double-click tolerance, move in
 * steps, release. Sends both pointer events (our renderer) and mouse events
 * (Cornerstone's tools and our zoom handler).
 */
async function drag(target: HTMLElement, button: number, dx: number, dy: number): Promise<void> {
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const buttons = button === 0 ? 1 : button === 1 ? 4 : 2;
  const at = (i: number) => ({
    bubbles: true,
    cancelable: true,
    button,
    buttons,
    clientX: x + (dx * i) / 10,
    clientY: y + (dy * i) / 10,
    pointerId: 1,
  });
  target.dispatchEvent(new PointerEvent('pointerdown', at(0)));
  target.dispatchEvent(new MouseEvent('mousedown', at(0)));
  await sleep(500);
  for (let i = 1; i <= 10; i++) {
    target.dispatchEvent(new PointerEvent('pointermove', at(i)));
    document.dispatchEvent(new MouseEvent('mousemove', at(i)));
    await sleep(20);
  }
  target.dispatchEvent(new PointerEvent('pointerup', at(10)));
  document.dispatchEvent(new MouseEvent('mouseup', at(10)));
}

async function perform(
  token: string,
  action: Record<string, unknown>,
  controls: TestControls,
): Promise<void> {
  if (action.kind === 'select' && typeof action.id === 'string') controls.select(action.id);
  if (action.kind === 'clickByte' && typeof action.offset === 'number')
    controls.clickByte(action.offset);
  if (action.kind === 'togglePane' && typeof action.name === 'string') {
    [...document.querySelectorAll<HTMLButtonElement>('.pane-toggle')]
      .find((b) => b.textContent.toLowerCase() === action.name)
      ?.click();
  }
  if (action.kind === 'setFrame' && typeof action.index === 'number') {
    const slider = document.querySelector<HTMLInputElement>('.frame-slider:not(.volume-slider)');
    if (slider) {
      slider.value = String(action.index);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(400);
    }
  }
  if (action.kind === 'clickTool' && typeof action.id === 'string') {
    document.querySelector<HTMLButtonElement>(`[data-tool="${action.id}"]`)?.click();
    await sleep(250);
  }
  if (
    action.kind === 'setWindow' &&
    typeof action.width === 'number' &&
    typeof action.level === 'number'
  ) {
    const [w, l] = [...document.querySelectorAll<HTMLInputElement>('.wl-input')];
    if (w && l) {
      w.value = String(action.width);
      l.value = String(action.level);
      l.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
    }
  }
  if (action.kind === 'toggleGrouping') {
    document.querySelector<HTMLButtonElement>('.tags-grouping')?.click();
  }
  if (action.kind === 'play') {
    const play = document.querySelector<HTMLButtonElement>('.frame-play');
    play?.click();
    await sleep(typeof action.ms === 'number' ? action.ms : 800);
    play?.click();
    await sleep(200);
  }
  const target = imageTarget();
  if (action.kind === 'wheel' && typeof action.deltaY === 'number' && target) {
    const r = target.getBoundingClientRect();
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: action.deltaY,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
    await sleep(400);
  }
  if (action.kind === 'drag' && target) {
    const { button, dx, dy } = action;
    if (typeof button === 'number' && typeof dx === 'number' && typeof dy === 'number') {
      await drag(target, button, dx, dy);
      // Let the last render land: CPU rendering on a slow machine can lag the input.
      await sleep(500);
    }
  }
  // Let the panes paint before reading them back.
  requestAnimationFrame(() => {
    setTimeout(() => {
      controls.post({ type: 'testState', token, state: snapshot() });
    }, 150);
  });
}
