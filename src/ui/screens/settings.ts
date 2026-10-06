// Settings: graphics (preset and individual toggles, resolution scale, particles), gameplay (FOV,
// hip / ADS / vehicle sensitivity, invert Y, screen shake, head bob, bot difficulty, team size,
// unlock all), audio mix, and interface (colorblind palette, HUD scale, opacity, motion, FPS).
// Every change is saved immediately and reported through onChange.
import { h, clear, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import { save, defaultSettings, type Settings } from '../../core/save';
import { section, sliderRow, toggleRow, segmentRow } from './widgets';

type Tab = 'graphics' | 'gameplay' | 'audio' | 'interface';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num2 = (v: number) => v.toFixed(2);

export class SettingsScreen {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tabs: HTMLDivElement;
  private tab: Tab = 'graphics';
  open = false;
  onBack: (() => void) | null = null;
  /** Called with the changed key after every edit. */
  onChange: ((key: keyof Settings) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.tabs = h('div', { class: 'st-tabs' });
    this.body = h('div', { class: 'st-body' });
    this.el = h(
      'div',
      { class: 'screen menu-screen settings hidden' },
      h('div', { class: 'ms-head' }, h('div', { class: 'display ms-title', text: 'Settings' }), this.tabs),
      h('div', { class: 'ms-panel panel strong brackets scan-in' }, this.body),
      h('div', { class: 'ms-foot' }, h('button', { class: 'btn', text: 'Back', on: { click: () => this.onBack?.() } }), h('button', { class: 'btn', text: 'Restore defaults', on: { click: () => this.restore() } })),
    );
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape') this.onBack?.();
    });
  }

  show(): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
    this.render();
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    save.update((d) => {
      d.settings[key] = value;
    });
    this.onChange?.(key);
  }

  private restore(): void {
    const keep = save.data.settings.bindings;
    save.update((d) => {
      Object.assign(d.settings, defaultSettings(), { bindings: keep });
    });
    for (const k of Object.keys(save.data.settings) as (keyof Settings)[]) this.onChange?.(k);
    this.render();
  }

  private render(): void {
    clear(this.tabs);
    for (const [id, label] of [
      ['graphics', 'Graphics'],
      ['gameplay', 'Gameplay'],
      ['audio', 'Audio'],
      ['interface', 'Interface'],
    ] as [Tab, string][]) {
      this.tabs.append(
        h('button', {
          class: `btn st-tab${id === this.tab ? ' selected' : ''}`,
          text: label,
          on: {
            click: () => {
              this.tab = id;
              this.render();
            },
          },
        }),
      );
    }
    clear(this.body);
    const s = save.settings;
    const C = TUNING.camera;
    const add = (...els: HTMLElement[]) => this.body.append(...els);
    if (this.tab === 'graphics') {
      add(
        section('Quality'),
        segmentRow('Preset', [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
          { id: 'high', label: 'High' },
          { id: 'ultra', label: 'Ultra' },
        ], s.preset, (v) => this.set('preset', v)),
        toggleRow('Shadows', s.shadows, (v) => this.set('shadows', v)),
        toggleRow('Bloom', s.bloom, (v) => this.set('bloom', v)),
        toggleRow('Outlines', s.outlines, (v) => this.set('outlines', v)),
        sliderRow('Particle density', 0.25, 1, 0.05, s.particles, pct, (v) => this.set('particles', v)),
        section('Resolution'),
        sliderRow('Resolution scale', 0.5, 1, 0.05, s.resolutionScale, pct, (v) => this.set('resolutionScale', v)),
        toggleRow('Dynamic resolution', s.dynamicResolution, (v) => this.set('dynamicResolution', v), 'Lowers the render scale when frames run long'),
      );
    } else if (this.tab === 'gameplay') {
      add(
        section('View'),
        sliderRow('Field of view', C.minFov, C.maxFov, 1, s.fov, (v) => `${Math.round(v)}°`, (v) => this.set('fov', v)),
        sliderRow('Screen shake', 0, 1.5, 0.05, s.screenShake, pct, (v) => this.set('screenShake', v)),
        toggleRow('Head bob', s.headBob, (v) => this.set('headBob', v)),
        section('Mouse'),
        sliderRow('Hip sensitivity', 0.1, 3, 0.01, s.sensHip, num2, (v) => this.set('sensHip', v)),
        sliderRow('ADS sensitivity', 0.1, 2, 0.01, s.sensAds, num2, (v) => this.set('sensAds', v)),
        sliderRow('Vehicle sensitivity', 0.1, 3, 0.01, s.sensVehicle, num2, (v) => this.set('sensVehicle', v)),
        toggleRow('Invert Y', s.invertY, (v) => this.set('invertY', v)),
        section('Match'),
        segmentRow('Bot difficulty', [
          { id: 'recruit', label: 'Recruit' },
          { id: 'veteran', label: 'Veteran' },
          { id: 'elite', label: 'Elite' },
        ], s.difficulty, (v) => this.set('difficulty', v)),
        sliderRow('Team size', TUNING.sector.teamSizeMin, TUNING.sector.teamSizeMax, 1, s.teamSize, (v) => `${v} v ${v}`, (v) => this.set('teamSize', v)),
        toggleRow('Unlock all', s.unlockAll, (v) => this.set('unlockAll', v), 'Bypass every progression lock'),
      );
    } else if (this.tab === 'audio') {
      add(
        section('Mix'),
        sliderRow('Master', 0, 1, 0.01, s.volMaster, pct, (v) => this.set('volMaster', v)),
        sliderRow('Effects', 0, 1, 0.01, s.volSfx, pct, (v) => this.set('volSfx', v)),
        sliderRow('Music', 0, 1, 0.01, s.volMusic, pct, (v) => this.set('volMusic', v)),
        sliderRow('Interface', 0, 1, 0.01, s.volUi, pct, (v) => this.set('volUi', v)),
        sliderRow('Announcer', 0, 1, 0.01, s.volVoice, pct, (v) => this.set('volVoice', v)),
      );
    } else {
      add(
        section('Color'),
        segmentRow('Team colors', [
          { id: 'default', label: 'Default' },
          { id: 'deuteranopia', label: 'Deuteranopia' },
          { id: 'protanopia', label: 'Protanopia' },
          { id: 'tritanopia', label: 'Tritanopia' },
        ], s.palette, (v) => this.set('palette', v)),
        h('div', { class: 'st-swatches' }, h('span', { class: 'sw friend', text: 'Friendly' }), h('span', { class: 'sw foe', text: 'Enemy' }), h('span', { class: 'sw squad', text: 'Squad' })),
        section('HUD'),
        sliderRow('HUD scale', 0.75, 1.3, 0.05, s.hudScale, pct, (v) => this.set('hudScale', v)),
        sliderRow('HUD opacity', 0.4, 1, 0.05, s.hudOpacity, pct, (v) => this.set('hudOpacity', v)),
        segmentRow('HUD motion', [
          { id: 'auto', label: 'System' },
          { id: 'full', label: 'Full' },
          { id: 'reduced', label: 'Reduced' },
        ], s.hudMotion, (v) => this.set('hudMotion', v)),
        toggleRow('Performance readout', s.showFps, (v) => this.set('showFps', v)),
      );
    }
  }
}
