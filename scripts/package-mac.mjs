// Packages the universal (Apple Silicon + Intel) macOS .dmg into ./release.
//
// macOS: electron-builder does everything natively (universal merge, ad-hoc signing, hdiutil DMG).
// Linux: electron-builder builds the x64 and arm64 .app bundles, @electron/universal merges them
// (needs `lipo` or `llvm-lipo`), rcodesign applies an ad-hoc signature, and xorrisofs plus the
// libdmg-hfsplus `dmg` tool produce a compressed UDIF image.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PRODUCT = pkg.productName;
const RELEASE = join(ROOT, 'release');
const DMG_NAME = `Vector-Front-${pkg.version}-universal.dmg`;
const BUILDER = join(ROOT, 'node_modules', '.bin', 'electron-builder');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed with exit code ${r.status}`);
}
function which(bin) {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
function need(bin, hint) {
  const p = which(bin);
  if (!p) throw new Error(`Required tool "${bin}" not found. ${hint}`);
  return p;
}

if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'dist-electron', 'main.cjs'))) {
  throw new Error('Run `npm run build:app` first (dist/ and dist-electron/ are missing).');
}
if (!existsSync(join(ROOT, 'build', 'icon.png'))) run('node', ['scripts/make-icon.mjs']);

if (process.platform === 'darwin') {
  run(BUILDER, ['--mac', 'dmg', '--universal', '--publish', 'never']);
  console.log(`\nDone. The DMG is in ${RELEASE}`);
  process.exit(0);
}

const WORK = join(RELEASE, '.build');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// 1) One .app per architecture (code signing is skipped off-macOS).
run(BUILDER, ['--mac', 'dir', '--x64', '--arm64', '--publish', 'never', `-c.directories.output=${WORK}`, '-c.mac.identity=null']);
const x64App = join(WORK, 'mac', `${PRODUCT}.app`);
const armApp = join(WORK, 'mac-arm64', `${PRODUCT}.app`);
if (!existsSync(x64App) || !existsSync(armApp)) throw new Error('electron-builder did not produce both architectures');

// 2) Merge into one universal .app.
if (!which('lipo')) {
  const llvm = ['llvm-lipo', 'llvm-lipo-19', 'llvm-lipo-18', 'llvm-lipo-17', 'llvm-lipo-16'].map(which).find(Boolean);
  if (!llvm) throw new Error('Need `lipo` or `llvm-lipo` to merge architectures (Ubuntu: apt-get install llvm).');
  const shim = join(tmpdir(), 'vf-lipo-shim');
  mkdirSync(shim, { recursive: true });
  rmSync(join(shim, 'lipo'), { force: true });
  symlinkSync(llvm, join(shim, 'lipo'));
  process.env.PATH = `${shim}:${process.env.PATH}`;
}
const uniApp = join(WORK, 'mac-universal', `${PRODUCT}.app`);
{
  const { makeUniversalApp } = require('@electron/universal');
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    console.log('\nMerging x64 + arm64 into a universal app...');
    await makeUniversalApp({ x64AppPath: x64App, arm64AppPath: armApp, outAppPath: uniApp, force: true });
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
}

// 3) Ad-hoc signature, required for Apple Silicon to launch the app.
const rcodesign = which('rcodesign');
if (rcodesign) run(rcodesign, ['sign', uniApp]);
else console.warn('\nWARNING: rcodesign not found; the universal app keeps the per-arch linker signatures only.');

// 4) DMG contents: the app, an Applications shortcut and a short note.
const stage = join(WORK, 'dmg');
mkdirSync(stage, { recursive: true });
run('cp', ['-a', uniApp, stage]);
symlinkSync('/Applications', join(stage, 'Applications'));
writeFileSync(
  join(stage, 'How to open.txt'),
  [
    'VECTOR FRONT',
    '',
    '1. Drag "Vector Front" onto the Applications folder.',
    '2. The app is ad-hoc signed and not notarized. The first time you open it:',
    '   double-click it once, then open System Settings > Privacy & Security,',
    '   scroll down and click "Open Anyway" next to Vector Front, and confirm.',
    '',
    'Fullscreen: Cmd+Ctrl+F (or F11). Full controls are on the Controls screen.',
    '',
  ].join('\n'),
);

// 5) ISO9660 + Rock Ridge (keeps the symlink and permissions), then compress to UDIF.
need('xorrisofs', 'Ubuntu: apt-get install xorriso');
const dmgTool = need('dmg', 'Build libdmg-hfsplus (https://github.com/fanquake/libdmg-hfsplus) and put its `dmg` binary on PATH.');
const iso = join(WORK, 'uncompressed.iso');
run('xorrisofs', ['-quiet', '-D', '-l', '-V', PRODUCT, '-no-pad', '-r', '-dir-mode', '0755', '-o', iso, stage]);
const out = join(RELEASE, DMG_NAME);
rmSync(out, { force: true });
run(dmgTool, [iso, out]);

rmSync(iso, { force: true });
rmSync(stage, { recursive: true, force: true });
rmSync(join(WORK, 'mac'), { recursive: true, force: true });
rmSync(join(WORK, 'mac-arm64'), { recursive: true, force: true });
console.log(`\nDone: ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
console.log('release/:', readdirSync(RELEASE).join(', '));
