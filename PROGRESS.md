# Progress

## Done

- M0: graphics study and scaffold. Elemental Brawl found in the `Claude` repo and studied (graphics only); `STYLE_GUIDE.md`, `UI_GUIDE.md`, `DECISIONS.md`; Electron + Vite + strict TypeScript scaffold; ESLint, Vitest, Playwright smoke harness (Electron under Xvfb, `--autoplay`, 90 s); procedural icon; universal `.dmg` packaging (verified `x86_64 arm64`).
- M1: render foundation. Toon ramp + vertex-colored primitive part kit + inverted-hull outlines (instancing-aware); banded gradient sky with three day keys and storm tint; light rig with camera-following shadows; HDR post pipeline (bloom threshold 1.0, composite for vignette/flash/damage/chroma/desaturation) with dynamic resolution; VFX renderer (particle pools, rings, spheres, flashes, bolts, trails, point lights, tracers, debris chunks, decals) and effect recipes; hex-cell energy shield material; skinned crowd renderer (GPU joint texture, one draw per faction/class); soldier, weapon (12 + attachments), vehicle (4) and prop generators; procedural animator with arm IK; style test scene (`?scene=style`).

## In progress

- M2: soldier controller.

## Next

- M3: gunplay.

## Known gaps

- None yet.
