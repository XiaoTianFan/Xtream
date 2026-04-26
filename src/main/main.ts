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
import { getActiveDisplays, getMode1TargetLayout, getMode2TargetLayouts, getMode3TargetLayouts } from '../shared/layouts';
import type {
  DirectorState,
  AudioCapabilitiesReport,
  AudioMetadataReport,
  AudioSinkSelection,
  DisplayCreateOptions,
  DisplayUpdate,
  DriftReport,
  ModePresetResult,
  PlaybackMode,
  RendererReadyReport,
  ShowConfigOperationResult,
  SlotMetadataReport,
  TransportCommand,
} from '../shared/types';

const director = new Director();

let controlWindow: BrowserWindow | undefined;
let displayRegistry: DisplayRegistry | undefined;
let currentShowConfigPath: string | undefined;

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

  return window;
}

function broadcastDirectorState(state: DirectorState): void {
  controlWindow?.webContents.send('director:state', state);

  for (const displayWindow of displayRegistry?.getAllWindows() ?? []) {
    displayWindow.webContents.send('director:state', state);
  }
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
  displayRegistry.closeAll();
  director.restoreShowConfig(config, buildMediaUrls(config));
  for (const display of config.displays) {
    const state = displayRegistry.create({
      layout: display.layout,
      fullscreen: display.fullscreen,
      displayId: display.displayId,
    });
    director.registerDisplay(state);
  }
  currentShowConfigPath = configPath;

  return {
    state: director.getState(),
    filePath: currentShowConfigPath,
    issues,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle('director:get-state', () => director.getState());

  ipcMain.handle('director:set-mode', (_event, mode: PlaybackMode) => director.setMode(mode));

  ipcMain.handle('director:apply-mode-preset', (_event, mode: PlaybackMode): ModePresetResult => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }

    director.setMode(mode);

    if (mode === 2 || mode === 3) {
      const activeDisplays = getActiveDisplays(director.getState().displays);
      const [displayALayout, displayBLayout] = mode === 3 ? getMode3TargetLayouts() : getMode2TargetLayouts();
      const displayA = activeDisplays[0] ?? displayRegistry.create({ layout: displayALayout, fullscreen: false });
      const displayB = activeDisplays[1] ?? displayRegistry.create({ layout: displayBLayout, fullscreen: false });
      const displayAWithLayout = displayRegistry.update(displayA.id, { layout: displayALayout });
      const displayBWithLayout = displayRegistry.update(displayB.id, { layout: displayBLayout });

      director.updateDisplay(displayAWithLayout);
      const state = director.updateDisplay(displayBWithLayout);
      return {
        state,
        primaryDisplayId: displayAWithLayout.id,
      };
    }

    if (mode !== 1) {
      return { state: director.getState() };
    }

    const activeDisplays = getActiveDisplays(director.getState().displays);
    const targetDisplay =
      activeDisplays[0] ?? displayRegistry.create({ layout: getMode1TargetLayout(), fullscreen: false });
    const displayWithPresetLayout = displayRegistry.update(targetDisplay.id, {
      layout: getMode1TargetLayout(),
    });

    const state = director.updateDisplay(displayWithPresetLayout);
    return {
      state,
      primaryDisplayId: displayWithPresetLayout.id,
    };
  });

  ipcMain.handle('director:transport', (_event, command: TransportCommand) => {
    return director.applyTransport(command);
  });

  ipcMain.handle('slot:pick-video', async (_event, slotId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: `Choose video for slot ${slotId}`,
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'ogv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    };

    const result = controlWindow
      ? await dialog.showOpenDialog(controlWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const videoPath = result.filePaths[0];
    return director.setSlotVideo(slotId, videoPath, pathToFileURL(videoPath).toString());
  });

  ipcMain.handle('slot:clear-video', (_event, slotId: string) => {
    return director.clearSlotVideo(slotId);
  });

  ipcMain.handle('slot:metadata', (_event, report: SlotMetadataReport) => {
    return director.updateSlotMetadata(report);
  });

  ipcMain.handle('audio:pick-file', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose stereo audio file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
        { name: 'Video/Audio', extensions: ['mp4', 'mov', 'm4v', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    };

    const result = controlWindow
      ? await dialog.showOpenDialog(controlWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const audioPath = result.filePaths[0];
    return director.setAudioFile(audioPath, pathToFileURL(audioPath).toString());
  });

  ipcMain.handle('audio:clear-file', () => {
    return director.clearAudioFile();
  });

  ipcMain.handle('audio:metadata', (_event, report: AudioMetadataReport) => {
    return director.updateAudioMetadata(report);
  });

  ipcMain.handle('audio:set-sink', (_event, selection: AudioSinkSelection) => {
    return director.setAudioSink(selection);
  });

  ipcMain.handle('audio:capabilities', (_event, report: AudioCapabilitiesReport) => {
    return director.updateAudioCapabilities(report);
  });

  ipcMain.handle('show:save', async (): Promise<ShowConfigOperationResult> => {
    currentShowConfigPath ??= getDefaultShowConfigPath(app.getPath('userData'));
    await writeShowConfig(currentShowConfigPath, director.createShowConfig());
    return {
      state: director.getState(),
      filePath: currentShowConfigPath,
      issues: validateRuntimeState(director.getState()),
    };
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
    return {
      state: director.getState(),
      filePath: currentShowConfigPath,
      issues: validateRuntimeState(director.getState()),
    };
  });

  ipcMain.handle('show:open', async (): Promise<ShowConfigOperationResult | undefined> => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }

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

    const diagnostics = createDiagnosticsReport(director.getState(), app.getVersion());
    await writeJsonFile(result.filePath, diagnostics);
    return result.filePath;
  });

  ipcMain.handle('display:create', (_event, options?: DisplayCreateOptions) => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }

    const display = displayRegistry.create(options);
    director.registerDisplay(display);
    return display;
  });

  ipcMain.handle('display:update', (_event, id: string, update: DisplayUpdate) => {
    if (!displayRegistry) {
      throw new Error('Display registry is not initialized.');
    }

    const display = displayRegistry.update(id, update);
    director.updateDisplay(display);
    return display;
  });

  ipcMain.handle('display:close', (_event, id: string) => {
    return displayRegistry?.close(id) ?? false;
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

    const display = displayRegistry.create({
      layout: previous.layout,
      fullscreen: previous.fullscreen,
      displayId: previous.displayId,
    });
    director.registerDisplay(display);
    return display;
  });

  ipcMain.handle('renderer:ready', (_event, report: RendererReadyReport) => {
    if (report.kind === 'display' && report.displayId) {
      const display = displayRegistry?.get(report.displayId);
      if (display) {
        director.updateDisplay({ ...display, health: 'ready' });
      }
    }
  });

  ipcMain.handle('renderer:drift', (_event, report: DriftReport) => {
    director.ingestDrift(report);
  });
}

app.whenReady().then(() => {
  displayRegistry = new DisplayRegistry(preloadPath, rendererRoot, (id) => {
    director.markDisplayClosed(id);
  }, (state) => {
    director.updateDisplay(state);
  });

  registerIpcHandlers();
  director.on('state', (state) => broadcastDirectorState(state));

  controlWindow = createControlWindow();
  currentShowConfigPath = getDefaultShowConfigPath(app.getPath('userData'));
  if (fs.existsSync(currentShowConfigPath)) {
    void readShowConfig(currentShowConfigPath)
      .then((config) => {
        restoreShowConfigFromDiskConfig(currentShowConfigPath!, config);
      })
      .catch((error: unknown) => {
        console.error('Failed to restore default show config.', error);
      });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
