// Controls: every action with a primary and a secondary binding. Click a key cell, press a key or
// mouse button (Esc cancels, Backspace clears); conflicts are flagged; defaults can be restored.
import { h, clear, toggle } from '../dom';
import { ACTIONS, DEFAULT_BINDINGS, input, type Action } from '../../core/input';
import { save } from '../../core/save';
import { keyLabel } from './widgets';

export class ControlsScreen {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  private hint: HTMLDivElement;
  private waiting: { action: Action; slot: number } | null = null;
  open = false;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.list = h('div', { class: 'ct-list' });
    this.hint = h('div', { class: 'label ct-hint', text: 'Click a binding, then press a key or mouse button. Esc cancels, Backspace clears.' });
    this.el = h(
      'div',
      { class: 'screen menu-screen controls hidden' },
      h('div', { class: 'ms-head' }, h('div', { class: 'display ms-title', text: 'Controls' }), this.hint),
      h('div', { class: 'ms-panel panel strong brackets scan-in' }, this.list),
      h('div', { class: 'ms-foot' }, h('button', { class: 'btn', text: 'Back', on: { click: () => this.back() } }), h('button', { class: 'btn', text: 'Restore defaults', on: { click: () => this.restore() } })),
    );
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.open && !this.waiting && e.code === 'Escape') this.back();
    });
  }

  show(): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
    this.render();
  }

  hide(): void {
    this.open = false;
    this.waiting = null;
    input.cancelCapture();
    toggle(this.el, 'hidden', true);
  }

  private back(): void {
    input.cancelCapture();
    this.waiting = null;
    this.onBack?.();
  }

  private restore(): void {
    save.update((d) => {
      d.settings.bindings = structuredClone(DEFAULT_BINDINGS);
    });
    input.bindings = save.settings.bindings;
    this.render();
  }

  private bind(action: Action, slot: number, code: string | null): void {
    save.update((d) => {
      const list = [...(d.settings.bindings[action] ?? [])];
      if (code === null) list.splice(slot, 1);
      else list[slot] = code;
      d.settings.bindings[action] = list.filter(Boolean);
    });
    input.bindings = save.settings.bindings;
  }

  private render(): void {
    clear(this.list);
    const b = save.settings.bindings;
    // Count codes to flag conflicts.
    const uses = new Map<string, number>();
    for (const codes of Object.values(b)) for (const c of codes) uses.set(c, (uses.get(c) ?? 0) + 1);
    let group = '';
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        this.list.append(h('div', { class: 'w-section label', text: group }));
      }
      const cells = [0, 1].map((slot) => {
        const code = b[a.id]?.[slot];
        const waiting = this.waiting?.action === a.id && this.waiting.slot === slot;
        const conflict = !!code && (uses.get(code) ?? 0) > 1 && !sharedOk(code);
        return h('button', {
          class: `btn ct-key${waiting ? ' waiting' : ''}${conflict ? ' conflict' : ''}${code ? '' : ' empty'}`,
          text: waiting ? 'Press a key' : code ? keyLabel(code) : '—',
          title: conflict ? 'Also bound to another action' : '',
          on: { click: () => this.capture(a.id, slot) },
        });
      });
      this.list.append(h('div', { class: 'ct-row' }, h('span', { class: 'w-label', text: a.label }), ...cells));
    }
  }

  private capture(action: Action, slot: number): void {
    this.waiting = { action, slot };
    this.render();
    input.captureNext((code) => {
      if (code === 'Escape') {
        this.waiting = null;
        this.render();
        return;
      }
      this.bind(action, slot, code === 'Backspace' ? null : code);
      this.waiting = null;
      this.render();
    });
  }
}

/** Seat keys share F1-F4 with nothing else by design; the wheel and digits may double up. */
function sharedOk(code: string): boolean {
  return code === 'WheelUp' || code === 'WheelDown';
}
