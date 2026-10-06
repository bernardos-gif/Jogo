// Draws the app icon in code (no image assets) and writes build/icon.png (1024x1024 RGBA).
// The mark: a dark glass tile with a cyan-white forward chevron (the "vector") and an amber tick.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const px = new Float32Array(N * N * 4);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
function blend(i, r, g, b, a) {
  const o = i * 4;
  const ia = 1 - a;
  px[o] = px[o] * ia + r * a;
  px[o + 1] = px[o + 1] * ia + g * a;
  px[o + 2] = px[o + 2] * ia + b * a;
  px[o + 3] = px[o + 3] * ia + a;
}
// Signed distance to a rounded box centered at the origin.
function sdRoundBox(x, y, hx, hy, r) {
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const idx = j * N + i;
    const x = (i + 0.5) / N - 0.5;
    const y = (j + 0.5) / N - 0.5;
    // Tile body (macOS icon grid: 824/1024 content square).
    const d = sdRoundBox(x, y, 0.402, 0.402, 0.09);
    const inside = 1 - smooth(-0.002, 0.002, d);
    if (inside <= 0) continue;
    const t = clamp(0.5 - y, 0, 1);
    const r = 0.035 + 0.05 * t, g = 0.05 + 0.07 * t, b = 0.08 + 0.12 * t;
    blend(idx, r, g, b, inside);
    // Fine grid.
    const gx = Math.abs(((x + 0.5) * 24) % 1 - 0.5), gy = Math.abs(((y + 0.5) * 24) % 1 - 0.5);
    const grid = (1 - smooth(0.0, 0.04, Math.min(gx, gy))) * 0.06 * inside;
    blend(idx, 0.6, 0.9, 1.0, grid);
    // Hairline border.
    const border = (1 - smooth(0.0, 0.004, Math.abs(d + 0.012))) * inside;
    blend(idx, 0.55, 0.85, 1.0, border * 0.55);
    // Chevron (two thick strokes) with soft glow.
    const c = Math.min(sdSegment(x, y, -0.2, -0.2, 0.12, 0.0), sdSegment(x, y, 0.12, 0.0, -0.2, 0.2));
    const glow = Math.exp(-Math.max(c - 0.05, 0) * 28) * 0.45 * inside;
    blend(idx, 0.25, 0.85, 1.0, glow);
    const stroke = (1 - smooth(0.05, 0.054, c)) * inside;
    blend(idx, 0.86, 0.97, 1.0, stroke);
    // Amber tick to the right of the chevron.
    const tick = sdSegment(x, y, 0.2, -0.07, 0.2, 0.07);
    blend(idx, 1.0, 0.7, 0.2, (1 - smooth(0.022, 0.026, tick)) * inside);
  }
}

// PNG encoding.
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let j = 0; j < N; j++) {
  raw[j * (N * 4 + 1)] = 0;
  for (let i = 0; i < N; i++) {
    const o = (j * N + i) * 4;
    const a = px[o + 3];
    const p = j * (N * 4 + 1) + 1 + i * 4;
    raw[p] = Math.round(clamp(a > 0 ? px[o] / a : 0, 0, 1) * 255);
    raw[p + 1] = Math.round(clamp(a > 0 ? px[o + 1] / a : 0, 0, 1) * 255);
    raw[p + 2] = Math.round(clamp(a > 0 ? px[o + 2] / a : 0, 0, 1) * 255);
    raw[p + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log('build/icon.png written');
