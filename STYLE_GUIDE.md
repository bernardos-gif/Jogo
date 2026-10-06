# Vector Front: 3D graphics style guide

Source of truth: **Elemental Brawl**, found at the root of the `Claude` repository (`bernardos-gif/claude`, commit `7bb862f`), cloned read-only into `_reference/Claude/`. Only the way the 3D world is drawn carries over. Values marked **EB** are copied exactly from that project; values marked **VF** are this game's adaptation of the same technique to a 1.2 km battlefield, a first-person camera and futuristic content.

Code that implements this guide: `src/render/toon.ts` (materials, outlines, part kit), `src/render/sky.ts`, `src/render/lighting.ts`, `src/render/post.ts`, `src/render/vfx.ts`, `src/art/*`.

## 1. Renderer

| Setting | Value |
| --- | --- |
| Renderer | `THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })` **EB** |
| Output color space | `THREE.SRGBColorSpace` **EB** |
| Tone mapping | none (`NoToneMapping`). Lit surfaces stay at or below 1.0; only glow surfaces exceed it **EB** |
| Shadows | `PCFShadowMap`, one directional sun **EB** |
| Pixel ratio cap | Low 1.0, Medium 1.25, High 1.5 **EB**; multiplied by the dynamic resolution scale **VF** |
| HDR target | `HalfFloatType` render target, MSAA samples Low 0, Medium 2, High 4 **EB** |

## 2. Materials and shading

**Toon base.** Every lit surface uses `MeshToonMaterial` with a shared 3-step gradient map: a 3x1 `DataTexture` with values `90, 175, 255` (35%, 69%, 100%), nearest filtering, no mipmaps **EB**. Surfaces are flat-shaded: each primitive is converted to non-indexed geometry and `computeVertexNormals()` runs per part, so every face catches one tone of the ramp **EB**.

**Vertex color, one material.** Models are assembled from primitive "parts" that carry their color in a vertex `color` attribute. All parts of a model (or of a rig joint) are merged into one geometry and drawn with one shared white toon material with `vertexColors: true` **EB**. UVs are deleted; there are no textures on lit surfaces **EB**.

**Glow material.** Emissive details (visors, trim lines, holograms, lamps) use `MeshBasicMaterial({ vertexColors: true, toneMapped: false })` with `color.setScalar(k)` pushing them above 1.0 so they bloom: rig details `k = 1.9`, world lamps `k = 1.5`, effect cores `k = 2.2` **EB**. Additive effect shells use `AdditiveBlending, depthWrite: false, toneMapped: false` with color multiplied by 2.0 **EB**.

**Inverted-hull outlines.** Every toon mesh gets a second mesh sharing its geometry with an outline `ShaderMaterial` (`side: BackSide`, fog-aware) **EB**:

- Each geometry carries an `outlineNormal` attribute: normals welded by position (rounded to 1/1000) and averaged, so hard-edged boxes produce a gap-free hull **EB**.
- Vertex shader pushes the view-space position along the view-space welded normal by `w = max(thickness, -mvPosition.z * 0.0021)`, which is a constant ~2 px line on screen beyond a few meters **EB**.
- Color `#140a10` for world props, `#0b0610` for characters, thickness `0.035` (world) / `0.032` (characters) **EB**. VF: vehicles use the character values; terrain has no outline (its facets carry the shape, matching EB's tiled floor).
- VF: the outline shader also supports `InstancedMesh` (`instanceMatrix`), so instanced soldiers and props keep their outlines.

**Hit flash.** A struck model flashes by setting the toon material's emissive to `rgb(1, 0.96, 0.9)` with intensity `min(0.7, t * 6)` for 0.12 s **EB**. VF: soldiers drawn with instancing flash through a per-instance flash attribute with the same color and curve.

**Energy surfaces (shields, holograms).** Additive, double-sided shader with a hex-cell line grid (hex distance `max(dot(p, vec2(0.5, 0.866)), p.x)`, line `1 - smoothstep(0, 0.05, edge)`), fresnel `pow(1 - |N.V|, 3)`, a rising scan band `exp(-((y - scanY) * 0.6)^2)` moving at 2.6 u/s, random per-cell pulses `pow(0.5 + 0.5 sin(t * (0.5 + h * 1.3) + h * 40), 8)`, and hit ripples (ring `exp(-((d - age * 12) * 1.2)^2) * exp(-age * 2.2)`, max 12) **EB**. Base color `#6fd8ff`, line `#b4f2ff` **EB**; VF tints it by faction for team-owned shields.

## 3. Model construction

- Everything is built from primitives in code: `BoxGeometry` dominates; `Cylinder`, `Cone`, `Icosahedron`, `Octahedron`, `Dodecahedron`, `Tetrahedron`, `Torus` for accents **EB**.
- Parts are placed with a compact transform `{x, y, z, rx, ry, rz, sx, sy, sz}` and merged per material **EB**.
- Characters are chunky "toy figures" on a 15-joint rig (hips, spine, neck, shoulders, elbows, hands, hips, knees, feet). One merged toon mesh (plus outline) and one merged glow mesh per joint **EB**.
- Default proportions (units = meters at scale 1) **EB**: torso 0.66 x 0.62 x 0.40, pelvis width 0.56, head 0.50 x 0.48, arm thickness 0.21, upper arm 0.36, forearm 0.32, hand cube 0.27, leg thickness 0.26, thigh 0.36, shin 0.32, boot 0.31 x 0.24 x 0.46. Hip height = `bootH * 0.55 + shin + thigh + 0.06` = 0.87. Total height about 2.15.
- VF soldiers keep those proportions and box construction, scaled by 0.86 (about 1.85 m tall), with a helmet block replacing hair and a glowing visor strip replacing the toy eyes. Armor plates are extra boxes on the torso, shoulders and shins.
- Palettes are per-model: `primary, secondary, accent, dark, boots, glow` **EB** (`skin, hair, eyes` drop out under helmets). Shade variants are produced by shifting HSL lightness (`shade(hex, amount)`) **EB**.
- Animation is procedural, driven by code each frame (joint Euler rotations plus hip offsets) **EB**.
- Destructible props split into box "chunks" drawn by one instanced toon mesh (max 320 chunks in EB, VF 400) with physics **EB**.

## 4. Lighting, fog and sky

**Lights (EB values, used at the "sunset" key of the day cycle).**

| Light | Value |
| --- | --- |
| `HemisphereLight` | sky `#ffd6b0`, ground `#6a4a7a`, intensity 1.15 |
| `AmbientLight` | `#ffffff`, intensity 0.35 |
| `DirectionalLight` (sun) | `#ffe0b8`, intensity 2.4, direction `(-0.62, 0.22, -0.75)` normalized (a low sun) |
| Sun shadow | ortho box +/-34, near 1, far 160, bias -0.0006, normalBias 0.03, map 512 / 1024 / 2048 per preset; the frustum follows the action |

VF: the shadow box is +/-70 m around the player (+/-45 on Medium), following the camera, with the map sizes above.

**Fog.** Linear `THREE.Fog(#f2a77a, 70, 260)` and background `#f0a070` **EB**: a warm peach haze that swallows distance. VF keeps the color logic and scales the distances to the battlefield: near 110, far 900 (High), 80 / 650 (Medium), 60 / 480 (Low).

**Sky dome.** Back-faced sphere with a shader drawn at the far plane (`gl_Position.z = gl_Position.w`) **EB**:

- Above the horizon: `mix(horizon, mid, smoothstep(0, 0.18, y))`, then `mix(col, top, smoothstep(0.12, 0.75, y))`. Below: `mix(horizon, below, smoothstep(0, 0.25, -y))`.
- Sun: `sunColor * (pow(s, 600) * 1.6 + pow(s, 40) * 0.4 + pow(s, 6) * 0.16)` with `s = max(dot(d, sunDir), 0)`.
- Stylized banding: `col = floor(col * 28) / 28`.
- Sunset palette: top `#2b2766`, mid `#c4567e`, horizon `#ffa860`, below `#e98d73`, sun `#fff0b0`.
- Clouds: instanced low-poly icosahedron puffs (detail 0), toon-shaded, stretched `1.1-1.6 x 0.55-0.8 x 1.1-1.5`, tints `#fff1e6 #ffd7c2 #ffc1b0 #f6b0b8 #ffe3c8`, slow rotation 0.004 rad/s.

**VF day-to-dusk drift.** The match starts at a "late afternoon" key and drifts through EB's exact sunset key to a "dusk" key. All three keys share EB's structure (warm horizon, violet zenith, violet hemisphere ground color); afternoon is a brighter, higher-sun variant and dusk a darker, violet variant:

| Key | Sun elevation | top | mid | horizon | below | fog | sun light |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Afternoon | 24 deg | `#3a4a8c` | `#d9839a` | `#ffc27a` | `#efb08a` | `#f4bf92` | `#fff0d0` x 2.6 |
| Sunset (EB) | 12.7 deg | `#2b2766` | `#c4567e` | `#ffa860` | `#e98d73` | `#f2a77a` | `#ffe0b8` x 2.4 |
| Dusk | 4 deg | `#1a1840` | `#7a3a6a` | `#e0704a` | `#9a5a6a` | `#b07068` | `#ffb890` x 1.6 |

Storm proximity darkens the sky and fog toward `#3a3550` and raises fog density (VF).

## 5. Post effects

- Pipeline: scene into the HDR target, `UnrealBloomPass(strength 0.6, radius 0.42, threshold 1.0)`, then `OutputPass` **EB**. Bloom strength per preset 0.5 / 0.58 / 0.65 **EB**.
- Because only glow materials exceed 1.0 (threshold), the toon world stays crisp and only effects, trims and tracers bleed light **EB**.
- VF adds one composite pass before output: vignette, full-screen flash, damage edge tint and a brief chromatic offset on heavy hits (the "vignette and full-screen flash" of the fallback spec).

## 6. Effects rendering

**Particles.** Pools of low-poly instanced meshes (not point sprites) **EB**:

| Shape | Geometry |
| --- | --- |
| cube | `BoxGeometry(1,1,1)` |
| spark | `BoxGeometry(0.35, 0.35, 1.6)` stretched along velocity: `size * stretch * clamp(speed / 8, 0.4, 2.2)` on z |
| tetra | `TetrahedronGeometry(0.75)` |
| puff | `IcosahedronGeometry(0.62, 0)` |

- Additive pools use `MeshBasicMaterial` additive, `depthWrite: false`, `toneMapped: false`; non-additive pools (debris, smoke) use the toon material so chunks are lit like the world **EB**.
- Per-particle data in one packed `Float32Array` (stride 22): position, velocity, life, size start/end, color start/end, gravity, drag, rotation, spin, stretch; swap-remove on death **EB**.
- Motion: `v *= exp(-drag * dt)`, `vy -= gravity * dt`; non-additive particles bounce off the ground (`vy *= -0.3`, `vxz *= 0.7`) **EB**.
- Additive brightness: `a = (1 - k)^0.7 * 1.25 * GLOW`, with `GLOW = 2.1` the HDR multiplier that makes effects bloom **EB**.
- Pool sizes scale with preset `maxParticles` 900 / 1800 / 3200 and `particleScale` 0.45 / 0.75 / 1.0 **EB**.

**Rings.** Plane (2x2) with a radial ring texture (stops 0 / 0.62 / 0.86 / 0.94 / 1 at alpha 0 / 0.12 / 0.9 / 1 / 0), additive. Expansion `r0 + (r1 - r0) * (1 - (1 - k)^3)`, opacity `1 - k`, color `* GLOW * 0.75` **EB**.

**Blast spheres.** `IcosahedronGeometry(1, 1)` additive, scale `r0 + (r1 - r0) * (1 - (1 - k)^2)`, opacity `(1 - k) * 0.85` **EB**.

**Flashes.** Sprites with a radial gradient texture (stops 0 / 0.25 / 0.6 / 1 at alpha 1 / 0.85 / 0.25 / 0), scale `size * (0.6 + 0.8k)`, opacity `1 - k`, color `* GLOW` **EB**.

**Bolts.** Jagged polylines: 9 segments by default, jitter `jag * min(1, len / 4) * rand(0.4, 1)`, one side branch; each segment is an instanced box (cap 400) oriented along the segment, width `width * k * 1.4`, color `* 1.6 * GLOW * k * flicker(0.7..1.0)` **EB**.

**Trails / afterimages.** Camera-facing ribbon (14 points) with vertex colors, additive, width tapering `width * (1 - i / (n - 1))`, alpha `k^2 * fade`, fade-out 5/s **EB**. VF uses it for tracers, grapple lines, rockets and wingsuit streaks.

**Point lights.** A pool of 3 `PointLight(color, 0, 14, 1.6)` reused round-robin, intensity decaying linearly over the effect life **EB**.

**Impact recipe.** Flash (light color) + spark burst along the hit normal + lit cube chunks with gravity; heavy hits add a ring, a blast sphere and a point light **EB**. VF chooses the colors by surface material (section 7) rather than by element.

## 7. Color mood and VF palette

EB scenes are warm sunsets: peach fog, violet shadow fill, saturated accents carried by emissive surfaces. Vector Front keeps that mood and adds a futuristic launch port:

| Use | Colors |
| --- | --- |
| Terrain | sand `#c9a77c`, dry grass `#9a9a5a`, rock `#8a7464`, dark rock `#5d4c48`, wet shore `#7a6a62` |
| Concrete / pads | `#cdbba2`, `#b9a68e`, `#a8957e`, scorched `#5a4a48` |
| Metal structures | gunmetal `#5a5f6e`, steel `#8a90a0`, hazard `#e0a020`, warning red `#c04a3a` |
| Containers | `#c0503a`, `#2f8fb0`, `#e0a020`, `#3a9a5a`, `#8a6ab0` |
| Glass / panels | `#6ab0c8` (lit), glow trim `#ffcf6a` (warm lamps) and `#7cf0ff` (tech) |
| Water | toon plane `#3a6a8a` with lighter facets `#5a8aa8` |

Factions (identity in 3D; the HUD uses friend/foe colors instead, see `UI_GUIDE.md`):

| Faction | Armor | Secondary | Dark | Emissive |
| --- | --- | --- | --- | --- |
| Halcyon Accord | ivory `#e8e2d4` | steel blue `#3d6fa8` | `#232838` | cyan `#3fe0ff` |
| Korvath Pact | graphite `#4a4450` | oxblood `#b03a3a` | `#221c24` | magenta-red `#ff3a5c` |

Projectile and impact colors:

| Kind | Core | Light |
| --- | --- | --- |
| Kinetic tracer | `#ffb52e` | `#fff4c8` |
| Energy (cyan family) | `#3fe0ff` | `#d8fbff` |
| Energy (violet family) | `#b56bff` | `#efdcff` |
| Rocket / explosion | `#ff5a1f` | `#ffd04a` |
| EMP | `#7cc8ff` | `#eaf8ff` |
| Metal impact sparks | `#ffb030` | `#fff0b0` |
| Concrete impact | chunks `#b9a68e`, dust puffs `#d8c8b0` |
| Dirt impact | chunks `#7a6a58`, puffs `#a08868` |
| Glass impact | shards `#cfefff` |
| Wood impact | splinters `#a8733f` |
| Armor hit (soldier) | faction emissive sparks; no blood |
