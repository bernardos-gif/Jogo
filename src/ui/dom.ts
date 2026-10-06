// Tiny DOM helpers used by every screen and HUD element (no framework).

type Child = Node | string | number | null | undefined | false;

export interface HProps {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  style?: string;
  title?: string;
  attrs?: Record<string, string>;
  data?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: HProps | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.id) el.id = props.id;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.style) el.setAttribute('style', props.style);
    if (props.title) el.title = props.title;
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
    if (props.on) {
      for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Sets text only when it changed (avoids layout work in per-frame HUD updates). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Inline SVG from a path list (icons are drawn in code, never loaded). */
export function svg(viewBox: string, inner: string, cls = 'icon'): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
