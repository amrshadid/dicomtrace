/**
 * The hex pane: physical file bytes, paged from the host on demand, with the selected
 * element's ranges highlighted. Offsets are always physical file offsets.
 */
import {
  BYTES_PER_ROW,
  PAGE_SIZE,
  formatOffset,
  pageOf,
  parseOffset,
  rowCount,
} from '../core/hexPaging';
import { rangeContains as contains } from '../core/ranges';
import { h, replace } from './dom';
import type { Selection } from './tagsPane';
import { unavailableText } from './tagsPane';

const ROW_PX = 20;
/** Browsers cap element heights; past this the scrollbar is scaled. */
const MAX_SCROLL_PX = 8_000_000;
/** Pages kept in memory (64 KiB each). */
const CACHE_PAGES = 64;

export interface HexPaneHost {
  readonly requestPage: (page: number) => void;
  readonly onByteClick: (offset: number) => void;
  readonly onHover: (offset: number | null) => void;
}

const printable = (b: number): string => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

export class HexPane {
  private readonly scroller = h('div', {
    class: 'hex-scroll pane-body',
    tabIndex: 0,
    aria: { label: 'File bytes' },
  });
  private readonly spacer = h('div', { class: 'hex-spacer' });
  private readonly note = h('div');
  /** Shows why a page couldn't be read; separate from the selection's notes. */
  private readonly readError = h('div');
  private readonly title = h('span', { class: 'image-info' });
  private readonly gotoBox = h('input', {
    class: 'goto',
    title: 'Go to offset (decimal or 0x hex)',
  });
  private fileSize = 0;
  private readonly pages = new Map<number, Uint8Array>();
  private readonly pending = new Set<number>();
  /** Pages the host refused or failed to read: not asked for again until the next reset. */
  private readonly failed = new Set<number>();
  private selection: Selection | null = null;
  private frame = 0;

  constructor(
    head: HTMLElement,
    body: HTMLElement,
    private readonly host: HexPaneHost,
  ) {
    this.gotoBox.placeholder = 'Go to offset';
    this.gotoBox.setAttribute('aria-label', 'Go to offset');
    const legend = h(
      'span',
      { class: 'hex-legend', aria: { hidden: 'true' } },
      h('span', { class: 'lg-tag' }, 'tag'),
      h('span', { class: 'lg-vr' }, 'VR'),
      h('span', { class: 'lg-len' }, 'length'),
      h('span', { class: 'lg-val' }, 'value'),
      h('span', { class: 'lg-delim' }, 'delimiter'),
    );
    replace(
      head,
      h('span', { class: 'label' }, 'Bytes'),
      this.title,
      h('span', { class: 'grow' }),
      legend,
      this.gotoBox,
    );
    this.scroller.append(this.spacer);
    body.replaceWith(this.scroller);
    this.scroller.before(this.note, this.readError);
    this.scroller.addEventListener('scroll', () => {
      this.schedule();
    });
    new ResizeObserver(() => {
      this.schedule();
    }).observe(this.scroller);
    this.gotoBox.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const offset = parseOffset(this.gotoBox.value);
      if (offset !== null && offset < this.fileSize) {
        this.scrollTo(offset);
        this.host.onByteClick(offset);
      }
    });
    this.spacer.addEventListener('click', (e) => {
      const offset = (e.target as HTMLElement).dataset.o;
      if (offset !== undefined) this.host.onByteClick(Number(offset));
    });
    this.spacer.addEventListener('mouseover', (e) => {
      const offset = (e.target as HTMLElement).dataset.o;
      this.host.onHover(offset === undefined ? null : Number(offset));
    });
    this.spacer.addEventListener('mouseleave', () => {
      this.host.onHover(null);
    });
  }

  /** Starts over for a new file or revision. */
  reset(fileSize: number): void {
    this.fileSize = fileSize;
    this.pages.clear();
    this.pending.clear();
    this.failed.clear();
    replace(this.readError);
    this.selection = null;
    this.title.textContent = `${fileSize.toLocaleString()} bytes`;
    replace(this.note);
    this.spacer.style.height = `${Math.min(rowCount(fileSize) * ROW_PX, MAX_SCROLL_PX)}px`;
    this.scroller.scrollTop = 0;
    this.schedule();
  }

  /** Bytes arrived from the host. */
  setPage(offset: number, data: Uint8Array): void {
    const page = pageOf(offset);
    this.pending.delete(page);
    this.pages.set(page, data);
    while (this.pages.size > CACHE_PAGES) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
    this.schedule();
  }

  /** The host could not read a page: show why, and don't ask for it again. */
  pageFailed(offset: number, message: string): void {
    const page = pageOf(offset);
    this.pending.delete(page);
    this.failed.add(page);
    replace(
      this.readError,
      h(
        'div',
        { class: 'unavailable' },
        h('strong', {}, `Bytes at ${formatOffset(offset)}: ${message}`),
      ),
    );
  }

  /** Highlights a selection and scrolls to its first byte; explains ranges it can't show. */
  setSelection(selection: Selection | null, scroll: boolean): void {
    this.selection = selection;
    const notes: Node[] = [];
    if (selection) {
      if (selection.whole.kind === 'unavailable') {
        notes.push(
          h(
            'div',
            { class: 'unavailable' },
            h(
              'strong',
              {},
              `${selection.label}: bytes unavailable — ${unavailableText(selection.whole)}. No range is highlighted.`,
            ),
          ),
        );
      } else {
        const missing = selection.parts.filter((p) => p.range.kind === 'unavailable');
        if (missing.length) {
          notes.push(
            h(
              'div',
              { class: 'unavailable' },
              h(
                'strong',
                {},
                missing.map((p) => `${p.kind}: ${unavailableText(p.range)}`).join(' · '),
              ),
            ),
          );
        }
        if (scroll) this.scrollTo(selection.whole.range.start);
      }
    }
    replace(this.note, ...notes);
    this.schedule();
  }

  /** Scrolls so `offset` is in view. */
  scrollTo(offset: number): void {
    const rows = rowCount(this.fileSize);
    const scale = Math.max(1, (rows * ROW_PX) / MAX_SCROLL_PX);
    const target = (Math.floor(offset / BYTES_PER_ROW) * ROW_PX) / scale;
    const view = this.scroller.clientHeight;
    if (target < this.scroller.scrollTop || target > this.scroller.scrollTop + view - ROW_PX * 2) {
      this.scroller.scrollTop = Math.max(0, target - view / 3);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private byteAt(offset: number): number | undefined {
    return this.pages.get(pageOf(offset))?.[offset % PAGE_SIZE];
  }

  private draw(): void {
    const rows = rowCount(this.fileSize);
    const scale = Math.max(1, (rows * ROW_PX) / MAX_SCROLL_PX);
    const top = this.scroller.scrollTop;
    const first = Math.floor((top * scale) / ROW_PX);
    const visible = Math.ceil(this.scroller.clientHeight / ROW_PX) + 1;
    const last = Math.min(rows, first + visible);

    // Ask for the pages on screen (and only those).
    const firstOffset = first * BYTES_PER_ROW;
    const lastOffset = Math.max(firstOffset, Math.min(this.fileSize, last * BYTES_PER_ROW) - 1);
    for (let p = pageOf(firstOffset); p <= pageOf(lastOffset); p++) {
      if (
        !this.pages.has(p) &&
        !this.pending.has(p) &&
        !this.failed.has(p) &&
        p * PAGE_SIZE < this.fileSize
      ) {
        this.pending.add(p);
        this.host.requestPage(p);
      }
    }

    const sel = this.selection;
    const whole = sel?.whole.kind === 'physical' ? sel.whole.range : null;
    const parts = (sel?.parts ?? []).flatMap((p) =>
      p.range.kind === 'physical' ? [{ kind: p.kind, range: p.range.range }] : [],
    );
    const classesOf = (o: number): string => {
      if (!whole || !contains(whole, o)) return '';
      let c = ' sel';
      for (const p of parts)
        if (contains(p.range, o))
          c += p.kind === 'value' ? '' : ` sel-${p.kind === 'delimiter' ? 'delim' : p.kind}`;
      if (o === whole.start) c += ' sel-start';
      return c;
    };

    const nodes: HTMLElement[] = [];
    for (let row = first; row < last; row++) {
      const start = row * BYTES_PER_ROW;
      const hex = h('span', { class: 'hex-bytes' });
      const ascii = h('span', { class: 'hex-ascii' });
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const o = start + i;
        if (o >= this.fileSize) break;
        const b = this.byteAt(o);
        const cls = classesOf(o) + (b === undefined ? ' pending' : '');
        const bx = h(
          'span',
          { class: `hex-b${i === 8 ? ' gap' : ''}${cls}`, dataset: { o: String(o) } },
          b === undefined ? '··' : b.toString(16).toUpperCase().padStart(2, '0'),
        );
        const ax = h(
          'span',
          { class: `hex-a${cls}`, dataset: { o: String(o) } },
          b === undefined ? '·' : printable(b),
        );
        hex.append(bx);
        ascii.append(ax);
      }
      const line = h(
        'div',
        { class: 'hex-row' },
        h('span', { class: 'hex-offset' }, formatOffset(start)),
        hex,
        ascii,
      );
      line.style.top = `${top + (row - first) * ROW_PX - ((top * scale) % ROW_PX) / scale}px`;
      nodes.push(line);
    }
    replace(this.spacer, ...nodes);
  }
}
