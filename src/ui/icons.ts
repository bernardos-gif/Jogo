// Icons drawn in code as inline SVG (1.5 px strokes, square caps). No image files.
import type { ClassId } from '../config/content';

const S = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"';

export const CLASS_ICONS: Record<ClassId, string> = {
  // Assault: a forward chevron through a ring.
  assault: `<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="8" ${S}/><path d="M8 7 L14 12 L8 17" ${S}/><path d="M13 7 L19 12 L13 17" ${S}/></svg>`,
  // Engineer: a wrench head over a hex.
  engineer: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 3 L19.8 7.5 V16.5 L12 21 L4.2 16.5 V7.5 Z" ${S}/><path d="M9 15 L15 9 M13.5 7.5 A2.5 2.5 0 1 0 16.5 10.5" ${S}/></svg>`,
  // Support: a cross inside a square.
  support: `<svg viewBox="0 0 24 24" class="icon"><rect x="4" y="4" width="16" height="16" ${S}/><path d="M12 8 V16 M8 12 H16" ${S}/></svg>`,
  // Recon: an eye with a reticle tick.
  recon: `<svg viewBox="0 0 24 24" class="icon"><path d="M3 12 Q12 4 21 12 Q12 20 3 12 Z" ${S}/><circle cx="12" cy="12" r="2.5" ${S}/><path d="M12 2 V5 M12 19 V22" ${S}/></svg>`,
};

export const ICONS = {
  skull: `<svg viewBox="0 0 24 24" class="icon"><path d="M6 11 A6 6 0 1 1 18 11 V15 H15 V18 H9 V15 H6 Z" ${S}/><path d="M9.5 11 H10.5 M13.5 11 H14.5" ${S}/></svg>`,
  downed: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 4 V14" ${S}/><path d="M12 18 V19" ${S}/><path d="M4 21 L12 3 L20 21 Z" ${S}/></svg>`,
  hq: `<svg viewBox="0 0 24 24" class="icon"><path d="M4 20 V9 L12 4 L20 9 V20 Z" ${S}/><path d="M9 20 V14 H15 V20" ${S}/></svg>`,
  squad: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 4 L20 18 H4 Z" ${S}/></svg>`,
  sector: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 3 L21 12 L12 21 L3 12 Z" ${S}/></svg>`,
  enemy: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 5 L19 12 L12 19 L5 12 Z" fill="currentColor"/></svg>`,
  left: `<svg viewBox="0 0 24 24" class="icon"><path d="M15 5 L8 12 L15 19" ${S}/></svg>`,
  right: `<svg viewBox="0 0 24 24" class="icon"><path d="M9 5 L16 12 L9 19" ${S}/></svg>`,
  lock: `<svg viewBox="0 0 24 24" class="icon"><rect x="5" y="11" width="14" height="9" ${S}/><path d="M8 11 V8 A4 4 0 0 1 16 8 V11" ${S}/></svg>`,
  star: `<svg viewBox="0 0 24 24" class="icon"><path d="M12 3 L14.6 9 L21 9.5 L16 13.6 L17.6 20 L12 16.5 L6.4 20 L8 13.6 L3 9.5 L9.4 9 Z" ${S}/></svg>`,
};
