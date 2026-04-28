import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, systemPreferences, webContents as electronWebContents } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { getAppIconPath } from './appIcon';
import { Director } from './director';
import { StreamEngine } from './streamEngine';
import { DisplayRegistry } from './displayRegistry';
import { toRendererFileUrl } from './fileUrls';
import {
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  addRecentShow,
  SHOW_AUDIO_ASSET_DIRECTORY,
  SHOW_PROJECT_FILENAME,
  readRecentShows,
  readShowConfig,
  validateRuntimeState,
  validateShowConfigMedia,
  writeJsonFile,
  writeShowConfig,
} from './showConfig';
import { getActiveDisplays } from '../shared/layouts';
import { mergeShowConfigPatchRouting } from '../shared/streamWorkspace';
import type {
  AudioMetadataReport,
  AudioExtractionFormat,
  AudioSourceState,
  AudioSourceUpdate,
  DirectorState,
  DisplayCreateOptions,
  DisplayUpdate,
  DriftReport,
  EmbeddedAudioImportChoice,
  EmbeddedAudioImportCandidate,
  EmbeddedAudioExtractionMode,
  LiveCaptureCreate,
  LiveDesktopSourceSummary,
  LiveVisualCaptureConfig,
  PreviewStatus,
  OutputMeterReport,
  PresetId,
  PresetResult,
  LaunchShowData,
  MediaValidationIssue,
  RendererReadyReport,
  ShowSettingsUpdate,
  ShowConfigOperationResult,
  ControlProjectUiStateV1,
  StreamCommand,
  StreamEditCommand,
  StreamEnginePublicState,
  TransportCommand,
  VisualImportItem,
  VisualMediaType,
  VisualMetadataReport,
  VisualUpdate,
  VirtualOutputId,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputUpdate,
} from '../shared/types';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';

const director = new Director();
const streamEngine = new StreamEngine(director);
director.setStreamPlaybackGate(() => streamEngine.isStreamPlaybackActive());

let controlWindow: BrowserWindow | undefined;
let audioWindow: BrowserWindow | undefined;
let displayRegistry: DisplayRegistry | undefined;
let currentShowConfigPath: string | undefined;
let autoSaveTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;
let soloOutputIds: VirtualOutputId[] = [];
/** Edited since explicit save or successful load/create; unrelated to autosave completion. */
let showExplicitDirty = false;
/** Skip flushing pending autosave on shutdown (Don't save branch). */
let skipAutoSaveFlushOnShutdown = false;

function normalizeShowProjectKey(configPath: string): string {
  return path.resolve(configPath).toLowerCase();
}

function getControlUiStateFilePath(): string {
  return path.join(app.getPath('userData'), CONTROL_PROJECT_UI_STATE_FILENAME);
}

function readControlUiStateStore(): Record<string, ControlProjectUiStateV1> {
  try {
    const raw = fs.readFileSync(getControlUiStateFilePath(), 'utf8');
    return JSON.parse(raw) as Record<string, ControlProjectUiStateV1>;
  } catch {
    return {};
  }
}

function writeControlUiStateStore(store: Record<string, ControlProjectUiStateV1>): void {
  const filePath = getControlUiStateFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function getControlUiStateForPath(showFilePath: string): ControlProjectUiStateV1 | undefined {
  return readControlUiStateStore()[normalizeShowProjectKey(showFilePath)];
}

function saveControlUiStateForPath(showFilePath: string, snapshot: ControlProjectUiStateV1): void {
  const key = normalizeShowProjectKey(showFilePath);
  const store = readControlUiStateStore();
  store[key] = snapshot;
  writeControlUiStateStore(store);
}

async function persistControlUiSnapshotFromRenderer(showFilePath: string | undefined): Promise<void> {
  if (!controlWindow || controlWindow.isDestroyed() || controlWindow.webContents.isDestroyed() || !showFilePath) {
    return;
  }
  try {
    const raw = await controlWindow.webContents.executeJavaScript('window.__xtreamGetControlUiSnapshot?.() ?? null', true);
    if (!raw || typeof raw !== 'object') {
      return;
    }
    saveControlUiStateForPath(showFilePath, raw as ControlProjectUiStateV1);
  } catch (error: unknown) {
    console.warn('Could not persist control UI snapshot.', error);
  }
}
type PendingDisplayMediaGrant = { visualId: string; sourceId?: string; createdAtWallTimeMs: number };
const pendingDisplayMediaGrants = new Map<number, PendingDisplayMediaGrant[]>();

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const preloadPath = path.join(__dirname, '../preload/preload.js');
const rendererRoot = path.join(__dirname, '../../renderer');
const VISUAL_IMPORT_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'ogv', 'png', 'jpg', 'jpeg', 'webp', 'gif']);
/** Matches add-file dialog: Audio + Video/Audio groups (excludes * catch-all) */
const AUDIO_FILE_IMPORT_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'm4v', 'webm']);
const LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS = 30 * 60;
const CONTROL_PROJECT_UI_STATE_FILENAME = 'control-project-ui-state.json';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createControlWindow(): BrowserWindow {
  let suppressCloseGuard = false;
  const iconPath = getAppIconPath();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Xtream Control',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(rendererRoot, 'index.html'));
  }
  window.on('close', (e) => {
    if (suppressCloseGuard || isShuttingDown) {
      return;
    }
    e.preventDefault();
    void (async () => {
      const outcome = await runCloseOrQuitConfirmation();
      if (outcome === 'abort') {
        return;
      }
      await persistControlUiSnapshotFromRenderer(currentShowConfigPath);
      suppressCloseGuard = true;
      window.close();
    })();
  });
  window.on('closed', () => {
    controlWindow = undefined;
    if (!isShuttingDown) {
      beginAppShutdown();
    }
  });
  return window;
}

function createAudioWindow(): BrowserWindow {
  const iconPath = getAppIconPath();
  const window = new BrowserWindow({
    width: 320,
    height: 120,
    show: false,
    title: 'Xtream Audio Engine',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (isDevelopment) {
    void window.loadURL(`${process.env.VITE_DEV_SERVER_URL!}/audio.html`);
  } else {
    void window.loadFile(path.join(rendererRoot, 'audio.html'));
  }
  window.on('closed', () => {
    audioWindow = undefined;
  });
  window.webContents.on('did-finish-load', () => {
    sendSoloOutputIds(window);
  });
  return window;
}

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
  return director.createShowConfig(new Date().toISOString(), streamEngine.getPersistence());
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

function getDisplayMediaRequester(request: { frame: Electron.WebFrameMain | null }): Electron.WebContents | undefined {
  return request.frame ? electronWebContents.fromFrame(request.frame) : undefined;
}

function consumePendingDisplayMediaGrant(contentsId: number | undefined): PendingDisplayMediaGrant | undefined {
  if (contentsId !== undefined) {
    const grants = pendingDisplayMediaGrants.get(contentsId);
    const grant = grants?.shift();
    if (grants && grants.length === 0) {
      pendingDisplayMediaGrants.delete(contentsId);
    }
    if (grant) {
      return grant;
    }
  }
  if (pendingDisplayMediaGrants.size === 1) {
    const [fallbackContentsId, fallbackGrants] = Array.from(pendingDisplayMediaGrants.entries())[0];
    const grant = fallbackGrants.shift();
    if (fallbackGrants.length === 0) {
      pendingDisplayMediaGrants.delete(fallbackContentsId);
    }
    return grant;
  }
  return undefined;
}

function queuePendingDisplayMediaGrant(contentsId: number, grant: Omit<PendingDisplayMediaGrant, 'createdAtWallTimeMs'>): void {
  const grants = pendingDisplayMediaGrants.get(contentsId) ?? [];
  grants.push({ ...grant, createdAtWallTimeMs: Date.now() });
  pendingDisplayMediaGrants.set(contentsId, grants.slice(-8));
}

function releasePendingDisplayMediaGrant(contentsId: number, visualId: string): void {
  const grants = pendingDisplayMediaGrants.get(contentsId);
  if (!grants) {
    return;
  }
  const remaining = grants.filter((grant) => grant.visualId !== visualId);
  if (remaining.length === 0) {
    pendingDisplayMediaGrants.delete(contentsId);
  } else {
    pendingDisplayMediaGrants.set(contentsId, remaining);
  }
}

function installCapturePermissionHandlers(): void {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (!isTrustedWebContents(webContents)) {
      return false;
    }
    return permission === 'media' || (permission as string) === 'display-capture';
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedWebContents(webContents) && (permission === 'media' || (permission as string) === 'display-capture'));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const requester = getDisplayMediaRequester(request);
    if (!isTrustedOrigin(request.securityOrigin) || !isTrustedWebContents(requester)) {
      return;
    }
    const grant = consumePendingDisplayMediaGrant(requester?.id);
    if (!grant) {
      console.warn('Display media request had no pending Xtream grant.', { requesterId: requester?.id, origin: request.securityOrigin });
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 640, height: 360 }, fetchWindowIcons: true });
      const source = grant.sourceId ? sources.find((candidate) => candidate.id === grant.sourceId) : sources[0];
      if (source) {
        callback({ video: source });
      } else {
        console.warn('Requested live capture source was not found.', { visualId: grant.visualId, sourceId: grant.sourceId });
      }
    } catch (error: unknown) {
      console.error('Failed to grant live display media source.', error);
    }
  });
}

async function listDesktopCaptureSources(): Promise<LiveDesktopSourceSummary[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    displayId: source.display_id,
    thumbnailDataUrl: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
    appIconDataUrl: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
  }));
}

function getLivePermissionStatus(): Record<string, string> {
  if (process.platform !== 'darwin') {
    return {};
  }
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

function setSoloOutputIds(outputIds: VirtualOutputId[]): void {
  const outputs = director.getState().outputs;
  soloOutputIds = [...new Set(outputIds)].filter((outputId) => outputs[outputId]);
  sendSoloOutputIds(audioWindow);
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
    if (currentShowConfigPath) {
      void ensureShowProjectStructure(currentShowConfigPath)
        .then(() => writeShowConfig(currentShowConfigPath!, createPersistedShowForDisk()))
        .catch((error: unknown) => {
          console.error('Failed to auto-save show config.', error);
        });
    }
  }, 250);
}

function flushShowConfigAutoSave(): void {
  if (!currentShowConfigPath || !autoSaveTimer) {
    return;
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = undefined;
  try {
    fs.mkdirSync(path.dirname(currentShowConfigPath), { recursive: true });
    ensureShowProjectStructureSync(currentShowConfigPath);
    fs.writeFileSync(currentShowConfigPath, `${JSON.stringify(createPersistedShowForDisk(), null, 2)}\n`, 'utf8');
  } catch (error: unknown) {
    console.error('Failed to save show config before shutdown.', error);
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
    if (!VISUAL_IMPORT_EXTENSIONS.has(extension) || !fs.existsSync(filePath)) {
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
    if (!AUDIO_FILE_IMPORT_EXTENSIONS.has(extension) || !fs.existsSync(filePath)) {
      continue;
    }
    paths.push(filePath);
  }
  return paths;
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
  for (const display of mergeShowConfigPatchRouting(config).displays) {
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
  currentShowConfigPath = configPath;
  showExplicitDirty = false;
  streamEngine.loadFromShow(config);
  return { state: director.getState(), filePath: currentShowConfigPath, issues };
}

async function openShowConfigPath(configPath: string): Promise<ShowConfigOperationResult> {
  const result = restoreShowConfigFromDiskConfig(configPath, await readShowConfig(configPath));
  await addRecentShow(app.getPath('userData'), configPath);
  return result;
}

async function createEmptyShowProject(configPath: string): Promise<void> {
  currentShowConfigPath = configPath;
  await ensureShowProjectStructure(currentShowConfigPath);
  displayRegistry?.closeAll();
  director.resetShow();
  streamEngine.resetToDefault();
  if (!displayRegistry) {
    throw new Error('Display registry is not initialized.');
  }
  const display = displayRegistry.create({ layout: { type: 'single' }, fullscreen: false });
  director.registerDisplay(display);
  await writeShowConfig(currentShowConfigPath, createPersistedShowForDisk());
  showExplicitDirty = false;
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
  await mkdir(path.join(path.dirname(configPath), SHOW_AUDIO_ASSET_DIRECTORY), { recursive: true });
}

function ensureShowProjectStructureSync(configPath: string): void {
  if (path.basename(configPath) !== SHOW_PROJECT_FILENAME) {
    return;
  }
  fs.mkdirSync(path.join(path.dirname(configPath), SHOW_AUDIO_ASSET_DIRECTORY), { recursive: true });
}

function createExtractionFilePath(visualId: string, format: AudioExtractionFormat): string {
  const audioDirectory = getProjectAudioDirectory();
  if (!audioDirectory) {
    throw new Error('Create a show project before extracting embedded video audio to a file.');
  }
  const safeVisualId = visualId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'visual';
  return path.join(audioDirectory, `${safeVisualId}.${format}`);
}

function getFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error('Bundled FFmpeg is unavailable.');
  }
  return ffmpegPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(summarizeFfmpegError(stderr) || `FFmpeg exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function summarizeFfmpegError(stderr: string): string {
  const lines = stderr
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const importantLines = lines.filter((line) => /error|invalid|failed|not yet implemented|reserved|sample rate|rematrix/i.test(line));
  return (importantLines.length > 0 ? importantLines : lines.slice(-12)).slice(-20).join('\n');
}

function createAudioExtractionArgs(inputPath: string, outputPath: string, format: AudioExtractionFormat): string[] {
  const baseArgs = [
    '-y',
    '-fflags',
    '+discardcorrupt',
    '-err_detect',
    'ignore_err',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '2',
    '-ar',
    '48000',
  ];
  return format === 'wav'
    ? [...baseArgs, '-acodec', 'pcm_s16le', outputPath]
    : [...baseArgs, '-acodec', 'aac', '-b:a', '192k', outputPath];
}

async function extractEmbeddedAudio(visualId: string, format: AudioExtractionFormat): Promise<ReturnType<Director['markEmbeddedAudioExtractionReady']>> {
  const visual = director.getState().visuals[visualId];
  if (!visual?.path) {
    throw new Error('This visual has no source file to extract audio from.');
  }
  const outputPath = createExtractionFilePath(visualId, format);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const outputUrl = toRendererFileUrl(outputPath);
  director.markEmbeddedAudioExtractionPending(visualId, outputPath, outputUrl, format);
  try {
    await runFfmpeg(createAudioExtractionArgs(visual.path, outputPath, format));
    const source = director.markEmbeddedAudioExtractionReady(
      visualId,
      outputPath,
      outputUrl,
      format,
      fs.existsSync(outputPath) ? fs.statSync(outputPath).size : undefined,
    );
    scheduleShowConfigAutoSave();
    return source;
  } catch (error: unknown) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { force: true });
    }
    const message = error instanceof Error ? error.message : 'Audio extraction failed.';
    const source = director.markEmbeddedAudioExtractionFailed(visualId, message);
    scheduleShowConfigAutoSave();
    throw Object.assign(new Error(message), { source });
  }
}

type UnsavedPromptKind = 'create' | 'open' | 'openDefault' | 'openRecent';

function unsavedPromptCopy(kind: UnsavedPromptKind): { title: string; message: string; detail: string } {
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
async function promptUnsavedChangesIfNeeded(kind: UnsavedPromptKind): Promise<boolean> {
  if (!showExplicitDirty) {
    return true;
  }
  const { title, message, detail } = unsavedPromptCopy(kind);
  const result = controlWindow
    ? await dialog.showMessageBox(controlWindow, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title,
        message,
        detail,
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title,
        message,
        detail,
      });
  if (result.response === 2) {
    return false;
  }
  if (result.response === 0) {
    await saveCurrentShowToDiskExplicitly();
  }
  if (result.response === 1) {
    cancelPendingAutosaveWithoutFlush();
  }
  return true;
}

async function runCloseOrQuitConfirmation(): Promise<'abort' | 'quit'> {
  if (!showExplicitDirty) {
    skipAutoSaveFlushOnShutdown = false;
    return 'quit';
  }
  const result = controlWindow
    ? await dialog.showMessageBox(controlWindow, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Quit Xtream',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before quitting or discard changes without saving.',
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Quit Xtream',
        message: 'The current show has unsaved changes.',
        detail: 'Save your changes before quitting or discard changes without saving.',
      });
  if (result.response === 2) {
    return 'abort';
  }
  if (result.response === 0) {
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

  ipcMain.handle('director:update-global-state', (_event, update) => director.updateGlobalState(update));

  ipcMain.handle('visual:add', async () => {
    const items = await pickVisualFiles(['openFile', 'multiSelections']);
    if (!items) {
      return undefined;
    }
    const visuals = director.addVisuals(items);
    scheduleShowConfigAutoSave();
    return visuals;
  });

  ipcMain.handle('visual:add-dropped', (_event, filePaths: string[]) => {
    const items = createDroppedVisualImportItems(filePaths);
    if (items.length === 0) {
      return [];
    }
    const visuals = director.addVisuals(items);
    scheduleShowConfigAutoSave();
    return visuals;
  });

  ipcMain.handle('visual:update', (_event, visualId: string, update: VisualUpdate) => {
    const visual = director.updateVisual(visualId, update);
    scheduleShowConfigAutoSave();
    return visual;
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

  ipcMain.handle('live-capture:list-desktop-sources', () => listDesktopCaptureSources());

  ipcMain.handle('live-capture:create', (_event, request: LiveCaptureCreate) => {
    const visual = director.addLiveVisual(request.label, request.capture);
    scheduleShowConfigAutoSave();
    return visual;
  });

  ipcMain.handle('live-capture:update', (_event, visualId: string, capture: LiveVisualCaptureConfig) => {
    const visual = director.updateLiveVisualCapture(visualId, capture);
    scheduleShowConfigAutoSave();
    return visual;
  });

  ipcMain.handle('live-capture:prepare-display-stream', (event, visualId: string, sourceId?: string) => {
    if (!isTrustedWebContents(event.sender)) {
      return false;
    }
    queuePendingDisplayMediaGrant(event.sender.id, { visualId, sourceId });
    return true;
  });

  ipcMain.handle('live-capture:release-display-stream', (event, visualId: string) => {
    releasePendingDisplayMediaGrant(event.sender.id, visualId);
  });

  ipcMain.handle('live-capture:permission-status', () => getLivePermissionStatus());

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
    const source = director.addAudioFileSource(audioPath, toRendererFileUrl(audioPath));
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:add-dropped', (_event, filePaths: string[]) => {
    const paths = createDroppedAudioFilePaths(filePaths);
    if (paths.length === 0) {
      return [];
    }
    const sources: AudioSourceState[] = [];
    for (const filePath of paths) {
      sources.push(director.addAudioFileSource(filePath, toRendererFileUrl(filePath)));
    }
    scheduleShowConfigAutoSave();
    return sources;
  });

  ipcMain.handle('audio-source:replace-file', async (_event, audioSourceId: string) => {
    const result = await showOpenDialog({
      title: 'Replace external audio',
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
    const source = director.replaceAudioFileSource(audioSourceId, audioPath, toRendererFileUrl(audioPath));
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:add-embedded', (_event, visualId: string, mode?: EmbeddedAudioExtractionMode) => {
    const source = director.addEmbeddedAudioSource(visualId, mode ?? 'representation');
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:extract-embedded', async (_event, visualId: string, format?: AudioExtractionFormat) => {
    const source = await extractEmbeddedAudio(visualId, format ?? director.getState().audioExtractionFormat);
    return source;
  });

  ipcMain.handle('audio-source:update', (_event, audioSourceId: string, update: AudioSourceUpdate) => {
    const source = director.updateAudioSource(audioSourceId, update);
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:clear', (_event, audioSourceId: string) => {
    const source = director.clearAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    return source;
  });

  ipcMain.handle('audio-source:remove', (_event, audioSourceId: string) => {
    director.removeAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('audio-source:split-stereo', (_event, audioSourceId: string) => {
    const sources = director.splitStereoAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    return sources;
  });

  ipcMain.handle('audio-source:metadata', (_event, report: AudioMetadataReport) => director.updateAudioMetadata(report));

  ipcMain.handle('output:create', () => {
    const output = director.createVirtualOutput();
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:update', (_event, outputId: string, update: VirtualOutputUpdate) => {
    const output = director.updateVirtualOutput(outputId, update);
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:add-source', (_event, outputId: string, audioSourceId: string) => {
    const output = director.addVirtualOutputSource(outputId, audioSourceId);
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:update-source', (_event, outputId: string, selectionId: string, update: VirtualOutputSourceSelectionUpdate) => {
    const output = director.updateVirtualOutputSource(outputId, selectionId, update);
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:remove-source', (_event, outputId: string, selectionId: string) => {
    const output = director.removeVirtualOutputSource(outputId, selectionId);
    scheduleShowConfigAutoSave();
    return output;
  });

  ipcMain.handle('output:meter', (_event, report: OutputMeterReport) => {
    const output = director.updateOutputMeter(report);
    return output;
  });

  ipcMain.handle('audio:meter-report', (_event, report: OutputMeterReport) => {
    director.updateOutputMeter(report);
    if (controlWindow && !controlWindow.isDestroyed() && !controlWindow.webContents.isDestroyed()) {
      controlWindow.webContents.send('audio:meter-lanes', report);
    }
  });

  ipcMain.handle('audio:set-solo-output-ids', (_event, outputIds: VirtualOutputId[]) => {
    setSoloOutputIds(outputIds);
  });

  ipcMain.handle('output:remove', (_event, outputId: string) => {
    director.removeVirtualOutput(outputId);
    setSoloOutputIds(soloOutputIds);
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('show:save', async (): Promise<ShowConfigOperationResult> => {
    currentShowConfigPath ??= getDefaultShowConfigPath(app.getPath('userData'));
    await ensureShowProjectStructure(currentShowConfigPath);
    await writeShowConfig(currentShowConfigPath, createPersistedShowForDisk());
    cancelPendingAutosaveWithoutFlush();
    showExplicitDirty = false;
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
    await ensureShowProjectStructure(currentShowConfigPath);
    await writeShowConfig(currentShowConfigPath, createPersistedShowForDisk());
    cancelPendingAutosaveWithoutFlush();
    showExplicitDirty = false;
    await addRecentShow(app.getPath('userData'), currentShowConfigPath);
    return { state: director.getState(), filePath: currentShowConfigPath, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle('show:create-project', async (): Promise<ShowConfigOperationResult | undefined> => {
    if (!(await promptUnsavedChangesIfNeeded('create'))) {
      return undefined;
    }
    const result = await showOpenDialog({
      title: 'Create Xtream show project',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const projectDirectory = result.filePaths[0];
    await createEmptyShowProject(path.join(projectDirectory, SHOW_PROJECT_FILENAME));
    await addRecentShow(app.getPath('userData'), currentShowConfigPath!);
    return { state: director.getState(), filePath: currentShowConfigPath, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle('show:media-validation-issues', (): MediaValidationIssue[] => {
    return validateShowConfigMedia(createPersistedShowForDisk());
  });

  ipcMain.handle('show:get-launch-data', async (): Promise<LaunchShowData> => {
    const defaultShowPath = getDefaultShowConfigPath(app.getPath('userData'));
    return {
      recentShows: await readRecentShows(app.getPath('userData')),
      defaultShow: {
        filePath: defaultShowPath,
        exists: fs.existsSync(defaultShowPath),
      },
    };
  });

  ipcMain.handle('show:open-default', async (): Promise<ShowConfigOperationResult | undefined> => {
    const defaultShowPath = getDefaultShowConfigPath(app.getPath('userData'));
    if (!(await promptUnsavedChangesIfNeeded('openDefault'))) {
      return undefined;
    }
    if (!fs.existsSync(defaultShowPath)) {
      await createEmptyShowProject(defaultShowPath);
    }
    return openShowConfigPath(defaultShowPath);
  });

  ipcMain.handle('show:open-recent', async (_event, filePath: string): Promise<ShowConfigOperationResult | undefined> => {
    if (!fs.existsSync(filePath)) {
      await readRecentShows(app.getPath('userData'));
      return undefined;
    }
    if (!(await promptUnsavedChangesIfNeeded('openRecent'))) {
      return undefined;
    }
    return openShowConfigPath(filePath);
  });

  ipcMain.handle('show:update-settings', (_event, update: ShowSettingsUpdate) => {
    const state = director.updateShowSettings(update);
    scheduleShowConfigAutoSave();
    return state;
  });

  ipcMain.handle(
    'show:choose-embedded-audio-import',
    async (_event, candidates: EmbeddedAudioImportCandidate[]): Promise<EmbeddedAudioImportChoice> => {
      const label = candidates.length === 1 ? candidates[0]?.label ?? 'video' : `${candidates.length} videos`;
      const hasLongVideo = candidates.some((candidate) => (candidate.durationSeconds ?? 0) > LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS);
      const buttons = hasLongVideo
        ? ['Do not extract audio', 'Extract audio into files']
        : ['Do not extract audio', 'Extract into representation', 'Extract audio into files'];
      const fileResponseId = hasLongVideo ? 1 : 2;
      const representationResponseId = hasLongVideo ? -1 : 1;
      const detail = hasLongVideo
        ? 'Videos longer than 30 minutes use extracted audio files for more stable playback.'
        : 'Choose how Xtream should create audio sources for the imported video media.';
      const result = controlWindow
        ? await dialog.showMessageBox(controlWindow, {
            type: 'question',
            buttons,
            defaultId: 1,
            cancelId: 0,
            title: 'Import video audio',
            message: `Import audio from ${label}?`,
            detail,
          })
        : await dialog.showMessageBox({
            type: 'question',
            buttons,
            defaultId: 1,
            cancelId: 0,
            title: 'Import video audio',
            message: `Import audio from ${label}?`,
            detail,
          });
      return result.response === fileResponseId ? 'file' : result.response === representationResponseId ? 'representation' : 'skip';
    },
  );

  ipcMain.handle('show:open', async (): Promise<ShowConfigOperationResult | undefined> => {
    if (!(await promptUnsavedChangesIfNeeded('open'))) {
      return undefined;
    }
    const result = await showOpenDialog({
      title: 'Open Xtream show config',
      properties: ['openFile'],
      filters: [{ name: 'Xtream Show Config', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return openShowConfigPath(result.filePaths[0]);
  });

  ipcMain.handle('controlUi:get-for-path', (_event, filePath: string) => getControlUiStateForPath(filePath));

  ipcMain.handle('controlUi:save-snapshot', (_event, filePath: string, snapshot: ControlProjectUiStateV1) => {
    saveControlUiStateForPath(filePath, snapshot);
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
    await writeJsonFile(result.filePath, createDiagnosticsReport(director.getState(), app.getVersion(), XTREAM_RUNTIME_VERSION));
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
    const { visualMingle, ...rest } = update;
    if (visualMingle !== undefined) {
      director.setDisplayVisualMingle(id, visualMingle);
    }
    const currentDisplay = director.getState().displays[id];
    if (!displayRegistry.get(id) && currentDisplay) {
      const state = director.updateDisplay({ ...currentDisplay, ...rest });
      scheduleShowConfigAutoSave();
      return state.displays[id];
    }
    const display = displayRegistry.update(id, rest);
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
    if (report.kind === 'audio') {
      director.markAudioRendererReady();
      sendSoloOutputIds(audioWindow);
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

  ipcMain.handle('renderer:preview-status', (_event, report: PreviewStatus) => {
    if (!isShuttingDown) {
      director.updatePreviewStatus(report);
    }
  });

  ipcMain.handle('stream:get-state', () => streamEngine.getPublicState());
  ipcMain.handle('stream:edit', (_event, command: StreamEditCommand) => {
    const state = streamEngine.applyEdit(command);
    scheduleShowConfigAutoSave();
    return state;
  });
  ipcMain.handle('stream:transport', (_event, command: StreamCommand) => {
    const state = streamEngine.applyTransport(command);
    scheduleShowConfigAutoSave();
    return state;
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

  registerIpcHandlers();
  installCapturePermissionHandlers();
  director.on('state', (state) => broadcastDirectorState(state));
  streamEngine.on('state', (streamState) => broadcastStreamState(streamState));

  controlWindow = createControlWindow();
  audioWindow = createAudioWindow();

  app.on('activate', () => {
    if (!isShuttingDown && BrowserWindow.getAllWindows().length === 0) {
      controlWindow = createControlWindow();
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
