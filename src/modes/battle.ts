// Battle runtime: the world, every soldier, physics, combat and rendering for one session
// (training ground or match). Systems step at the fixed simulation rate in a fixed order;
// rendering interpolates between steps.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { Physics, initPhysics } from '../physics/physics';
import { CollisionWorld, makeHit } from '../physics/collision';
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
import { attachBody, detachBody, stepMovement, teleport, setStance, type MovementContext } from '../player/movement';
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
import { attachmentUnlocked } from '../net-sim/unlocks';
import { SPECIALIST_BY_ID, VEHICLES, type AttachmentId, type ClassId, type SpecialistId, type TeamId, type ThrowableId, type WeaponId } from '../config/content';
import type { MapBuild } from '../world/maps/mapBuild';
import { Destructibles, type Destructible } from '../world/destruction';
import { Water } from '../world/water';
import { Rocket } from '../world/rocket';
import { captureTacticalMap, type TacticalImage } from '../render/tacticalMap';
import { Pings, type PingKind } from '../net-sim/pings';
import { GadgetSystem, type GadgetContext } from '../gadgets/system';
import { hasPassive } from '../gadgets/state';
import { CallIns, type CallInKind } from '../gadgets/callins';
import { VehicleSystem, type VehicleContext } from '../vehicles/system';
import { SEAT_MOUNTS, type Vehicle } from '../vehicles/vehicle';
import { keyLabel } from '../ui/screens/widgets';
import type { VehicleView } from '../ui/hud/vehicleHud';
import type { HudWorld, HudPrompt } from '../ui/hud/types';
import type { ScoreboardData } from '../ui/screens/scoreboard';
import type { GadgetView } from '../ui/hud/weaponPanel';
import { flags } from '../core/flags';
import { AIDirector, type AIHost } from '../ai/director';
import { raySoldier } from '../weapons/hitboxes';
import { damageAt } from '../weapons/ballistics';
import { damageSoldier } from '../weapons/damage';
import { buildNavMesh, GridNav, type PathFinder } from '../world/nav';
import { explode, killSoldier } from '../weapons/damage';
import type { Renderer } from '../render/renderer';
import type { Interactives } from '../world/interactives';
import type { Terrain } from '../world/terrain';
import type { GameScene } from '../scenes/gameScene';
import type { BattleMode } from './mode';
import type { BodyMode } from '../art/soldierAnim';

const MOUNT_NAMES: Record<string, string> = { cannon: 'Siege cannon', coax: 'Coax beam', rockets: 'Rocket pods', chin: 'Chin turret', minigun: 'Twin miniguns', doorgun: 'Door gun' };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();
const makeHitTmp = makeHit();

export class Battle implements GameScene, WeaponContext, AIHost, GadgetContext, VehicleContext {
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
  /** Automated runs show the scoreboard without input. */
  forceScoreboard = false;

  readonly destructibles: Destructibles;
  readonly water: Water | null = null;
  readonly rocket: Rocket | null = null;
  nav: PathFinder | null = null;
  readonly ai: AIDirector;
  readonly pings: Pings;
  readonly gadgets: GadgetSystem;
  readonly callIns: CallIns;
  readonly vehicles: VehicleSystem;
  /** Vehicle camera: first person (seat) or third person. */
  vehicleThirdPerson = true;
  private vehCam = new THREE.Vector3();
  private vehCamInit = false;
  tactical: TacticalImage | null = null;
  private pingHeld = -1;
  private navGeometry: THREE.BufferGeometry;
  /** Fixed debug camera from ?cam=x,y,z,tx,ty,tz (screenshots). */
  private debugCam: number[] | null = null;

  static async create(renderer: Renderer, map: MapBuild, ui: HTMLElement | null, onProgress?: (f: number, label: string) => void): Promise<Battle> {
    await initPhysics();
    onProgress?.(0.55, 'Assembling the world');
    await new Promise((r) => setTimeout(r, 0));
    const b = new Battle(renderer, map, ui);
    onProgress?.(0.7, 'Building navigation mesh');
    await new Promise((r) => setTimeout(r, 0));
    await b.buildNav();
    return b;
  }

  private async buildNav(): Promise<void> {
    const t = this.terrain.indexedGeometry();
    const tp = t.getAttribute('position').array as Float32Array;
    const ti = t.index!.array as Uint32Array;
    const sp = this.navGeometry.getAttribute('position')?.array as Float32Array | undefined;
    const sn = sp ? sp.length / 3 : 0;
    const positions = new Float32Array(tp.length + (sp?.length ?? 0));
    positions.set(tp, 0);
    if (sp) positions.set(sp, tp.length);
    const indices = new Uint32Array(ti.length + sn);
    indices.set(ti, 0);
    const base = tp.length / 3;
    for (let i = 0; i < sn; i++) indices[ti.length + i] = base + i;
    const half = this.terrain.size / 2;
    this.nav = await buildNavMesh({ positions, indices, interactives: this.interactives, bounds: [[-half, -20, -half], [half, 160, half]] });
    if (!this.nav) {
      this.nav = new GridNav(-half, 4, this.terrain.size, (x, z) => this.terrain.heightAt(x, z), () => false);
      this.debug.nav = 'grid A* (fallback)';
    } else this.debug.nav = 'navmesh';
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
    this.navGeometry = map.builder.finalize(this.scene, this.physics, this.collision).navGeometry;
    this.interactives = map.builder.interactives;
    this.scene.fog = new THREE.Fog(0xf2a77a, q.fogNear, q.fogFar);
    this.scene.background = new THREE.Color(0xf2a77a);
    this.sky = new Sky(q.clouds, new Rng(77));
    this.scene.add(this.sky.group);
    this.lighting = new Lighting(this.scene);
    this.lighting.applyQuality(q);
    this.vfx = new VFX(this.scene, q);
    this.vfx.ground = (x, z) => this.terrain.heightAt(x, z);
    this.destructibles = new Destructibles(this.scene, map.builder.destructibles, this.physics, this.collision, this.vfx);
    this.destructibles.onExplode = (d) => this.fuelExplosion(d);
    this.destructibles.onDestroyed = (d) => this.events.emit('destruct', { pos: d.center.clone(), kind: d.kind });
    if (map.water !== null && map.seaX !== undefined) {
      this.water = new Water(map.water, map.seaX - 60, 1700, -1700, 1700);
      this.scene.add(this.water.mesh);
    }
    if (map.rocket) {
      this.rocket = new Rocket(map.rocket, this.physics, this.collision);
      this.scene.add(this.rocket.group);
    }
    this.debugCam = flags.cam;
    this.crowd = new CrowdRenderer(this.scene, 40);
    this.crowd.warm();
    this.weaponCrowd = new WeaponCrowd(this.scene, 64);
    this.throwables = new Throwables(this.scene);
    this.fp = new FpCamera(renderer.aspect);
    this.vfx.camera = this.fp.camera;
    this.viewmodel = new Viewmodel(renderer.aspect);
    this.collision.targets.push(new SoldierTargets(() => this.soldiers, (s) => this.vehicles.exposed(s)));
    this.ai = new AIDirector(this, map.builder.covers, save.settings.difficulty);
    this.pings = new Pings(this.events);
    this.gadgets = new GadgetSystem(this.scene);
    this.callIns = new CallIns(this.scene);
    this.vehicles = new VehicleSystem(this.scene);
    this.collision.targets.push(this.vehicles);
    if (map.hqs) this.vehicles.setupPads(map.hqs, (x, z) => this.terrain.heightAt(x, z));
    this.vehicles.reset(this);
    this.callIns.onLand = (kind, team, pos, yaw) => this.vehicles.spawn(kind, team, pos, yaw, this.physics);

    this.moveCtx = {
      physics: this.physics,
      interactives: this.interactives,
      time: 0,
      groundHeight: (x, z) => this.terrain.heightAt(x, z),
      hasWingsuit: (s) => SPECIALIST_BY_ID[s.specialist].passiveName === 'Wingsuit',
      onLand: (s, impact) => this.onLand(s, impact),
      onOutOfBounds: (s, left) => {
        if (left <= 0 && s.alive) killSoldier(this, s);
      },
      speedMul: (s) => (s.arsenal ? s.arsenal.current.stats.moveMul : 1) * (this.map.water !== null && s.pos.y < this.map.water - 0.4 ? TUNING.movement.wadeMul : 1) * ((s.sprinting || s.tacSprint) && hasPassive(s, 'Momentum') ? TUNING.gadgets.passives.momentumSprint : 1),
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
    if (this.mode) {
      this.mode.dispose?.();
      this.clearBots();
    }
    this.mode = m;
    m.setup(this);
  }

  /** Removes every soldier except the player (mode changes). */
  clearBots(): void {
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      if (s === this.player) continue;
      detachBody(s, this.physics);
      this.soldiers.splice(i, 1);
      this.byId.delete(s.id);
      this.ai.brains.delete(s.id);
    }
    this.ai.brains.delete(this.player.id);
    this.ai.squads.length = 0;
    this.player.squadId = -1;
    this.resetWorld();
  }

  addSoldier(team: TeamId, name: string, cls: ClassId, spec: SpecialistId, primary: WeaponId, throwable: ThrowableId): Soldier {
    const s = new Soldier(this.nextId++, name, team, cls, spec, primary, throwable);
    const rocketBonus = SPECIALIST_BY_ID[spec].passiveName === 'Ordnance' ? 2 : 0;
    s.arsenal = new Arsenal(primary, (id) => (team === 0 && name === 'You' ? save.data.attachments[id] : undefined) ?? defaultAttachments(id), throwable, rocketBonus);
    this.gadgets.equip(s);
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
    if (s.gadget) {
      const cd = s.gadget.cooldown;
      this.gadgets.equip(s);
      s.gadget.cooldown = cd;
    }
    s.arsenal.switchTo(0);
    s.arsenal.slot = 0;
    s.arsenal.equipT = 0;
    if (s.isPlayer) this.controller.setAim(yaw, 0);
  }

  /** Replaces a soldier's class, specialist and weapons (deploy screen loadout changes). */
  applyLoadout(s: Soldier, cls: ClassId, spec: SpecialistId, primary: WeaponId, throwable: ThrowableId): void {
    s.cls = cls;
    s.specialist = spec;
    s.primary = primary;
    s.throwable = throwable;
    const rocketBonus = SPECIALIST_BY_ID[spec].passiveName === 'Ordnance' ? 2 : 0;
    // Saved attachments that are still locked fall back to the weapon's defaults.
    const att = (id: WeaponId): AttachmentSet => {
      const saved = s.isPlayer ? save.data.attachments[id] : undefined;
      const def = defaultAttachments(id);
      if (!saved) return def;
      const ok = (k: keyof AttachmentSet) => (attachmentUnlocked(id, saved[k]) ? saved[k] : def[k]);
      return { sight: ok('sight'), barrel: ok('barrel'), underbarrel: ok('underbarrel'), ammo: ok('ammo') } as AttachmentSet;
    };
    s.arsenal = new Arsenal(primary, att, throwable, rocketBonus);
    s.maxArmor = 0;
    s.armor = 0;
    this.gadgets.equip(s);
    if (s.isPlayer) this.viewWeapon = null;
  }

  /** Re-applies the renderer's quality profile to the live scene (settings changes). */
  applyQuality(): void {
    const q = this.renderer.quality;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = q.fogNear;
    fog.far = q.fogFar;
    this.lighting.applyQuality(q);
    this.scene.traverse((o) => {
      if (o.name === 'outline') o.visible = q.outlines;
      if (this.renderer.shadowChanged) {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      }
    });
    this.renderer.shadowChanged = false;
    this.vfx.setScale(q.particleScale);
  }

  /** Renders the holographic tactical map image (once, after load). */
  captureTactical(): TacticalImage {
    const img = this.captureTacticalImage();
    this.tactical = img;
    this.hud?.setMap(img);
    return img;
  }

  private captureTacticalImage(): TacticalImage {
    return captureTacticalMap(this.renderer.gl, this.scene, {
      worldSize: this.terrain.size,
      water: this.map.water,
      seaX: this.map.seaX,
      limit: TUNING.movement.mapLimit,
      roads: this.map.roads,
      roadWidth: this.map.roadWidth,
      hide: [this.sky.group, this.vfx.group, this.crowd.group, this.weaponCrowd.group],
    });
  }

  /** Takes a soldier out of the world without a death (before the first deploy). */
  park(s: Soldier, at: THREE.Vector3): void {
    s.alive = false;
    s.downed = false;
    s.state = 'dead';
    s.deadT = 1e6;
    s.health = 0;
    teleport(s, at);
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
  lockCandidate(s: Soldier): { id: unknown; pos(): THREE.Vector3 | null } | null {
    return this.vehicles.lockCandidate(s, s.eyePos, s.yaw, s.pitch);
  }
  personalWeaponSeat(s: Soldier): boolean {
    const v = this.vehicles.vehicleOf(s);
    return !!v && SEAT_MOUNTS[v.kind][s.seat] === 'personal';
  }
  shielded(s: Soldier): boolean {
    return s.inVehicle && !this.vehicles.exposed(s);
  }
  arcVehicle(by: Soldier, ref: unknown, dt: number): boolean {
    return this.vehicles.arc(by, ref, dt, this);
  }
  throwGrenade(s: Soldier, kind: ThrowableId, origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.throwables.throw(s, kind, origin, dir);
  }
  sprintToFireMul(s: Soldier): number {
    return hasPassive(s, 'Momentum') ? TUNING.gadgets.passives.momentumSprintToFire : 1;
  }
  horizontalSpeed(s: Soldier): number {
    return Math.hypot(s.vel.x, s.vel.z);
  }
  onExplosion(pos: THREE.Vector3, radius: number, damage: number, _attacker: Soldier | null, _vehicleDamage: number, kind: string): void {
    const d = this.fp.camera.position.distanceTo(pos);
    const R = TUNING.camera.explosionShakeRadius;
    if (d < R) this.fp.addTrauma(clamp((1 - d / R) * damage * TUNING.explosions.shakePerDamage, 0, 0.8));
    if (kind !== 'emp' && damage > 0) {
      this.destructibles.radiusDamage(pos, radius * TUNING.destruction.explosionRadiusMul, damage * TUNING.destruction.explosionDamageMul);
      this.gadgets.radiusDamage(pos, radius, damage, _attacker, this);
    }
    if (kind === 'emp') {
      this.gadgets.emp(pos, radius, this, _attacker ? _attacker.team : -1);
      this.vehicles.emp(pos, radius, _attacker ? _attacker.team : -1);
    } else this.vehicles.radiusDamage(pos, radius, _vehicleDamage, _attacker, this);
  }
  damageObject(ref: unknown, _kind: string, damage: number, attacker: Soldier | null = null, pos: THREE.Vector3 = _v, vehicleDamage = 0): boolean {
    if (this.vehicles.damageRef(ref, vehicleDamage, attacker, this, pos)) return true;
    if (this.gadgets.damageRef(ref, damage, attacker, this, pos)) return true;
    if (ref && typeof ref === 'object' && 'debris' in ref && 'maxHp' in ref) return this.destructibles.damage(ref as Destructible, damage * TUNING.destruction.bulletMul);
    return false;
  }

  private fuelExplosion(d: Destructible): void {
    const F = TUNING.destruction.fuelTank;
    explode(this, d.center, { radius: F.radius, damage: F.damage, inner: F.inner, attacker: null, weapon: 'Fuel tank', kind: 'fuel', vehicleDamage: F.vehicleDamage });
  }
  // ---- AIHost ----------------------------------------------------------------------------------
  fragsNear(p: THREE.Vector3, r: number): readonly { pos: THREE.Vector3 }[] {
    return this.throwables.near(p, r);
  }
  cameraPos(): THREE.Vector3 {
    return this.fp.camera.position;
  }
  hqCenter(team: TeamId): THREE.Vector3 {
    return this.map.hqs?.find((h) => h.team === team)?.center ?? this.map.spawn;
  }

  // ---- GadgetContext -------------------------------------------------------------------------
  // ---- Crew host (bots and vehicles) -------------------------------------------------------------
  readonly mapLimit = TUNING.movement.mapLimit;

  enterVehicle(s: Soldier, v: Vehicle, seat: number): boolean {
    return this.vehicles.enter(s, v, seat);
  }

  exitVehicle(s: Soldier): boolean {
    return this.vehicles.exit(s, this);
  }

  switchSeat(s: Soldier, seat: number): boolean {
    return this.vehicles.switchSeat(s, seat);
  }

  /** A bot's airdrop request: open ground a little ahead of it. */
  requestCallIn(s: Soldier, kind: CallInKind): boolean {
    if (!this.callIns.ready(s.team, kind)) return false;
    for (let k = 0; k < 6; k++) {
      const a = s.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.9;
      _v.set(s.pos.x - Math.sin(a) * 14, 0, s.pos.z - Math.cos(a) * 14);
      const ty = this.terrain.heightAt(_v.x, _v.z);
      const gy = this.collision.groundBelow(_v.x, ty + 120, _v.z, 200);
      if (gy === null || Math.abs(gy - ty) > 0.6) continue;
      _v.y = ty;
      if (!this.callIns.request(s, kind, _v, ty)) return false;
      this.events.emit('ping', { soldier: s, pos: _v.clone(), kind: 'vehicle' });
      return true;
    }
    return false;
  }

  groundHeight(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Spot for a team; quiet spots (sensors, autopilot drones) score only for new marks. */
  spot(by: Soldier, target: Soldier, quiet = false): void {
    const fresh = !(target.spottedUntil > this.time && target.spottedByTeam === by.team);
    if (quiet && !fresh) {
      target.spottedUntil = Math.max(target.spottedUntil, this.time + TUNING.gadgets.sensor.pulse + 0.6);
      return;
    }
    this.ai.spot(by, target);
  }

  /** Interact enters or leaves a vehicle; seat keys switch seats. */
  private vehicleSeatInput(s: Soldier): void {
    const i = s.input;
    if (!s.alive) {
      if (s.inVehicle) this.vehicles.exit(s, this, true);
      return;
    }
    if (s.inVehicle) {
      if (s.downed) {
        this.vehicles.exit(s, this, true);
        return;
      }
      s.prevYaw = s.yaw;
      s.prevPitch = s.pitch;
      s.yaw = i.yaw;
      s.pitch = clamp(i.pitch, -TUNING.camera.pitchLimit, TUNING.camera.pitchLimit);
      if (i.interact) this.vehicles.exit(s, this);
      else if (i.seat >= 0) this.vehicles.switchSeat(s, i.seat);
      return;
    }
    // Bots board through the crew planner (AIDirector), never by a stray interact press.
    if (!s.isPlayer || !s.active || !i.interact || s.state === 'ladder' || s.state === 'zipline') return;
    // Ladders and ziplines take precedence when right at hand.
    if (this.interactives.nearestLadder(s.pos, 1.2) || this.interactives.nearestZipline(s.pos, 1.5)) return;
    const v = this.vehicles.nearest(s);
    if (v && this.vehicles.enter(s, v)) i.interact = false;
  }

  /** A piloting soldier stands still; the drone takes the command. */
  private holdForPilot(s: Soldier): void {
    const d = this.gadgets.droneOf(s);
    if (!d || !d.piloted) {
      s.piloting = false;
      return;
    }
    const i = s.input;
    d.cmd.moveX = i.moveX;
    d.cmd.moveZ = i.moveZ;
    d.cmd.up = (i.jumpHeld ? 1 : 0) - (i.sprint ? 1 : 0);
    d.cmd.yaw = i.yaw;
    d.cmd.pitch = i.pitch;
    if (i.firePressed) {
      // Spot whatever is under the drone's reticle.
      const dir = viewDir(d.yaw, d.pitch, _v2);
      const hit = this.collision.raycast(d.pos, dir, TUNING.gadgets.drone.spotRange * 1.5, { ignore: d }, makeHitTmp);
      if (hit && hit.kind === 'soldier' && (hit.ref as Soldier).team !== s.team) {
        const t = hit.ref as Soldier;
        this.ai.spot(s, t);
        this.events.emit('ping', { soldier: s, pos: t.pos.clone(), kind: 'enemy', follow: t });
      } else if (hit) this.events.emit('ping', { soldier: s, pos: hit.point.clone(), kind: 'location' });
    }
    i.moveX = 0;
    i.moveZ = 0;
    i.jump = false;
    i.fire = false;
    i.firePressed = false;
    i.aim = false;
    i.sprint = false;
    i.yaw = s.yaw;
    i.pitch = s.pitch;
  }

  /** Far bots shooting far bots: analytic hit test against the target's hitboxes, no projectile. */
  resolveShot(s: Soldier, st: Arsenal['current']['stats'], origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (s.isPlayer || s.lod < 2 || st.category === 'launcher') return false;
    const b = this.ai.brain(s);
    const t = b?.target;
    if (!t || t.isPlayer || t.lod < 2 || !t.alive || !b.targetVisible) return false;
    const range = origin.distanceTo(t.pos) + 3;
    const hit = raySoldier(t, origin, dir, range);
    if (!hit) return true;
    const r = damageSoldier(this, t, damageAt(st, hit.dist, hit.part), { attacker: s, weapon: st.id, part: hit.part, explosive: false, from: origin.clone(), armorMul: st.armorMul });
    if (r.dealt > 0) this.events.emit('hit', { attacker: s, victim: t, kind: 'soldier', part: hit.part, damage: r.dealt, armorBreak: r.armorBreak, kill: r.killed, downed: r.downed, pos: _v.copy(origin).addScaledVector(dir, hit.dist).clone() });
    return true;
  }

  /** Clears transient combat state and rebuilds destructibles (round restart). */
  resetWorld(): void {
    this.projectiles.clear();
    this.throwables.clear();
    this.destructibles.reset();
    this.vfx.clear();
    this.pings.clear();
    this.gadgets.clear(this);
    this.callIns.clear();
    this.vehicles.reset(this);
    this.ai.crews.clear();
    for (const s of this.soldiers) s.piloting = false;
    this.hud?.clearTransient();
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
      const unlocked = (id: AttachmentId) => attachmentUnlocked(a.current.id, id);
      if (wantMenu && !menu.open) menu.show(a.current, unlocked);
      if (!wantMenu && menu.open) menu.hide();
      if (menu.open) {
        const [dx, dy] = input.takeMouse();
        const att = menu.update(dx, dy, input.pressed('fire'), unlocked);
        if (att) this.setAttachments(att);
        this.attachClicked = true;
      }
    }
    // Scoreboard (hold Tab) and full map (M).
    if (this.hud) {
      this.hud.scoreboard.show(input.isDown('scoreboard') || this.forceScoreboard);
      if (input.pressed('map')) this.hud.fullMap?.toggle();
      if (!p.alive && this.hud.fullMap?.open) this.hud.fullMap.show(false);
    }
    this.handlePing(p);
    this.handleTablet(p);
    const zoom = 1 + (a.current.stats.zoom - 1) * a.adsK;
    if (this.ai.brain(p)) {
      // Autoplay: the player's brain writes the command; the camera follows its aim.
      input.takeMouse();
      this.controller.setAim(p.yaw, p.pitch);
    } else this.controller.frame(p, a.adsK, zoom, p.inVehicle && !this.personalWeaponSeat(p));
    if (p.inVehicle && input.pressed('vehicleCamera')) this.vehicleThirdPerson = !this.vehicleThirdPerson;
    if (menu?.open || this.hud?.comms.open || this.hud?.tablet.open) {
      p.input.slot = -1;
      p.input.fire = false;
      p.input.firePressed = false;
      p.input.aim = false;
    }
  }

  /** Q: tap to ping what is under the crosshair; hold for the comms rose. */
  private handlePing(p: Soldier): void {
    const hud = this.hud;
    if (!hud) return;
    const U = TUNING.ui;
    if (!p.active) {
      if (hud.comms.open) hud.comms.hide();
      this.pingHeld = -1;
      return;
    }
    if (input.pressed('ping')) this.pingHeld = 0;
    if (this.pingHeld >= 0) {
      const held = input.heldFor('ping');
      if (!hud.comms.open && held >= U.commsHoldSeconds) hud.comms.show();
      if (hud.comms.open) {
        const [dx, dy] = input.takeMouse();
        hud.comms.update(dx, dy);
      }
      if (input.released('ping') || !input.isDown('ping')) {
        if (hud.comms.open) {
          const opt = hud.comms.hide();
          if (opt) this.sendPing(p, opt.kind, opt.atAim);
        } else this.sendPing(p, null, true);
        this.pingHeld = -1;
      }
    }
  }

  /** Hold B: the call-in tablet; the drop goes to the crosshair point (or beside the player). */
  private handleTablet(p: Soldier): void {
    const tab = this.hud?.tablet;
    if (!tab) return;
    const C = TUNING.callins;
    if (!p.active || p.inVehicle || p.piloting) {
      if (tab.open) tab.hide();
      return;
    }
    if (!tab.open && input.heldFor('tablet') >= C.holdToOpen && input.isDown('tablet')) tab.show();
    if (!tab.open) return;
    const [dx] = input.takeMouse();
    const key = input.pressed('weapon1') ? 0 : input.pressed('weapon2') ? 1 : -1;
    const at = this.dropPoint(p, _v);
    const kind = tab.update(dx, key, this.callIns.cooldowns[p.team], at.inRange);
    const confirm = input.pressed('fire') || !input.isDown('tablet');
    if (!confirm) return;
    tab.hide();
    if (kind && this.callIns.request(p, kind, at.point, at.point.y)) {
      this.events.emit('announce', { text: `${kind === 'wisp' ? 'Wisp' : 'Basalt'} inbound`, sub: 'Airdrop requested', tone: 'info' });
      this.events.emit('ping', { soldier: p, pos: at.point.clone(), kind: 'vehicle' });
    }
  }

  /** Ground point under the crosshair for a call-in (beside the player when out of range). */
  dropPoint(p: Soldier, out: THREE.Vector3): { point: THREE.Vector3; inRange: boolean } {
    const aim = viewDir(this.controller.yaw, this.controller.pitch, _v2);
    const hit = this.collision.raycast(this.fp.camera.position, aim, TUNING.callins.maxRange, { worldOnly: true, ignore: p }, makeHitTmp);
    if (hit && hit.normal.y > 0.6) return { point: out.copy(hit.point), inRange: true };
    out.set(p.pos.x - Math.sin(p.yaw) * 8, 0, p.pos.z - Math.cos(p.yaw) * 8);
    out.y = this.terrain.heightAt(out.x, out.z);
    return { point: out, inRange: false };
  }

  /** Publishes a ping from the player: at the crosshair (or on the player for requests). */
  private sendPing(p: Soldier, kind: PingKind | null, atAim: boolean): void {
    const aim = viewDir(this.controller.yaw, this.controller.pitch, _v2);
    if (!atAim) {
      this.events.emit('ping', { soldier: p, pos: p.pos.clone().setY(p.pos.y + 2.1), kind: kind ?? 'location', follow: p });
      return;
    }
    const hit = this.collision.raycast(this.fp.camera.position, aim, TUNING.ui.pings.maxRange, { ignore: p });
    if (!hit) return;
    const target = hit.kind === 'soldier' ? (hit.ref as Soldier) : null;
    if (target && target.team !== p.team && (kind === null || kind === 'enemy')) {
      this.ai.spot(p, target);
      this.events.emit('ping', { soldier: p, pos: target.pos.clone(), kind: 'enemy', follow: target });
      return;
    }
    this.events.emit('ping', { soldier: p, pos: hit.point.clone(), kind: kind ?? 'location' });
  }

  /** HUD chip for the player's gadget. */
  private gadgetView(p: Soldier): GadgetView | null {
    const g = p.gadget;
    if (!g) return null;
    const name = SPECIALIST_BY_ID[p.specialist].gadgetName;
    if (g.id === 'arctool') return { name, ready: !g.overheated && g.disabledT <= 0, cooldown: g.heat, charges: 1 };
    const active = g.deployed > 0;
    const ready = g.cooldown <= 0 && g.charges > 0 && g.disabledT <= 0 && (!active || g.id === 'drone');
    return { name: active ? `${name} · active` : name, ready, cooldown: g.disabledT > 0 ? 1 : g.cooldown / Math.max(0.01, g.cooldownMax), charges: g.charges };
  }

  /** Everything the HUD reads this frame. */
  hudWorld(): HudWorld {
    const p = this.player;
    const info = this.mode?.hudInfo?.();
    const sq = this.ai.squadOf(p);
    return {
      time: this.time,
      player: p,
      camera: this.fp.camera,
      soldiers: this.soldiers,
      squad: sq?.members ?? [p],
      squadName: sq?.name ?? '',
      zones: info?.zones ?? [],
      tickets: info?.tickets ?? null,
      ticketMax: info?.ticketMax ?? 1,
      bleed: info?.bleed ?? [0, 0],
      kills: info?.kills ?? null,
      killTarget: info?.killTarget ?? 1,
      roundT: info?.roundT ?? this.time,
      timeLeft: info?.timeLeft ?? null,
      modeName: info?.modeName ?? '',
      hqs: (this.map.hqs ?? []).map((h) => ({ team: h.team, x: h.center.x, z: h.center.z })),
      limit: TUNING.movement.mapLimit,
      map: this.tactical,
      pings: this.pings.list,
      frags: this.throwables.near(p.pos, TUNING.ui.grenadeIndicatorRange),
      prompt: this.interactPrompt(p),
      hazards: this.hazards,
      drone: this.droneReadout(p),
      vehicle: this.vehicleView(p),
      vehicles: this.vehicles.list.filter((v) => v.alive).map((v) => ({ x: v.pos.x, z: v.pos.z, yaw: v.yaw, team: v.team, kind: v.kind, crewed: v.crewCount > 0, aircraft: v.aircraft })),
    };
  }

  /** The player's vehicle readout for the vehicle HUD. */
  private vehicleView(p: Soldier): VehicleView | null {
    const v = this.vehicles.vehicleOf(p);
    if (!v) return null;
    const V = TUNING.vehicles;
    const VW = V.weapons;
    const m = v.mounts[p.seat];
    let mount: VehicleView['mount'] = null;
    if (m && m.kind && m.kind !== 'personal') {
      const name = MOUNT_NAMES[m.kind];
      if (m.kind === 'cannon') mount = { name, heat: null, overheated: false, ammo: m.ammo, ammoMax: 1, reload: m.ammo > 0 ? null : 1 - m.reloadT / VW.cannon.reload };
      else if (m.kind === 'rockets') mount = { name, heat: null, overheated: false, ammo: m.ammo, ammoMax: VW.rockets.salvo, reload: m.ammo > 0 || m.salvoLeft > 0 ? null : 1 - m.reloadT / VW.rockets.reload };
      else mount = { name, heat: m.heat, overheated: m.overheatT > 0, ammo: null, ammoMax: 0, reload: null };
    }
    const key = (a: keyof typeof save.settings.bindings, d: string) => keyLabel(save.settings.bindings[a][0] ?? d);
    const C = V.countermeasures;
    const incoming = this.projectiles.list.some((q) => q.active && q.homing && (q.homing as { id?: unknown }).id === v);
    return {
      name: VEHICLES[v.kind].name,
      kind: v.kind,
      aircraft: v.aircraft,
      hp: v.hp / v.maxHp,
      comps: v.comps,
      crippledBelow: V.componentCrippled,
      seat: p.seat,
      seatLabel: VEHICLES[v.kind].seats[p.seat] ?? '',
      seats: v.seats.map((s) => ({ taken: !!s, squad: !!s && s !== p && s.squadId === p.squadId })),
      mount,
      personal: m?.kind === 'personal',
      driver: p.seat === 0,
      speed: v.vel.length(),
      heading: v.yaw,
      altitude: v.pos.y - this.terrain.heightAt(v.pos.x, v.pos.z),
      pitch: v.pitch,
      roll: v.roll,
      vtol: v.kind === 'condor' ? (v.forwardFlight ? 'Cruise' : 'Hover') : null,
      cm: { label: v.aircraft ? 'Flares' : 'Smoke', charges: v.cm.charges, max: C.charges, cooldown: v.cm.cooldown, active: v.cm.activeT > 0 },
      lockWarn: v.lockWarnT > 0,
      incoming,
      emp: v.empT > 0,
      burning: v.hp < v.maxHp * V.burnBelow,
      keys: { exit: key('interact', 'KeyE'), cm: key('fireMode', 'KeyX'), camera: key('vehicleCamera', 'KeyC'), vtol: key('reload', 'KeyR') },
    };
  }

  private droneReadout(p: Soldier): HudWorld['drone'] {
    const d = p.piloting ? this.gadgets.droneOf(p) : null;
    if (!d) return null;
    const D = TUNING.gadgets.drone;
    return { battery: d.battery / D.battery, altitude: d.pos.y - this.terrain.heightAt(d.pos.x, d.pos.z), hp: d.hp / D.hp };
  }

  /** Hazard zones shown on the maps (dynamic events add them). */
  hazards: { x: number; z: number; r: number; label: string }[] = [];

  scoreboardData(): ScoreboardData {
    const p = this.player;
    const info = this.mode?.hudInfo?.();
    const enemy = p.team === 0 ? 1 : 0;
    const totals: [number, number] = info?.tickets ? [info.tickets[p.team], info.tickets[enemy]] : info?.kills ? [info.kills[p.team], info.kills[enemy]] : [0, 0];
    return { player: p, soldiers: this.soldiers, squadName: (s) => this.mode?.squadName?.(s.squadId) ?? '', totals, totalLabel: info?.tickets ? 'Tickets' : 'Kills', roundT: info?.roundT ?? this.time, modeName: info?.modeName ?? '' };
  }

  /** Context prompt: revive a downed teammate, climb a ladder, ride a zipline. */
  private interactPrompt(p: Soldier): HudPrompt | null {
    if (!p.active || p.inVehicle || p.state === 'ladder' || p.state === 'zipline') return null;
    const key = keyLabel(save.settings.bindings.interact[0] ?? 'KeyE');
    const H = TUNING.health;
    for (const t of this.soldiers)
      if (t !== p && t.team === p.team && t.downed && t.alive && t.pos.distanceTo(p.pos) < H.reviveRange) return { key, text: `Hold to revive ${t.name}`, hold: t.reviverId === p.id ? t.reviveProgress : 0 };
    const R = TUNING.ui.interactRange;
    if (this.interactives.nearestLadder(p.pos, R * 0.6)) return { key, text: 'Climb ladder', hold: null };
    if (this.interactives.nearestZipline(p.pos, R)) return { key, text: 'Ride zipline', hold: null };
    const v = this.vehicles.nearest(p);
    if (v) return { key, text: `Enter ${VEHICLES[v.kind].name}${v.seats[0] ? '' : ' (drive)'}`, hold: null };
    return null;
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
    this.ai.update(dt);
    for (const s of this.soldiers) this.gadgets.stepSoldier(s, dt, this);
    for (const s of this.soldiers) this.vehicleSeatInput(s);
    this.vehicles.step(dt, this);
    for (const s of this.soldiers) {
      if (s.dummy && !s.alive) continue;
      if (s.inVehicle) continue;
      if (s.piloting) this.holdForPilot(s);
      stepMovement(s, dt, this.moveCtx);
    }
    for (const s of this.soldiers) this.weaponSystem.step(s, dt, this);
    this.projectiles.step(dt, this);
    this.throwables.step(dt, this);
    this.gadgets.step(dt, this);
    this.callIns.step(dt, this.vfx);
    for (const s of this.soldiers) {
      stepHealth(this, s, dt);
      s.empT = Math.max(0, s.empT - dt);
    }
    this.physics.step();
    this.vehicles.postPhysics(dt, this);
    this.pings.update(dt);
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

    for (const s of this.soldiers) if ((!s.isPlayer || flags.tp) && (s.alive || s.deadT < 8)) this.drawSoldier(s, alpha, frameDt);
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

    if (this.debugCam && this.debugCam.length >= 6) {
      const c = this.debugCam;
      this.fp.camera.position.set(c[0], c[1], c[2]);
      this.fp.camera.lookAt(c[3], c[4], c[5]);
      this.fp.camera.updateMatrixWorld();
      this.viewmodel.visible = false;
      this.viewmodel.update(frameDt, this.fp.camera, vm, this.renderer.aspect);
      this.hud?.root.classList.add('hidden');
    } else if (p.inVehicle && !flags.tp && !flags.spectate) {
      this.vehicleCamera(p, frameDt, alpha, vm);
    } else if (p.piloting && this.gadgets.droneOf(p)) {
      // Drone view: the camera rides the drone; the body stays behind.
      const d = this.gadgets.droneOf(p)!;
      const cam = this.fp.camera;
      cam.position.copy(d.prev).lerp(d.pos, alpha);
      cam.rotation.set(this.controller.pitch, this.controller.yaw, 0, 'YXZ');
      cam.updateMatrixWorld();
      this.viewmodel.visible = false;
      this.viewmodel.update(frameDt, cam, vm, this.renderer.aspect);
    } else if (flags.spectate || flags.tp) this.spectateCamera(frameDt, alpha, vm);
    else if (this.cameraOverride) {
      this.cameraOverride(this.fp.camera, frameDt);
      this.fp.camera.updateMatrixWorld();
      this.viewmodel.visible = false;
      this.viewmodel.update(frameDt, this.fp.camera, vm, this.renderer.aspect);
      this.hud?.root.classList.add('hidden');
    }
    this.water?.update(frameDt);
    this.gadgets.render(frameDt, alpha, this);
    this.callIns.render(alpha);
    if (!p.inVehicle) this.vehicles.render(alpha);
    this.projectiles.render(this, alpha);
    this.throwables.render(alpha);
    this.vfx.update(frameDt);
    this.sky.update(frameDt, this.fp.camera.position, 4);
    this.lighting.follow(this.renderPos);
    this.vfx.flushTracers();
    this.renderer.render(this.scene, this.fp.camera, this.viewmodel.scene, this.viewmodel.camera);

    // HUD (hidden while a debug camera is set).
    if (this.hud && !this.debugCam && !flags.spectate && !flags.tp && !this.cameraOverride) {
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
        gadget: this.gadgetView(p),
        time: this.swayT,
      }, this.hudWorld());
    }
    if (this.hud?.scoreboard.open) this.hud.updateScoreboard(frameDt, this.scoreboardData());
    this.screenEffects(frameDt);
    this.mode?.frame?.(frameDt);
    this.debug.state = `${p.state} / ${p.stance}${p.sprinting ? ' / sprint' : ''}${p.tacSprint ? ' / tac' : ''}`;
    this.debug.speed = `${speed.toFixed(1)} m/s  y ${p.pos.y.toFixed(1)}`;
    if (this.attachClicked) this.attachClicked = false;
    input.endFrame();
  }

  /** Cinematic camera (deploy screen, kill cam, end of round): hides the viewmodel and HUD. */
  cameraOverride: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  /** Post-process feedback: low-health edge, damage pulse, heavy-hit glitch, downed desaturation. */
  private screenEffects(dt: number): void {
    const fx = this.renderer.post?.fx;
    if (!fx) return;
    const p = this.player;
    const hud = this.hud;
    const low = TUNING.ui.lowHealthFraction;
    const hp = p.alive && !p.downed ? p.health / 100 : 0;
    const want = this.cameraOverride ? 0 : Math.max(hp < low && p.alive ? (1 - hp / low) * 0.85 : 0, (hud?.hurt ?? 0) * 0.5, p.downed ? 0.6 : 0);
    fx.damage += (want - fx.damage) * Math.min(1, dt * 6);
    const desat = this.cameraOverride ? 0 : p.downed ? 0.7 : 0;
    fx.desat += (desat - fx.desat) * Math.min(1, dt * 4);
    fx.chroma = hud && hud.glitchT > 0 && document.documentElement.dataset.motion !== 'reduced' ? (hud.glitchT / TUNING.ui.glitch) * 3 : 0;
  }

  private spectated: Soldier | null = null;
  private spectateT = 0;

  /** In a vehicle: seat view, or a chase camera behind the look direction (C toggles). */
  private vehicleCamera(p: Soldier, frameDt: number, alpha: number, vm: ViewmodelState): void {
    const v = this.vehicles.vehicleOf(p);
    if (!v) return;
    this.vehicles.render(alpha);
    const cam = this.fp.camera;
    const personal = this.personalWeaponSeat(p);
    const look = viewDir(this.controller.yaw, this.controller.pitch, _v2);
    const center = _v.copy(v.model.root.position).add(_right.set(0, v.model.centerY, 0).applyQuaternion(v.model.root.quaternion));
    if (this.vehicleThirdPerson && !personal) {
      const C = TUNING.vehicles.camera;
      const want = center.clone().addScaledVector(look, -C.thirdDistance[v.kind]).add(_right.set(0, C.thirdHeight[v.kind], 0));
      const gy = this.terrain.heightAt(want.x, want.z) + 1;
      if (want.y < gy) want.y = gy;
      if (!this.vehCamInit) {
        this.vehCam.copy(want);
        this.vehCamInit = true;
      }
      this.vehCam.lerp(want, 1 - Math.exp(-C.lerp * frameDt));
      cam.position.copy(this.vehCam);
      cam.lookAt(center.addScaledVector(look, 30));
    } else {
      const seat = _right.copy(v.model.seats[p.seat] ?? v.model.seats[0]).applyQuaternion(v.model.root.quaternion).add(v.model.root.position);
      cam.position.set(seat.x, seat.y + 0.75, seat.z);
      cam.rotation.set(this.controller.pitch, this.controller.yaw, 0, 'YXZ');
      this.vehCamInit = false;
    }
    cam.updateMatrixWorld();
    this.viewmodel.visible = personal;
    this.viewmodel.update(frameDt, cam, vm, this.renderer.aspect);
  }

  /** Debug spectator: over-the-shoulder view of a bot in a firefight (switches every few seconds). */
  private spectateCamera(frameDt: number, alpha: number, vm: ViewmodelState): void {
    this.spectateT += frameDt;
    if (flags.tp) this.spectated = this.player;
    const kind = flags.spectateKind;
    if (kind) {
      // Chase a bot-driven vehicle of that kind.
      const cur = this.spectated ? this.vehicles.vehicleOf(this.spectated) : null;
      if (!cur || !cur.alive || cur.driver !== this.spectated) {
        const v = this.vehicles.list.find((x) => x.alive && x.driver && !x.driver.isPlayer && (kind === 'vehicle' || x.kind === kind));
        this.spectated = v?.driver ?? null;
      }
      const v = this.spectated ? this.vehicles.vehicleOf(this.spectated) : null;
      if (v) {
        const C = TUNING.vehicles.camera;
        const r = v.model.root;
        const back = C.thirdDistance[v.kind] * 1.3;
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
        const cam = this.fp.camera;
        cam.position.set(r.position.x - fx * back, r.position.y + C.thirdHeight[v.kind] * 1.4, r.position.z - fz * back);
        cam.lookAt(r.position.x + fx * 20, r.position.y, r.position.z + fz * 20);
        cam.updateMatrixWorld();
        this.viewmodel.visible = false;
        this.viewmodel.update(frameDt, cam, vm, this.renderer.aspect);
        this.hud?.root.classList.add('hidden');
        return;
      }
    }
    const cur = this.spectated;
    if (!cur || !cur.alive || this.spectateT > 14) {
      let pick: Soldier | null = null;
      for (const b of this.ai.brains.values()) if (b.s !== this.player && b.s.alive && b.mode === 'combat' && b.targetVisible) pick = b.s;
      if (pick || !cur?.alive) {
        this.spectated = pick ?? this.soldiers.find((s) => s.alive && s !== this.player) ?? null;
        this.spectateT = 0;
      }
    }
    const s = this.spectated;
    if (!s) return;
    const p = _v.copy(s.prevPos).lerp(s.pos, alpha);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const cam = this.fp.camera;
    cam.position.set(p.x - fx * 3.4 + fz * 0.9, p.y + 2.3, p.z - fz * 3.4 - fx * 0.9);
    cam.lookAt(p.x + fx * 12, p.y + 1.4 + Math.sin(s.pitch) * 12, p.z + fz * 12);
    cam.updateMatrixWorld();
    this.viewmodel.visible = false;
    this.viewmodel.update(frameDt, cam, vm, this.renderer.aspect);
    this.hud?.root.classList.add('hidden');
  }

  private drawSoldier(s: Soldier, alpha: number, dt: number): void {
    if (s.inVehicle && !this.vehicles.exposed(s)) return;
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
      driving: s.inVehicle && s.seat === 0,
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
