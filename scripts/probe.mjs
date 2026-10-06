// Developer probe: runs the built app in autoplay and prints match stats at an interval.
// Usage: xvfb-run -a node scripts/probe.mjs <minutes> <intervalSeconds> [--flag=value ...]
import { _electron as electron } from '@playwright/test';

const [minutes = '3', every = '30', ...rest] = process.argv.slice(2);
const args = ['dist-electron/main.cjs', '--size=1280x720', '--autoplay', ...rest];
if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
const app = await electron.launch({ args });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.waitForFunction(() => window.__vf?.state === 'playing', null, { timeout: 240000 });
const end = Date.now() + Number(minutes) * 60000;
while (Date.now() < end) {
  await page.waitForTimeout(Number(every) * 1000);
  const s = await page.evaluate(() => window.__vf.stats());
  console.log(`t=${s.matchTime.toFixed(0)}s fps-med=${s.frameMsMedian.toFixed(0)}ms step=${s.simStepMsMedian.toFixed(1)}ms calls=${s.drawCalls} alive=${s.aliveSoldiers}/${s.soldiers} kills=${s.kills} tickets=${s.tickets.join("/")} gadgets=${s.gadgetsUsed} vehicles=${s.vehiclesUsed}`);
  for (const n of s.notes) console.log('   ', n);
}
console.log('errors:', errors.slice(0, 10));
await app.close();
