// Human controller: mouse look (hip / ADS / vehicle sensitivity, invert Y) and key actions
// written into the soldier's command each rendered frame.
import { TUNING } from '../config/tuning';
import { clamp } from '../core/math';
import { input } from '../core/input';
import { save } from '../core/save';
import type { Soldier } from './soldier';

export class PlayerController {
  yaw = 0;
  pitch = 0;
  /** Mouse delta this frame (for viewmodel sway). */
  dx = 0;
  dy = 0;

  /** Reads input for this frame. `zoom` is the current optic magnification blended by ADS. */
  frame(s: Soldier, adsK: number, zoom: number, vehicleLook = false): void {
    const st = save.settings;
    const [mx, my] = input.takeMouse();
    this.dx = mx;
    this.dy = my;
    const base = TUNING.camera.mouseRadiansPerPixel;
    let sens = vehicleLook ? st.sensVehicle : st.sensHip;
    if (adsK > 0.5 && !vehicleLook) sens = (st.sensAds * st.sensHip) / Math.pow(Math.max(1, zoom), 0.85);
    this.yaw -= mx * base * sens;
    this.pitch -= my * base * sens * (st.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -TUNING.camera.pitchLimit, TUNING.camera.pitchLimit);

    const i = s.input;
    i.yaw = this.yaw;
    i.pitch = this.pitch;
    i.moveZ = (input.isDown('moveForward') ? 1 : 0) - (input.isDown('moveBack') ? 1 : 0);
    i.moveX = (input.isDown('moveRight') ? 1 : 0) - (input.isDown('moveLeft') ? 1 : 0);
    i.sprint = input.isDown('sprint');
    i.jumpHeld = input.isDown('jump');
    i.fire = input.isDown('fire');
    i.aim = input.isDown('aim');
    i.interactHeld = input.isDown('interact');
    i.gadgetHeld = input.isDown('gadget');
    // Edges accumulate until the sim consumes them.
    i.jump ||= input.pressed('jump');
    i.tacSprint ||= input.doubleTap('sprint');
    i.crouch ||= input.pressed('crouch');
    i.prone ||= input.pressed('prone');
    i.firePressed ||= input.pressed('fire');
    i.reload ||= input.pressed('reload');
    i.gadget ||= input.pressed('gadget');
    i.grenade ||= input.pressed('grenade');
    i.melee ||= input.pressed('melee');
    i.fireMode ||= input.pressed('fireMode');
    i.interact ||= input.pressed('interact');
    i.inspect ||= input.pressed('inspect');
    if (input.pressed('weapon1')) i.slot = 0;
    if (input.pressed('weapon2')) i.slot = 1;
    if (input.pressed('weapon3')) i.slot = 2;
    if (input.wheel !== 0 && i.slot < 0) i.slot = 100 + Math.sign(input.wheel);
    for (let k = 0; k < 4; k++) if (input.pressed(`seat${k + 1}` as 'seat1')) i.seat = k;
  }

  /** Re-aims the controller (spawn, vehicle exit). */
  setAim(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
