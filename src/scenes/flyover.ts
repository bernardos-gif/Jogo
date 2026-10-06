// Main menu flyover: a slow closed spline over the battlefield, looking ahead at a second spline
// that threads the districts, so the live battle drifts past behind the menu.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';

export class Flyover {
  private path: THREE.CatmullRomCurve3;
  private look: THREE.CatmullRomCurve3;
  private t = 0;
  private readonly p = new THREE.Vector3();
  private readonly l = new THREE.Vector3();

  constructor(points: THREE.Vector3[], height: (x: number, z: number) => number) {
    const F = TUNING.ui.flyover;
    // Camera ring: offset outward from each point and lifted above the ground.
    const cam = points.map((q, i) => {
      const n = points[(i + 1) % points.length];
      const dx = n.x - q.x, dz = n.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      const x = q.x - (dz / len) * F.offset, z = q.z + (dx / len) * F.offset;
      return new THREE.Vector3(x, Math.max(height(x, z), height(q.x, q.z)) + F.height, z);
    });
    this.path = new THREE.CatmullRomCurve3(cam, true, 'centripetal');
    this.look = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q.x, height(q.x, q.z) + F.lookHeight, q.z)), true, 'centripetal');
  }

  update(cam: THREE.PerspectiveCamera, dt: number): void {
    const F = TUNING.ui.flyover;
    this.t = (this.t + dt / F.loopSeconds) % 1;
    this.path.getPointAt(this.t, this.p);
    this.look.getPointAt((this.t + F.lookAhead) % 1, this.l);
    cam.position.copy(this.p);
    cam.lookAt(this.l);
  }
}
