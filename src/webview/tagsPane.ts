/**
 * The tags pane: the element tree (DICOM) or the header fields (NIfTI). Selecting a row
 * tells the rest of the view which bytes to show; it never reads bytes itself.
 */
import type { InspectedElement, Inspection } from '../core/inspection';
import type { NiftiView } from '../core/niftiModel';
import type { RangeOrReason } from '../core/ranges';
import { parseQuery, search } from '../core/search';
import { groupElements } from '../core/tagGroups';
import { h, replace } from './dom';

/** The parts of a selected entry the hex pane highlights. */
export interface SelectionPart {
  readonly kind: 'tag' | 'vr' | 'length' | 'value' | 'delimiter';
  readonly range: RangeOrReason;
}

export interface Selection {
  readonly id: string;
  /** Short label for the status bar and the hex pane head, e.g. "(0028,0010) Rows". */
  readonly label: string;
  readonly whole: RangeOrReason;
  readonly parts: readonly SelectionPart[];
}

interface Row {
  readonly id: string;
  readonly depth: number;
  readonly el?: InspectedElement;
  readonly item?: { readonly parentId: string; readonly index: number; readonly count: number };
  readonly section?: string;
  readonly field?: NiftiView['fields'][number];
}

const UNAVAILABLE_TEXT: Readonly<Record<string, string>> = {
  deflated: 'deflated data set',
  undefinedLengthNoDelimiter: 'undefined length, no delimiter',
  parseError: 'not established by the parser',
  notEncoded: 'not in the file',
  compressed: 'inside a compressed stream',
};

/** Why a range has no bytes, in words; empty for a physical range. */
export function unavailableText(r: RangeOrReason): string {
  return r.kind === 'unavailable' ? (UNAVAILABLE_TEXT[r.reason] ?? r.reason) : '';
}

function elementSelection(el: InspectedElement): Selection {
  const parts: SelectionPart[] = [
    { kind: 'tag', range: el.ranges.tag },
    { kind: 'vr', range: el.ranges.vr },
    { kind: 'length', range: el.ranges.length },
    { kind: 'value', range: el.ranges.value },
  ];
  if (el.ranges.delimiter)
    parts.push({ kind: 'delimiter', range: { kind: 'physical', range: el.ranges.delimiter } });
  return {
    id: el.id,
    label: `${el.tag} ${el.keyword || el.name || 'private'}`,
    whole: el.ranges.element,
    parts,
  };
}

export class TagsPane {
  private readonly tree = h('div', {
    class: 'tag-tree',
    role: 'tree',
    tabIndex: 0,
    aria: { label: 'Tags' },
  });
  private readonly searchBox = h('input', {
    class: 'tags-search',
    title: 'Search by tag (0028,0010), keyword or name',
  });
  private readonly count = h('span', { class: 'image-info' });
  private rows: Row[] = [];
  private readonly expanded = new Set<string>();
  private readonly selections = new Map<string, Selection>();
  /** Data elements at every depth (sequence items are selectable but not counted). */
  private elementCount = 0;
  private elements: readonly InspectedElement[] = [];
  private dicom: Inspection | null = null;
  private nifti: NiftiView | null = null;
  private selected: string | null = null;
  private matches: string[] = [];
  private readonly groupButton = h(
    'button',
    { class: 'tags-grouping', title: 'Group the data set by module, or show it in file order' },
    'Grouped',
  );

  constructor(
    head: HTMLElement,
    body: HTMLElement,
    private readonly onSelect: (selection: Selection | null) => void,
    /** Data set grouped by module (patient, study, series…) or in file order. */
    private grouped: boolean,
    private readonly onGroupingChange: (grouped: boolean) => void,
  ) {
    this.searchBox.placeholder = 'Search tags';
    this.searchBox.setAttribute('aria-label', 'Search tags');
    this.updateGroupButton();
    this.groupButton.addEventListener('click', () => {
      this.grouped = !this.grouped;
      this.updateGroupButton();
      this.onGroupingChange(this.grouped);
      this.render();
    });
    replace(
      head,
      h('span', { class: 'label' }, 'Tags'),
      this.searchBox,
      this.count,
      this.groupButton,
    );
    replace(body, this.tree);
    this.searchBox.addEventListener('input', () => {
      this.runSearch(false);
    });
    this.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.runSearch(true);
      if (e.key === 'Escape') {
        this.searchBox.value = '';
        this.runSearch(false);
      }
    });
    this.tree.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.tag-row');
      if (!row?.dataset.id) return;
      const id = row.dataset.id;
      if ((e.target as HTMLElement).classList.contains('tag-twisty')) this.toggle(id);
      this.select(id, false);
    });
    this.tree.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.tag-row');
      if (row?.dataset.id) this.toggle(row.dataset.id);
    });
    this.tree.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
  }

  /** Shows a DICOM file's elements (file meta, then the data set) and indexes them. */
  showDicom(inspection: Inspection): void {
    this.dicom = inspection;
    this.nifti = null;
    this.groupButton.hidden = false;
    this.elements = [...inspection.fileMeta, ...inspection.dataSet];
    this.selections.clear();
    this.elementCount = 0;
    const index = (els: readonly InspectedElement[]): void => {
      for (const el of els) {
        this.elementCount++;
        this.selections.set(el.id, elementSelection(el));
        el.items.forEach((item, i) => {
          const id = `${el.id}[${i}]`;
          const parts: SelectionPart[] = [{ kind: 'value', range: item.ranges.item }];
          if (item.ranges.delimiter) {
            parts.push({
              kind: 'delimiter',
              range: { kind: 'physical', range: item.ranges.delimiter },
            });
          }
          this.selections.set(id, {
            id,
            label: `${el.tag} item ${i + 1}`,
            whole: item.ranges.item,
            parts,
          });
          index(item.elements);
        });
      }
    };
    index(this.elements);
    this.runSearch(false, true);
  }

  /** Shows a NIfTI header's fields, its extensions and the voxel data as rows. */
  showNifti(view: NiftiView): void {
    this.nifti = view;
    this.dicom = null;
    this.groupButton.hidden = true;
    this.elements = [];
    this.selections.clear();
    for (const f of view.fields) {
      this.selections.set(`n/${f.name}`, {
        id: `n/${f.name}`,
        label: f.name,
        whole: f.range,
        parts: [{ kind: 'value', range: f.range }],
      });
    }
    view.extensions.forEach((e, i) => {
      this.selections.set(`n/ext${i}`, {
        id: `n/ext${i}`,
        label: `extension ${i + 1} (code ${e.code})`,
        whole: e.range,
        parts: [{ kind: 'value', range: e.range }],
      });
    });
    this.selections.set('n/voxels', {
      id: 'n/voxels',
      label: 'voxel data',
      whole: view.voxels,
      parts: [{ kind: 'value', range: view.voxels }],
    });
    this.runSearch(false, true);
  }

  /** Empties the tree and shows `message` instead (the file could not be parsed). */
  clear(message: string): void {
    this.dicom = null;
    this.nifti = null;
    this.rows = [];
    replace(this.tree, h('div', { class: 'empty-state' }, message));
    this.count.textContent = '';
  }

  /** The selection for an element id, for linking from the hex pane. */
  selectionOf(id: string): Selection | undefined {
    return this.selections.get(id);
  }

  /** Selects a row, expanding its ancestors; `reveal` scrolls it into view. */
  select(id: string | null, reveal: boolean): void {
    if (id) for (const ancestor of ancestorsOf(id)) this.expanded.add(ancestor);
    this.selected = id;
    this.render();
    const sel = id ? (this.selections.get(id) ?? null) : null;
    this.onSelect(sel);
    if (reveal && id) {
      this.tree
        .querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.render();
  }

  private runSearch(next: boolean, reset = false): void {
    const query = parseQuery(this.searchBox.value);
    this.matches = query && this.dicom ? search(this.elements, query) : [];
    if (query && this.nifti) {
      const text = query.kind === 'text' ? query.text : '';
      this.matches = this.nifti.fields
        .filter((f) => text && f.name.toLowerCase().includes(text))
        .map((f) => `n/${f.name}`);
    }
    if (reset) this.expanded.clear();
    for (const id of this.matches) for (const a of ancestorsOf(id)) this.expanded.add(a);
    if (query) {
      this.count.textContent = `${this.matches.length} found`;
      if (this.matches.length) {
        const at = next && this.selected ? this.matches.indexOf(this.selected) + 1 : 0;
        this.select(this.matches[at % this.matches.length] ?? null, true);
        return;
      }
    } else {
      this.count.textContent = this.dicom ? `${this.elementCount.toLocaleString()} elements` : '';
    }
    this.render();
  }

  private buildRows(): Row[] {
    const rows: Row[] = [];
    if (this.nifti) {
      const v = this.nifti;
      rows.push({
        id: 'h/header',
        depth: 0,
        section: `NIfTI-${v.version} header (${v.version === 1 ? 348 : 540} bytes${v.compressed ? ', compressed file' : ''})`,
      });
      for (const f of v.fields) rows.push({ id: `n/${f.name}`, depth: 0, field: f });
      if (v.extensions.length) rows.push({ id: 'h/ext', depth: 0, section: 'Extensions' });
      v.extensions.forEach((_, i) => rows.push({ id: `n/ext${i}`, depth: 0 }));
      rows.push({ id: 'h/vox', depth: 0, section: 'Voxel data' }, { id: 'n/voxels', depth: 0 });
      return rows;
    }
    if (!this.dicom) return rows;
    const walk = (els: readonly InspectedElement[], depth: number): void => {
      for (const el of els) {
        rows.push({ id: el.id, depth, el });
        if (!el.items.length || !this.expanded.has(el.id)) continue;
        el.items.forEach((item, index) => {
          const itemId = `${el.id}[${index}]`;
          rows.push({
            id: itemId,
            depth: depth + 1,
            item: { parentId: el.id, index, count: item.elements.length },
          });
          if (this.expanded.has(itemId)) walk(item.elements, depth + 2);
        });
      }
    };
    rows.push({
      id: 'h/meta',
      depth: 0,
      section: `File Meta Information (${this.dicom.fileMeta.length})`,
    });
    walk(this.dicom.fileMeta, 0);
    if (this.grouped) {
      for (const group of groupElements(this.dicom.dataSet)) {
        rows.push({
          id: `h/g-${group.id}`,
          depth: 0,
          section: `${group.label} (${group.elements.length})`,
        });
        walk(group.elements, 0);
      }
    } else {
      rows.push({
        id: 'h/data',
        depth: 0,
        section: `Data Set, in file order (${this.dicom.dataSet.length})`,
      });
      walk(this.dicom.dataSet, 0);
    }
    return rows;
  }

  private updateGroupButton(): void {
    this.groupButton.textContent = this.grouped ? 'Grouped' : 'File order';
    this.groupButton.setAttribute('aria-pressed', String(this.grouped));
    this.groupButton.hidden = this.nifti !== null;
  }

  private render(): void {
    this.rows = this.buildRows();
    const matchSet = new Set(this.matches);
    const nodes = this.rows.map((row) => {
      if (row.section) return h('div', { class: 'tag-section' }, row.section);
      const cls = `tag-row${row.id === this.selected ? ' selected' : ''}${matchSet.has(row.id) ? ' match' : ''}`;
      const indent = `${row.depth * 14}px`;
      let node: HTMLElement;
      if (row.el) {
        const el = row.el;
        const preview =
          el.preview.kind === 'text'
            ? h(
                'span',
                { class: 'tag-value' },
                el.preview.text + (el.preview.truncated ? ' …' : ''),
              )
            : el.preview.kind === 'binary'
              ? h('span', { class: 'tag-value binary' }, `${el.valueLength.toLocaleString()} bytes`)
              : el.preview.kind === 'empty'
                ? h('span', { class: 'tag-value empty' }, 'empty')
                : h(
                    'span',
                    { class: 'tag-value' },
                    `${el.items.length} item${el.items.length === 1 ? '' : 's'}`,
                  );
        const vr = h(
          'span',
          {
            class: `tag-vr${el.vrFromDictionary ? ' dictionary' : ''}`,
            title: el.vrFromDictionary
              ? 'VR not in the file (implicit VR); from the dictionary'
              : 'VR as encoded',
          },
          el.vr || '—',
        );
        node = h(
          'div',
          {
            class: cls,
            role: 'treeitem',
            dataset: { id: row.id },
            aria: el.items.length ? { expanded: String(this.expanded.has(el.id)) } : {},
          },
          h(
            'span',
            { class: 'tag-twisty' },
            el.items.length ? (this.expanded.has(el.id) ? '▾' : '▸') : '',
          ),
          h('span', { class: 'tag-code' }, el.tag),
          vr,
          h(
            'span',
            { class: 'tag-main' },
            h('span', { class: 'tag-name' }, el.keyword || el.name || 'Private tag'),
            preview,
          ),
        );
      } else if (row.item) {
        node = h(
          'div',
          {
            class: cls,
            role: 'treeitem',
            dataset: { id: row.id },
            aria: { expanded: String(this.expanded.has(row.id)) },
          },
          h('span', { class: 'tag-twisty' }, this.expanded.has(row.id) ? '▾' : '▸'),
          h('span', { class: 'tag-item' }, `Item ${row.item.index + 1}`),
          h('span', {}, ''),
          h(
            'span',
            { class: 'tag-main tag-item' },
            `${row.item.count} element${row.item.count === 1 ? '' : 's'}`,
          ),
        );
      } else {
        const sel = this.selections.get(row.id);
        const field = row.field;
        node = h(
          'div',
          { class: cls, role: 'treeitem', dataset: { id: row.id } },
          h('span', { class: 'tag-twisty' }, ''),
          h('span', { class: 'tag-code' }, field ? field.name : (sel?.label ?? row.id)),
          h('span', {}, ''),
          h(
            'span',
            { class: 'tag-main' },
            h(
              'span',
              { class: 'tag-value' },
              field
                ? field.text
                : sel?.whole.kind === 'physical'
                  ? `${(sel.whole.range.end - sel.whole.range.start).toLocaleString()} bytes`
                  : '',
            ),
          ),
        );
      }
      // A CSSOM property write, which style-src allows (a style attribute would not be).
      node.style.paddingLeft = indent;
      return node;
    });
    replace(this.tree, ...nodes);
  }

  private onKey(e: KeyboardEvent): void {
    const selectable = this.rows.filter((r) => !r.section);
    const i = selectable.findIndex((r) => r.id === this.selected);
    const move = (to: number): void => {
      const row = selectable[Math.max(0, Math.min(selectable.length - 1, to))];
      if (row) this.select(row.id, true);
    };
    switch (e.key) {
      case 'ArrowDown':
        move(i + 1);
        break;
      case 'ArrowUp':
        move(i - 1);
        break;
      case 'ArrowRight':
        if (this.selected && !this.expanded.has(this.selected)) this.toggle(this.selected);
        break;
      case 'ArrowLeft': {
        if (this.selected && this.expanded.has(this.selected)) this.toggle(this.selected);
        else if (this.selected) {
          const parent = ancestorsOf(this.selected).at(-1);
          if (parent) this.select(parent, true);
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }
}

/** Ancestor row ids of an element or item id, outermost first. */
export function ancestorsOf(id: string): string[] {
  // d/(0008,1115)[1]/(0008,1150) → d/(0008,1115), d/(0008,1115)[1]
  const out: string[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(id)) !== null) {
    const itemId = id.slice(0, m.index + m[0].length);
    out.push(id.slice(0, m.index), itemId);
  }
  return out.filter((a) => a !== id);
}
