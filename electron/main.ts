// Electron main process: one game window, fullscreen shortcuts, JSON save file in userData,
// and command-line flags (--autoplay, --smoke, --soak=<minutes>, --mode=skirmish) forwarded to the renderer.
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const isMac = process.platform === 'darwin';
const argv = process.argv.slice(1);
const flag = (name: string): string | null => {
  for (const a of argv) {
    if (a === `--${name}`) return '1';
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return null;
};

const forwarded: Record<string, string> = {};
for (const name of ['autoplay', 'smoke', 'soak', 'mode', 'seed', 'preset', 'size', 'bots', 'scene', 'cam', 'spectate', 'tickets', 'tp']) {
  const v = flag(name);
  if (v !== null) forwarded[name] = v;
}
const headlessTest = forwarded.smoke !== undefined || forwarded.soak !== undefined;

// Keep the simulation running when the window is hidden or unfocused (soak and smoke runs).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (headlessTest) app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const savePath = (): string => join(app.getPath('userData'), 'vector-front-save.json');

ipcMain.handle('save:read', () => {
  try {
    const p = savePath();
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
});

ipcMain.handle('save:write', (_e, json: string) => {
  try {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = savePath() + '.tmp';
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, savePath());
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('app:quit', () => app.quit());

let win: BrowserWindow | null = null;

ipcMain.on('app:fullscreen', (_e, on: boolean) => win?.setFullScreen(on));
ipcMain.handle('app:isFullscreen', () => win?.isFullScreen() ?? false);

function toggleFullscreen(): void {
  if (win) win.setFullScreen(!win.isFullScreen());
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: 'Vector Front',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }],
    });
  }
  template.push({
    label: 'View',
    submenu: [
      { label: 'Toggle Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: toggleFullscreen },
      { role: 'reload', visible: !app.isPackaged },
      { role: 'toggleDevTools', visible: !app.isPackaged },
    ],
  });
  template.push({ label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const size = (forwarded.size ?? '').split('x').map((n) => parseInt(n, 10));
  const [w, h] = size.length === 2 && size.every((n) => n > 0) ? size : [1600, 900];
  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 960,
    minHeight: 540,
    title: 'Vector Front',
    backgroundColor: '#0b0f16',
    show: false,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('enter-full-screen', () => win?.webContents.send('app:fullscreen-changed', true));
  win.on('leave-full-screen', () => win?.webContents.send('app:fullscreen-changed', false));
  // F11 secondary fullscreen shortcut (Cmd+Ctrl+F is the menu accelerator on macOS).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const cmdCtrlF = input.meta && input.control && input.key.toLowerCase() === 'f';
    if (input.key === 'F11' || (cmdCtrlF && !isMac)) {
      event.preventDefault();
      toggleFullscreen();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  const query = new URLSearchParams(forwarded).toString();
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl + (query ? `?${query}` : ''));
  else void win.loadFile(join(__dirname, '..', 'dist', 'index.html'), { search: query });
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
