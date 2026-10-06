// Rolling frame and simulation timing, used by the performance overlay, dynamic resolution
// and the smoke test hooks.

export class RollingStat {
  private buf: Float32Array;
  private n = 0;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  reset(): void {
    this.n = 0;
    this.i = 0;
  }
  get count(): number {
    return this.n;
  }
  percentile(p: number): number {
    if (!this.n) return 0;
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  }
  mean(): number {
    if (!this.n) return 0;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k];
    return s / this.n;
  }
}
