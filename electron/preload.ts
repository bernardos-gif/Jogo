// Narrow bridge between the game and the Electron main process.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vfNative', {
  isElectron: true,
  platform: process.platform,
  readSave: (): Promise<string | null> => ipcRenderer.invoke('save:read'),
  writeSave: (json: string): Promise<boolean> => ipcRenderer.invoke('save:write', json),
  quit: (): void => ipcRenderer.send('app:quit'),
  setFullscreen: (on: boolean): void => ipcRenderer.send('app:fullscreen', on),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('app:isFullscreen'),
  onFullscreen: (cb: (on: boolean) => void): void => {
    ipcRenderer.on('app:fullscreen-changed', (_e, on: boolean) => cb(on));
  },
});
