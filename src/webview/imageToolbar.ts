/**
 * The image toolbar: the same tools for DICOM (Cornerstone) and NIfTI (our renderer).
 * Choose what a left drag does (contrast, pan or zoom), zoom in and out, type an exact
 * window/level or fit it to the image, and reset. Middle drag always pans and right drag
 * always zooms, whatever the left tool is.
 */
import { formatWindowValue as fmt } from '../core/windowLevel';
import { h } from './dom';

export type LeftTool = 'contrast' | 'pan' | 'zoom';

/** What each renderer offers the toolbar. */
export interface ImageControls {
  readonly zoomBy: (factor: number) => void;
  readonly setWindow: (center: number, width: number) => void;
  readonly fitWindow: () => void;
  readonly setLeftTool: (tool: LeftTool) => void;
  readonly reset: () => void;
}

const ZOOM_STEP = 1.25;
const TOOLS: readonly { readonly id: LeftTool; readonly label: string; readonly title: string }[] =
  [
    {
      id: 'contrast',
      label: 'Contrast',
      title: 'Left drag changes window/level (contrast and brightness)',
    },
    { id: 'pan', label: 'Pan', title: 'Left drag moves the image' },
    { id: 'zoom', label: 'Zoom', title: 'Left drag zooms (drag up to zoom in)' },
  ];

export class ImageToolbar {
  readonly element = h('div', {
    class: 'image-toolbar',
    role: 'toolbar',
    aria: { label: 'Image tools' },
  });
  private tool: LeftTool = 'contrast';
  private readonly toolButtons: [LeftTool, HTMLButtonElement][];
  private readonly width = h('input', {
    class: 'wl-input',
    title: 'Window width: the range of values shown (contrast)',
  });
  private readonly level = h('input', {
    class: 'wl-input',
    title: 'Window level: the value at mid-grey (brightness)',
  });

  constructor(private readonly controls: () => ImageControls | null) {
    this.toolButtons = TOOLS.map(({ id, label, title }) => {
      const button = h('button', { class: 'tool', title, dataset: { tool: id } }, label);
      button.addEventListener('click', () => {
        this.setTool(id);
      });
      return [id, button];
    });
    const button = (
      label: string,
      title: string,
      action: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const b = h('button', { class: 'tool', title, dataset: { tool: action } }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    for (const input of [this.width, this.level]) {
      input.type = 'number';
      input.step = 'any';
      input.addEventListener('change', () => {
        this.applyWindow();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.applyWindow();
      });
    }
    this.width.setAttribute('aria-label', 'Window width');
    this.level.setAttribute('aria-label', 'Window level');
    this.element.append(
      h(
        'span',
        { class: 'tool-group', role: 'group', aria: { label: 'Left drag' } },
        ...this.toolButtons.map(([, b]) => b),
      ),
      h(
        'span',
        { class: 'tool-group', role: 'group', aria: { label: 'Zoom' } },
        button('−', 'Zoom out', 'zoomOut', () => this.controls()?.zoomBy(1 / ZOOM_STEP)),
        button('+', 'Zoom in', 'zoomIn', () => this.controls()?.zoomBy(ZOOM_STEP)),
      ),
      h(
        'span',
        { class: 'tool-group', role: 'group', aria: { label: 'Window/level' } },
        h('span', { class: 'wl-label' }, 'W'),
        this.width,
        h('span', { class: 'wl-label' }, 'L'),
        this.level,
        button('Auto', 'Fit the window to the image’s minimum and maximum', 'auto', () =>
          this.controls()?.fitWindow(),
        ),
      ),
      button('Reset', 'Reset window/level, zoom and pan (R)', 'reset', () =>
        this.controls()?.reset(),
      ),
    );
    this.element.hidden = true;
    this.markTool();
  }

  /** Shows the toolbar for a newly shown image and applies the chosen left tool to it. */
  attach(): void {
    this.element.hidden = false;
    this.controls()?.setLeftTool(this.tool);
  }

  /** Hides the toolbar while no image is shown. */
  hide(): void {
    this.element.hidden = true;
  }

  /** Follows the renderer; leaves a box alone while the user is typing in it. */
  showWindow(center: number, width: number): void {
    if (document.activeElement !== this.width) this.width.value = fmt(width);
    if (document.activeElement !== this.level) this.level.value = fmt(center);
  }

  private setTool(tool: LeftTool): void {
    this.tool = tool;
    this.markTool();
    this.controls()?.setLeftTool(tool);
  }

  private markTool(): void {
    for (const [id, b] of this.toolButtons)
      b.setAttribute('aria-pressed', String(id === this.tool));
  }

  private applyWindow(): void {
    const width = Number(this.width.value);
    const level = Number(this.level.value);
    if (
      this.width.value !== '' &&
      this.level.value !== '' &&
      Number.isFinite(width) &&
      Number.isFinite(level) &&
      width > 0
    ) {
      this.controls()?.setWindow(level, width);
    }
  }
}
