// Runs the Playwright smoke test against the built Electron app.
// On Linux without a display it wraps the run in xvfb-run. `--soak` runs the long soak variant
// (SOAK_MINUTES, default 10) instead of the 90-second smoke run.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('dist/index.html') || !existsSync('dist-electron/main.cjs')) {
  console.error('Build first: npm run build:app');
  process.exit(1);
}
const soak = process.argv.includes('--soak');
const env = { ...process.env, VF_SOAK: soak ? '1' : '' };
const args = ['playwright', 'test', '--config', 'playwright.config.ts'];
let cmd = 'npx';
let full = args;
if (process.platform === 'linux' && !process.env.DISPLAY) {
  cmd = 'xvfb-run';
  full = ['-a', '-s', '-screen 0 1920x1080x24', 'npx', ...args];
}
const r = spawnSync(cmd, full, { stdio: 'inherit', env });
process.exit(r.status ?? 1);
