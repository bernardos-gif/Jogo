# Decisions made on your behalf

One line per choice. Newest entries are appended at the end of each section.

## Project and tooling

- Style source: Elemental Brawl sits at the root of `bernardos-gif/claude`; no local `Claude` folder existed and `gh` is not installed here, so the repository was attached through the session's GitHub access and cloned read-only into `_reference/Claude` (git-ignored, never modified).
- Project location: this repository (`bernardos-gif/Jogo`, branch `claude/festive-knuth-kvtk06`) was empty, so Vector Front lives at its root with its own fresh history.
- TypeScript 6.0 instead of 7.0: `typescript-eslint` supports TypeScript below 6.1 only.
- Runtime libraries (three, rapier, three-mesh-bvh, recast-navigation, fonts) are dev dependencies: Vite bundles them into `dist/`, so the packaged app ships no `node_modules`.
- `npm run dev` starts the Vite server (any browser tab can open the printed URL) and launches Electron against it; `npm run dev:web` starts only the browser version.
- Packaging on Linux cross-builds the universal app (per-arch electron-builder, `@electron/universal`, `rcodesign` ad-hoc signature, `xorrisofs` + libdmg-hfsplus `dmg`); on macOS `npm run build` calls electron-builder's native DMG path.
- The app icon is drawn by `scripts/make-icon.mjs` (signed distance shapes rasterized to PNG in Node) so the project has no image files.
- The smoke test drives the real Electron build through Playwright under Xvfb with Chromium's software WebGL; its frame-time limit (`TUNING.test`) is set for software rendering, which is far slower than an M1 GPU.

## Names (all invented)

- Game: Vector Front. Map: Breakwater Launch Port.
- Factions: Halcyon Accord (ivory armor, steel blue, cyan emissive) and Korvath Pact (graphite armor, oxblood, magenta-red emissive); chosen for maximum hue separation under the warm sunset lighting.
- Districts: A Gantry (launch complex), B Moorings (container port), C Core Plaza, D Sunfield (solar field), E Ridgeline Relay.
- Specialists: Assault VARGA (Grapnel hook) and OKONJO (Bulwark shield); Engineer HALLORAN (Watchdog sentry) and PETROVA (Arc Tool repair/EMP); Support ADEYEMI (Mender dart launcher) and LINDQVIST (Supply Cache); Recon TANAKA (Kestrel drone) and ROUSSEAU (Echo motion sensor + wingsuit).
- Weapons: Tern AR-4, Lumen ER-9 (energy), Wasp SMG-11, Flicker EPD (energy), Anvil LMG-2, Torrent HL-6 (energy, heat-cycled), Sable DMR-7, Prism EMR-3 (energy), Longbow BR-12 (bolt), Maul SG-8, Sparrow P-2, Hammerhead RL.
- Vehicles: Wisp (hover buggy), Basalt (hover tank), Condor (VTOL gunship), Midge (scout heli).

## Graphics

- Elemental Brawl's look is reproduced exactly (toon ramp, vertex-colored primitive models, inverted-hull outlines, glow materials above 1.0 with bloom threshold 1.0, banded gradient sky, instanced low-poly particles); see `STYLE_GUIDE.md`.
- Fog distances, shadow box and pool sizes are scaled from the 60 m arena to the 1.2 km battlefield; colors and formulas are unchanged.
- Day-to-dusk drift interpolates three sky keys; the middle key is Elemental Brawl's exact sunset.
- Soldiers keep the 15-joint toy-figure proportions at 0.86 scale (about 1.85 m), with helmets and glowing visors instead of faces.
- Terrain has no outline: its flat-shaded facets carry the shape, as Elemental Brawl's floor tiles do.

## Map

- North is -Z: Halcyon Accord holds the south HQ, Korvath Pact the north HQ; the sea runs along the east edge so B Moorings sits on the waterline.
- Districts sit on flattened pads, so every capture zone is fightable on foot; E Ridgeline sits on a 46 m hill for the verticality the brief asks for.
- Roads are separate ribbons laid over smoothed road beds and lifted to the highest nearby terrain facet, so no facet pokes through.
- Destructibles stay out of the navmesh (bots path through where walls used to stand, and treat standing walls as obstacles through line-of-sight checks).
- Water is shallow everywhere: soldiers wade at reduced speed instead of swimming; vehicles cross it.
- The Skirmish arena is Core Plaza (C) fenced at a 105 m radius.
- The rocket on pad A carries colliders until the launch event lifts it off.
- Fog reaches further than in Elemental Brawl (fog end 600-1150 m by preset) so long sightlines across the port stay readable.

## Bots and Sector Control

- Default difficulty is Veteran; Recruit and Elite are the other two presets (Settings, M11).
- Bot aim error is measured in meters at the target and converted to an angle, so accuracy reads naturally at every range; the error wanders around the target (an Ornstein-Uhlenbeck process) instead of snapping.
- Far bots fighting far bots resolve shots analytically against the target's hitboxes (perception already checked the sight line); anything involving the player always runs the full projectile simulation.
- `--bots=N` sets the team size (N per team, clamped to 8-32); the default comes from Settings (24).
- All five zones start neutral; both teams race from their HQs.
- A downed bot with no teammate within 45 m gives up after 8 s, which keeps the respawn flow moving.
- Bot class mix: 34% assault, 22% engineer, 24% support, 20% recon, each with a class-appropriate weapon pool and random attachments.
- Squad callsigns are invented (Aster, Bastion, Cinder, Drift, Ember, Flux, Gale, Halo, Ion, Juniper, Kite, Lumen); the player leads nothing and joins Aster squad.
- Bots spot enemies they see (6 s cooldown) and sometimes ping them, the same way a player would.

- Kill credit and the kill-feed entry happen when a soldier is downed (the downing player earns the kill even if the victim is revived later); a finished or bled-out soldier costs the ticket.
- The player joins every round on the deploy screen; bots deploy at their HQ right away.
- Sector defense score: a kill where the killer or the victim stands inside a sector the killer's team owns.
- XP: one XP per score point, plus 500 for a win and 250 for finishing the round; levels need 1200 XP growing 10% per level, up to level 50.
- Unlock levels: Tern, Wasp, Anvil, Sable, Sparrow and Hammerhead from the start; Maul 2, Lumen 3, Flicker 4, Prism 6, Torrent 8, Longbow 10; attachment options 1/2/3 of every slot at levels 1/3/6.
- `--tickets=N` overrides the starting tickets for tests; the smoke test drives the player's death and the end of round through test hooks.

## UI
- The tactical map is captured once after load (an orthographic top-down render into height and normal targets with a line-treatment pass) and read back to a 2D canvas; live overlays are drawn on top with Canvas 2D every frame the map is visible.

- Fonts: Rajdhani (display), Inter (body), JetBrains Mono (tabular numerals).
- HUD team colors are relative to the player (cyan friend, red foe, green squad); factions keep their own 3D colors.
- The main menu runs over the live battle: bots keep fighting behind the menu while a spline camera flies over the districts; Play restarts the round (a new roster when the team size changed).
- Pause halts the simulation (the battle is single-player with bots).
- The loadout screen renders its weapon preview with a second, small WebGL renderer so the menu works without touching the battle renderer.
- Saved attachments that are still locked fall back to the weapon's defaults when you deploy.
- Tap Q pings what is under the crosshair (an enemy gets spotted and the ping follows it); hold Q opens the comms rose (attack, enemy, defend, vehicle, need ammo, need medic, go here).
- The performance readout (fps, frame and sim times, draw calls, render scale) is off by default and lives under Settings → Interface.

## Specialists and gadgets

- Every soldier carries the gadget of their specialist on the gadget key (4); the Mender fires on release and self-heals on a hold, the Arc Tool works while held and overheats.
- Bulwark walls stop bullets from both sides and block movement, so they work as real cover for either team; they last 22 s or until shot down.
- Mender darts revive a downed ally they hit (the support class's revive tool at range).
- Supply caches hand out an armor plate to anyone who stands at them, which is how soldiers other than Okonjo get armor.
- Bots fly their Kestrel on autopilot in an orbit over their squad's objective; the player pilots it from the drone's own camera (Space / Shift climb and dive, fire to spot).
- The call-in tablet offers the two ground vehicles (Wisp and Basalt); aircraft spawn on the HQ pads instead of being airdropped.

## Vehicles

- Controls in a vehicle: W/S throttle (aircraft: nose down and forward / back), A/D steer (aircraft: strafe and roll), mouse aims the seat's weapon (aircraft: heading), Space brake (aircraft: climb), Shift (aircraft: descend), X countermeasures (smoke on ground vehicles, flares on aircraft; the fire-mode key, unused in a vehicle seat), R toggles the Condor's hover and cruise modes (the reload key; mounts reload by themselves), C switches seat and chase cameras, E exits, F1-F4 switch seats.
- The Basalt's driver also aims and fires the main cannon (a one-person tank stays useful); the second seat is the coax gunner.
- Wisp passengers keep their own weapons and can be shot; Basalt and Condor seats are enclosed, and the Midge's door gunner is exposed.
- Vehicles are dynamic Rapier bodies with locked rotations whose velocity and rotation the vehicle code sets each tick (an arcade model with physical collisions against the world and each other); crash damage counts horizontal speed lost against an obstacle only.
- Self-repair restores the hull to 50% after 8 s without damage; Petrova's Arc Tool repairs the rest.
- Only Wisp and Basalt can be airdropped; aircraft spawn on HQ pads.
- Enemy crewed vehicles appear on the minimap within 180 m (they are loud); empty vehicles appear in grey for everyone.

## Bot crews

- Bots consider vehicles only for trips over 160 m (joining a squadmate's vehicle from 70 m), within 30 m of the bot; an empty aircraft tempts a bot half the time and a Basalt 60% of the time, so pads empty steadily without every bot queueing for them.
- Bot pilots fly an orbit 120 m around their squad's objective at 70 m above the terrain ahead and dive on targets to 38 m, pulling out at 45 m from the target; this keeps aircraft visible and threatening without making them unbeatable.
- Bots fire launchers at vehicles only on a lock, or dumb-fire inside 70 m after holding aim for 2.5 s.

## Dynamic events and weather

- The first ion storm comes 3.5 to 5.5 minutes into a round, and half the rounds get a second one at 12.5 to 15 minutes; the launch countdown starts at 9.5 to 12 minutes. Rounds that end sooner skip what has not happened yet.
- The storm always crosses east to west or west to east, aimed at one of the middle objectives, so it cuts across the fight between the HQs instead of running along a base.
- "Fuel tanks destroyed" means half or more of the four tagged tanks at the fuel farm; the tanks chain-react, so one good hit usually takes the farm and dooms the rocket.
- Launch outcomes are permanent for the round; a new round restores the rocket and clears the rubble. The rubble does not rebuild the navmesh (bots treat it as an obstacle they steer around).
- The day starts in the afternoon and passes Elemental Brawl's exact sunset at the round's midpoint, ending at dusk after 20 minutes.
- Lightning and the storm core credit no attacker; deaths show the storm or lightning as the cause in the kill feed.

## Audio

- All audio is synthesized at runtime with Web Audio (oscillators, generated noise and generated reverb impulses); there are no audio files.
- Electron starts audio without a click (`autoplay-policy`); the browser build unlocks it on the first key or pointer press.
- Remote gunshots are rate-limited per soldier (one sound per 45 ms) and impacts to a few per frame; sounds past their hearing range are skipped and far gunshots drop their transient layer, which keeps a 48-soldier firefight within the voice budget.
- Smoke and soak runs are silent by default because CI machines have no audio device; `--audio=on` turns audio on for automated checks.

## Skirmish

- Skirmish is a fast infantry mode: 8 v 8 in and around Core Plaza (five drop points: the plaza and four points 95 m out), first to 100 kills (about 9 minutes with bots) or the most kills after 15 minutes, 4 s respawns, no vehicles or airdrops. Ownership of a drop point follows whoever stands at it, which is what the bots chase, so squads keep running into each other.
- Deaths without an enemy killer (storm, lightning, falls, suicides) count for the other team.

## Balance and release (M12)

- Sector Control starts at 450 tickets with a bleed of 0.3, 0.55, 0.85, 1.2 and 1.7 tickets per second for a sector lead of 1 to 5. Soak data at 24 v 24 showed the losing team draining about 21 tickets a minute on the old values (600 tickets), which put rounds near 29 minutes; the new values aim at 15 to 20 minutes.
- Bot pilots keep 2.5 storm pull radii away from the ion storm; ground bots run from it inside 75 m.
- The Wisp's roll cage is tall enough that first-person cameras in its seats sit under the top rails.
- The packaged app is ad-hoc signed (no Apple Developer ID or notarization is available here), so the first launch needs System Settings → Privacy & Security → Open Anyway, as the README explains.

