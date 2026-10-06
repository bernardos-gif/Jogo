// Headless smoke test: launches the packaged-layout Electron app with --autoplay, starts a
// Sector Control match driven by bot AI, runs it, and asserts zero console errors and a healthy
// frame time. VF_SOAK=1 turns it into a long soak run (SOAK_MINUTES, default 10).
import { test, expect, _electron as electron, type ConsoleMessage } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TUNING } from '../../src/config/tuning';

interface SmokeStats {
  state: string;
  matchTime: number;
  frames: number;
  frameMsMedian: number;
  frameMsP95: number;
  simStepMsMedian: number;
  drawCalls: number;
  soldiers: number;
  aliveSoldiers: number;
  kills: number;
  tickets: [number, number];
  vehiclesUsed: number;
  gadgetsUsed: number;
  stormEvents: number;
  notes: string[];
}

const soak = process.env.VF_SOAK === '1';
const runSeconds = soak ? Number(process.env.SOAK_MINUTES ?? TUNING.test.soakMinutes) * 60 : TUNING.test.smokeSeconds;

test(soak ? 'soak run' : 'smoke: autoplay Sector Control', async () => {
  test.setTimeout((runSeconds + TUNING.test.bootTimeoutSeconds + 120) * 1000);
  const args = ['dist-electron/main.cjs', '--autoplay', '--smoke', `--size=${TUNING.test.windowSize}`];
  if (soak) args.push('--soak=1');
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  const app = await electron.launch({ args, env: { ...process.env } as Record<string, string> });
  const errors: string[] = [];
  const page = await app.firstWindow();
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // Boot, world generation and navmesh, then autoplay deploys into a match.
  await page.waitForFunction(() => (window as unknown as { __vf?: { state: string } }).__vf?.state === 'playing', null, {
    timeout: TUNING.test.bootTimeoutSeconds * 1000,
    polling: 500,
  });
  await page.evaluate(() => (window as unknown as { __vf: { resetStats(): void } }).__vf.resetStats());

  const outDir = 'smoke-artifacts';
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < runSeconds * 1000) {
    await page.waitForTimeout(Math.min(15000, runSeconds * 1000 - (Date.now() - t0) + 10));
    if (shot < 6) await page.screenshot({ path: join(outDir, `${soak ? 'soak' : 'smoke'}-${shot++}.png`) }).catch(() => undefined);
    const st = await page.evaluate(() => (window as unknown as { __vf: { state: string } }).__vf.state);
    if (soak && st !== 'playing' && st !== 'deploy' && st !== 'dead') {
      // A soak run keeps going across rounds: the autoplay flow starts a new match by itself.
    }
  }
  const stats = (await page.evaluate(() => (window as unknown as { __vf: { stats(): unknown } }).__vf.stats())) as SmokeStats;
  writeFileSync(join(outDir, `${soak ? 'soak' : 'smoke'}-stats.json`), JSON.stringify({ stats, errors }, null, 2));
  console.log('STATS', JSON.stringify(stats));
  await app.close();

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  expect(stats.frames).toBeGreaterThan(TUNING.test.minFrames);
  expect(stats.frameMsMedian).toBeLessThan(TUNING.test.maxMedianFrameMs);
  expect(stats.matchTime).toBeGreaterThan(runSeconds * TUNING.test.minSimRealtimeRatio);
});
