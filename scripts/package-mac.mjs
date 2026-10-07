// Packages the universal (Apple Silicon + Intel) macOS .dmg into ./release.
//
// macOS: electron-builder builds and merges the universal .app without signing; then every extended
// attribute is cleared, one ad-hoc signature covers the whole bundle (codesign --deep), hdiutil makes
// the DMG, and the DMG is mounted and the app copied out the way Finder does to prove it installs.
// (electron-builder's own signing also signs data files such as app.asar one by one, which stores
// com.apple.cs.* extended attributes on them; Finder cannot write those on the copy and the drag to
// Applications fails with error -36.)
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

/** The short note that ships next to the app in the DMG. */
function writeNote(dir) {
  writeFileSync(
    join(dir, 'How to open.txt'),
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
}

/** Lines of `xattr -lr` output that carry code-signature attributes (they break Finder copies). */
function signatureXattrs(path) {
  const r = spawnSync('xattr', ['-lr', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? '').split('\n').filter((l) => l.includes('com.apple.cs.'));
}

if (process.platform === 'darwin') {
  const app = join(RELEASE, 'mac-universal', `${PRODUCT}.app`);
  rmSync(join(RELEASE, 'mac-universal'), { recursive: true, force: true });
  // 1) Universal .app, unsigned.
  run(BUILDER, ['--mac', 'dir', '--universal', '--publish', 'never', '-c.mac.identity=null']);
  if (!existsSync(app)) throw new Error(`electron-builder did not produce ${app}`);
  // 2) No extended attributes anywhere, then one ad-hoc signature sealing the whole bundle.
  run('xattr', ['-cr', app]);
  run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const left = signatureXattrs(app);
  if (left.length) throw new Error(`Code-signature attributes left on files:\n${left.join('\n')}`);
  // 3) DMG: the app, an Applications shortcut and a short note, HFS+ compressed with zlib.
  const stage = join(RELEASE, '.dmg-stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  run('ditto', ['--noextattr', '--noqtn', app, join(stage, `${PRODUCT}.app`)]);
  symlinkSync('/Applications', join(stage, 'Applications'));
  writeNote(stage);
  const out = join(RELEASE, DMG_NAME);
  rmSync(out, { force: true });
  run('hdiutil', ['create', '-volname', PRODUCT, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', out]);
  rmSync(stage, { recursive: true, force: true });
  // 4) Install check: mount the DMG, copy the app out like Finder, verify the copy.
  const mnt = join(tmpdir(), `vf-dmg-${process.pid}`);
  const dest = join(tmpdir(), `vf-install-${process.pid}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run('hdiutil', ['attach', out, '-nobrowse', '-readonly', '-mountpoint', mnt]);
  try {
    run('ditto', [join(mnt, `${PRODUCT}.app`), join(dest, `${PRODUCT}.app`)]);
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', join(dest, `${PRODUCT}.app`)]);
    const bad = signatureXattrs(join(mnt, `${PRODUCT}.app`));
    if (bad.length) throw new Error(`The DMG's app still carries code-signature attributes:\n${bad.join('\n')}`);
  } finally {
    run('hdiutil', ['detach', mnt, '-force']);
    rmSync(dest, { recursive: true, force: true });
  }
  console.log(`\nDone: ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
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
writeNote(stage);

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
