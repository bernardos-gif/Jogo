// Bundles the Electron main and preload scripts to CommonJS in dist-electron/.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'warning' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' });
console.log('electron bundles written to dist-electron/');
