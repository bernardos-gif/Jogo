// Energy surfaces (STYLE_GUIDE.md section 2): Elemental Brawl's hex-cell dome shader generalized
// for deployable shields, the capture-zone walls and holograms: additive hex lines, fresnel,
// a rising scan band, random cell pulses and hit ripples.
import * as THREE from 'three';

const MAX_RIPPLES = 8;

const VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uCell;
uniform float uIntensity;
uniform float uHeight;
uniform vec3 uColor;
uniform vec3 uLine;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform vec3 uRippleColor;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;

float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Planar hex mapping in the surface's dominant plane.
  vec3 n = abs(normalize(vNormalW));
  vec2 uv = n.y > 0.6 ? vLocal.xz : (n.x > n.z ? vLocal.zy : vLocal.xy);
  uv /= uCell;
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(uv, r) - r * 0.5;
  vec2 b = mod(uv - r * 0.5, r) - r * 0.5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv;
  float edge = 0.5 - hexDist(gv);
  float line = 1.0 - smoothstep(0.0, 0.05, edge);
  float h = hash12(id);
  float pulse = pow(0.5 + 0.5 * sin(uTime * (0.5 + h * 1.3) + h * 40.0), 8.0);

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(normalize(vNormalW), V)), 3.0);
  float y01 = clamp(vLocal.y / max(uHeight, 0.001), 0.0, 1.0);
  float base = exp(-y01 * 3.0);
  float scanY = mod(uTime * 2.6, uHeight + 3.0) - 1.5;
  float scan = exp(-pow((vLocal.y - scanY) * 0.6, 2.0));

  vec3 rip = vec3(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    float age = uTime - uRipples[i].w;
    if (uRipples[i].w < 0.0 || age < 0.0 || age > 1.2) continue;
    float d = distance(vWorld, uRipples[i].xyz);
    float ring = exp(-pow((d - age * 6.0) * 1.6, 2.0)) * exp(-age * 2.6);
    float core = exp(-d * 1.4) * exp(-age * 7.0);
    rip += uRippleColor * (ring * (0.35 + line * 1.8) + core * 2.0);
  }

  float fill = 0.03 + fres * 0.12 + pulse * 0.06 * (1.0 - smoothstep(0.0, 0.3, edge)) + base * 0.08;
  float lines = line * (0.12 + fres * 0.3 + base * 0.4 + scan * 0.35);
  vec3 col = (uColor * fill + uLine * lines) * uIntensity + rip;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class ShieldMaterial extends THREE.ShaderMaterial {
  private next = 0;
  constructor(color: number, line: number, cell = 0.45, height = 2) {
    super({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCell: { value: cell },
        uIntensity: { value: 1 },
        uHeight: { value: height },
        uColor: { value: new THREE.Color(color) },
        uLine: { value: new THREE.Color(line) },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, -1)) },
        uRippleColor: { value: new THREE.Color(line) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }
  set time(t: number) {
    this.uniforms.uTime.value = t;
  }
  set intensity(v: number) {
    this.uniforms.uIntensity.value = v;
  }
  ripple(at: THREE.Vector3): void {
    const i = this.next++ % MAX_RIPPLES;
    (this.uniforms.uRipples.value[i] as THREE.Vector4).set(at.x, at.y, at.z, this.uniforms.uTime.value as number);
  }
}
