# Vector Front: UI guide

The interface is a new design made for this game: a dense, military, holographic layer of DOM/CSS over the 3D canvas, with Canvas 2D for the minimap and the tactical map. It shares nothing with Elemental Brawl's menus or HUD. These tokens live as CSS custom properties in `src/ui/styles/tokens.css`; every screen and HUD element uses them.

## 1. Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#05080d` | Deepest backdrop, scrims |
| `--glass` | `rgba(8, 14, 22, 0.62)` | Panel fill (translucent glass-dark) |
| `--glass-strong` | `rgba(8, 14, 22, 0.84)` | Menus, modal panels |
| `--glass-hi` | `rgba(30, 52, 70, 0.55)` | Hover / selected fill |
| `--hair` | `rgba(170, 230, 255, 0.22)` | 1 px hairlines, dividers |
| `--hair-strong` | `rgba(190, 240, 255, 0.55)` | Corner brackets, focused outlines |
| `--fg` | `#e4f7ff` | Primary text (cool cyan-white) |
| `--fg-dim` | `#8fb2c2` | Secondary text, labels |
| `--fg-faint` | `#4f6b78` | Tertiary text, disabled |
| `--cyan` | `#3fd7ff` | Primary accent, friendly, selection |
| `--cyan-glow` | `rgba(63, 215, 255, 0.35)` | Glows, scan sweeps |
| `--amber` | `#ffb340` | Warnings, contested, low ammo, events |
| `--red` | `#ff4458` | Threats, enemies, damage, critical |
| `--squad` | `#8dff7a` | Own squad (nameplates, minimap, list) |
| `--neutral` | `#c8d2dc` | Neutral objectives |

Team colors are relative to the player (friendly / enemy), never the faction's 3D colors. Colorblind palettes swap three tokens (`--friend`, `--foe`, `--squad`):

| Palette | Friend | Foe | Squad |
| --- | --- | --- | --- |
| Default | `#3fd7ff` | `#ff4458` | `#8dff7a` |
| Deuteranopia | `#4aa8ff` | `#ffb000` | `#f2f2f2` |
| Protanopia | `#3f8cff` | `#ffd23a` | `#f2f2f2` |
| Tritanopia | `#00d6c0` | `#ff3c78` | `#ffffff` |

## 2. Typography

| Role | Family | Weights | Treatment |
| --- | --- | --- | --- |
| Display | Rajdhani (geometric, condensed) | 500, 600, 700 | Uppercase, letter-spacing 0.08em (headings) / 0.14em (labels) |
| Body | Inter | 400, 500, 600 | Sentence case, letter-spacing 0 |
| Numerals | JetBrains Mono | 400, 600 | `font-variant-numeric: tabular-nums`, letter-spacing 0.02em |

Bundled with `@fontsource/rajdhani`, `@fontsource/inter`, `@fontsource/jetbrains-mono`; nothing is fetched at runtime.

Type scale (px at HUD scale 1.0): 10, 11, 12, 13, 15, 18, 22, 28, 36, 48, 72. Labels 10-11 px display uppercase; values 13-22 px mono; screen titles 36-72 px display 700.

## 3. Shape and detail

- Panels: square corners, 1 px `--hair` border, `--glass` fill with `backdrop-filter: blur(6px)` where supported.
- Corner brackets: four L-shaped 1 px marks in `--hair-strong`, arms 10 px (panels) or 6 px (chips), drawn with gradients so they need no extra elements.
- Fine grid: a 12 px grid of `rgba(170, 230, 255, 0.04)` lines inside large panels and the tactical map.
- Tick marks: 1 px ticks every 5 deg on the compass, every 10 % on bars; major ticks 2x length.
- Bars: 3-4 px tall, unfilled track `rgba(170, 230, 255, 0.12)`, fill solid token color, segmented by 1 px gaps every 10 %.
- Buttons: 1 px outline, display font uppercase, hover fills `--glass-hi` and lights the left edge with a 2 px `--cyan` bar.
- Icons: drawn in code as inline SVG (stroke 1.5 px, square caps) or Canvas 2D; no image files.
- Spacing on a 4 px grid: 4, 8, 12, 16, 24, 32, 48.

## 4. Motion

| Motion | Duration | Easing |
| --- | --- | --- |
| Scan sweep on panel entry (a bright band crossing the panel top to bottom) | 420 ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| Panel fade/slide in | 220 ms, 8 px | same |
| Number tick-up (score, XP, tickets on screen entry) | 300-900 ms | ease-out |
| Chromatic glitch on heavy damage (RGB split of the HUD + post pass) | 180 ms | steps(3) |
| Hit marker | in 60 ms, hold 90 ms, out 160 ms | ease-out |
| Kill feed entry | slide 200 ms; lifetime 6 s; fade 400 ms | ease-out |
| Score events | stack and merge within 2.4 s; fade 300 ms | ease-out |
| Event banner | 600 ms in, 4 s hold, 500 ms out | ease-out |
| Capture ring progress | continuous, no easing | linear |

`prefers-reduced-motion: reduce` or the HUD motion setting "Reduced" disables sweeps, glitches, tick-ups and slides (state changes become instant fades of at most 120 ms). Screen shake has its own strength setting.

## 5. Layout of the in-match HUD (1920x1080 reference, scaled by the HUD scale setting)

| Region | Content |
| --- | --- |
| Top center | Compass strip (bearing, objective letters), objective row A-E, ticket bars on both sides |
| Top right | Kill feed |
| Center right | Score event stack |
| Center | Crosshair, hit markers, damage arcs, grenade indicators, capture ring, interaction prompt |
| Bottom left | Rotating minimap, squad list |
| Bottom right | Weapon panel, ammo, fire mode, attachments, gadget / throwable cooldowns, health and armor |
| Top left | Event banners, match clock |
| Full screen overlays | Scopes, attachment cross, call-in tablet, comms rose, vehicle HUD, kill cam card, low-health vignette |

Margins: 24 px from screen edges. HUD opacity setting multiplies every HUD element's alpha (0.4 to 1.0).
