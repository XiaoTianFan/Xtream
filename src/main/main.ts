import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Director } from './director';
import { DisplayRegistry } from './displayRegistry';
import {
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  readShowConfig,
  validateRuntimeState,
  validateShowConfigMedia,
  writeJsonFile,
  writeShowConfig,
} from './showConfig';
import { getActiveDisplays } from '../shared/layouts';
import type {
  AudioMetadataReport,
  AudioSourceUpdate,
  DirectorState,
  DisplayCreateOptions,
  DisplayUpdate,
  DriftReport,
  PresetId,
  PresetResult,
  RendererReadyReport,
  ShowConfigOperationResult,
  TransportCommand,
  VisualImportItem,
  VisualMediaType,
  VisualMetadataReport,
  VirtualOutputUpdate,
} from '../shared/types';

const director = new Director();

let controlWindow: BrowserWindow | undefined;
let displayRegistry: DisplayRegistry | undefined;
let currentShowConfigPath: string | undefined;
let autoSaveTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const preloadPath = path.join(__dirname, '../preload/preload.js');
const rendererRoot = path.join(__dirname, '../../renderer');

function createControlWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Xtream Control',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(rendererRoot, 'index.html'));
  }
  window.on('closed', () => {
    controlWindow = undefined;
    if (!isShuttingDown) {
      beginAppShutdown();
    }
  });
  return window;
}

function broadcastDirectorState(state: DirectorState): void {
  sendDirectorState(controlWindow, state);
  for (const displayWindow of displayRegistry?.getAllWindows() ?? []) {
    sendDirectorState(displayWindow, state);
  }
}

function sendDirectorState(window: BrowserWindow | undefined, state: DirectorState): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send('director:state', state);
}

function beginAppShutdown(): void {
  isShuttingDown = true;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
  }
  displayRegistry?.closeAll();
  app.quit();
}

function scheduleShowConfigAutoSave(): void {
  if (isShuttingDown || !currentShowConfigPath) {
    return;
  }
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = undefined;
    if (currentShowConfigPath) {
      void writeShowConfig(currentShowConfigPath, director.createShowConfig()).catch((error: unknown) => {
        console.error('Failed to auto-save show config.', error);
      });
    }
  }, 250);
}

function shouldAutoSaveTransport(command: TransportCommand): boolean {
  return command.type === 'set-rate' || command.type === 'set-loop';
}

function getVisualMediaType(filePath: string): VisualMediaType {
  const extension = path.extname(filePath).toLowerCase().replace('.', '');
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? 'image' : 'video';
}

function createVisualImportItem(filePath: string): VisualImportItem {
  return {
    label: path.basename(filePath),
    type: getVisualMediaType(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
  };
}

async function pickVisualFiles(properties: Electron.OpenDialogOptions['properties']): Promise<VisualImportItem[] | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose visual media',
    properties,
    filters: [
      { name: 'Visual Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'ogv', 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'ogv'] },
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
  const result = controlWindow ? await dialog.showOpenDialog(controlWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths.map(createVisualImportItem);
}

async function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return controlWindow ? dialog.showSaveDialog(controlWindow, options) : dialog.showSaveDialog(options);
}

async function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return controlWindow ? dialog.showOpenDialog(controlWindow, options) : dialog.showOpenDialog(options);
}

function restoreShowConfigFromDiskConfig(configPath: string, config: Awaited<ReturnType<typeof readShowConfig>>): ShowConfigOperationResult {
  if (!displayRegistry) {
    throw new Error('Display registry is not initialized.');
  }
  const issues = validateShowConfigMedia(config);
  const mediaUrls = buildMediaUrls(config);
  displayRegistry.closeAll();
  director.restoreShowConfig(config, mediaUrls);
  for (const display of config.displays) {
    const state = displayRegistry.create({
      layout: display.layout,
      fullscreen: display.fullscreen,
      displayId: display.displayId,
    });
    director.registerDisplay(state);
  }
  currentShowConfigPath = configPath;
  return { state: director.getState(), filePath: currentShowConfigPath, issues };
}

function registerIpcHandlers(): void {
  ipcMain.handle('director:get-state', () => director.getState());

  ipcMain.handle('director:apply-preset', (_event, preset: PresetId): PresetResult => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }
    const result = director.applyPreset(preset, (layout, index) => {
      const activeDisplays = getActiveDisplays(director.getState().displays);
      const existing = activeDisplays[index];
      if (!existing) {
        return displayRegistry!.create({ layout, fullscreen: false });
      }
      return displayRegistry!.update(existing.id, { layout });
    });
    scheduleShowConfigAutoSave();
    return result;
  });

  ipcMain.handle('director:transport', (_event, command: TransportCommand) => {
    const state = director.applyTransport(command);
    if (shouldAutoSaveTransport(command)) {
      scheduleShowConfigAutoSave();
    }
    return state;
  });

  ipcMain.handle('visual:add', async () => {
    const items = await pickVisualFiles(['openFile', 'multiSelections']);
    if (!items) {
      return undefined;
    }
    const visuals = director.addVisuals(items);
    scheduleShowConfigAutoSave();
    return visuals;
  });

  ipcMain.handle('visual:replace', async (_event, visualId: string) => {
    const items = await pickVisualFiles(['openFile']);
    if (!items?.[0]) {
      return undefined;
    }
    const visual = director.replaceVisual(visualId, items[0]);
    scheduleShowConfigAutoSave();
    return visual;
  });

  ipcMain.handle('visual:clear', (_event, visualId: string) => {
    const visual = director.clearVisual(visualId);
    scheduleShowConfigAutoSave();
    return visual;
  });

  ipcMain.handle('visual:remove', (_event, visualId: string) => {
    director.removeVisual(visualId);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('visual:metadata', (_event, report: VisualMetadataReport) => director.updateVisualMetadata(report));

  ipcMain.handle('audio-source:add-file', async () => {
    const result = await showOpenDialog({
      title: 'Add audio source',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
        { name: 'Video/Audio', extensions: ['mp4', 'mov', 'm4v', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const audioPath = result.filePaths[0];
    const source = director.addAudioFileSource(audioPath, pathToFileURL(audioPath).toString());
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:add-embedded', (_event, visualId: string) => {
    const source = director.addEmbeddedAudioSource(visualId);
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:update', (_event, audioSourceId: string, update: AudioSourceUpdate) => {
    const source = director.updateAudioSource(audioSourceId, update);
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:remove', (_event, audioSourceId: string) => {
    director.removeAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('audio-source:metadata', (_event, report: AudioMetadataReport) => director.updateAudioMetadata(report));

  ipcMain.handle('output:create', () => {
    const output = director.createVirtualOutput();
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:update', (_event, outputId: string, update: VirtualOutputUpdate) => {
    const output = director.updateVirtualOutput(outputId, update);
    if (update.meterDb === undefined) {
      scheduleShowConfigAutoSave();
    }
    return output;
  });

  ipcMain.handle('output:remove', (_event, outputId: string) => {
    director.removeVirtualOutput(outputId);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('show:save', async (): Promise<ShowConfigOperationResult> => {
    currentShowConfigPath ??= getDefaultShowConfigPath(app.getPath('userData'));
    await writeShowConfig(currentShowConfigPath, director.createShowConfig());
    return { state: director.getState(), filePath: currentShowConfigPath, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle('show:save-as', async (): Promise<ShowConfigOperationResult | undefined> => {
    const result = await showSaveDialog({
      title: 'Save Xtream show config',
      defaultPath: currentShowConfigPath ?? getDefaultShowConfigPath(app.getPath('documents')),
      filters: [{ name: 'Xtream Show Config', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }
    currentShowConfigPath = result.filePath;
    await writeShowConfig(currentShowConfigPath, director.createShowConfig());
    return { state: director.getState(), filePath: currentShowConfigPath, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle('show:open', async (): Promise<ShowConfigOperationResult | undefined> => {
    const result = await showOpenDialog({
      title: 'Open Xtream show config',
      properties: ['openFile'],
      filters: [{ name: 'Xtream Show Config', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const configPath = result.filePaths[0];
    return restoreShowConfigFromDiskConfig(configPath, await readShowConfig(configPath));
  });

  ipcMain.handle('show:export-diagnostics', async (): Promise<string | undefined> => {
    const result = await showSaveDialog({
      title: 'Export Xtream diagnostics',
      defaultPath: path.join(app.getPath('documents'), `xtream-diagnostics-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }
    await writeJsonFile(result.filePath, createDiagnosticsReport(director.getState(), app.getVersion()));
    return result.filePath;
  });

  ipcMain.handle('display:create', (_event, options?: DisplayCreateOptions) => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }
    const display = displayRegistry.create(options);
    director.registerDisplay(display);
    scheduleShowConfigAutoSave();
    return display;
  });

  ipcMain.handle('display:update', (_event, id: string, update: DisplayUpdate) => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }
    const currentDisplay = director.getState().displays[id];
    if (!displayRegistry.get(id) && currentDisplay) {
      const state = director.updateDisplay({ ...currentDisplay, ...update });
      scheduleShowConfigAutoSave();
      return state.displays[id];
    }
    const display = displayRegistry.update(id, update);
    director.updateDisplay(display);
    scheduleShowConfigAutoSave();
    return display;
  });

  ipcMain.handle('display:close', (_event, id: string) => displayRegistry?.close(id) ?? false);

  ipcMain.handle('display:remove', (_event, id: string) => {
    displayRegistry?.remove(id);
    director.removeDisplay(id);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('display:list-monitors', () => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }
    return displayRegistry.listMonitors();
  });

  ipcMain.handle('display:reopen', (_event, id: string) => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }
    const previous = director.getState().displays[id];
    if (!previous) {
      throw new Error(`Unknown display window: ${id}`);
    }
    const display = displayRegistry.reopen(previous);
    director.registerDisplay(display);
    scheduleShowConfigAutoSave();
    return display;
  });

  ipcMain.handle('renderer:ready', (_event, report: RendererReadyReport) => {
    if (isShuttingDown) {
      return;
    }
    if (report.kind === 'display' && report.displayId) {
      const display = displayRegistry?.get(report.displayId);
      if (display) {
        director.updateDisplay({ ...display, health: 'ready' });
      }
    }
  });

  ipcMain.handle('renderer:drift', (_event, report: DriftReport) => {
    if (!isShuttingDown) {
      director.ingestDrift(report);
    }
  });
}

app.whenReady().then(() => {
  displayRegistry = new DisplayRegistry(
    preloadPath,
    rendererRoot,
    (id) => {
      if (!isShuttingDown) {
        director.markDisplayClosed(id);
      }
    },
    (state) => {
      if (!isShuttingDown) {
        director.updateDisplay(state);
      }
    },
  );

  registerIpcHandlers();
  director.on('state', (state) => broadcastDirectorState(state));

  controlWindow = createControlWindow();
  currentShowConfigPath = getDefaultShowConfigPath(app.getPath('userData'));
  if (fs.existsSync(currentShowConfigPath)) {
    void readShowConfig(currentShowConfigPath)
      .then((config) => restoreShowConfigFromDiskConfig(currentShowConfigPath!, config))
      .catch((error: unknown) => {
        console.error('Failed to restore default show config.', error);
      });
  }

  app.on('activate', () => {
    if (!isShuttingDown && BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createControlWindow();
    }
  });
});

app.on('before-quit', () => {
  isShuttingDown = true;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
  }
  displayRegistry?.closeAll();
});

app.on('window-all-closed', () => {
  if (isShuttingDown || process.platform !== 'darwin') {
    app.quit();
  }
});
