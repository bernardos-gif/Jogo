// Human-like bot aim: a reaction delay after acquiring a target, an initial error (meters at the
// target, converted to an angle) that decays toward a tracking floor (an Ornstein-Uhlenbeck wander,
// so the crosshair keeps drifting around the target), a floor that grows with range, target speed
// and suppression, and a capped turn speed.
import { TUNING } from '../config/tuning';
import { wrapAngle } from '../core/math';

const DEG = Math.PI / 180;

export type AimProfile = (typeof TUNING.ai.difficulty)['veteran'];

/** Approximate unit normal sample from three uniforms. */
function gauss(rnd: () => number): number {
  return (rnd() + rnd() + rnd() - 1.5) * 2;
}

export class AimState {
  /** Current aim error (radians) relative to the true aim point. */
  errYaw = 0;
  errPitch = 0;
  /** Seconds before the bot may fire at a newly acquired target. */
  reactLeft = 0;
  targetId = -1;
  /** Aim at the head for this engagement. */
  head = false;

  /** Starts a new engagement: reaction delay and a large initial error. */
  acquire(targetId: number, dist: number, p: AimProfile, rnd: () => number): void {
    this.targetId = targetId;
    this.reactLeft = Math.max(0.05, p.reaction * (1 + (rnd() * 2 - 1) * p.reactionJitter) + dist * 0.0012);
    const mag = Math.min(TUNING.ai.combat.maxInitialError * DEG, Math.atan((p.initialError * (1 + dist / 120)) / Math.max(2, dist)));
    const a = rnd() * Math.PI * 2;
    this.errYaw = Math.cos(a) * mag;
    this.errPitch = Math.sin(a) * mag * 0.6;
    this.head = rnd() < p.headBias;
  }

  /** Stationary error magnitude (radians) for the current conditions. */
  floor(dist: number, targetSpeed: number, suppression: number, p: AimProfile): number {
    const S = TUNING.ai.suppression;
    const meters = p.trackingFloor + p.rangeError * (dist / 100) + p.moveError * (targetSpeed / 5);
    return Math.atan(meters / Math.max(2, dist)) * (1 + suppression * (S.maxErrorMul - 1));
  }

  /** Advances the error process by dt. */
  update(dt: number, dist: number, targetSpeed: number, suppression: number, p: AimProfile, rnd: () => number): void {
    this.reactLeft = Math.max(0, this.reactLeft - dt);
    const theta = p.errorDecay;
    const sigma = this.floor(dist, targetSpeed, suppression, p) * Math.sqrt(2 * theta);
    const sq = Math.sqrt(dt);
    this.errYaw += -theta * this.errYaw * dt + sigma * sq * gauss(rnd);
    this.errPitch += -theta * this.errPitch * dt + sigma * 0.6 * sq * gauss(rnd);
  }

  get magnitude(): number {
    return Math.hypot(this.errYaw, this.errPitch);
  }
}

/** Rotates (yaw, pitch) toward a goal by at most `maxStep` radians of combined arc. */
export function turnToward(yaw: number, pitch: number, goalYaw: number, goalPitch: number, maxStep: number): [number, number] {
  const dy = wrapAngle(goalYaw - yaw);
  const dp = goalPitch - pitch;
  const d = Math.hypot(dy, dp);
  if (d <= maxStep || d < 1e-6) return [yaw + dy, goalPitch];
  const k = maxStep / d;
  return [yaw + dy * k, pitch + dp * k];
}

/** Launch pitch (radians, before the throw's built-in upward bias) that lands a throwable at range. */
export function throwPitch(dist: number, dh: number, speed: number, up: number, bias: number, gravity: number): number {
  let best = 0.3;
  let bestErr = Infinity;
  for (let p = -0.4; p <= 1.2; p += 0.02) {
    const a = p + bias;
    const vx = Math.cos(a) * speed;
    const vy = Math.sin(a) * speed + up;
    // Time when the arc comes back down to dh: dh = vy t - g t^2 / 2.
    const disc = vy * vy - 2 * gravity * dh;
    if (disc < 0) continue;
    const t = (vy + Math.sqrt(disc)) / gravity;
    const err = Math.abs(vx * t - dist);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  return best;
}
