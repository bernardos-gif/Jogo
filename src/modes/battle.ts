// Battle runtime: the world, every soldier, physics, combat and rendering for one session
// (training ground or match). Systems step at the fixed simulation rate in a fixed order;
// rendering interpolates between steps.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { Physics, initPhysics } from '../physics/physics';
import { CollisionWorld } from '../physics/collision';
import { Sky, newSkyState, sampleSky, type SkyState } from '../render/sky';
import { Lighting } from '../render/lighting';
import { VFX } from '../render/vfx';
import { CrowdRenderer } from '../render/crowd';
import { WeaponCrowd } from '../render/weaponCrowd';
import { muzzleFlash, shellEject, dustKick } from '../render/recipes';
import { Rng } from '../core/rng';
import { input } from '../core/input';
import { save } from '../core/save';
import { EventBus } from '../core/events';
import { clamp, damp, viewDir } from '../core/math';
import { Soldier, clearEdges } from '../player/soldier';
import { attachBody, stepMovement, teleport, setStance, type MovementContext } from '../player/movement';
import { FpCamera, verticalFov } from '../player/fpCamera';
import { Viewmodel, newViewmodelState, type ViewmodelState } from '../player/viewmodel';
import { PlayerController } from '../player/playerController';
import { defaultAttachments, categoryOf, type AttachmentSet } from '../art/weaponModels';
import { TP_WEAPON_SCALE } from '../art/soldierAnim';
import { Arsenal } from '../weapons/arsenal';
import { WeaponSystem, currentSpread, type WeaponContext } from '../weapons/weaponSystem';
import { Projectiles } from '../weapons/projectiles';
import { Throwables } from '../weapons/throwables';
import { SoldierTargets } from '../weapons/hitboxes';
import { stepHealth } from '../weapons/damage';
import { Hud } from '../ui/hud/hud';
import { SPECIALIST_BY_ID, type ClassId, type SpecialistId, type TeamId, type ThrowableId, type WeaponId } from '../config/content';
import type { MapBuild } from '../world/maps/training';
import type { Renderer } from '../render/renderer';
import type { Interactives } from '../world/interactives';
import type { Terrain } from '../world/terrain';
import type { GameScene } from '../scenes/gameScene';
import type { BattleMode } from './mode';
import type { BodyMode } from '../art/soldierAnim';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();

export class Battle implements GameScene, WeaponContext {
  readonly scene = new THREE.Scene();
  readonly physics: Physics;
  readonly collision = new CollisionWorld();
  readonly events = new EventBus();
  readonly sky: Sky;
  readonly lighting: Lighting;
  readonly vfx: VFX;
  readonly crowd: CrowdRenderer;
  readonly weaponCrowd: WeaponCrowd;
  readonly terrain: Terrain;
  readonly interactives: Interactives;
  readonly projectiles = new Projectiles();
  readonly throwables: Throwables;
  readonly weaponSystem = new WeaponSystem();
  readonly soldiers: Soldier[] = [];
  private byId = new Map<number, Soldier>();
  player: Soldier;
  readonly fp: FpCamera;
  readonly viewmodel: Viewmodel;
  readonly controller = new PlayerController();
  readonly vm: ViewmodelState = newViewmodelState();
  hud: Hud | null = null;
  mode: BattleMode | null = null;
  time = 0;
  /** 0 afternoon .. 1 dusk. */
  dayT = 0.5;
  storm = 0;
  private skyState: SkyState = newSkyState();
  private stepInFrame = 0;
  private nextId = 1;
  private moveCtx: MovementContext;
  private renderPos = new THREE.Vector3();
  readonly rng = new Rng(1234);
  debug: Record<string, string> = {};
  private viewWeapon: WeaponId | null = null;
  private viewAttKey = '';
  private attachClicked = false;
  private swayT = 0;
  /** Automated runs open the attachment menu without input. */
  forceAttachMenu = false;

  static async create(renderer: Renderer, map: MapBuild, ui: HTMLElement | null): Promise<Battle> {
    await initPhysics();
    return new Battle(renderer, map, ui);
  }

  private constructor(
    readonly renderer: Renderer,
    readonly map: MapBuild,
    ui: HTMLElement | null,
  ) {
    const q = renderer.quality;
    this.physics = new Physics();
    this.terrain = map.terrain;
    this.terrain.install(this.scene, this.physics, this.collision);
    map.builder.finalize(this.scene, this.physics, this.collision);
    this.interactives = map.builder.interactives;
    this.scene.fog = new THREE.Fog(0xf2a77a, q.fogNear, q.fogFar);
    this.scene.background = new THREE.Color(0xf2a77a);
    this.sky = new Sky(q.clouds, new Rng(77));
    this.scene.add(this.sky.group);
    this.lighting = new Lighting(this.scene);
    this.lighting.applyQuality(q);
    this.vfx = new VFX(this.scene, q);
    this.vfx.ground = (x, z) => this.terrain.heightAt(x, z);
    this.crowd = new CrowdRenderer(this.scene, 40);
    this.crowd.warm();
    this.weaponCrowd = new WeaponCrowd(this.scene, 64);
    this.throwables = new Throwables(this.scene);
    this.fp = new FpCamera(renderer.aspect);
    this.vfx.camera = this.fp.camera;
    this.viewmodel = new Viewmodel(renderer.aspect);
    this.collision.targets.push(new SoldierTargets(() => this.soldiers, (s) => !s.inVehicle));

    this.moveCtx = {
      physics: this.physics,
      interactives: this.interactives,
      time: 0,
      groundHeight: (x, z) => this.terrain.heightAt(x, z),
      hasWingsuit: (s) => SPECIALIST_BY_ID[s.specialist].passiveName === 'Wingsuit',
      onLand: (s, impact) => this.onLand(s, impact),
      onOutOfBounds: () => undefined,
      speedMul: (s) => (s.arsenal ? s.arsenal.current.stats.moveMul : 1),
      aiming: (s) => !!s.arsenal && s.arsenal.adsK > 0.5,
    };

    const lo = save.data.loadouts[save.data.cls];
    this.player = this.addSoldier(0, 'You', save.data.cls, lo.specialist, lo.primary, lo.throwable);
    this.player.isPlayer = true;
    teleport(this.player, map.spawn);
    this.controller.setAim(map.spawnYaw, 0);
    this.viewmodel.setTeam(0);
    if (ui) this.hud = new Hud(ui, this.events, () => this.player);
    this.events.on('shot', (e) => this.onShot(e.soldier));
    this.applySky();
  }

  setMode(m: BattleMode): void {
    this.mode = m;
    m.setup(this);
  }

  addSoldier(team: TeamId, name: string, cls: ClassId, spec: SpecialistId, primary: WeaponId, throwable: ThrowableId): Soldier {
    const s = new Soldier(this.nextId++, name, team, cls, spec, primary, throwable);
    const rocketBonus = SPECIALIST_BY_ID[spec].passiveName === 'Ordnance' ? 2 : 0;
    s.arsenal = new Arsenal(primary, (id) => (team === 0 && name === 'You' ? save.data.attachments[id] : undefined) ?? defaultAttachments(id), throwable, rocketBonus);
    this.soldiers.push(s);
    this.byId.set(s.id, s);
    attachBody(s, this.physics);
    return s;
  }

  soldierById(id: number): Soldier | undefined {
    return this.byId.get(id);
  }

  /** Brings a soldier back at a position with full health and ammo. */
  respawn(s: Soldier, pos: THREE.Vector3, yaw: number): void {
    s.alive = true;
    s.downed = false;
    s.health = TUNING.health.max;
    s.armor = s.maxArmor;
    s.state = 'ground';
    s.deadT = 0;
    s.downedT = 0;
    s.empT = 0;
    s.vel.set(0, 0, 0);
    s.spawnProtectT = 1.5;
    s.assistants.clear();
    setStance(s, 'stand', this.physics);
    teleport(s, pos);
    s.yaw = yaw;
    s.pitch = 0;
    s.input.yaw = yaw;
    s.arsenal.refillAll();
    s.arsenal.switchTo(0);
    s.arsenal.slot = 0;
    s.arsenal.equipT = 0;
    if (s.isPlayer) this.controller.setAim(yaw, 0);
  }

  // ---- WeaponContext ---------------------------------------------------------------------------
  arsenal(s: Soldier): Arsenal {
    return s.arsenal;
  }
  muzzle(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
    if (s.isPlayer && !s.inVehicle) return this.viewmodel.muzzleWorld(this.fp.camera, out);
    return approxMuzzle(s, out);
  }
  applyRecoil(s: Soldier, pitch: number, yaw: number): void {
    if (s.isPlayer) {
      this.controller.pitch = clamp(this.controller.pitch + pitch, -TUNING.camera.pitchLimit, TUNING.camera.pitchLimit);
      this.controller.yaw += yaw;
      s.input.pitch = this.controller.pitch;
      s.input.yaw = this.controller.yaw;
      s.pitch = this.controller.pitch;
      s.yaw = this.controller.yaw;
      if (pitch > 0) this.viewmodel.kick(Math.min(2, pitch * 40), yaw * 4);
    } else {
      s.pitch += pitch;
      s.yaw += yaw;
      s.input.pitch += pitch;
      s.input.yaw += yaw;
    }
  }
  lockCandidate(): { id: unknown; pos(): THREE.Vector3 | null } | null {
    return null;
  }
  throwGrenade(s: Soldier, kind: ThrowableId, origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.throwables.throw(s, kind, origin, dir);
  }
  horizontalSpeed(s: Soldier): number {
    return Math.hypot(s.vel.x, s.vel.z);
  }
  onExplosion(pos: THREE.Vector3, radius: number, damage: number): void {
    const d = this.fp.camera.position.distanceTo(pos);
    const R = TUNING.camera.explosionShakeRadius;
    if (d < R) this.fp.addTrauma(clamp((1 - d / R) * damage * TUNING.explosions.shakePerDamage, 0, 0.8));
    void radius;
  }
  damageObject(): boolean {
    return false;
  }
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    return this.throwables.blocks(a, b);
  }
  isMedic(s: Soldier): boolean {
    return s.cls === 'support';
  }
  fastReviver(s: Soldier): boolean {
    return SPECIALIST_BY_ID[s.specialist].passiveName === 'Triage';
  }
  explosiveResist(s: Soldier): number {
    return SPECIALIST_BY_ID[s.specialist].passiveName === 'Insulated' ? 0.7 : 1;
  }

  // ------------------------------------------------------------------------------------------
  private onLand(s: Soldier, impact: number): void {
    if (impact > 6) dustKick(this.vfx, s.pos, Math.min(3, impact / 6));
    if (s.isPlayer) this.fp.addTrauma(Math.min(0.35, impact / 60));
  }

  private onShot(s: Soldier): void {
    const st = s.arsenal.current.stats;
    const mz = this.muzzle(s, _v);
    const dir = viewDir(s.yaw, s.pitch, _v2);
    const scale = st.category === 'launcher' ? 2 : st.category === 'sniper' || st.category === 'shotgun' ? 1.5 : st.suppressed ? 0.35 : 1;
    muzzleFlash(this.vfx, mz, dir, st.energy, scale, s.isPlayer || s.pos.distanceToSquared(this.player.pos) < 900);
    if (s.isPlayer) {
      const ej = this.viewmodel.ejectWorld(this.fp.camera, _v2);
      _right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      shellEject(this.vfx, ej, _right, st.energy);
    }
  }

  private applySky(): void {
    sampleSky(this.dayT, this.storm, this.skyState);
    this.sky.apply(this.skyState, this.storm);
    this.lighting.applySky(this.skyState);
    (this.scene.fog as THREE.Fog).color.copy(this.skyState.fog);
    (this.scene.background as THREE.Color).copy(this.skyState.fog);
  }

  // ------------------------------------------------------------------------------------------
  frame(_dt: number): void {
    this.stepInFrame = 0;
    const p = this.player;
    const a = p.arsenal;
    // Attachment menu (hold T): the mouse drives the menu cursor instead of the aim.
    const menu = this.hud?.attachments;
    const wantMenu = (input.isDown('attachments') || this.forceAttachMenu) && p.active && !p.inVehicle;
    if (menu) {
      if (wantMenu && !menu.open) menu.show(a.current, () => true);
      if (!wantMenu && menu.open) menu.hide();
      if (menu.open) {
        const [dx, dy] = input.takeMouse();
        const att = menu.update(dx, dy, input.pressed('fire'), () => true);
        if (att) this.setAttachments(att);
        this.attachClicked = true;
      }
    }
    const zoom = 1 + (a.current.stats.zoom - 1) * a.adsK;
    this.controller.frame(p, a.adsK, zoom);
    if (menu?.open) {
      p.input.fire = false;
      p.input.firePressed = false;
      p.input.aim = false;
    }
  }

  setAttachments(att: AttachmentSet): void {
    const w = this.player.arsenal.current;
    w.setAttachments(att);
    save.update((d) => {
      d.attachments[w.id] = att;
    });
    this.hud?.attachments.refresh();
  }

  update(dt: number): void {
    this.time += dt;
    this.moveCtx.time = this.time;
    this.interactives.update(dt);
    for (const s of this.soldiers) {
      if (s.dummy && !s.alive) continue;
      stepMovement(s, dt, this.moveCtx);
    }
    for (const s of this.soldiers) this.weaponSystem.step(s, dt, this);
    this.projectiles.step(dt, this);
    this.throwables.step(dt, this);
    for (const s of this.soldiers) {
      stepHealth(this, s, dt);
      s.empT = Math.max(0, s.empT - dt);
    }
    this.physics.step();
    this.mode?.update(dt);
    if (this.stepInFrame++ === 0) for (const s of this.soldiers) clearEdges(s.input);
  }

  render(alpha: number, frameDt: number): void {
    const p = this.player;
    const a = p.arsenal;
    const w = a.current;
    this.swayT += frameDt;
    // Camera at the interpolated eye.
    this.renderPos.copy(p.prevPos).lerp(p.pos, alpha);
    const eye = _v.copy(this.renderPos);
    eye.y += p.eye;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const extraFov = p.tacSprint ? TUNING.camera.tacSprintFovAdd : p.sprinting ? TUNING.camera.sprintFovAdd : p.state === 'slide' ? TUNING.camera.slideFovAdd : 0;
    const zoom = 1 + (w.stats.zoom - 1) * a.adsK;
    this.fp.shakeScale = save.settings.screenShake;
    this.fp.headBob = save.settings.headBob;
    this.fp.update(frameDt, eye, this.controller.yaw, this.controller.pitch, speed, p.grounded && p.state === 'ground', p.landKick, save.settings.fov, zoom, extraFov * (1 - a.adsK), this.renderer.aspect);

    for (const s of this.soldiers) if (!s.isPlayer && (s.alive || s.deadT < 8)) this.drawSoldier(s, alpha, frameDt);
    this.crowd.flush();
    this.weaponCrowd.flush();

    // Viewmodel.
    const vm = this.vm;
    const scoped = w.stats.scoped && a.adsK > 0.85 && p.active;
    if (this.viewWeapon !== w.id || this.viewAttKey !== attKey(w.att)) {
      this.viewWeapon = w.id;
      this.viewAttKey = attKey(w.att);
      this.viewmodel.setWeapon(w.id, w.att);
    }
    vm.adsK = a.adsK;
    vm.sprintK += ((p.sprinting || p.tacSprint ? 1 : 0) - vm.sprintK) * damp(10, frameDt);
    vm.tacSprint = p.tacSprint;
    vm.speed = speed;
    vm.grounded = p.grounded;
    vm.mouseDX = this.controller.dx;
    vm.mouseDY = this.controller.dy;
    vm.lowered = p.state === 'ladder' || p.state === 'zipline' || p.state === 'parachute' || p.state === 'wingsuit' || p.state === 'mantle' || p.state === 'grapple';
    vm.reload = w.reloading ? (w.stats.perShell ? (w.reloadT / w.reloadDur) % 1 : w.reloadT / w.reloadDur) : -1;
    vm.cycle = w.cycleT;
    vm.vent = w.overheatT > 0 && w.stats.heat ? 1 - w.overheatT / w.stats.heat.lockout : -1;
    vm.inspect = a.inspectT;
    vm.melee = a.meleeT;
    vm.throwing = a.throwT;
    vm.equip = a.equipK;
    vm.scoped = scoped;
    vm.heat = w.heat;
    this.viewmodel.visible = p.active && !p.inVehicle;
    this.viewmodel.setFov(a.adsK, w.stats.zoom);
    this.viewmodel.copyLights(this.lighting);
    this.viewmodel.update(frameDt, this.fp.camera, vm, this.renderer.aspect);

    this.projectiles.render(this, alpha);
    this.throwables.render(alpha);
    this.vfx.update(frameDt);
    this.sky.update(frameDt, this.fp.camera.position, 4);
    this.lighting.follow(this.renderPos);
    this.vfx.flushTracers();
    this.renderer.render(this.scene, this.fp.camera, this.viewmodel.scene, this.viewmodel.camera);

    // HUD.
    if (this.hud) {
      const aim = viewDir(this.controller.yaw, this.controller.pitch, _v2);
      const hit = this.collision.raycast(this.fp.camera.position, aim, 1500, { ignore: p });
      const enemy = !!hit && hit.kind === 'soldier' && (hit.ref as Soldier).team !== p.team;
      this.hud.update({
        dt: frameDt,
        player: p,
        arsenal: a,
        spread: currentSpread(p, a, w, speed),
        vfov: verticalFov(save.settings.fov, zoom),
        screenH: window.innerHeight,
        scoped,
        zoom: w.stats.zoom,
        rangeM: hit ? hit.dist : null,
        enemyUnderCrosshair: enemy,
        gadget: null,
        time: this.swayT,
      });
    }
    this.mode?.frame?.(frameDt);
    this.debug.state = `${p.state} / ${p.stance}${p.sprinting ? ' / sprint' : ''}${p.tacSprint ? ' / tac' : ''}`;
    this.debug.speed = `${speed.toFixed(1)} m/s  y ${p.pos.y.toFixed(1)}`;
    if (this.attachClicked) this.attachClicked = false;
    input.endFrame();
  }

  private drawSoldier(s: Soldier, alpha: number, dt: number): void {
    const pos = this.renderPos.copy(s.prevPos).lerp(s.pos, alpha);
    const a = s.arsenal;
    const wid = a.current.id;
    const cat = categoryOf(wid);
    s.anim.update(dt, {
      pos,
      yaw: s.yaw,
      pitch: s.pitch,
      vel: s.vel,
      crouch: s.stance === 'crouch' || s.state === 'slide',
      prone: s.stance === 'prone',
      mode: bodyMode(s),
      weapon: { cat, anchors: this.weaponCrowd.anchors(wid) },
      reload: a.current.reloading ? a.current.reloadT / Math.max(0.01, a.current.reloadDur) : -1,
      melee: a.meleeT,
      throwing: a.throwT,
      kick: clamp(1 - (this.time - a.current.lastShotT) * 12, 0, 1),
      deadT: s.deadT,
      seed: s.deathSeed,
      driving: false,
    });
    this.crowd.submit(s.team, s.cls, s.anim.out, Math.min(0.7, s.flashT * 6));
    if (s.anim.hasWeapon && s.alive) this.weaponCrowd.submit(wid, s.anim.weaponMatrix);
  }

  resize(aspect: number): void {
    this.fp.camera.aspect = aspect;
    this.fp.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.mode?.dispose?.();
    this.hud?.dispose();
    this.events.clear();
    this.vfx.dispose();
    this.crowd.dispose();
    this.weaponCrowd.dispose();
    this.physics.dispose();
  }
}

function attKey(a: AttachmentSet): string {
  return `${a.sight}|${a.barrel}|${a.underbarrel}|${a.ammo}`;
}

export function bodyMode(s: Soldier): BodyMode {
  switch (s.state) {
    case 'ground':
      return s.sprinting || s.tacSprint ? 'sprint' : 'normal';
    case 'air':
    case 'grapple':
      return 'air';
    case 'vehicle':
      return 'seated';
    default:
      return s.state as BodyMode;
  }
}

/** Approximate third-person muzzle position from the eye and aim (simulation side). */
export function approxMuzzle(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
  const d = viewDir(s.yaw, s.pitch, _v2);
  const r = _right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
  return out.copy(s.eyePos).addScaledVector(d, 0.75 * TP_WEAPON_SCALE).addScaledVector(r, 0.18).setY(s.eyePos.y - 0.15);
}
