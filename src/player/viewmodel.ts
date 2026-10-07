// Procedural first-person viewmodel: weapon + forearms in their own scene and camera (drawn after
// the world with cleared depth). Hip / ADS / sprint / tactical-sprint poses, mouse sway, walk bob,
// recoil spring, inspect, equip, melee, throw and per-category reload motions, all driven by code.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { clamp, damp, lerp } from '../core/math';
import { buildWeaponModel, type AttachmentSet, type WeaponModel } from '../art/weaponModels';
import { buildArmsGeometry } from '../art/soldierModel';
import { MATS, merge, outlinedMesh, outlineMaterial, OUTLINE_CHAR, glowMaterial, GLOW_RIG } from '../render/toon';
import { WEAPON_BY_ID, type TeamId, type WeaponCategory, type WeaponId } from '../config/content';
import type { Lighting } from '../render/lighting';

const V = TUNING.viewmodel;

export interface ViewmodelState {
  adsK: number;
  sprintK: number;
  tacSprint: boolean;
  speed: number;
  grounded: boolean;
  mouseDX: number;
  mouseDY: number;
  /** Reload progress 0..1 or -1. */
  reload: number;
  /** Bolt / pump cycle progress after a shot (0..1) or -1. */
  cycle: number;
  /** Overheat vent progress 0..1 or -1 (heat weapons). */
  vent: number;
  inspect: number;
  melee: number;
  throwing: number;
  /** Equip progress 0..1 (1 = ready). */
  equip: number;
  /** Hide the gun while looking through a magnified optic. */
  scoped: boolean;
  /** Pull the weapon down (on a ladder, zipline, parachute). */
  lowered: boolean;
  /** 0..1 heat for energy glow pulse. */
  heat: number;
}

export function newViewmodelState(): ViewmodelState {
  return { adsK: 0, sprintK: 0, tacSprint: false, speed: 0, grounded: true, mouseDX: 0, mouseDY: 0, reload: -1, cycle: -1, vent: -1, inspect: -1, melee: -1, throwing: -1, equip: 1, scoped: false, lowered: false, heat: 0 };
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private weaponRoot = new THREE.Group();
  private model: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private cat: WeaponCategory = 'ar';
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private hemi = new THREE.HemisphereLight();
  private ambient = new THREE.AmbientLight();
  private sun = new THREE.DirectionalLight();
  private outline = outlineMaterial(OUTLINE_CHAR, 0.0012);
  private glowMat = glowMaterial(GLOW_RIG);
  private team: TeamId = 0;
  // Springs
  private swayX = 0;
  private swayY = 0;
  private recoilZ = 0;
  private recoilZv = 0;
  private recoilP = 0;
  private recoilPv = 0;
  private recoilR = 0;
  private recoilRv = 0;
  private bobT = 0;
  private bobK = 0;
  private hipOffset = new THREE.Vector3(...V.hipOffset);
  private sprintOffset = new THREE.Vector3(...V.sprintOffset);
  visible = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(V.fov, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.rig.add(this.weaponRoot);
    this.scene.add(this.armL, this.armR, this.hemi, this.ambient, this.sun, this.sun.target);
    this.setTeam(0);
  }

  setTeam(team: TeamId): void {
    this.team = team;
    for (const arm of [this.armL, this.armR]) arm.clear();
    const g = buildArmsGeometry(team);
    const mk = (parts: THREE.BufferGeometry[]) => {
      const geo = merge(parts, true);
      geo.rotateY(Math.PI);
      return outlinedMesh(geo, this.outline, MATS.toon, false);
    };
    this.armL.add(mk(g.left));
    this.armR.add(mk(g.right));
    const glow = merge(g.glow, false);
    glow.rotateY(Math.PI);
    this.armL.add(new THREE.Mesh(glow, this.glowMat));
  }

  setWeapon(id: WeaponId, att: AttachmentSet): void {
    if (this.model) {
      this.weaponRoot.remove(this.model.group);
      this.model.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.model = buildWeaponModel(id, att, this.outline, this.glowMat);
    this.weaponId = id;
    this.cat = WEAPON_BY_ID[id].category;
    this.weaponRoot.add(this.model.group);
    // The model's +Z barrel points away from the camera.
    this.model.group.rotation.y = Math.PI;
  }

  get currentWeapon(): WeaponId | null {
    return this.weaponId;
  }

  get anchors(): WeaponModel | null {
    return this.model;
  }

  /** Recoil impulse (strength ~1 for a rifle shot). */
  kick(strength: number, roll = 0): void {
    this.recoilZv += V.recoilKickBack * 60 * strength;
    this.recoilPv += V.recoilKickUp * 60 * strength;
    this.recoilRv += roll * 20;
  }

  copyLights(l: Lighting): void {
    this.hemi.color.copy(l.hemi.color);
    this.hemi.groundColor.copy(l.hemi.groundColor);
    this.hemi.intensity = l.hemi.intensity;
    this.ambient.intensity = l.ambient.intensity;
    this.sun.color.copy(l.sun.color);
    this.sun.intensity = l.sun.intensity;
    this.sun.position.copy(l.sunDir).multiplyScalar(10);
    this.sun.target.position.set(0, 0, 0);
  }

  update(dt: number, main: THREE.Camera, st: ViewmodelState, aspect: number): void {
    this.camera.quaternion.copy(main.quaternion);
    this.camera.position.set(0, 0, 0);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const m = this.model;
    const show = this.visible && !!m && !st.scoped;
    this.rig.visible = show;
    this.armL.visible = show;
    this.armR.visible = show;
    if (!m) return;

    // Springs: sway from mouse, recoil.
    const sw = V.swayAmount * (1 - st.adsK * (1 - V.adsSwayKeep));
    this.swayX = clamp(this.swayX - st.mouseDX * sw, -V.swayMax, V.swayMax);
    this.swayY = clamp(this.swayY + st.mouseDY * sw, -V.swayMax, V.swayMax);
    const ret = damp(V.swayReturn, dt);
    this.swayX -= this.swayX * ret;
    this.swayY -= this.swayY * ret;
    // Stiff springs: sub-step so long frames (hitches, slow GPUs) stay stable.
    const k = V.recoilStiffness, c = V.recoilDamping;
    const sub = Math.max(1, Math.ceil(dt * 120));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.recoilZv += (-k * this.recoilZ - c * this.recoilZv) * h;
      this.recoilZ += this.recoilZv * h;
      this.recoilPv += (-k * this.recoilP - c * this.recoilPv) * h;
      this.recoilP += this.recoilPv * h;
      this.recoilRv += (-k * this.recoilR - c * this.recoilRv) * h;
      this.recoilR += this.recoilRv * h;
    }
    // Bob.
    const moving = st.grounded && st.speed > 0.4 ? clamp(st.speed / 6, 0, 1.3) : 0;
    this.bobK += (moving - this.bobK) * damp(8, dt);
    this.bobT += dt * (4 + st.speed * 1.1);
    const bobA = V.bobAmount * this.bobK * (1 - st.adsK * (1 - V.adsBobKeep));
    const bx = Math.sin(this.bobT) * bobA;
    const by = -Math.abs(Math.cos(this.bobT)) * bobA;

    // Pose: hip -> ADS, sprint, lowered.
    const sight = m.sight;
    const adsPos = new THREE.Vector3(sight.x, -sight.y, V.adsDepth + sight.z);
    const pos = this.hipOffset.clone().lerp(adsPos, st.adsK);
    const sk = st.sprintK * (1 - st.adsK);
    pos.lerp(this.sprintOffset, sk);
    let rx = 0, ry = 0, rz = 0;
    if (st.tacSprint) {
      // Weapon swung up and across the chest.
      rx += 0.55 * sk;
      ry += 0.6 * sk;
      rz += 0.5 * sk;
      pos.y += 0.06 * sk;
    } else {
      rx -= 0.45 * sk;
      ry += 0.55 * sk;
      rz += 0.25 * sk;
    }
    if (st.lowered) {
      pos.y -= 0.35;
      rx -= 0.8;
    }
    // Equip: rise from below.
    const eq = 1 - st.equip;
    pos.y -= eq * 0.35;
    rx -= eq * 0.9;
    // Inspect: turn the weapon to show its side.
    if (st.inspect >= 0) {
      const t = st.inspect;
      const w = Math.sin(clamp(t, 0, 1) * Math.PI);
      ry -= 0.9 * w;
      rz -= 0.5 * w * Math.sin(t * Math.PI * 2);
      pos.x -= 0.06 * w;
      pos.z += 0.06 * w;
    }
    // Melee: jab.
    if (st.melee >= 0) {
      const w = Math.sin(st.melee * Math.PI);
      pos.z -= 0.22 * w;
      pos.x -= 0.08 * w;
      rz += 0.9 * w;
      ry -= 0.4 * w;
    }
    // Throw: drop the weapon out of view.
    if (st.throwing >= 0) {
      const w = Math.sin(clamp(st.throwing * 1.2, 0, 1) * Math.PI);
      pos.y -= 0.3 * w;
      rx -= 0.6 * w;
    }
    // Overheat vent.
    if (st.vent >= 0) {
      const w = Math.sin(st.vent * Math.PI);
      rz += 0.6 * w;
      rx += 0.25 * w;
      pos.y -= 0.04 * w;
    }
    // Reload motions by category.
    this.resetParts();
    if (st.reload >= 0) this.reloadPose(st.reload, pos, (a, b, c) => ((rx += a), (ry += b), (rz += c)));
    if (st.cycle >= 0) this.cyclePose(st.cycle, (a) => (rx += a));

    pos.x += bx + this.swayX;
    pos.y += by + this.swayY;
    pos.z += this.recoilZ;
    this.rig.position.copy(pos);
    const tilt = 1 - st.adsK * (1 - V.adsTiltKeep);
    this.rig.rotation.set(rx + this.recoilP * 0.6 * tilt + this.swayY * 1.5, ry + this.swayX * 2, rz + this.recoilR * tilt + this.swayX * 1.2, 'YXZ');
    this.weaponRoot.rotation.set(0, 0, 0);

    // Arms follow the hands.
    this.camera.updateMatrixWorld(true);
    const wm = m.group.matrixWorld;
    const handR = m.grip.clone().applyMatrix4(wm);
    const handL = (st.reload >= 0 && m.magObj ? m.mag.clone().applyMatrix4(m.magObj.matrixWorld) : m.fore.clone().applyMatrix4(wm));
    if (st.throwing >= 0) handL.set(0.1, -0.3, -0.3).applyMatrix4(this.camera.matrixWorld);
    const elbowR = new THREE.Vector3(0.34, -0.5, 0.15).applyMatrix4(this.camera.matrixWorld);
    const elbowL = new THREE.Vector3(-0.3, -0.52, 0.05).applyMatrix4(this.camera.matrixWorld);
    this.placeArm(this.armR, handR, elbowR);
    this.placeArm(this.armL, handL, elbowL);
    // Heat glow pulse on energy weapons.
    this.glowMat.color.setScalar(GLOW_RIG * (1 + st.heat * 0.8));
  }

  private placeArm(arm: THREE.Group, hand: THREE.Vector3, elbow: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(hand, elbow).normalize();
    arm.position.copy(hand).addScaledVector(dir, -0.355);
    arm.lookAt(hand);
  }

  private resetParts(): void {
    const m = this.model!;
    if (m.magObj) {
      m.magObj.position.set(0, 0, 0);
      m.magObj.rotation.set(0, 0, 0);
      m.magObj.visible = true;
    }
    if (m.boltObj) m.boltObj.position.set(0, 0, 0);
    if (m.pumpObj) m.pumpObj.position.set(0, 0, 0);
  }

  private reloadPose(t: number, pos: THREE.Vector3, rot: (x: number, y: number, z: number) => void): void {
    const m = this.model!;
    const tilt = Math.sin(clamp(t, 0, 1) * Math.PI);
    rot(0.12 * tilt, -0.25 * tilt, 0.55 * tilt);
    pos.y -= 0.03 * tilt;
    switch (this.cat) {
      case 'shotgun': {
        // Shells fed one by one: the pump hand shuttles to the loading port.
        const cycles = 4;
        const c = (t * cycles) % 1;
        if (m.pumpObj) m.pumpObj.position.z = -0.03 * Math.sin(c * Math.PI);
        rot(0, 0, 0.15 * Math.sin(c * Math.PI));
        break;
      }
      case 'launcher': {
        if (!m.magObj) break;
        // Rocket slides in from the front.
        const a = clamp((t - 0.25) / 0.5, 0, 1);
        m.magObj.visible = t > 0.2;
        m.magObj.position.z = (1 - a) * 0.6;
        m.magObj.position.y = (1 - a) * -0.25;
        break;
      }
      default: {
        if (!m.magObj) break;
        // Old mag drops out, new mag rises in, then the bolt is charged.
        if (t < 0.32) {
          const a = clamp((t - 0.12) / 0.2, 0, 1);
          m.magObj.position.y = -0.3 * a * a;
          m.magObj.rotation.x = 0.4 * a;
          m.magObj.visible = a < 0.95;
        } else if (t < 0.7) {
          const a = clamp((t - 0.38) / 0.28, 0, 1);
          m.magObj.position.y = -0.3 * (1 - a);
          m.magObj.position.x = 0.04 * (1 - a);
        }
        if (m.boltObj && t > 0.72 && t < 0.92) m.boltObj.position.z = -0.06 * Math.sin(((t - 0.72) / 0.2) * Math.PI);
      }
    }
  }

  private cyclePose(t: number, rot: (x: number) => void): void {
    const m = this.model!;
    const w = Math.sin(clamp(t, 0, 1) * Math.PI);
    if (this.cat === 'sniper' && m.boltObj) {
      m.boltObj.position.z = -0.08 * w;
      rot(0.08 * w);
    } else if (this.cat === 'shotgun' && m.pumpObj) {
      m.pumpObj.position.z = -0.09 * w;
    }
  }

  /** Muzzle position in world space of the view scene, mapped onto the main camera (for effects). */
  muzzleWorld(main: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    const local = this.model.muzzle.clone().applyMatrix4(this.model.group.matrixWorld);
    // View-space offset relative to the camera, re-expressed in the main camera's frame.
    const inv = this.camera.matrixWorld.clone().invert();
    local.applyMatrix4(inv);
    return out.copy(local).applyMatrix4(main.matrixWorld);
  }

  ejectWorld(main: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0, 0, 0);
    const local = this.model.eject.clone().applyMatrix4(this.model.group.matrixWorld);
    local.applyMatrix4(this.camera.matrixWorld.clone().invert());
    return out.copy(local).applyMatrix4(main.matrixWorld);
  }

  /** Smoothly scales the viewmodel FOV with ADS so optics don't distort. */
  setFov(adsK: number, zoom: number): void {
    const fov = lerp(V.fov, V.fov / Math.min(1.6, Math.max(1, zoom * 0.7)), adsK);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get teamId(): TeamId {
    return this.team;
  }
}
