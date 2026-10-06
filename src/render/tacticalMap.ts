// Tactical map capture: an orthographic top-down render of the battlefield into a height-and-normal
// target, then a holographic line treatment (height and normal edges in cyan, contour lines every
// few meters, a 50 m grid, hillshade on a deep blue-black ground, teal water, scanlines). The result
// is read back once into a 2D canvas that the deploy screen and the full map draw their overlays on.
import * as THREE from 'three';

export interface TacticalImage {
  canvas: HTMLCanvasElement;
  /** World extent covered (meters, centered on the origin; north = -Z is up). */
  worldSize: number;
}

const DATA_VS = /* glsl */ `
varying vec3 vN;
varying float vH;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * p;
  vH = wp.y;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const DATA_FS = /* glsl */ `
uniform float hScale;
uniform float hOffset;
varying vec3 vN;
varying float vH;
void main() {
  vec3 n = normalize(vN);
  if (n.y < 0.0) n = -n;
  gl_FragColor = vec4(n.x * 0.5 + 0.5, n.z * 0.5 + 0.5, (vH + hOffset) / hScale, 1.0);
}`;

const HOLO_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const HOLO_FS = /* glsl */ `
uniform sampler2D tData;
uniform vec2 texel;
uniform float hScale;
uniform float hOffset;
uniform float worldSize;
uniform float water;
uniform float seaX;
uniform float limit;
varying vec2 vUv;

vec4 D(vec2 o) { return texture2D(tData, vUv + o * texel); }
float H(vec2 o) { return D(o).b * hScale - hOffset; }
vec3 N(vec4 c) {
  vec2 xz = vec2(c.r, c.g) * 2.0 - 1.0;
  return vec3(xz.x, sqrt(max(0.0, 1.0 - dot(xz, xz))), xz.y);
}

void main() {
  vec4 c = D(vec2(0.0));
  vec3 bg = vec3(0.012, 0.022, 0.035);
  if (c.a < 0.5) { gl_FragColor = vec4(bg, 1.0); return; }
  float h = H(vec2(0.0));
  vec3 n = N(c);
  // Height edges (Sobel): walls, roofs, cliffs.
  float tl = H(vec2(-1.0, 1.0)), t = H(vec2(0.0, 1.0)), tr = H(vec2(1.0, 1.0));
  float l = H(vec2(-1.0, 0.0)), r = H(vec2(1.0, 0.0));
  float bl = H(vec2(-1.0, -1.0)), b = H(vec2(0.0, -1.0)), br = H(vec2(1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float g = length(vec2(gx, gy));
  // Wall-height jumps: the Laplacian spikes at discontinuities but stays near zero on slopes.
  float lap = l + r + t + b - 4.0 * h;
  float edge = max(smoothstep(0.7, 2.2, abs(lap)), smoothstep(22.0, 40.0, g));
  // Hillshade from the smoothed height field (geometry normals are faceted).
  float hx = H(vec2(2.0, 0.0)) - H(vec2(-2.0, 0.0));
  float hz = H(vec2(0.0, 2.0)) - H(vec2(0.0, -2.0));
  float mpp = worldSize * texel.x;
  // +v in texture space is north (-z), so hz is -dh/dz; light comes from the north-west.
  vec3 sn = normalize(vec3(-hx, 4.0 * mpp, hz));
  float shade = clamp(dot(sn, normalize(vec3(-0.55, 0.75, -0.45))), 0.0, 1.0);
  vec3 col = mix(vec3(0.022, 0.06, 0.085), vec3(0.06, 0.18, 0.22), shade);
  col += vec3(0.0, 0.025, 0.035) * clamp(h / 60.0, 0.0, 1.0);
  // Flat roofs and decks (built surfaces) read slightly brighter.
  if (n.y > 0.995 && edge < 0.5 && g < 2.0) col += vec3(0.01, 0.025, 0.03);
  // Water.
  vec2 w = vec2(vUv.x - 0.5, 0.5 - vUv.y) * worldSize;
  bool sea = h < water + 0.25 && w.x > seaX - 60.0 && n.y > 0.97;
  if (sea) col = vec3(0.01, 0.06, 0.08) + vec3(0.0, 0.035, 0.045) * step(0.5, fract(gl_FragCoord.y * 0.25));
  // Contours every 5 m, faded where they crowd together on steep ground.
  float hc = h / 5.0;
  float fw = max(fwidth(hc), 1e-4);
  float fc = fract(hc);
  float contour = (1.0 - smoothstep(0.0, fw * 1.2, min(fc, 1.0 - fc))) * (1.0 - smoothstep(0.12, 0.35, fw));
  // 50 m grid.
  vec2 gw = w / 50.0;
  vec2 fg = fract(gw);
  vec2 gfw = fwidth(gw);
  vec2 gl2 = 1.0 - smoothstep(vec2(0.0), gfw * 1.2, min(fg, 1.0 - fg));
  float grid = max(gl2.x, gl2.y);
  vec3 cyan = vec3(0.25, 0.84, 1.0);
  col += cyan * edge * 0.9 + cyan * contour * (sea ? 0.0 : 0.2) + cyan * grid * 0.07;
  // Outside the combat area: dimmed.
  if (max(abs(w.x), abs(w.y)) > limit) col *= 0.45;
  // Scanlines.
  col *= 0.9 + 0.1 * step(0.5, fract(gl_FragCoord.y * 0.5));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface CaptureOptions {
  worldSize: number;
  px?: number;
  water: number | null;
  seaX?: number;
  /** Combat area half-extent (the map dims beyond it). */
  limit?: number;
  /** Road polylines (x, z) and width, drawn as faint ribbons. */
  roads?: readonly (readonly [number, number])[][];
  roadWidth?: number;
  /** Objects hidden during the capture (sky, soldiers, effects). */
  hide: THREE.Object3D[];
}

export function captureTacticalMap(gl: THREE.WebGLRenderer, scene: THREE.Scene, o: CaptureOptions): TacticalImage {
  const px = o.px ?? 1024;
  const W = o.worldSize;
  const hScale = 400, hOffset = 50;
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, W / 2, -W / 2, 1, 1200);
  cam.position.set(0, 600, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  const data = new THREE.WebGLRenderTarget(px, px, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const out = new THREE.WebGLRenderTarget(px, px, { type: THREE.UnsignedByteType, depthBuffer: false });
  const dataMat = new THREE.ShaderMaterial({ vertexShader: DATA_VS, fragmentShader: DATA_FS, uniforms: { hScale: { value: hScale }, hOffset: { value: hOffset } }, side: THREE.DoubleSide });

  // Hide everything that is not world geometry (and the inverted-hull outlines).
  const restore: [THREE.Object3D, boolean][] = [];
  for (const h of o.hide) {
    restore.push([h, h.visible]);
    h.visible = false;
  }
  scene.traverse((obj) => {
    if (obj.name === 'outline' && obj.visible) {
      restore.push([obj, true]);
      obj.visible = false;
    }
  });
  const prevOverride = scene.overrideMaterial;
  const prevFog = scene.fog;
  const prevBg = scene.background;
  const prevShadow = gl.shadowMap.autoUpdate;
  const prevClear = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevTarget = gl.getRenderTarget();
  scene.overrideMaterial = dataMat;
  scene.fog = null;
  scene.background = null;
  gl.shadowMap.autoUpdate = false;
  gl.setClearColor(0x000000, 0);
  gl.setRenderTarget(data);
  gl.clear(true, true, true);
  gl.render(scene, cam);

  // Holographic treatment.
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: HOLO_VS,
      fragmentShader: HOLO_FS,
      uniforms: {
        tData: { value: data.texture },
        texel: { value: new THREE.Vector2(1 / px, 1 / px) },
        hScale: { value: hScale },
        hOffset: { value: hOffset },
        worldSize: { value: W },
        water: { value: o.water ?? -999 },
        seaX: { value: o.seaX ?? 1e6 },
        limit: { value: o.limit ?? 1e6 },
      },
      depthTest: false,
      depthWrite: false,
    }),
  );
  const qs = new THREE.Scene();
  qs.add(quad);
  gl.setRenderTarget(out);
  gl.render(qs, cam);
  const pixels = new Uint8Array(px * px * 4);
  gl.readRenderTargetPixels(out, 0, 0, px, px, pixels);

  // Restore renderer and scene state.
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevClear, prevAlpha);
  gl.shadowMap.autoUpdate = prevShadow;
  scene.overrideMaterial = prevOverride;
  scene.fog = prevFog;
  scene.background = prevBg;
  for (const [obj, v] of restore) obj.visible = v;
  data.dispose();
  out.dispose();
  dataMat.dispose();
  quad.geometry.dispose();
  (quad.material as THREE.Material).dispose();

  // Into a canvas (flip rows: GL reads bottom-up).
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    const src = (px - 1 - y) * px * 4;
    img.data.set(pixels.subarray(src, src + px * 4), y * px * 4);
  }
  ctx.putImageData(img, 0, 0);
  // Road network as faint ribbons.
  if (o.roads) {
    const k = px / W;
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.22)';
    ctx.lineWidth = Math.max(2, (o.roadWidth ?? 10) * k);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const r of o.roads) {
      ctx.beginPath();
      r.forEach(([x, z], i) => (i ? ctx.lineTo((x + W / 2) * k, (z + W / 2) * k) : ctx.moveTo((x + W / 2) * k, (z + W / 2) * k)));
      ctx.stroke();
    }
  }
  return { canvas, worldSize: W };
}
