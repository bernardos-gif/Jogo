# Progress

## Done

- M0: graphics study and scaffold. Elemental Brawl found in the `Claude` repo and studied (graphics only); `STYLE_GUIDE.md`, `UI_GUIDE.md`, `DECISIONS.md`; Electron + Vite + strict TypeScript scaffold; ESLint, Vitest, Playwright smoke harness (Electron under Xvfb, `--autoplay`, 90 s); procedural icon; universal `.dmg` packaging (verified `x86_64 arm64`).
- M1: render foundation. Toon ramp + vertex-colored primitive part kit + inverted-hull outlines (instancing-aware); banded gradient sky with three day keys and storm tint; light rig with camera-following shadows; HDR post pipeline (bloom threshold 1.0, composite for vignette/flash/damage/chroma/desaturation) with dynamic resolution; VFX renderer (particle pools, rings, spheres, flashes, bolts, trails, point lights, tracers, debris chunks, decals) and effect recipes; hex-cell energy shield material; skinned crowd renderer (GPU joint texture, one draw per faction/class); soldier, weapon (12 + attachments), vehicle (4) and prop generators; procedural animator with arm IK; style test scene (`?scene=style`).

- M2: soldier controller. Rapier physics wrapper (heightfield, static boxes, shared kinematic character controller), BVH collision world for rays, world builder (chunked outlined meshes, colliders, BVH, nav input), terrain object, ladders / ziplines / elevators; unified `Soldier` with a per-tick command; movement state machine (walk, sprint, double-tap tactical sprint, crouch, prone, slide, jump, vault, mantle, ladder, zipline, parachute, wingsuit, grapple pull, elevator riding, fall landing, map boundary); first-person camera (FOV setting, bob, landing dip, trauma shake); procedural viewmodel (hip/ADS/sprint/tac-sprint poses, sway, bob, recoil spring, inspect, equip, melee, throw, reload and bolt/pump motions, arms); rebindable input; persistent settings/loadouts/progression save; training ground map; headless movement tests (walk/sprint, jump, mantle, vault, slide/crouch/prone, ladder, zipline).

- M3: gunplay. All 12 weapons with stats in `tuning.ts` (falloff, head/limb multipliers, fire modes, mags, reloads, velocity and drop, ADS and sprint-to-fire, spread and bloom, deterministic recoil patterns, penetration, heat for the Torrent, bolt and pump cycling, rocket lock-on); attachment modifiers; pooled swept-ray projectiles with penetration and homing rockets; damage rules (armor plates, downed, finish, bleed-out, revive with medic speed, assists, regeneration); explosions with occlusion and knockback; frag / smoke / EMP throwables; melee takedowns; analytic hitboxes; event bus; HUD crosshair (real spread), hit markers (hit / head / armor / kill), weapon panel, scope overlays, hold-T attachment cross menu with live swaps and stat bars; firing range with static, strafing and armored targets and a TTK readout; unit tests for falloff, ballistics, recoil determinism, attachments and damage rules.

## In progress

- M4: map.

## Next

- M5: bots.

## Known gaps

- Settings for FOV and sensitivity are live in the save model and used by the camera and controller; their on-screen sliders arrive with the Settings screen (M7).
