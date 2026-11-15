/**
 * Minimal DOM building. Text always goes in through `textContent`, never as HTML, so a
 * tag value can never become markup.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  readonly class?: string;
  readonly title?: string;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly aria?: Readonly<Record<string, string>>;
}

/** Creates an element with optional class, attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.role) el.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  for (const [k, v] of Object.entries(props.dataset ?? {})) el.dataset[k] = v;
  for (const [k, v] of Object.entries(props.aria ?? {})) el.setAttribute(`aria-${k}`, v);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** Replaces all children of `el`. */
export function replace(el: Element, ...children: Child[]): void {
  el.replaceChildren(
    ...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
  );
}
