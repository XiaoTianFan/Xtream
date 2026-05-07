import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getAppIconPath } from './appIcon';
import { cancelAllPendingShellModals } from './shellModalBridge';

type AppWindowPaths = {
  preloadPath: string;
  rendererRoot: string;
  devServerUrl: string | undefined;
};

type ControlWindowOptions = AppWindowPaths & {
  beginAppShutdown: () => void;
  getCurrentShowConfigPath: () => string | undefined;
  isShuttingDown: () => boolean;
  onClosed: () => void;
  persistControlUiSnapshot: (showFilePath: string | undefined) => Promise<void>;
  runCloseOrQuitConfirmation: () => Promise<'abort' | 'quit'>;
  sendSoloOutputIds: (window: BrowserWindow | undefined) => void;
};

type AudioWindowOptions = AppWindowPaths & {
  onClosed: () => void;
  sendSoloOutputIds: (window: BrowserWindow | undefined) => void;
};

export function createControlWindow(options: ControlWindowOptions): BrowserWindow {
  let suppressCloseGuard = false;
  const iconPath = getAppIconPath();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'Xtream Control',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });
  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(path.join(options.rendererRoot, 'index.html'));
  }
  window.webContents.on('did-finish-load', () => {
    options.sendSoloOutputIds(window);
  });
  window.webContents.once('destroyed', () => {
    cancelAllPendingShellModals('Control WebContents destroyed');
  });
  window.on('close', (e) => {
    if (suppressCloseGuard || options.isShuttingDown()) {
      return;
    }
    e.preventDefault();
    void (async () => {
      const outcome = await options.runCloseOrQuitConfirmation();
      if (outcome === 'abort') {
        return;
      }
      await options.persistControlUiSnapshot(options.getCurrentShowConfigPath());
      suppressCloseGuard = true;
      window.close();
    })();
  });
  window.on('closed', () => {
    options.onClosed();
    if (!options.isShuttingDown()) {
      options.beginAppShutdown();
    }
  });
  return window;
}

export function createAudioWindow(options: AudioWindowOptions): BrowserWindow {
  const iconPath = getAppIconPath();
  const window = new BrowserWindow({
    width: 320,
    height: 120,
    show: false,
    title: 'Xtream Audio Engine',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (options.devServerUrl) {
    void window.loadURL(`${options.devServerUrl}/audio.html`);
  } else {
    void window.loadFile(path.join(options.rendererRoot, 'audio.html'));
  }
  window.on('closed', options.onClosed);
  window.webContents.on('did-finish-load', () => {
    options.sendSoloOutputIds(window);
  });
  return window;
}
