// M1 style test scene (?scene=style): terrain, props, soldiers of both factions and all classes
// cycling through their poses, all 12 weapons, all 4 vehicles, an energy shield and a loop that
// fires every effect type. Used to check the 3D view against STYLE_GUIDE.md.
import * as THREE from 'three';
import { Sky, newSkyState, sampleSky } from '../render/sky';
import { Lighting } from '../render/lighting';
import { VFX, Trail } from '../render/vfx';
import { CrowdRenderer } from '../render/crowd';
import { WeaponCrowd } from '../render/weaponCrowd';
import { MATS, merge, outlinedMesh } from '../render/toon';
import { impact, muzzleFlash, explosion, empBurst, lightningStrike, healPulse, dustKick, shellEject } from '../render/recipes';
import { ShieldMaterial } from '../render/shieldMaterial';
import { SoldierAnimator, type BodyMode } from '../art/soldierAnim';
import { buildWeaponModel, defaultAttachments, categoryOf } from '../art/weaponModels';
import { buildVehicleModel } from '../art/vehicleModels';
import { container, fuelTank, solarPanel, crate, barrier, lampPost, antenna, sandbags, techCrate, CONTAINER_COLORS, xf, type PropGeo } from '../art/props';
import { fbm } from '../world/noise';
import { buildTerrainChunk, sampleGrid, type HeightGrid } from '../world/terrainMesh';
import { Rng } from '../core/rng';
import { WEAPONS, type ClassId, type TeamId, type WeaponId } from '../config/content';
import type { Surface } from '../world/surface';
import type { Renderer } from '../render/renderer';
import type { GameScene } from './gameScene';

const CLASSES: ClassId[] = ['assault', 'engineer', 'support', 'recon'];
const MODES: { mode: BodyMode; crouch?: boolean; prone?: boolean; speed: number; reload?: boolean }[] = [
  { mode: 'normal', speed: 0 },
  { mode: 'normal', speed: 3.5 },
  { mode: 'sprint', speed: 6.5 },
  { mode: 'normal', crouch: true, speed: 1.5 },
  { mode: 'normal', prone: true, speed: 0.6 },
  { mode: 'normal', speed: 0, reload: true },
  { mode: 'slide', speed: 6 },
  { mode: 'ladder', speed: 1.5 },
  { mode: 'parachute', speed: 0 },
  { mode: 'downed', speed: 0 },
];

interface Actor {
  team: TeamId;
  cls: ClassId;
  weapon: WeaponId;
  anim: SoldierAnimator;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  yaw: number;
  t: number;
  modeIdx: number;
  flash: number;
}

export class StyleScene implements GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sky: Sky;
  private lighting: Lighting;
  private vfx: VFX;
  private crowd: CrowdRenderer;
  private weapons: WeaponCrowd;
  private actors: Actor[] = [];
  private grid: HeightGrid;
  private time = 0;
  private fxT = 0;
  private fxStep = 0;
  private rack: THREE.Group[] = [];
  private shield: ShieldMaterial;
  private trail: Trail;
  private trailHead = new THREE.Vector3();
  private rotors: THREE.Object3D[] = [];
  private fixedCam: number[] | null;

  constructor(private renderer: Renderer) {
    const q = renderer.quality;
    this.camera = new THREE.PerspectiveCamera(68, renderer.aspect, 0.1, 2400);
    const rng = new Rng(7);
    const st = sampleSky(0.5, 0, newSkyState());
    this.scene.background = st.fog.clone();
    this.scene.fog = new THREE.Fog(st.fog, q.fogNear, q.fogFar);
    this.sky = new Sky(q.clouds, rng);
    this.sky.apply(st, 0);
    this.scene.add(this.sky.group);
    this.lighting = new Lighting(this.scene);
    this.lighting.applyQuality(q);
    this.lighting.applySky(st);
    this.vfx = new VFX(this.scene, q);
    this.vfx.camera = this.camera;
    this.crowd = new CrowdRenderer(this.scene, 8);
    this.weapons = new WeaponCrowd(this.scene, 8);

    // Terrain patch.
    const n = 97;
    const cell = 2.5;
    const h = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const x = -120 + ix * cell, z = -120 + iz * cell;
        const r = Math.hypot(x, z);
        const flat = Math.min(1, Math.max(0, (r - 30) / 40));
        h[iz * n + ix] = (fbm(x * 0.012, z * 0.012, 5, 3) * 9 + Math.max(0, r - 70) * 0.18) * flat;
      }
    this.grid = { n, cell, origin: -120, h };
    const geo = buildTerrainChunk(this.grid, 0, 0, n - 1, n - 1, (x, z, y, slope, out) => {
      const pad = Math.abs(x) < 26 && Math.abs(z) < 26;
      if (pad) out.setHex(((Math.floor(x / 4) + Math.floor(z / 4)) & 1) ? 0xcdbba2 : 0xc2ae95);
      else if (slope > 0.35) out.setHex(0x8a7464);
      else if (y > 6) out.setHex(0x9a9a5a);
      else out.setHex(0xc9a77c);
      out.offsetHSL(0, 0, ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 0.03);
    });
    const terrain = new THREE.Mesh(geo, MATS.toon);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    this.vfx.ground = (x, z) => sampleGrid(this.grid, x, z);

    // Props.
    const place = (p: PropGeo, x: number, z: number, ry = 0, y = 0) => {
      const m = xf({ x, y, z, ry });
      const toon = p.toon.map((g) => g.applyMatrix4(m));
      const glow = p.glow.map((g) => g.applyMatrix4(m));
      return { toon, glow };
    };
    const toonParts: THREE.BufferGeometry[] = [];
    const glowParts: THREE.BufferGeometry[] = [];
    const addP = (r: { toon: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] }) => {
      toonParts.push(...r.toon);
      glowParts.push(...r.glow);
    };
    addP(place(container(CONTAINER_COLORS[0]), -18, -14, 0.1));
    addP(place(container(CONTAINER_COLORS[1]), -18, -14, 0.1, 2.6));
    addP(place(container(CONTAINER_COLORS[2], true), -14, -16, 0.1));
    addP(place(container(CONTAINER_COLORS[3]), -22, -6, Math.PI / 2));
    addP(place(fuelTank(), 16, -16));
    addP(place(fuelTank(), 20, -12));
    for (let i = 0; i < 5; i++) addP(place(solarPanel(), 6 + i * 4, 18, 0));
    addP(place(crate(), -6, 10, 0.3));
    addP(place(crate(0.8), -5, 11.2, 0.8, 0));
    addP(place(techCrate(), -8, 12, -0.2));
    addP(place(barrier(), 2, -8, Math.PI / 2));
    addP(place(sandbags(), -2, -8, 0));
    addP(place(lampPost(), 24, 4));
    addP(place(lampPost(), -24, 6, Math.PI));
    addP(place(antenna(), 30, -26));
    const props = outlinedMesh(merge(toonParts, true), MATS.outline);
    this.scene.add(props);
    this.scene.add(new THREE.Mesh(merge(glowParts, false), MATS.lamp));

    // Soldiers: both factions x four classes.
    WEAPONS.slice(0, 8).forEach((w, i) => {
      const team = (i % 2) as TeamId;
      const cls = CLASSES[Math.floor(i / 2) % 4];
      const a = (i / 8) * Math.PI * 1.2 - Math.PI * 0.6;
      const home = new THREE.Vector3(Math.sin(a) * 9, 0, Math.cos(a) * 9 - 2);
      this.actors.push({ team, cls, weapon: w.id, anim: new SoldierAnimator(), home, pos: home.clone(), yaw: a + Math.PI, t: i * 0.7, modeIdx: i % MODES.length, flash: 0 });
    });

    // Weapon rack (first-person models).
    WEAPONS.forEach((w, i) => {
      const model = buildWeaponModel(w.id, defaultAttachments(w.id));
      const g = new THREE.Group();
      g.add(model.group);
      g.position.set(-11 + (i % 6) * 1.6, 1.3 + Math.floor(i / 6) * 0.8, 14);
      g.scale.setScalar(1.6);
      this.scene.add(g);
      this.rack.push(g);
    });

    // Vehicles.
    const vk = [
      { kind: 'basalt' as const, team: 0 as TeamId, x: -12, z: 0, ry: 0.6 },
      { kind: 'wisp' as const, team: 1 as TeamId, x: 13, z: 2, ry: -0.8 },
      { kind: 'midge' as const, team: 0 as TeamId, x: 4, z: -22, ry: 0.3 },
      { kind: 'condor' as const, team: 1 as TeamId, x: -32, z: 20, ry: 2.2 },
    ];
    for (const v of vk) {
      const m = buildVehicleModel(v.kind, v.team);
      m.root.position.set(v.x, sampleGrid(this.grid, v.x, v.z) + (v.kind === 'basalt' || v.kind === 'wisp' ? 0.4 : 0), v.z);
      m.root.rotation.y = v.ry;
      if (m.turret) m.turret.rotation.y = -0.5;
      if (m.rotor) this.rotors.push(m.rotor);
      for (const nc of m.nacelles) nc.rotation.x = -0.6;
      this.scene.add(m.root);
    }

    // Energy shield wall.
    this.shield = new ShieldMaterial(0x6fd8ff, 0xb4f2ff, 0.32, 2.2);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.08, 1, 1, 1), this.shield);
    wall.position.set(6, 1.1, -6);
    wall.rotation.y = -0.4;
    this.scene.add(wall);

    this.trail = new Trail(0x3fe0ff, 0.12, 18);
    this.trail.emitting = true;
    this.vfx.addTrail(this.trail, () => this.trailHead);

    const cam = new URLSearchParams(location.search).get('cam');
    this.fixedCam = cam ? cam.split(',').map(Number) : null;
    this.crowd.warm();
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // Camera: slow orbit (or fixed via ?cam=x,y,z,tx,ty,tz).
    if (this.fixedCam && this.fixedCam.length >= 6) {
      const c = this.fixedCam;
      this.camera.position.set(c[0], c[1], c[2]);
      this.camera.lookAt(c[3], c[4], c[5]);
    } else {
      const a = t * 0.08;
      this.camera.position.set(Math.sin(a) * 26, 9 + Math.sin(t * 0.1) * 2, Math.cos(a) * 26);
      this.camera.lookAt(0, 1.5, 0);
    }
    this.camera.updateMatrixWorld();

    // Actors.
    for (const ac of this.actors) {
      ac.t += dt;
      if (ac.t > 4) {
        ac.t = 0;
        ac.modeIdx = (ac.modeIdx + 1) % MODES.length;
      }
      const md = MODES[ac.modeIdx];
      const vel = new THREE.Vector3();
      if (md.speed > 0 && md.mode !== 'ladder') {
        const ang = this.time * (md.speed / 4) + ac.home.x;
        ac.pos.set(ac.home.x + Math.cos(ang) * 2, 0, ac.home.z + Math.sin(ang) * 2);
        vel.set(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(md.speed);
        ac.yaw = Math.atan2(-vel.x, -vel.z);
      } else {
        ac.pos.copy(ac.home);
      }
      ac.pos.y = sampleGrid(this.grid, ac.pos.x, ac.pos.z) + (md.mode === 'parachute' ? 2.5 + Math.sin(t) * 0.3 : 0);
      ac.flash = Math.max(0, ac.flash - dt);
      const cat = categoryOf(ac.weapon);
      ac.anim.update(dt, {
        pos: ac.pos,
        yaw: ac.yaw,
        pitch: Math.sin(t * 0.7 + ac.home.x) * 0.25,
        vel: md.mode === 'ladder' ? new THREE.Vector3(0, 1.5, 0) : vel,
        crouch: !!md.crouch,
        prone: !!md.prone,
        mode: md.mode,
        weapon: { cat, anchors: this.weapons.anchors(ac.weapon) },
        reload: md.reload ? (ac.t % 2.2) / 2.2 : -1,
        melee: -1,
        throwing: -1,
        kick: 0,
        deadT: 0,
        seed: (ac.home.x * 13.37) % 1,
        driving: false,
      });
      this.crowd.submit(ac.team, ac.cls, ac.anim.out, Math.min(0.7, ac.flash * 6));
      if (ac.anim.hasWeapon) this.weapons.submit(ac.weapon, ac.anim.weaponMatrix);
    }
    this.crowd.flush();
    this.weapons.flush();

    for (let i = 0; i < this.rack.length; i++) this.rack[i].rotation.y = t * 0.5 + i * 0.4;
    for (const r of this.rotors) r.rotation.y += dt * 9;
    this.shield.time = t;
    this.trailHead.set(Math.cos(t * 1.6) * 5, 2.5 + Math.sin(t * 3) * 0.6, Math.sin(t * 1.6) * 5 - 2);

    this.effects(dt);
    this.vfx.update(dt);
    this.sky.update(dt, this.camera.position, 4);
    this.lighting.follow(new THREE.Vector3(0, 0, 0));
  }

  private effects(dt: number): void {
    this.fxT += dt;
    // Tracers every frame from a firing actor.
    const shooter = this.actors[0];
    const from = new THREE.Vector3(-4, 1.5, 6);
    const to = new THREE.Vector3(14, 1.4, -14);
    const k = (this.time * 3) % 1;
    const head = from.clone().lerp(to, k);
    const tail = from.clone().lerp(to, Math.max(0, k - 0.12));
    this.vfx.tracer(tail, head, 0xffb52e, 0.022);
    const head2 = from.clone().add(new THREE.Vector3(0, 0.6, 0)).lerp(to, (k + 0.5) % 1);
    this.vfx.tracer(head2.clone().lerp(from, 0.08), head2, 0x3fe0ff, 0.028);
    void shooter;
    if (this.fxT < 0.45) return;
    this.fxT = 0;
    const surfaces: Surface[] = ['concrete', 'metal', 'sheet', 'glass', 'wood', 'dirt', 'sand', 'grass', 'water', 'armor', 'energy'];
    const step = this.fxStep++;
    const sp = new THREE.Vector3(-14 + (step % 11) * 2.6, 0.5, -10);
    sp.y = sampleGrid(this.grid, sp.x, sp.z) + 0.5;
    impact(this.vfx, sp, new THREE.Vector3(0, 0.7, 0.7).normalize(), surfaces[step % surfaces.length], step % 3 === 1 ? 'cyan' : step % 3 === 2 ? 'violet' : 'kinetic', step % 4 === 0, 0x3fe0ff);
    this.vfx.decal(new THREE.Vector3(sp.x, sp.y - 0.49, sp.z), new THREE.Vector3(0, 1, 0), 0.5, 'hole', 20);
    const mz = new THREE.Vector3(-4, 1.5, 6);
    muzzleFlash(this.vfx, mz, new THREE.Vector3(0.6, 0, -0.8).normalize(), step % 2 ? 'cyan' : 'kinetic');
    shellEject(this.vfx, mz, new THREE.Vector3(1, 0, 0), 'kinetic');
    switch (step % 8) {
      case 0: {
        const p = new THREE.Vector3(18, 0, 8);
        p.y = sampleGrid(this.grid, p.x, p.z) + 0.5;
        explosion(this.vfx, p, 3.5, 'rocket');
        this.vfx.decal(new THREE.Vector3(p.x, p.y - 0.5, p.z), new THREE.Vector3(0, 1, 0), 6, 'crater', 30);
        break;
      }
      case 2:
        empBurst(this.vfx, new THREE.Vector3(-8, 1.2, -2), 4);
        break;
      case 4:
        lightningStrike(this.vfx, new THREE.Vector3(30, 80, -30), new THREE.Vector3(26, sampleGrid(this.grid, 26, -26), -26));
        break;
      case 5:
        healPulse(this.vfx, new THREE.Vector3(2, 1, 4));
        this.actors[step % this.actors.length].flash = 0.12;
        this.shield.ripple(new THREE.Vector3(6, 1.2, -6));
        break;
      case 6:
        dustKick(this.vfx, new THREE.Vector3(-12, sampleGrid(this.grid, -12, 0), 0), 3);
        this.vfx.burst(new THREE.Vector3(-2, 0.3, 6), { count: 14, color: 0xd8d0c8, color2: 0xbfb6ae, speed: [0.5, 2], up: 1, life: [3, 5], size: [0.6, 1.0], sizeEnd: 2.4, shape: 'puff', additive: false, drag: 1.5 });
        break;
      case 7: {
        const p = new THREE.Vector3(18, 2.5, -14);
        explosion(this.vfx, p, 6, 'fuel');
        break;
      }
    }
  }

  render(): void {
    this.vfx.flushTracers();
    this.renderer.render(this.scene, this.camera);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.vfx.dispose();
    this.crowd.dispose();
    this.weapons.dispose();
  }
}
