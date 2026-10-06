// Battle runtime: the world, every soldier, physics and rendering for one session (training
// ground or match). Systems are stepped at the fixed simulation rate in a fixed order; rendering
// interpolates between steps.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { Physics, initPhysics } from '../physics/physics';
import { CollisionWorld } from '../physics/collision';
import { Sky, newSkyState, sampleSky, type SkyState } from '../render/sky';
import { Lighting } from '../render/lighting';
import { VFX } from '../render/vfx';
import { CrowdRenderer } from '../render/crowd';
import { WeaponCrowd } from '../render/weaponCrowd';
import { Rng } from '../core/rng';
import { input } from '../core/input';
import { save } from '../core/save';
import { damp } from '../core/math';
import { Soldier, clearEdges } from '../player/soldier';
import { attachBody, stepMovement, teleport, type MovementContext } from '../player/movement';
import { FpCamera } from '../player/fpCamera';
import { Viewmodel, newViewmodelState, type ViewmodelState } from '../player/viewmodel';
import { PlayerController } from '../player/playerController';
import { defaultAttachments } from '../art/weaponModels';
import { categoryOf } from '../art/weaponModels';
import { SPECIALIST_BY_ID, type TeamId } from '../config/content';
import type { MapBuild } from '../world/maps/training';
import type { Renderer } from '../render/renderer';
import type { Interactives } from '../world/interactives';
import type { Terrain } from '../world/terrain';
import type { GameScene } from '../scenes/gameScene';
import { dustKick } from '../render/recipes';

export class Battle implements GameScene {
  readonly scene = new THREE.Scene();
  readonly physics: Physics;
  readonly collision = new CollisionWorld();
  readonly sky: Sky;
  readonly lighting: Lighting;
  readonly vfx: VFX;
  readonly crowd: CrowdRenderer;
  readonly weaponCrowd: WeaponCrowd;
  readonly terrain: Terrain;
  readonly interactives: Interactives;
  readonly soldiers: Soldier[] = [];
  player: Soldier;
  readonly fp: FpCamera;
  readonly viewmodel: Viewmodel;
  readonly controller = new PlayerController();
  readonly vm: ViewmodelState = newViewmodelState();
  time = 0;
  /** 0 afternoon .. 1 dusk. */
  dayT = 0.5;
  storm = 0;
  private skyState: SkyState = newSkyState();
  private stepInFrame = 0;
  private nextId = 1;
  private moveCtx: MovementContext;
  adsK = 0;
  private renderPos = new THREE.Vector3();
  readonly rng = new Rng(1234);
  /** Messages for the debug readout. */
  debug: Record<string, string> = {};

  static async create(renderer: Renderer, map: MapBuild): Promise<Battle> {
    await initPhysics();
    return new Battle(renderer, map);
  }

  private constructor(
    readonly renderer: Renderer,
    readonly map: MapBuild,
  ) {
    const q = renderer.quality;
    this.physics = new Physics();
    this.terrain = map.terrain;
    this.terrain.install(this.scene, this.physics, this.collision);
    const built = map.builder.finalize(this.scene, this.physics, this.collision);
    void built;
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
    this.fp = new FpCamera(renderer.aspect);
    this.vfx.camera = this.fp.camera;
    this.viewmodel = new Viewmodel(renderer.aspect);

    this.moveCtx = {
      physics: this.physics,
      interactives: this.interactives,
      time: 0,
      groundHeight: (x, z) => this.terrain.heightAt(x, z),
      hasWingsuit: (s) => SPECIALIST_BY_ID[s.specialist].passiveName === 'Wingsuit',
      onLand: (s, impact) => this.onLand(s, impact),
      onOutOfBounds: () => undefined,
      speedMul: () => 1,
      aiming: (s) => s.input.aim && s.state === 'ground',
    };

    // The local player.
    const lo = save.data.loadouts[save.data.cls];
    this.player = this.addSoldier(0, 'You', save.data.cls, lo.specialist, lo.primary, lo.throwable);
    this.player.isPlayer = true;
    teleport(this.player, map.spawn);
    this.controller.setAim(map.spawnYaw, 0);
    this.viewmodel.setTeam(0);
    this.viewmodel.setWeapon(this.player.primary, save.data.attachments[this.player.primary] ?? defaultAttachments(this.player.primary));
    this.applySky();
  }

  addSoldier(team: TeamId, name: string, cls: Soldier['cls'], spec: Soldier['specialist'], primary: Soldier['primary'], throwable: Soldier['throwable']): Soldier {
    const s = new Soldier(this.nextId++, name, team, cls, spec, primary, throwable);
    this.soldiers.push(s);
    attachBody(s, this.physics);
    return s;
  }

  private onLand(s: Soldier, impact: number): void {
    if (impact > 6) dustKick(this.vfx, s.pos, Math.min(3, impact / 6));
    if (s.isPlayer) this.fp.addTrauma(Math.min(0.35, impact / 60));
  }

  private applySky(): void {
    sampleSky(this.dayT, this.storm, this.skyState);
    this.sky.apply(this.skyState, this.storm);
    this.lighting.applySky(this.skyState);
    (this.scene.fog as THREE.Fog).color.copy(this.skyState.fog);
    (this.scene.background as THREE.Color).copy(this.skyState.fog);
    this.viewmodel.copyLights(this.lighting);
  }

  // ------------------------------------------------------------------------------------------
  frame(_dt: number): void {
    this.stepInFrame = 0;
    const zoom = 1;
    this.controller.frame(this.player, this.adsK, zoom);
  }

  update(dt: number): void {
    this.time += dt;
    this.moveCtx.time = this.time;
    this.interactives.update(dt);
    for (const s of this.soldiers) stepMovement(s, dt, this.moveCtx);
    this.physics.step();
    // ADS blend (weapon systems refine this in M3).
    const p = this.player;
    const wantAds = p.input.aim && (p.state === 'ground' || p.state === 'air' || p.state === 'slide') && !p.sprinting;
    this.adsK += ((wantAds ? 1 : 0) - this.adsK) * Math.min(1, dt / 0.06);
    if (this.stepInFrame++ === 0) clearEdges(p.input);
  }

  render(alpha: number, frameDt: number): void {
    const p = this.player;
    // Camera at the interpolated eye.
    this.renderPos.copy(p.prevPos).lerp(p.pos, alpha);
    const eye = this.renderPos.clone();
    eye.y += p.eye;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const extraFov = p.tacSprint ? TUNING.camera.tacSprintFovAdd : p.sprinting ? TUNING.camera.sprintFovAdd : p.state === 'slide' ? TUNING.camera.slideFovAdd : 0;
    this.fp.shakeScale = save.settings.screenShake;
    this.fp.headBob = save.settings.headBob;
    this.fp.update(frameDt, eye, this.controller.yaw, this.controller.pitch, speed, p.grounded && p.state === 'ground', p.landKick, save.settings.fov, 1, extraFov, this.renderer.aspect);

    // Other soldiers (third person).
    for (const s of this.soldiers) {
      if (s.isPlayer) continue;
      this.drawSoldier(s, alpha, frameDt);
    }
    this.crowd.flush();
    this.weaponCrowd.flush();

    // Viewmodel.
    const vm = this.vm;
    vm.adsK = this.adsK;
    vm.sprintK += ((p.sprinting || p.tacSprint ? 1 : 0) - vm.sprintK) * damp(10, frameDt);
    vm.tacSprint = p.tacSprint;
    vm.speed = speed;
    vm.grounded = p.grounded;
    vm.mouseDX = this.controller.dx;
    vm.mouseDY = this.controller.dy;
    vm.lowered = p.state === 'ladder' || p.state === 'zipline' || p.state === 'parachute' || p.state === 'wingsuit' || p.state === 'mantle';
    this.viewmodel.visible = p.alive && !p.inVehicle;
    this.viewmodel.copyLights(this.lighting);
    this.viewmodel.update(frameDt, this.fp.camera, vm, this.renderer.aspect);

    this.vfx.update(frameDt);
    this.sky.update(frameDt, this.fp.camera.position, 4);
    this.lighting.follow(this.renderPos);
    this.vfx.flushTracers();
    this.renderer.render(this.scene, this.fp.camera, this.viewmodel.scene, this.viewmodel.camera);
    this.debug.state = `${p.state} / ${p.stance}${p.sprinting ? ' / sprint' : ''}${p.tacSprint ? ' / tac' : ''}`;
    this.debug.speed = `${speed.toFixed(1)} m/s  y ${p.pos.y.toFixed(1)}`;
    input.endFrame();
  }

  private drawSoldier(s: Soldier, alpha: number, dt: number): void {
    const pos = new THREE.Vector3().copy(s.prevPos).lerp(s.pos, alpha);
    const cat = categoryOf(s.primary);
    s.anim.update(dt, {
      pos,
      yaw: s.yaw,
      pitch: s.pitch,
      vel: s.vel,
      crouch: s.stance === 'crouch' || s.state === 'slide',
      prone: s.stance === 'prone',
      mode: s.state === 'ground' ? (s.sprinting || s.tacSprint ? 'sprint' : 'normal') : s.state === 'air' ? 'air' : s.state === 'slide' ? 'slide' : s.state === 'mantle' ? 'mantle' : s.state === 'ladder' ? 'ladder' : s.state === 'zipline' ? 'zipline' : s.state === 'parachute' ? 'parachute' : s.state === 'wingsuit' ? 'wingsuit' : s.state === 'downed' ? 'downed' : s.state === 'dead' ? 'dead' : 'normal',
      weapon: { cat, anchors: this.weaponCrowd.anchors(s.primary) },
      reload: -1,
      melee: -1,
      throwing: -1,
      kick: 0,
      deadT: s.deadT,
      seed: s.deathSeed,
      driving: false,
    });
    this.crowd.submit(s.team, s.cls, s.anim.out, Math.min(0.7, s.flashT * 6));
    if (s.anim.hasWeapon) this.weaponCrowd.submit(s.primary, s.anim.weaponMatrix);
  }

  resize(aspect: number): void {
    this.fp.camera.aspect = aspect;
    this.fp.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.vfx.dispose();
    this.crowd.dispose();
    this.weaponCrowd.dispose();
    this.physics.dispose();
  }
}
