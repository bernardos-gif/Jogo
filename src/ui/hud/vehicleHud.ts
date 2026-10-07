// Vehicle HUD: hull and components, the seat's weapon (heat, ammo, reload), countermeasures, seat
// diagram, speed and heading for drivers; for pilots an artificial horizon with a pitch ladder,
// altitude and speed tapes, and the VTOL mode; lock-on and incoming-missile warnings.
import { h, setText, setStyle, toggle } from '../dom';
import type { VehicleKind } from '../../config/content';

export interface VehicleView {
  name: string;
  kind: VehicleKind;
  aircraft: boolean;
  /** Hull fraction 0..1 and component health 0..1. */
  hp: number;
  comps: { engine: number; weapons: number; mobility: number };
  crippledBelow: number;
  seat: number;
  seatLabel: string;
  seats: { taken: boolean; squad: boolean }[];
  /** Seat weapon (null for open seats with a personal weapon). */
  mount: { name: string; heat: number | null; overheated: boolean; ammo: number | null; ammoMax: number; reload: number | null } | null;
  /** Open seat with the occupant's own weapon (the weapon panel stays). */
  personal: boolean;
  driver: boolean;
  speed: number;
  heading: number;
  altitude: number;
  pitch: number;
  roll: number;
  vtol: 'Hover' | 'Cruise' | null;
  cm: { label: string; charges: number; max: number; cooldown: number; active: boolean };
  lockWarn: boolean;
  incoming: boolean;
  emp: boolean;
  burning: boolean;
  keys: { exit: string; cm: string; camera: string; vtol: string };
}

const COMP_NAMES = [
  ['engine', 'ENG'],
  ['weapons', 'WPN'],
  ['mobility', 'MOB'],
] as const;

export class VehicleHud {
  readonly el: HTMLDivElement;
  private panel: HTMLDivElement;
  private name = h('div', { class: 'vh-name display' });
  private seatLabel = h('div', { class: 'vh-seat label' });
  private hull = h('div', { class: 'bar seg vh-hull' }, h('i'));
  private hullNum = h('span', { class: 'num vh-hullnum' });
  private comps: HTMLDivElement[] = [];
  private mountName = h('div', { class: 'vh-mount label' });
  private mountAmmo = h('div', { class: 'num vh-ammo' });
  private mountBar = h('div', { class: 'bar vh-heat' }, h('i'));
  private cm = h('div', { class: 'vh-cm label' });
  private seatsEl = h('div', { class: 'vh-seats' });
  private hint = h('div', { class: 'vh-hint label' });
  // Driver readouts.
  private speedBox: HTMLDivElement;
  private speedNum = h('div', { class: 'num vh-speed' });
  private headingNum = h('div', { class: 'num vh-heading' });
  // Flight instruments.
  private flight: HTMLDivElement;
  private horizon = h('div', { class: 'vh-horizon' });
  private ladder = h('div', { class: 'vh-ladder' });
  private altTape = h('div', { class: 'vh-tape vh-alt' });
  private altNum = h('div', { class: 'num vh-tapenum' });
  private spdTape = h('div', { class: 'vh-tape vh-spd' });
  private spdNum = h('div', { class: 'num vh-tapenum' });
  private vtol = h('div', { class: 'vh-vtol chip brackets' });
  // Warnings.
  private warn = h('div', { class: 'vh-warn display' });
  private lastSeats = '';

  constructor(parent: HTMLElement) {
    const compRow = h('div', { class: 'vh-comps' });
    for (const [, label] of COMP_NAMES) {
      const c = h('div', { class: 'vh-comp chip', text: label });
      this.comps.push(c);
      compRow.append(c);
    }
    this.panel = h(
      'div',
      { class: 'vh-panel panel brackets' },
      h('div', { class: 'vh-top' }, this.name, this.seatLabel),
      h('div', { class: 'vh-hullrow' }, h('span', { class: 'label', text: 'Hull' }), this.hull, this.hullNum),
      compRow,
      h('div', { class: 'vh-weapon' }, h('div', { class: 'vh-wtop' }, this.mountName, this.mountAmmo), this.mountBar),
      h('div', { class: 'vh-foot' }, this.cm, this.seatsEl),
      this.hint,
    );
    this.speedBox = h('div', { class: 'vh-speedbox' }, this.speedNum, h('div', { class: 'label', text: 'km/h' }), this.headingNum);
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const line = h('div', { class: 'vh-rung' }, h('span', { class: 'num', text: String(Math.abs(p)) }));
      line.style.top = `${-p * 4}px`;
      line.classList.toggle('neg', p < 0);
      this.ladder.append(line);
    }
    this.horizon.append(h('div', { class: 'vh-hline' }), this.ladder);
    this.flight = h(
      'div',
      { class: 'vh-flight' },
      h('div', { class: 'vh-att' }, this.horizon, h('div', { class: 'vh-wings' })),
      h('div', { class: 'vh-tapebox left' }, this.spdTape, this.spdNum, h('div', { class: 'label', text: 'km/h' })),
      h('div', { class: 'vh-tapebox right' }, this.altTape, this.altNum, h('div', { class: 'label', text: 'ALT m' })),
      this.vtol,
    );
    this.el = h('div', { class: 'vehicle-hud hidden' }, this.panel, this.speedBox, this.flight, this.warn);
    parent.appendChild(this.el);
  }

  update(v: VehicleView | null, time: number): void {
    toggle(this.el, 'hidden', !v);
    if (!v) return;
    setText(this.name, v.name);
    setText(this.seatLabel, v.seatLabel);
    setStyle(this.hull.firstElementChild as HTMLElement, 'width', `${Math.max(0, v.hp * 100).toFixed(1)}%`);
    toggle(this.hull, 'low', v.hp < 0.35);
    setText(this.hullNum, `${Math.max(0, Math.round(v.hp * 100))}%`);
    COMP_NAMES.forEach(([k], i) => {
      const c = this.comps[i];
      const val = v.comps[k];
      toggle(c, 'crippled', val < v.crippledBelow);
      toggle(c, 'damaged', val >= v.crippledBelow && val < 0.99);
    });
    // Weapon.
    const m = v.mount;
    toggle(this.panel, 'no-mount', !m);
    toggle(this.panel, 'raised', v.personal);
    if (m) {
      setText(this.mountName, m.name);
      if (m.heat !== null) {
        setText(this.mountAmmo, m.overheated ? 'OVERHEAT' : '');
        setStyle(this.mountBar.firstElementChild as HTMLElement, 'width', `${(m.heat * 100).toFixed(0)}%`);
        toggle(this.mountBar, 'over', m.overheated);
        toggle(this.mountBar, 'reload', false);
        toggle(this.mountBar, 'ammo', false);
      } else {
        setText(this.mountAmmo, m.reload !== null ? 'RELOADING' : m.ammoMax > 1 ? `${m.ammo} / ${m.ammoMax}` : 'READY');
        const frac = m.reload ?? (m.ammoMax > 0 ? (m.ammo ?? 0) / m.ammoMax : 1);
        setStyle(this.mountBar.firstElementChild as HTMLElement, 'width', `${(frac * 100).toFixed(0)}%`);
        toggle(this.mountBar, 'over', false);
        toggle(this.mountBar, 'reload', m.reload !== null);
        toggle(this.mountBar, 'ammo', m.reload === null);
      }
    }
    // Countermeasures.
    const cm = v.cm;
    setText(this.cm, `${cm.label} [${v.keys.cm}] ${'◆'.repeat(cm.charges)}${'◇'.repeat(Math.max(0, cm.max - cm.charges))}${cm.cooldown > 0 ? ` ${Math.ceil(cm.cooldown)}s` : ''}`);
    toggle(this.cm, 'active', cm.active);
    // Seats.
    const key = v.seats.map((s, i) => `${s.taken ? 1 : 0}${s.squad ? 1 : 0}${i === v.seat ? 1 : 0}`).join('');
    if (key !== this.lastSeats) {
      this.lastSeats = key;
      this.seatsEl.textContent = '';
      v.seats.forEach((s, i) => {
        const b = h('div', { class: 'vh-seatbox num', text: String(i + 1) });
        toggle(b, 'taken', s.taken);
        toggle(b, 'squad', s.squad);
        toggle(b, 'me', i === v.seat);
        this.seatsEl.append(b);
      });
    }
    setText(this.hint, `${v.keys.exit} exit · F1-F${v.seats.length} seats · ${v.keys.camera} camera${v.vtol && v.driver ? ` · ${v.keys.vtol} VTOL mode` : ''}`);
    // Driver readouts (ground).
    toggle(this.speedBox, 'hidden', !v.driver || v.aircraft);
    const kmh = Math.round(v.speed * 3.6);
    let brg = Math.round((-v.heading * 180) / Math.PI) % 360;
    if (brg < 0) brg += 360;
    if (v.driver && !v.aircraft) {
      setText(this.speedNum, String(kmh));
      setText(this.headingNum, `${String(brg).padStart(3, '0')}°`);
    }
    // Flight instruments (pilot).
    toggle(this.flight, 'hidden', !(v.aircraft && v.driver));
    if (v.aircraft && v.driver) {
      const pitchDeg = (v.pitch * 180) / Math.PI;
      const rollDeg = (v.roll * 180) / Math.PI;
      setStyle(this.horizon, 'transform', `rotate(${rollDeg.toFixed(1)}deg) translateY(${(-pitchDeg * 4).toFixed(1)}px)`);
      setText(this.altNum, String(Math.round(v.altitude)));
      setText(this.spdNum, String(kmh));
      setStyle(this.altTape, 'background-position-y', `${(v.altitude * 4) % 40}px`);
      setStyle(this.spdTape, 'background-position-y', `${(v.speed * 4) % 40}px`);
      toggle(this.vtol, 'hidden', !v.vtol);
      if (v.vtol) setText(this.vtol, v.vtol === 'Cruise' ? 'CRUISE' : 'HOVER');
      toggle(this.altNum, 'low', v.altitude < 10);
    }
    // Warnings (incoming beats lock; EMP and fire show when nothing is locking).
    const blink = Math.floor(time * 6) % 2 === 0;
    let text = '';
    let tone = '';
    if (v.incoming) {
      text = 'MISSILE INCOMING';
      tone = 'red';
    } else if (v.lockWarn) {
      text = 'LOCK WARNING';
      tone = 'amber';
    } else if (v.emp) {
      text = 'SYSTEMS DISRUPTED';
      tone = 'cyan';
    } else if (v.burning) {
      text = 'HULL CRITICAL';
      tone = 'red';
    }
    setText(this.warn, text);
    toggle(this.warn, 'hidden', !text || (tone !== 'cyan' && !blink && v.incoming));
    this.warn.dataset.tone = tone;
  }
}
