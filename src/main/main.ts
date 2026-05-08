import { app, BrowserWindow, dialog } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { copyFilesIntoProjectAssets } from './mediaImport';
import { readAppControlSettings } from './appControlSettings';
import { Director } from './director';
import { StreamEngine } from './streamEngine';
import { DisplayRegistry } from './displayRegistry';
import { toRendererFileUrl } from './fileUrls';
import { createAudioWindow, createControlWindow } from './appWindows';
import { createCapturePermissionController } from './capturePermissions';
import { persistControlUiSnapshotFromRenderer } from './controlUiStateStore';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { StreamSceneStateTransitionLogger } from './sessionStreamSceneLog';
import {
  buildMediaUrls,
  getDefaultShowConfigPath,
  addRecentShow,
  SHOW_AUDIO_ASSET_DIRECTORY,
  SHOW_VISUAL_ASSET_DIRECTORY,
  SHOW_PROJECT_FILENAME,
  hydratePersistedShowMediaPaths,
  readShowConfig,
  validateShowConfigMedia,
  writeShowConfig,
} from './showConfig';
import type { SessionLogPayload, ShowOpenProfileLogEntry } from '../shared/showOpenProfile';
import { normalizeSessionLogEntry } from '../shared/showOpenProfile';
import { mergeShowConfigPatchRouting } from '../shared/streamWorkspace';
import {
  classifyMediaPoolExtension,
  VISUAL_IMPORT_EXTENSIONS,
  VISUAL_IMPORT_EXTENSION_SET,
  AUDIO_FILE_IMPORT_EXTENSION_SET,
} from '../shared/mediaImportClassification';
import type {
  DirectorState,
  MediaPoolClassifiedPaths,
  MissingMediaListItem,
  MissingMediaRelinkPayload,
  ShowConfigOperationResult,
  ShowUnsavedPromptKind,
  StreamEnginePublicState,
  TransportCommand,
  VisualImportItem,
  VisualMediaType,
  VirtualOutputId,
} from '../shared/types';
import {
  clearShellModalsBeforeWindowClosePrompt,
  promptShellChoiceModal,
} from './shellModalBridge';
import { checkAndPromptRuntimeUpdateReminder } from './runtimeUpdateReminder';

const director = new Director();
const streamEngine = new StreamEngine(director);
const streamSceneStateTransitionLogger = new StreamSceneStateTransitionLogger();
director.setStreamPlaybackGate(() => streamEngine.isStreamPlaybackActive());

const SHOW_CONFIG_AUTO_SAVE_DELAY_MS = 2 * 60 * 1000;

function applyAppPersistedDirectorGlobals(): void {
  director.applyPersistedAppControlSettings(readAppControlSettings(app.getPath('userData')));
}

let controlWindow: BrowserWindow | undefined;
let audioWindow: BrowserWindow | undefined;
let displayRegistry: DisplayRegistry | undefined;
let currentShowConfigPath: string | undefined;
const currentShowConfigPathRef = {
  get value(): string | undefined {
    return currentShowConfigPath;
  },
  set value(value: string | undefined) {
    currentShowConfigPath = value;
  },
};
let autoSaveTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;
let soloOutputIds: VirtualOutputId[] = [];
/** Edited since explicit save or successful load/create; unrelated to autosave completion. */
let showExplicitDirty = false;
/** Skip flushing pending autosave on shutdown (Don't save branch). */
let skipAutoSaveFlushOnShutdown = false;

function forwardSessionLogFromMain(payload: SessionLogPayload): void {
  if (!controlWindow || controlWindow.isDestroyed() || controlWindow.webContents.isDestroyed()) {
    return;
  }
  const entry: ShowOpenProfileLogEntry = normalizeSessionLogEntry(
    {
      checkpoint: payload.checkpoint,
      runId: payload.runId,
      sinceRunStartMs: payload.sinceRunStartMs,
      segmentMs: payload.segmentMs,
      extra: payload.extra,
      domain: payload.domain ?? 'main',
      kind: payload.kind ?? 'checkpoint',
    },
    'main',
  );
  controlWindow.webContents.send('session-log:entry', entry);
}

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const preloadPath = path.join(__dirname, '../preload/preload.js');
const rendererRoot = path.join(__dirname, '../../renderer');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function broadcastDirectorState(state: DirectorState): void {
  sendDirectorState(controlWindow, state);
  sendDirectorState(audioWindow, state);
  for (const displayWindow of displayRegistry?.getAllWindows() ?? []) {
    sendDirectorState(displayWindow, state);
  }
}

function sendStreamState(window: BrowserWindow | undefined, state: StreamEnginePublicState): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send('stream:state', state);
}

function broadcastStreamState(state: StreamEnginePublicState): void {
  sendStreamState(controlWindow, state);
  sendStreamState(audioWindow, state);
  for (const displayWindow of displayRegistry?.getAllWindows() ?? []) {
    sendStreamState(displayWindow, state);
  }
}

function createPersistedShowForDisk(): ReturnType<Director['createShowConfig']> {
  const projectRoot =
    currentShowConfigPath && path.basename(currentShowConfigPath) === SHOW_PROJECT_FILENAME
      ? path.dirname(currentShowConfigPath)
      : undefined;
  return director.createShowConfig(
    new Date().toISOString(),
    streamEngine.getPersistence(),
    projectRoot ? { projectRootForRelativeMedia: projectRoot } : undefined,
  );
}

function listMissingMediaItems(): MissingMediaListItem[] {
  const state = director.getState();
  const items: MissingMediaListItem[] = [];
  for (const v of Object.values(state.visuals)) {
    if (v.kind !== 'file' || !v.path) {
      continue;
    }
    if (!fs.existsSync(v.path)) {
      items.push({
        kind: 'visual',
        id: v.id,
        label: v.label,
        referencePath: v.path,
        filename: path.basename(v.path),
      });
    }
  }
  for (const s of Object.values(state.audioSources)) {
    if (s.type === 'external-file' && s.path && !fs.existsSync(s.path)) {
      items.push({
        kind: 'audio-external',
        id: s.id,
        label: s.label,
        referencePath: s.path,
        filename: path.basename(s.path),
      });
    }
    if (s.type === 'embedded-visual' && s.extractionMode === 'file' && s.extractedPath && !fs.existsSync(s.extractedPath)) {
      items.push({
        kind: 'audio-embedded',
        id: s.id,
        label: s.label,
        referencePath: s.extractedPath,
        filename: path.basename(s.extractedPath),
      });
    }
  }
  return items;
}

async function resolveRelinkPickerPath(pickedPath: string, mode: 'link' | 'copy', assetKind: 'visual' | 'audio'): Promise<string> {
  const abs = path.resolve(pickedPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  if (mode === 'link') {
    return abs;
  }
  if (!currentShowConfigPath || path.basename(currentShowConfigPath) !== SHOW_PROJECT_FILENAME) {
    throw new Error('Save the project as show.xtream-show.json before copying media.');
  }
  const copied = await copyFilesIntoProjectAssets(currentShowConfigPath, [abs], assetKind);
  return copied[0];
}

function applyResolvedRelink(payload: MissingMediaRelinkPayload, finalPath: string): void {
  switch (payload.kind) {
    case 'visual':
      director.replaceVisual(payload.id, createVisualImportItem(finalPath));
      break;
    case 'audio-external':
      director.replaceAudioFileSource(payload.id, finalPath, toRendererFileUrl(finalPath));
      break;
    case 'audio-embedded':
      director.relinkEmbeddedExtractedFile(payload.id, finalPath, toRendererFileUrl(finalPath));
      break;
  }
}

function sendDirectorState(window: BrowserWindow | undefined, state: DirectorState): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send('director:state', state);
}

function sendSoloOutputIds(window: BrowserWindow | undefined): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send('audio:solo-output-ids', soloOutputIds);
}

function broadcastSoloOutputIds(): void {
  sendSoloOutputIds(audioWindow);
  sendSoloOutputIds(controlWindow);
}

function isTrustedWebContents(contents: Electron.WebContents | undefined | null): boolean {
  if (!contents || contents.isDestroyed()) {
    return false;
  }
  return (
    contents.id === controlWindow?.webContents.id ||
    contents.id === audioWindow?.webContents.id ||
    Boolean(displayRegistry?.getAllWindows().some((window) => window.webContents.id === contents.id))
  );
}

function isTrustedOrigin(origin: string): boolean {
  return origin.startsWith('file://') || (isDevelopment && process.env.VITE_DEV_SERVER_URL !== undefined && origin === new URL(process.env.VITE_DEV_SERVER_URL).origin);
}

const capturePermissions = createCapturePermissionController({
  isTrustedWebContents,
  isTrustedOrigin,
});

function setSoloOutputIds(outputIds: VirtualOutputId[]): void {
  const outputs = director.getState().outputs;
  soloOutputIds = [...new Set(outputIds)].filter((outputId) => outputs[outputId]);
  broadcastSoloOutputIds();
}

function beginAppShutdown(): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const skipFlush = skipAutoSaveFlushOnShutdown;
  skipAutoSaveFlushOnShutdown = false;
  if (!skipFlush) {
    flushShowConfigAutoSave();
  } else {
    cancelPendingAutosaveWithoutFlush();
  }
  displayRegistry?.closeAll();
  audioWindow?.close();
  app.quit();
}

function cancelPendingAutosaveWithoutFlush(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
  }
}

function isPlaybackEngineActiveForAutoSave(): boolean {
  return director.isPatchTransportPlaying() || streamEngine.isStreamPlaybackActive();
}

function scheduleShowConfigAutoSave(): void {
  if (isShuttingDown || !currentShowConfigPath) {
    return;
  }
  showExplicitDirty = true;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = undefined;
    if (isPlaybackEngineActiveForAutoSave()) {
      scheduleShowConfigAutoSave();
      return;
    }
    if (currentShowConfigPath) {
      const runId = `autosave-${Date.now()}-${randomBytes(3).toString('hex')}`;
      forwardSessionLogFromMain({
        runId,
        checkpoint: 'main_autosave_enter',
        domain: 'config',
        kind: 'operation',
        extra: { filePath: currentShowConfigPath },
      });
      void ensureShowProjectStructure(currentShowConfigPath)
        .then(() => writeShowConfig(currentShowConfigPath!, createPersistedShowForDisk()))
        .then(() => {
          forwardSessionLogFromMain({
            runId,
            checkpoint: 'main_autosave_done',
            domain: 'config',
            kind: 'operation',
            extra: { filePath: currentShowConfigPath },
          });
        })
        .catch((error: unknown) => {
          console.error('Failed to auto-save show config.', error);
          forwardSessionLogFromMain({
            runId,
            checkpoint: 'main_autosave_failed',
            domain: 'config',
            kind: 'operation',
            extra: {
              filePath: currentShowConfigPath,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });
    }
  }, SHOW_CONFIG_AUTO_SAVE_DELAY_MS);
}

function flushShowConfigAutoSave(): void {
  if (!currentShowConfigPath || !autoSaveTimer) {
    return;
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = undefined;
  const runId = `shutdown-save-${Date.now()}-${randomBytes(3).toString('hex')}`;
  forwardSessionLogFromMain({
    runId,
    checkpoint: 'main_shutdown_save_enter',
    domain: 'config',
    kind: 'operation',
    extra: { filePath: currentShowConfigPath },
  });
  try {
    fs.mkdirSync(path.dirname(currentShowConfigPath), { recursive: true });
    ensureShowProjectStructureSync(currentShowConfigPath);
    fs.writeFileSync(currentShowConfigPath, `${JSON.stringify(createPersistedShowForDisk(), null, 2)}\n`, 'utf8');
    forwardSessionLogFromMain({
      runId,
      checkpoint: 'main_shutdown_save_done',
      domain: 'config',
      kind: 'operation',
      extra: { filePath: currentShowConfigPath },
    });
  } catch (error: unknown) {
    console.error('Failed to save show config before shutdown.', error);
    forwardSessionLogFromMain({
      runId,
      checkpoint: 'main_shutdown_save_failed',
      domain: 'config',
      kind: 'operation',
      extra: {
        filePath: currentShowConfigPath,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
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
    url: toRendererFileUrl(filePath),
  };
}

function createDroppedVisualImportItems(filePaths: string[]): VisualImportItem[] {
  const items: VisualImportItem[] = [];
  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    if (!VISUAL_IMPORT_EXTENSION_SET.has(extension) || !fs.existsSync(filePath)) {
      continue;
    }
    items.push(createVisualImportItem(filePath));
  }
  return items;
}

function createDroppedAudioFilePaths(filePaths: string[]): string[] {
  const paths: string[] = [];
  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    if (!AUDIO_FILE_IMPORT_EXTENSION_SET.has(extension) || !fs.existsSync(filePath)) {
      continue;
    }
    paths.push(filePath);
  }
  return paths;
}

function classifyMediaPoolPathsOnDisk(filePaths: string[]): MediaPoolClassifiedPaths {
  const seen = new Set<string>();
  const visualPaths: string[] = [];
  const audioPaths: string[] = [];
  const unsupportedPaths: string[] = [];

  for (const filePath of filePaths) {
    const key = path.resolve(filePath).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (!fs.existsSync(filePath)) {
      unsupportedPaths.push(filePath);
      continue;
    }

    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    const bucket = classifyMediaPoolExtension(extension);
    if (bucket === 'unsupported') {
      unsupportedPaths.push(filePath);
    } else if (bucket === 'visual') {
      visualPaths.push(filePath);
    } else {
      audioPaths.push(filePath);
    }
  }

  return { visualPaths, audioPaths, unsupportedPaths };
}

async function pickVisualFiles(properties: Electron.OpenDialogOptions['properties']): Promise<VisualImportItem[] | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose visual media',
    properties,
    filters: [
      { name: 'Visual Media', extensions: [...VISUAL_IMPORT_EXTENSIONS] },
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

function restoreShowConfigFromDiskConfig(
  configPath: string,
  config: Awaited<ReturnType<typeof readShowConfig>>,
  profile?: { runId: string; t0: number },
): ShowConfigOperationResult {
  if (!displayRegistry) {
    throw new Error('Display registry is not initialized.');
  }
  const log = (checkpoint: string, segmentMs?: number, extra?: Record<string, unknown>): void => {
    if (!profile) {
      return;
    }
    forwardSessionLogFromMain({
      runId: profile.runId,
      checkpoint,
      sinceRunStartMs: Date.now() - profile.t0,
      segmentMs,
      extra,
    });
  };

  let seg = Date.now();
  log('main_restore_enter');

  const issues = validateShowConfigMedia(config, configPath);
  log('main_validate_media_done', Date.now() - seg, { issueCount: issues.length });
  seg = Date.now();

  const mediaUrls = buildMediaUrls(config);
  log('main_build_media_urls_done', Date.now() - seg);
  seg = Date.now();

  displayRegistry.closeAll();
  log('main_display_close_all_done', Date.now() - seg);
  seg = Date.now();

  director.restoreShowConfig(config, mediaUrls);
  applyAppPersistedDirectorGlobals();
  log('main_director_restore_done', Date.now() - seg);
  seg = Date.now();

  const displays = mergeShowConfigPatchRouting(config).displays;
  for (const display of displays) {
    const state = displayRegistry.create({
      id: display.id,
      label: display.label,
      layout: display.layout,
      fullscreen: display.fullscreen,
      alwaysOnTop: display.alwaysOnTop,
      displayId: display.displayId,
      bounds: display.bounds,
    });
    director.registerDisplay(state);
  }
  log('main_displays_register_done', Date.now() - seg, { displayCount: displays.length });
  seg = Date.now();

  currentShowConfigPath = configPath;
  showExplicitDirty = false;
  streamEngine.loadFromShow(config);
  log('main_stream_engine_load_done', Date.now() - seg);

  log('main_restore_exit', undefined, { issueCount: issues.length });

  return {
    state: director.getState(),
    filePath: currentShowConfigPath,
    issues,
    ...(profile ? { openProfileRunId: profile.runId } : {}),
  };
}

async function openShowConfigPath(configPath: string, runIdOverride?: string): Promise<ShowConfigOperationResult> {
  const runId = runIdOverride ?? `so-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const t0 = Date.now();
  forwardSessionLogFromMain({ runId, checkpoint: 'main_open_path_enter', sinceRunStartMs: 0 });
  let seg = Date.now();
  const config = hydratePersistedShowMediaPaths(await readShowConfig(configPath), configPath);
  forwardSessionLogFromMain({
    runId,
    checkpoint: 'main_read_config_done',
    sinceRunStartMs: Date.now() - t0,
    segmentMs: Date.now() - seg,
  });
  seg = Date.now();
  const result = restoreShowConfigFromDiskConfig(configPath, config, { runId, t0 });
  forwardSessionLogFromMain({
    runId,
    checkpoint: 'main_restore_call_done',
    sinceRunStartMs: Date.now() - t0,
    segmentMs: Date.now() - seg,
  });
  seg = Date.now();
  await addRecentShow(app.getPath('userData'), configPath);
  forwardSessionLogFromMain({
    runId,
    checkpoint: 'main_add_recent_done',
    sinceRunStartMs: Date.now() - t0,
    segmentMs: Date.now() - seg,
  });
  forwardSessionLogFromMain({ runId, checkpoint: 'main_open_path_exit', sinceRunStartMs: Date.now() - t0 });
  return result;
}

async function createEmptyShowProject(configPath: string, profile?: { runId: string; t0: number }): Promise<void> {
  const log = (checkpoint: string, extra?: Record<string, unknown>): void => {
    if (!profile) {
      return;
    }
    forwardSessionLogFromMain({
      runId: profile.runId,
      checkpoint,
      sinceRunStartMs: Date.now() - profile.t0,
      domain: 'main',
      kind: 'checkpoint',
      extra,
    });
  };
  currentShowConfigPath = configPath;
  log('main_create_project_enter', { filePath: configPath });
  await ensureShowProjectStructure(currentShowConfigPath);
  log('main_create_project_structure_done');
  displayRegistry?.closeAll();
  log('main_create_project_display_close_all_done');
  director.resetShow();
  applyAppPersistedDirectorGlobals();
  log('main_create_project_director_reset_done');
  streamEngine.resetToDefault();
  log('main_create_project_stream_reset_done');
  if (!displayRegistry) {
    throw new Error('Display registry is not initialized.');
  }
  const display = displayRegistry.create({ layout: { type: 'single' }, fullscreen: false });
  director.registerDisplay(display);
  log('main_create_project_initial_display_done', { displayId: display.id });
  await writeShowConfig(currentShowConfigPath, createPersistedShowForDisk());
  showExplicitDirty = false;
  log('main_create_project_write_done');
}

function getProjectAudioDirectory(): string | undefined {
  if (!currentShowConfigPath || path.basename(currentShowConfigPath) !== SHOW_PROJECT_FILENAME) {
    return undefined;
  }
  return path.join(path.dirname(currentShowConfigPath), SHOW_AUDIO_ASSET_DIRECTORY);
}

async function ensureShowProjectStructure(configPath: string): Promise<void> {
  if (path.basename(configPath) !== SHOW_PROJECT_FILENAME) {
    return;
  }
  const root = path.dirname(configPath);
  await mkdir(path.join(root, SHOW_AUDIO_ASSET_DIRECTORY), { recursive: true });
  await mkdir(path.join(root, SHOW_VISUAL_ASSET_DIRECTORY), { recursive: true });
}

function ensureShowProjectStructureSync(configPath: string): void {
  if (path.basename(configPath) !== SHOW_PROJECT_FILENAME) {
    return;
  }
  const root = path.dirname(configPath);
  fs.mkdirSync(path.join(root, SHOW_AUDIO_ASSET_DIRECTORY), { recursive: true });
  fs.mkdirSync(path.join(root, SHOW_VISUAL_ASSET_DIRECTORY), { recursive: true });
}

function unsavedPromptCopy(kind: ShowUnsavedPromptKind): { title: string; message: string; detail: string } {
  switch (kind) {
    case 'create':
      return {
        title: 'Create new show project',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before creating a new show project or discard changes to continue.',
      };
    case 'openDefault':
      return {
        title: 'Open default show',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before opening the default show or discard changes to continue.',
      };
    case 'openRecent':
      return {
        title: 'Open recent show',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before opening another project or discard changes to continue.',
      };
    default:
      return {
        title: 'Open show project',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before opening another project or discard changes to continue.',
      };
  }
}

async function saveCurrentShowToDiskExplicitly(): Promise<void> {
  currentShowConfigPath ??= getDefaultShowConfigPath(app.getPath('userData'));
  cancelPendingAutosaveWithoutFlush();
  await ensureShowProjectStructure(currentShowConfigPath);
  await writeShowConfig(currentShowConfigPath, createPersistedShowForDisk());
  showExplicitDirty = false;
}

/** Returns whether to continue the attempted action (`true`) or abort (`false`). */
async function promptUnsavedChangesIfNeeded(kind: ShowUnsavedPromptKind): Promise<boolean> {
  if (!showExplicitDirty) {
    return true;
  }
  const runId = `unsaved-${Date.now()}-${randomBytes(3).toString('hex')}`;
  forwardSessionLogFromMain({
    runId,
    checkpoint: 'main_unsaved_prompt_enter',
    domain: 'config',
    kind: 'operation',
    extra: { kind },
  });
  const { title, message, detail } = unsavedPromptCopy(kind);
  const response = await promptShellChoiceModal(
    {
      title,
      message,
      detail,
      buttons: [
        { label: 'Save', variant: 'primary' },
        { label: "Don't Save", variant: 'secondary' },
        { label: 'Cancel', variant: 'secondary' },
      ],
      defaultId: 0,
      cancelId: 2,
    },
    () => controlWindow,
  );
  if (response === 2) {
    forwardSessionLogFromMain({
      runId,
      checkpoint: 'main_unsaved_prompt_cancel',
      domain: 'config',
      kind: 'operation',
      extra: { kind },
    });
    return false;
  }
  if (response === 0) {
    await saveCurrentShowToDiskExplicitly();
    forwardSessionLogFromMain({
      runId,
      checkpoint: 'main_unsaved_prompt_save_done',
      domain: 'config',
      kind: 'operation',
      extra: { kind, filePath: currentShowConfigPath },
    });
  }
  if (response === 1) {
    cancelPendingAutosaveWithoutFlush();
    forwardSessionLogFromMain({
      runId,
      checkpoint: 'main_unsaved_prompt_discard',
      domain: 'config',
      kind: 'operation',
      extra: { kind },
    });
  }
  return true;
}

async function runCloseOrQuitConfirmation(): Promise<'abort' | 'quit'> {
  clearShellModalsBeforeWindowClosePrompt(() => controlWindow);
  if (!showExplicitDirty) {
    skipAutoSaveFlushOnShutdown = false;
    return 'quit';
  }
  const response = await promptShellChoiceModal(
    {
      title: 'Quit Xtream',
      message: 'The current show has unsaved changes.',
      detail: 'Save your changes before quitting or discard changes without saving.',
      buttons: [
        { label: 'Save', variant: 'primary' },
        { label: "Don't Save", variant: 'secondary' },
        { label: 'Cancel', variant: 'secondary' },
      ],
      defaultId: 0,
      cancelId: 2,
    },
    () => controlWindow,
  );
  if (response === 2) {
    return 'abort';
  }
  if (response === 0) {
    try {
      await saveCurrentShowToDiskExplicitly();
    } catch (error: unknown) {
      console.error('Save before quit failed.', error);
      return 'abort';
    }
    skipAutoSaveFlushOnShutdown = false;
    return 'quit';
  }
  skipAutoSaveFlushOnShutdown = true;
  return 'quit';
}

function openControlWindow(): BrowserWindow {
  return createControlWindow({
    preloadPath,
    rendererRoot,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    beginAppShutdown,
    getCurrentShowConfigPath: () => currentShowConfigPath,
    isShuttingDown: () => isShuttingDown,
    onClosed: () => {
      controlWindow = undefined;
    },
    persistControlUiSnapshot: (showFilePath) =>
      persistControlUiSnapshotFromRenderer(app.getPath('userData'), controlWindow, showFilePath),
    runCloseOrQuitConfirmation,
    sendSoloOutputIds,
  });
}

function openAudioWindow(): BrowserWindow {
  return createAudioWindow({
    preloadPath,
    rendererRoot,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    onClosed: () => {
      audioWindow = undefined;
    },
    sendSoloOutputIds,
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
        scheduleShowConfigAutoSave();
      }
    },
  );

  registerIpcHandlers({
    applyResolvedRelink,
    cancelPendingAutosaveWithoutFlush,
    capturePermissions,
    classifyMediaPoolPathsOnDisk,
    createDroppedAudioFilePaths,
    createDroppedVisualImportItems,
    createEmptyShowProject,
    createPersistedShowForDisk,
    createVisualImportItem,
    currentShowConfigPathRef,
    director,
    ensureShowProjectStructure,
    getAudioWindow: () => audioWindow,
    getControlWindow: () => controlWindow,
    getDisplayRegistry: () => displayRegistry,
    getProjectAudioDirectory,
    getSoloOutputIds: () => soloOutputIds,
    isTrustedWebContents,
    isShuttingDown: () => isShuttingDown,
    listMissingMediaItems,
    openShowConfigPath,
    pickVisualFiles,
    promptUnsavedChangesIfNeeded,
    resolveRelinkPickerPath,
    broadcastSoloOutputIds,
    scheduleShowConfigAutoSave,
    setShowExplicitDirty: (dirty) => {
      showExplicitDirty = dirty;
    },
    setSoloOutputIds,
    shouldAutoSaveTransport,
    showOpenDialog,
    showSaveDialog,
    streamEngine,
    forwardSessionLogFromMain,
  });
  capturePermissions.installCapturePermissionHandlers();
  applyAppPersistedDirectorGlobals();
  director.on('state', (state) => broadcastDirectorState(state));
  streamEngine.on('state', (streamState) => {
    for (const row of streamSceneStateTransitionLogger.collect(streamState)) {
      forwardSessionLogFromMain(row);
    }
    broadcastStreamState(streamState);
  });

  controlWindow = openControlWindow();
  audioWindow = openAudioWindow();
  void checkAndPromptRuntimeUpdateReminder(() => controlWindow);

  app.on('activate', () => {
    if (!isShuttingDown && BrowserWindow.getAllWindows().length === 0) {
      controlWindow = openControlWindow();
      void checkAndPromptRuntimeUpdateReminder(() => controlWindow);
    }
  });
});

app.on('before-quit', (e) => {
  if (!isShuttingDown && controlWindow && !controlWindow.isDestroyed()) {
    e.preventDefault();
    controlWindow.close();
    return;
  }
});

app.on('window-all-closed', () => {
  if (isShuttingDown || process.platform !== 'darwin') {
    app.quit();
  }
});
