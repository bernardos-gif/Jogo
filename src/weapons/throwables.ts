// Throwables: frag, smoke and EMP grenades with bouncing ballistic arcs, smoke clouds that block
// sight (AI line of sight and spotting), and EMP bursts that disable vehicles, gadgets and HUDs.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { explode, damageSoldier, type CombatContext } from './damage';
import { empBurst, FX_COLORS } from '../render/recipes';
import { dodeca, cyl, ico, merge, MATS, glowMaterial, GLOW_CORE, box } from '../render/toon';
import { makeHit } from '../physics/collision';
import type { Soldier } from '../player/soldier';
import type { ThrowableId } from '../config/content';

interface Grenade {
  kind: ThrowableId;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  owner: Soldier;
  rest: boolean;
  spin: THREE.Euler;
}

export interface SmokeCloud {
  pos: THREE.Vector3;
  t: number;
  duration: number;
  radius: number;
  emitAcc: number;
}

const T = TUNING.throwables;
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _hit = makeHit();

export class Throwables {
  readonly grenades: Grenade[] = [];
  readonly smokes: SmokeCloud[] = [];
  private meshes: Record<ThrowableId, THREE.InstancedMesh>;
  private glow: THREE.InstancedMesh;

  constructor(scene: THREE.Scene) {
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(geo, MATS.toon, 32);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      scene.add(m);
      return m;
    };
    this.meshes = {
      frag: mk(merge([dodeca(0.07, 0x5a6a48), box(0.03, 0.05, 0.03, 0x3a3436, { y: 0.07 })], false)),
      smoke: mk(merge([cyl(0.045, 0.045, 0.16, 8, 0xb8b0a0), cyl(0.047, 0.047, 0.03, 8, 0x3a3436, { y: 0.06 })], false)),
      emp: mk(merge([ico(0.07, 0x2a4058), box(0.1, 0.02, 0.02, 0x8a90a0)], false)),
    };
    this.glow = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.03), glowMaterial(GLOW_CORE, false, 0xffffff), 32);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    scene.add(this.glow);
  }

  throw(owner: Soldier, kind: ThrowableId, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const vel = dir.clone().multiplyScalar(T.throwSpeed);
    vel.y += T.throwUp;
    vel.add(owner.vel.clone().multiplyScalar(0.5));
    this.grenades.push({ kind, pos: origin.clone(), prev: origin.clone(), vel, fuse: T[kind].fuse, owner, rest: false, spin: new THREE.Euler() });
  }

  step(dt: number, ctx: CombatContext): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (!g.rest) {
        g.prev.copy(g.pos);
        g.vel.y -= TUNING.weapons.gravity * dt;
        _d.copy(g.vel).multiplyScalar(dt);
        const len = _d.length();
        if (len > 1e-5) {
          _d.multiplyScalar(1 / len);
          const h = ctx.collision.raycast(g.pos, _d, len + 0.07, { ignore: g.owner, worldOnly: true }, _hit);
          if (h) {
            g.pos.copy(h.point).addScaledVector(h.normal, 0.07);
            const vn = g.vel.dot(h.normal);
            g.vel.addScaledVector(h.normal, -(1 + T.bounce) * vn).multiplyScalar(T.friction);
            if (g.vel.length() < 1.2 && h.normal.y > 0.6) {
              g.rest = true;
              g.vel.set(0, 0, 0);
            }
            ctx.events.emit('impact', { pos: g.pos.clone(), surface: h.surface, energy: 'kinetic', heavy: false });
          } else g.pos.addScaledVector(g.vel, dt);
        }
        g.spin.x += dt * 9;
        g.spin.z += dt * 6;
      }
      if (g.fuse <= 0) {
        this.detonate(g, ctx);
        this.grenades.splice(i, 1);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const c = this.smokes[i];
      c.t += dt;
      c.emitAcc += dt * T.smoke.puffRate * (c.t < c.duration - 3 ? 1 : 0.3);
      while (c.emitAcc >= 1) {
        c.emitAcc -= 1;
        const r = this.radius(c) * 0.6;
        _v.set(c.pos.x + (Math.random() - 0.5) * r, c.pos.y + 0.3, c.pos.z + (Math.random() - 0.5) * r);
        ctx.vfx.burst(_v, { count: 2, color: FX_COLORS.smoke[0], color2: FX_COLORS.smoke[2], speed: [0.3, 1.2], up: 0.6, life: [3.5, 5.5], size: [1.2, 1.9], sizeEnd: 2.2, shape: 'puff', additive: false, drag: 1.2, flat: true, radius: r });
      }
      if (c.t >= c.duration) this.smokes.splice(i, 1);
    }
  }

  private radius(c: SmokeCloud): number {
    const grow = Math.min(1, c.t / 2.5);
    const fade = c.t > c.duration - 2 ? Math.max(0, (c.duration - c.t) / 2) : 1;
    return c.radius * grow * fade;
  }

  private detonate(g: Grenade, ctx: CombatContext): void {
    if (g.kind === 'frag') {
      const F = T.frag;
      explode(ctx, g.pos, { radius: F.radius, damage: F.damage, inner: F.innerRadius, attacker: g.owner, weapon: 'Shard Frag', kind: 'frag', vehicleDamage: 25 });
    } else if (g.kind === 'smoke') {
      this.smokes.push({ pos: g.pos.clone(), t: 0, duration: T.smoke.duration, radius: T.smoke.radius, emitAcc: 6 });
      ctx.events.emit('explosion', { pos: g.pos.clone(), radius: 2, kind: 'smoke', owner: g.owner });
    } else {
      const E = T.emp;
      empBurst(ctx.vfx, g.pos, E.radius * 0.5);
      for (const s of ctx.soldiers) {
        if (!s.alive || s.team === g.owner.team) continue;
        if (s.pos.distanceTo(g.pos) > E.radius) continue;
        s.empT = E.disable;
        damageSoldier(ctx, s, E.damage, { attacker: g.owner, weapon: 'Pulse EMP', part: null, explosive: true, from: g.pos, armorMul: 2 });
      }
      ctx.events.emit('explosion', { pos: g.pos.clone(), radius: E.radius, kind: 'emp', owner: g.owner });
      ctx.onExplosion(g.pos, E.radius, 0, g.owner, 0, 'emp');
    }
  }

  /** True when the segment a-b passes through an active smoke cloud. */
  blocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const c of this.smokes) {
      const r = this.radius(c);
      if (r < 0.5) continue;
      _d.subVectors(b, a);
      const len2 = _d.lengthSq();
      const t = len2 > 0 ? Math.max(0, Math.min(1, _v.subVectors(c.pos, a).dot(_d) / len2)) : 0;
      _v.copy(a).addScaledVector(_d, t);
      _v.y = Math.max(_v.y, c.pos.y);
      if (_v.distanceTo(c.pos) < r) return true;
    }
    return false;
  }

  render(alpha: number): void {
    const counts: Record<ThrowableId, number> = { frag: 0, smoke: 0, emp: 0 };
    let gi = 0;
    const c = new THREE.Color();
    for (const g of this.grenades) {
      const mesh = this.meshes[g.kind];
      _v.copy(g.prev).lerp(g.pos, alpha);
      _q.setFromEuler(g.spin);
      _m.compose(_v, _q, _one);
      mesh.setMatrixAt(counts[g.kind]++, _m);
      // Blinking fuse light.
      const blink = Math.sin(g.fuse * (g.fuse < 1 ? 30 : 12)) > 0;
      _m.compose(_v.setY(_v.y + 0.09), _q.identity(), _one);
      this.glow.setMatrixAt(gi, _m);
      this.glow.setColorAt(gi, c.setHex(g.kind === 'emp' ? 0x7cc8ff : g.kind === 'smoke' ? 0xffcf6a : 0xff3a3a).multiplyScalar(blink ? 1 : 0.15));
      gi++;
    }
    for (const k of Object.keys(this.meshes) as ThrowableId[]) {
      this.meshes[k].count = counts[k];
      this.meshes[k].instanceMatrix.needsUpdate = true;
    }
    this.glow.count = gi;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  /** Live grenades near a point (HUD grenade indicators, AI evasion). */
  near(p: THREE.Vector3, range: number): Grenade[] {
    return this.grenades.filter((g) => g.kind === 'frag' && g.pos.distanceTo(p) < range);
  }

  clear(): void {
    this.grenades.length = 0;
    this.smokes.length = 0;
  }
}
