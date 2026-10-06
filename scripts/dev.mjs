// npm run dev: starts the Vite dev server (open the printed URL in any browser tab)
// and launches the Electron shell against it. If Electron cannot start (no display),
// the browser tab keeps working.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const server = await createServer({ server: { host: true } });
await server.listen();
server.printUrls();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`\nBrowser: open ${url} in a tab.`);

if (!process.argv.includes('--web')) {
  await import('./build-electron.mjs');
  const electronBin = require('electron');
  const args = ['.'];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const child = spawn(electronBin, [...args, ...process.argv.slice(2).filter((a) => a !== '--web')], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url.replace(/\/$/, '/') },
  });
  child.on('exit', (code) => console.log(`Electron exited (${code}). The dev server keeps running for the browser tab; Ctrl+C to stop.`));
  child.on('error', (e) => console.log(`Electron could not start (${e.message}). Use the browser tab.`));
}
