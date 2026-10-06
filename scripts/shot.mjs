// Developer screenshot tool: launches the built Electron app with flags and saves PNGs.
// Usage: xvfb-run -a node scripts/shot.mjs <out.png> <waitSeconds> [--flag=value ...]
import { _electron as electron } from '@playwright/test';

const [out = 'shot.png', wait = '6', ...rest] = process.argv.slice(2);
const args = ['dist-electron/main.cjs', '--size=1280x720', ...rest];
if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
const app = await electron.launch({ args });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shots = out.split(',');
for (let i = 0; i < shots.length; i++) {
  await page.waitForTimeout(Number(wait) * 1000);
  await page.screenshot({ path: shots[i] });
}
const stats = await page.evaluate(() => window.__vf?.stats?.()).catch(() => null);
console.log(JSON.stringify({ stats, errors: errors.slice(0, 20) }, null, 1));
await app.close();
