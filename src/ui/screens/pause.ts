// Pause menu (Esc): resume, settings, controls, leave the match, quit.
import { h, toggle } from '../dom';
import { native } from '../../core/native';

export class PauseMenu {
  readonly el: HTMLDivElement;
  open = false;
  onResume: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onControls: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const btn = (text: string, fn: () => void, cls = '') => h('button', { class: `btn menu-btn ${cls}`, text, on: { click: fn } });
    this.el = h(
      'div',
      { class: 'screen pause hidden' },
      h(
        'div',
        { class: 'pause-panel panel strong brackets scan-in' },
        h('div', { class: 'display pause-title', text: 'Paused' }),
        btn('Resume', () => this.onResume?.(), 'primary'),
        btn('Settings', () => this.onSettings?.()),
        btn('Controls', () => this.onControls?.()),
        btn('Leave match', () => this.onLeave?.()),
        native.isElectron ? btn('Quit to desktop', () => native.quit(), 'danger') : null,
      ),
    );
    parent.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }
}
