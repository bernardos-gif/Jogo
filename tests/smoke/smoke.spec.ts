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
  flowVisited: string[];
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
  // The smoke run also walks the player through death, the deploy screen and the end of round.
  const acts = soak ? [] : [
    { at: 0.04, name: 'storm' },
    { at: 0.08, name: 'showcase' },
    { at: 0.1, name: 'callin' },
    { at: 0.12, name: 'scoreboard' },
    { at: 0.16, name: 'scoreboard' },
    { at: 0.18, name: 'fullmap' },
    { at: 0.2, name: 'board:condor' },
    { at: 0.22, name: 'fullmap' },
    { at: 0.24, name: 'board:basalt' },
    { at: 0.27, name: 'exitVehicle' },
    { at: 0.3, name: 'killPlayer' },
    { at: 0.5, name: 'pause' },
    { at: 0.51, name: 'settings' },
    { at: 0.52, name: 'settings' },
    { at: 0.53, name: 'controls' },
    { at: 0.54, name: 'controls' },
    { at: 0.55, name: 'pause' },
    { at: 0.66, name: 'endRound' },
    { at: 0.86, name: 'menu' },
    { at: 0.87, name: 'loadout' },
    { at: 0.88, name: 'loadout' },
    { at: 0.89, name: 'menu' },
  ];
  const act = (name: string) => page.evaluate((n) => (window as unknown as { __vf: { act(n: string): boolean } }).__vf.act(n), name);
  while (Date.now() - t0 < runSeconds * 1000) {
    const elapsed = (Date.now() - t0) / 1000;
    const next = acts.find((a) => a.at * runSeconds > elapsed);
    const until = next ? next.at * runSeconds - elapsed : Infinity;
    await page.waitForTimeout(Math.max(10, Math.min(15000, until * 1000, runSeconds * 1000 - (Date.now() - t0) + 10)));
    for (const a of acts) if (a.at * runSeconds <= (Date.now() - t0) / 1000 && !(a as { done?: boolean }).done) {
      (a as { done?: boolean }).done = true;
      // The player may be between lives; retry once a few seconds later.
      if (!(await act(a.name))) {
        await page.waitForTimeout(4000);
        await act(a.name);
      }
    }
    if (shot < 6) await page.screenshot({ path: join(outDir, `${soak ? 'soak' : 'smoke'}-${shot++}.png`) }).catch(() => undefined);
  }
  const stats = (await page.evaluate(() => (window as unknown as { __vf: { stats(): unknown } }).__vf.stats())) as SmokeStats;
  writeFileSync(join(outDir, `${soak ? 'soak' : 'smoke'}-stats.json`), JSON.stringify({ stats, errors }, null, 2));
  console.log('STATS', JSON.stringify(stats));
  await app.close();

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  expect(stats.frames).toBeGreaterThan(TUNING.test.minFrames);
  expect(stats.frameMsMedian).toBeLessThan(TUNING.test.maxMedianFrameMs);
  expect(stats.matchTime).toBeGreaterThan(runSeconds * TUNING.test.minSimRealtimeRatio);
  expect(stats.soldiers).toBeGreaterThanOrEqual(TUNING.sector.teamSizeMin * 2);
  if (!soak) for (const f of ['playing', 'killcam', 'deploy', 'end']) expect(stats.flowVisited, `flow state ${f}`).toContain(f);
  if (!soak) expect(stats.vehiclesUsed).toBeGreaterThan(0);
  if (!soak) expect(stats.stormEvents).toBeGreaterThan(0);
});
