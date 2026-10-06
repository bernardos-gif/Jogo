// Top-left event banners (storm, launch sequence, sector captured / lost, round results). Banners
// queue and play one at a time: slide in, hold, slide out.
import { h, setText, toggle } from '../dom';
import { TUNING } from '../../config/tuning';

export type BannerTone = 'info' | 'good' | 'bad' | 'warn';

interface Banner {
  text: string;
  sub: string;
  tone: BannerTone;
}

export class Banners {
  readonly el: HTMLDivElement;
  private title: HTMLDivElement;
  private sub: HTMLDivElement;
  private queue: Banner[] = [];
  private t = -1;

  constructor(parent: HTMLElement) {
    this.title = h('div', { class: 'bn-title display' });
    this.sub = h('div', { class: 'bn-sub label' });
    this.el = h('div', { class: 'banner hidden' }, h('div', { class: 'bn-bar' }), h('div', { class: 'bn-text' }, this.title, this.sub));
    parent.appendChild(this.el);
  }

  push(text: string, sub: string, tone: BannerTone): void {
    // Replace a queued banner with the same text (repeated captures).
    this.queue = this.queue.filter((b) => b.text !== text);
    this.queue.push({ text, sub, tone });
    while (this.queue.length > TUNING.ui.bannerQueue) this.queue.shift();
  }

  update(dt: number): void {
    const U = TUNING.ui;
    const total = U.bannerIn + U.bannerHold + U.bannerOut;
    if (this.t < 0) {
      const next = this.queue.shift();
      if (!next) return;
      this.t = 0;
      setText(this.title, next.text);
      setText(this.sub, next.sub);
      this.el.className = `banner ${next.tone} in`;
      return;
    }
    this.t += dt;
    if (this.t > U.bannerIn + U.bannerHold) toggle(this.el, 'out', true);
    if (this.t > total) {
      this.t = -1;
      this.el.className = 'banner hidden';
    }
  }

  clear(): void {
    this.queue.length = 0;
    this.t = -1;
    this.el.className = 'banner hidden';
  }
}
