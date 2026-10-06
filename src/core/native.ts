// Bridge to the Electron shell, with browser fallbacks so `npm run dev:web` works in a tab.

interface VfNativeApi {
  isElectron: boolean;
  platform: string;
  readSave(): Promise<string | null>;
  writeSave(json: string): Promise<boolean>;
  quit(): void;
  setFullscreen(on: boolean): void;
  isFullscreen(): Promise<boolean>;
  onFullscreen(cb: (on: boolean) => void): void;
}

declare global {
  interface Window {
    vfNative?: VfNativeApi;
  }
}

const LS_KEY = 'vector-front-save';
const api: VfNativeApi | undefined = typeof window !== 'undefined' ? window.vfNative : undefined;

export const native = {
  isElectron: !!api?.isElectron,
  isMac: api ? api.platform === 'darwin' : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform),

  async readSave(): Promise<string | null> {
    if (api) return api.readSave();
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  },

  async writeSave(json: string): Promise<boolean> {
    if (api) return api.writeSave(json);
    try {
      localStorage.setItem(LS_KEY, json);
      return true;
    } catch {
      return false;
    }
  },

  quit(): void {
    if (api) api.quit();
    else window.close();
  },

  setFullscreen(on: boolean): void {
    if (api) {
      api.setFullscreen(on);
      return;
    }
    if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
    if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  },

  toggleFullscreen(): void {
    if (api) void api.isFullscreen().then((v) => api.setFullscreen(!v));
    else this.setFullscreen(!document.fullscreenElement);
  },

  onFullscreen(cb: (on: boolean) => void): void {
    if (api) api.onFullscreen(cb);
    else document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement));
  },
};
