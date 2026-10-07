# Vector Front

Vector Front is a large-scale futuristic first-person shooter for macOS. Two factions, the Halcyon Accord and the Korvath Pact, fight 24 v 24 over Breakwater Launch Port. The port is a 1.2 km storm-battered launch facility with five sectors, hover vehicles, gunships and specialists with gadgets. An ion storm crosses the map mid-match, and a rocket on pad A either launches or blows up.

Every model, effect, texture, sound and piece of music is generated in code. Nothing is downloaded at runtime and the game works offline. The 3D look follows the toon style of Elemental Brawl (see `STYLE_GUIDE.md`); everything else is new.

## Download

Get the latest `Vector-Front-…-universal.dmg` from the [Releases page](https://github.com/bernardos-gif/Jogo/releases), then follow "Opening the app" below. Pushing a `v*` tag builds a new release on a macOS runner (`.github/workflows/release.yml`).

## Quick start

Requirements: Node.js 20 or newer and npm. The packaged app runs on macOS 12 or newer, on Apple Silicon or Intel.

```sh
npm install
npm run dev        # Vite dev server + Electron window (the printed URL also works in a browser tab)
npm run build      # typecheck, production build, universal .dmg in ./release
```

`npm run build` writes `release/Vector-Front-1.0.1-universal.dmg`. It holds a single app that runs natively on Apple Silicon and Intel Macs.

### Opening the app (it is not signed by Apple)

1. Open the `.dmg` and drag **Vector Front** into **Applications**.
2. Open Vector Front from Applications. macOS blocks it the first time and says it cannot verify the developer. Click **Done** (or **OK**).
3. Open **System Settings → Privacy & Security** and scroll down to Security. There is a line saying "Vector Front" was blocked. Click **Open Anyway**.
4. Confirm with your password or Touch ID, then click **Open**. From then on it opens normally.

On older macOS versions you can also Control-click the app in Applications, choose **Open**, and confirm.

## Playing

The main menu runs over a live flyover of the battle. **Play** asks for a mode, team size and bot difficulty, then drops you on the deploy screen.

- **Sector Control** (24 v 24 by default, adjustable from 8 v 8 to 32 v 32): capture and hold sectors A to E. The team holding fewer sectors bleeds tickets, and every death costs one ticket. A team at zero tickets loses. You spawn at your HQ, on sectors you hold that are not under attack, or on a squadmate who is out of combat.
- **Skirmish** (8 v 8 infantry): a fast fight in and around Core Plaza. You deploy at drop points with no enemies nearby or on your squad. The first team to 100 kills wins, or the team ahead when the 15-minute clock runs out.

You fight in a squad of four with bots on both sides. Bots capture, defend, flank, take cover, revive, throw grenades, use their gadgets, drive and fly vehicles, fire rocket launchers at armor and call in airdrops.

**Classes and specialists** (pick them on the deploy screen or in Loadout):

| Class | Specialist | Gadget | Passive |
|---|---|---|---|
| Assault | Ilse Varga | Grapnel: grapple to any surface in range | Momentum: faster sprint and sprint-to-fire |
| Assault | Tomi Okonjo | Bulwark: deployable energy wall that stops bullets | Plated: armor plate that rebuilds out of combat |
| Engineer | Bram Halloran | Watchdog: auto sentry turret | Ordnance: two extra rockets |
| Engineer | Nadia Petrova | Arc Tool: repairs friendly vehicles, overloads enemy ones | Insulated: less explosive damage |
| Support | Kemi Adeyemi | Mender: healing and revive darts | Triage: faster revives, full-health revives |
| Support | Soren Lindqvist | Supply Cache: ammo, throwables and armor plates | Stockpile: squad regenerates sooner |
| Recon | Rei Tanaka | Kestrel: pilotable scout drone | Long Gaze: spotted enemies stay marked longer |
| Recon | Lucien Rousseau | Echo: thrown motion sensor | Wingsuit instead of a parachute |

**Loadout:** every soldier carries a primary weapon (12 in all), the Sparrow sidearm, the Hammerhead rocket launcher (which locks on to vehicles) and a throwable (frag, smoke or EMP). Hold **T** in a match to swap attachments (sight, barrel, underbarrel, ammo). Weapons and attachment options unlock with your level. Settings → Gameplay has **Unlock all**.

**Vehicles:** each HQ has pads with a **Wisp** hover buggy (driver plus two open seats where passengers shoot their own weapons) and a **Basalt** hover tank (the driver fires the cannon; the gunner runs the coax beam). Each HQ also has a **Condor** VTOL gunship (rocket pods and a chin turret; **R** switches between hover and cruise) and a **Midge** helicopter (miniguns and a door gun). Wisps and Basalts can also be airdropped from the call-in tablet (hold **B**). Vehicles have hull and component damage, self-repair to half health, and countermeasures (**X**: smoke on ground vehicles, flares on aircraft) that break rocket locks.

**Events:** an ion storm forms at a map edge and crosses the battlefield, usually 4 to 5 minutes in. It pulls in and lifts soldiers and vehicles, tears props apart and throws lightning, with rain and low visibility around it. Later the launch countdown starts on pad A. If the fuel farm next to the pad is still standing, the rocket takes off and scorches the pad. If the farm was destroyed, the rocket explodes on the pad and leaves wreckage. The HUD banner, countdown and minimap warning cone tell you what is coming. The sky drifts from afternoon to dusk over the round.

## Controls

All bindings can be changed in **Controls**.

| Action | Key |
|---|---|
| Move | W A S D |
| Sprint (double-tap: tactical sprint) | Shift |
| Crouch / slide | Ctrl |
| Prone | Z |
| Jump / vault / parachute | Space |
| Fire / aim | Left / right mouse |
| Reload | R |
| Weapons | 1 / 2 / 3 |
| Gadget | 4 |
| Throwable | G |
| Melee | V |
| Fire mode | X |
| Attachments (hold) | T |
| Call-in tablet (hold) | B |
| Interact / enter vehicle | E |
| Ping (hold: comms rose) | Q |
| Vehicle seats | F1 to F4 |
| Vehicle camera | C |
| Full map | M |
| Scoreboard | Tab |
| Pause | Esc |
| Fullscreen | Cmd + Ctrl + F |

**In a vehicle:** W/S throttle, A/D steer, mouse aims the seat's weapon, Space brakes, X countermeasures, E exits. **Aircraft:** the mouse sets the heading; W/S pitch forward and back, A/D strafe and roll, Space climbs, Shift descends, R switches the Condor between hover and cruise. **Kestrel drone:** Space and Shift climb and dive, fire spots, the gadget key returns.

## Settings

- **Graphics:** presets (Low, Medium, High, Ultra) with overrides for shadows, bloom, outlines, particles and resolution scale, plus dynamic resolution, which keeps the frame rate up when it dips.
- **Gameplay:** field of view, hip, ADS and vehicle sensitivity, invert Y, screen shake, head bob, bot difficulty (Recruit, Veteran, Elite), team size and unlock all.
- **Audio:** master, effects, music, interface and announcer volume.
- **Interface:** colorblind palettes, HUD scale and opacity, reduced motion, and a performance readout.

Settings, loadouts and progression are saved in the app's user-data folder (`~/Library/Application Support/Vector Front`).

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload and an Electron window (`npm run dev:web` for the browser only) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (ballistics, falloff, recoil, damage, capture and tickets, spawns, AI utility and aim, navigation, gadgets, vehicles, crews, events, audio, progression) |
| `npm run build:app` | Production web and Electron bundles |
| `npm run smoke` | Playwright: launches the built app in autoplay, plays Sector Control for 90 s through death, deploy, the end of the round, every menu and a storm, and asserts zero console errors and a healthy frame time |
| `npm run soak` | The same harness for 10 minutes (`SOAK_MINUTES`, `SOAK_ARGS` for extra flags) |
| `npm run check` | All of the above except soak |
| `npm run build` | Typecheck, build and package the universal `.dmg` |

Launch flags (append to the Electron command or use as URL parameters in the browser):

- `--autoplay`: the player is driven by bot AI and rounds chain automatically.
- `--mode=skirmish`: start in Skirmish.
- `--events=fast`: the storm and launch come early.
- `--bots=N`: team size.
- `--tickets=N`: starting tickets.
- `--preset=low|medium|high|ultra`: graphics preset.
- `--audio=on|off`: force audio on or off (automated runs are silent by default).
- `--scene=range`: firing range.
- `--scene=style`: style test scene.
- `--spectate[=storm|rocket|wisp|basalt|condor|midge]` and `--tp`: debug cameras.

Every gameplay number lives in `src/config/tuning.ts`. `DECISIONS.md` records the design choices and `PROGRESS.md` tracks the milestones.

### Layout

```
src/core      loop, input, events, flags, save, match flow
src/config    tuning (every gameplay number) and content (names, weapons, specialists, vehicles)
src/render    toon materials, sky, lighting, post effects, VFX, crowd renderer, tactical map, storm visuals
src/art       code-built models (soldiers, weapons, vehicles, gadgets, props)
src/world     terrain, Breakwater map, destruction, navmesh, rocket, world events, weather
src/player    soldier, movement, camera, viewmodel
src/weapons   weapons, ballistics, projectiles, damage, throwables
src/gadgets   specialist gadgets and call-ins
src/vehicles  vehicles, seats, mounts, flight and hover models
src/ai        bot brains, squads, director, aim, gadget use, vehicle crews
src/modes     battle runtime, Sector Control, Skirmish, firing range
src/ui        HUD and screens (DOM/CSS, Canvas 2D maps)
src/audio     Web Audio engine, synthesized sounds, adaptive score
src/net-sim   scoring, progression, unlocks, pings
electron/     main process and preload
tests/        unit tests and the Playwright smoke/soak harness
```

## Troubleshooting

- **The app does not open:** follow the Privacy & Security steps above. The app is ad-hoc signed only.
- **"Error code -36" when dragging the app to Applications:** that was a packaging bug in 1.0.0. Download 1.0.1 or later.
- **Low frame rate:** pick a lower preset or turn down the resolution scale. Dynamic resolution is on by default.
- **No sound:** check the in-game Audio volumes and the macOS output device. In the browser build, sound starts after the first click or key press.
