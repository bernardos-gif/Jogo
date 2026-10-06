// Shared menu widgets: slider, toggle and segmented rows, section titles, key labels.
import { h, setText, toggle } from '../dom';

export function section(title: string): HTMLDivElement {
  return h('div', { class: 'w-section label', text: title });
}

/** A labeled slider with a live value readout. */
export function sliderRow(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onChange: (v: number) => void): HTMLDivElement {
  const out = h('span', { class: 'num w-val', text: fmt(value) });
  const input = h('input', { class: 'w-slider', attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } }) as HTMLInputElement;
  input.value = String(value);
  const fill = () => input.style.setProperty('--k', `${(((Number(input.value) - min) / (max - min)) * 100).toFixed(1)}%`);
  fill();
  input.addEventListener('input', () => {
    const v = Number(input.value);
    setText(out, fmt(v));
    fill();
    onChange(v);
  });
  return h('div', { class: 'w-row' }, h('span', { class: 'w-label', text: label }), input, out);
}

/** An on/off switch row. */
export function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLDivElement {
  let on = value;
  const sw = h('button', { class: 'w-switch' }, h('i'));
  const text = h('span', { class: 'label w-switch-text', text: on ? 'On' : 'Off' });
  toggle(sw, 'on', on);
  sw.addEventListener('click', () => {
    on = !on;
    toggle(sw, 'on', on);
    setText(text, on ? 'On' : 'Off');
    onChange(on);
  });
  return h('div', { class: 'w-row', title: hint }, h('span', { class: 'w-label', text: label }), h('div', { class: 'w-ctl' }, sw, text));
}

/** A segmented choice row. */
export function segmentRow<T extends string>(label: string, options: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLDivElement {
  const btns: HTMLButtonElement[] = [];
  const wrap = h('div', { class: 'w-seg' });
  for (const o of options) {
    const b = h('button', {
      class: `btn chip-btn${o.id === value ? ' selected' : ''}`,
      text: o.label,
      on: {
        click: () => {
          for (const x of btns) toggle(x, 'selected', x === b);
          onChange(o.id);
        },
      },
    });
    btns.push(b);
    wrap.append(b);
  }
  return h('div', { class: 'w-row' }, h('span', { class: 'w-label', text: label }), wrap);
}

const KEY_NAMES: Record<string, string> = {
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  WheelUp: 'Wheel up',
  WheelDown: 'Wheel down',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Cmd',
  MetaRight: 'R Cmd',
  Space: 'Space',
  Escape: 'Esc',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  CapsLock: 'Caps',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** Human label for a key or mouse code. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
