import { app, ipcMain, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAppControlSettings } from '../appControlSettings';
import type { CapturePermissionController } from '../capturePermissions';
import { getControlUiStateForPath, saveControlUiStateForPath } from '../controlUiStateStore';
import type { Director } from '../director';
import type { DisplayRegistry } from '../displayRegistry';
import { extractEmbeddedAudio as extractEmbeddedAudioToFile } from '../embeddedAudioExtraction';
import { toRendererFileUrl } from '../fileUrls';
import { copyFilesIntoProjectAssets } from '../mediaImport';
import {
  addRecentShow,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  readRecentShows,
  SHOW_PROJECT_FILENAME,
  validateRuntimeState,
  validateShowConfigMedia,
  writeJsonFile,
  writeShowConfig,
} from '../showConfig';
import { attachShellModalIpcHandlers, promptShellChoiceModal } from '../shellModalBridge';
import type { StreamEngine } from '../streamEngine';
import { buildEmbeddedAudioImportPrompt } from '../../shared/embeddedAudioImportPrompt';
import { getActiveDisplays } from '../../shared/layouts';
import {
  allMediaPoolImportDialogExtensions,
  AUDIO_FILE_IMPORT_EXTENSIONS,
  VISUAL_IMPORT_EXTENSIONS,
} from '../../shared/mediaImportClassification';
import type {
  AppControlSettingsV1,
  AudioExtractionFormat,
  AudioMetadataReport,
  AudioSourceState,
  AudioSourceUpdate,
  AudioSubCuePreviewCommand,
  AudioSubCuePreviewPosition,
  BatchMissingMediaRelinkPayload,
  BatchMissingMediaRelinkResult,
  ControlProjectUiStateV1,
  DiagnosticsExportAttachPayload,
  DirectorState,
  DisplayCreateOptions,
  DisplayUpdate,
  DriftReport,
  EmbeddedAudioImportCandidate,
  EmbeddedAudioImportChoice,
  EmbeddedAudioExtractionMode,
  GlobalStateUpdate,
  LaunchShowData,
  LiveCaptureCreate,
  LiveVisualCaptureConfig,
  MediaPoolClassifiedPaths,
  MediaPoolImportFilesPayload,
  MediaValidationIssue,
  MissingMediaListItem,
  MissingMediaRelinkPayload,
  OutputMeterReport,
  PresetId,
  PresetResult,
  PreviewStatus,
  RendererReadyReport,
  ShowConfigOperationResult,
  ShowDiskActionIpcOpts,
  ShowSettingsUpdate,
  ShowUnsavedPromptKind,
  StreamCommand,
  StreamEditCommand,
  TransportCommand,
  VisualImportItem,
  VisualMetadataReport,
  VisualUpdate,
  VirtualOutputId,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputUpdate,
} from '../../shared/types';
import { XTREAM_RUNTIME_VERSION } from '../../shared/version';

type CurrentShowConfigPathRef = { value: string | undefined };

export type RegisterIpcHandlersOptions = {
  applyResolvedRelink: (payload: MissingMediaRelinkPayload, finalPath: string) => void;
  cancelPendingAutosaveWithoutFlush: () => void;
  capturePermissions: CapturePermissionController;
  classifyMediaPoolPathsOnDisk: (filePaths: string[]) => MediaPoolClassifiedPaths;
  createDroppedAudioFilePaths: (filePaths: string[]) => string[];
  createDroppedVisualImportItems: (filePaths: string[]) => VisualImportItem[];
  createEmptyShowProject: (configPath: string) => Promise<void>;
  createPersistedShowForDisk: () => ReturnType<Director['createShowConfig']>;
  createVisualImportItem: (filePath: string) => VisualImportItem;
  currentShowConfigPathRef: CurrentShowConfigPathRef;
  director: Director;
  ensureShowProjectStructure: (configPath: string) => Promise<void>;
  getAudioWindow: () => BrowserWindow | undefined;
  getControlWindow: () => BrowserWindow | undefined;
  getDisplayRegistry: () => DisplayRegistry | undefined;
  getProjectAudioDirectory: () => string | undefined;
  getSoloOutputIds: () => VirtualOutputId[];
  isTrustedWebContents: (contents: Electron.WebContents | undefined | null) => boolean;
  isShuttingDown: () => boolean;
  listMissingMediaItems: () => MissingMediaListItem[];
  openShowConfigPath: (configPath: string) => Promise<ShowConfigOperationResult>;
  pickVisualFiles: (properties: Electron.OpenDialogOptions['properties']) => Promise<VisualImportItem[] | undefined>;
  promptUnsavedChangesIfNeeded: (kind: ShowUnsavedPromptKind) => Promise<boolean>;
  resolveRelinkPickerPath: (pickedPath: string, mode: 'link' | 'copy', assetKind: 'visual' | 'audio') => Promise<string>;
  broadcastSoloOutputIds: () => void;
  scheduleShowConfigAutoSave: () => void;
  setShowExplicitDirty: (dirty: boolean) => void;
  setSoloOutputIds: (outputIds: VirtualOutputId[]) => void;
  shouldAutoSaveTransport: (command: TransportCommand) => boolean;
  showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
  showSaveDialog: (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
  streamEngine: StreamEngine;
};

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  const {
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
    getAudioWindow,
    getControlWindow,
    getDisplayRegistry,
    getProjectAudioDirectory,
    getSoloOutputIds,
    isTrustedWebContents,
    isShuttingDown,
    listMissingMediaItems,
    openShowConfigPath,
    pickVisualFiles,
    promptUnsavedChangesIfNeeded,
    resolveRelinkPickerPath,
    broadcastSoloOutputIds,
    scheduleShowConfigAutoSave,
    setShowExplicitDirty,
    setSoloOutputIds,
    shouldAutoSaveTransport,
    showOpenDialog,
    showSaveDialog,
    streamEngine,
  } = options;
  const displayRegistry = getDisplayRegistry();
  attachShellModalIpcHandlers();
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

  ipcMain.handle('director:update-global-state', (_event, update: GlobalStateUpdate) => {
    const state = director.updateGlobalState(update);
    if (update.performanceMode !== undefined) {
      mergeAppControlSettings(app.getPath('userData'), { performanceMode: update.performanceMode });
    }
    return state;
  });

  ipcMain.handle('visual:choose-files', async () => {
    const items = await pickVisualFiles(['openFile', 'multiSelections']);
    return items?.map((item) => item.path) ?? [];
  });

  ipcMain.handle('media-pool:choose-import-files', async () => {
    const result = await showOpenDialog({
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All supported media', extensions: allMediaPoolImportDialogExtensions() },
        { name: 'Visual media', extensions: [...VISUAL_IMPORT_EXTENSIONS] },
        { name: 'Audio', extensions: [...AUDIO_FILE_IMPORT_EXTENSIONS] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle('media-pool:classify-import-paths', (_event, filePaths: string[]) => classifyMediaPoolPathsOnDisk(filePaths));

  ipcMain.handle('visual:import-files', async (_event, payload: MediaPoolImportFilesPayload) => {
    const items = createDroppedVisualImportItems(payload.filePaths);
    if (items.length === 0) {
      return [];
    }
    let toAdd: VisualImportItem[] = items;
    if (payload.mode === 'copy') {
      if (!currentShowConfigPathRef.value) {
        throw new Error('No show is open.');
      }
      const destPaths = await copyFilesIntoProjectAssets(
        currentShowConfigPathRef.value,
        items.map((item) => item.path),
        'visual',
      );
      toAdd = destPaths.map((destination) => createVisualImportItem(destination));
    }
    const visuals = director.addVisuals(toAdd);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visuals;
  });

  ipcMain.handle('visual:update', (_event, visualId: string, update: VisualUpdate) => {
    const visual = director.updateVisual(visualId, update);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visual;
  });

  ipcMain.handle('visual:replace', async (_event, visualId: string) => {
    const items = await pickVisualFiles(['openFile']);
    if (!items?.[0]) {
      return undefined;
    }
    const visual = director.replaceVisual(visualId, items[0]);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visual;
  });

  ipcMain.handle('visual:clear', (_event, visualId: string) => {
    const visual = director.clearVisual(visualId);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visual;
  });

  ipcMain.handle('visual:remove', (_event, visualId: string) => {
    director.removeVisual(visualId);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return true;
  });

  ipcMain.handle('visual:metadata', (_event, report: VisualMetadataReport) => {
    const state = director.updateVisualMetadata(report);
    streamEngine.refreshMediaDurations();
    return state;
  });

  ipcMain.handle('live-capture:list-desktop-sources', () => capturePermissions.listDesktopCaptureSources());

  ipcMain.handle('live-capture:create', (_event, request: LiveCaptureCreate) => {
    const visual = director.addLiveVisual(request.label, request.capture);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visual;
  });

  ipcMain.handle('live-capture:update', (_event, visualId: string, capture: LiveVisualCaptureConfig) => {
    const visual = director.updateLiveVisualCapture(visualId, capture);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return visual;
  });

  ipcMain.handle('live-capture:prepare-display-stream', (event, visualId: string, sourceId?: string) => {
    if (!isTrustedWebContents(event.sender)) {
      return false;
    }
    capturePermissions.queuePendingDisplayMediaGrant(event.sender.id, { visualId, sourceId });
    return true;
  });

  ipcMain.handle('live-capture:release-display-stream', (event, visualId: string) => {
    capturePermissions.releasePendingDisplayMediaGrant(event.sender.id, visualId);
  });

  ipcMain.handle('live-capture:permission-status', () => capturePermissions.getLivePermissionStatus());

  ipcMain.handle('audio-source:choose-file', async () => {
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
    return result.filePaths[0];
  });

  ipcMain.handle('audio-source:import-files', async (_event, payload: MediaPoolImportFilesPayload) => {
    const paths = createDroppedAudioFilePaths(payload.filePaths);
    if (paths.length === 0) {
      return [];
    }
    let pathsToAdd = paths;
    if (payload.mode === 'copy') {
      if (!currentShowConfigPathRef.value) {
        throw new Error('No show is open.');
      }
      pathsToAdd = await copyFilesIntoProjectAssets(currentShowConfigPathRef.value, paths, 'audio');
    }
    const sources: AudioSourceState[] = [];
    for (const filePath of pathsToAdd) {
      sources.push(director.addAudioFileSource(filePath, toRendererFileUrl(filePath)));
    }
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
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
    streamEngine.refreshMediaDurations();
    return source;
  });

  ipcMain.handle('audio-source:add-embedded', (_event, visualId: string, mode?: EmbeddedAudioExtractionMode) => {
    const source = director.addEmbeddedAudioSource(visualId, mode ?? 'representation');
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return source;
  });

  ipcMain.handle('audio-source:extract-embedded', async (_event, visualId: string, format?: AudioExtractionFormat) => {
    const source = await extractEmbeddedAudioToFile(
      {
        director,
        getProjectAudioDirectory,
        onExtractionStateChanged: () => {
          scheduleShowConfigAutoSave();
          streamEngine.refreshMediaDurations();
        },
      },
      visualId,
      format ?? director.getState().audioExtractionFormat,
    );
    return source;
  });

  ipcMain.handle('audio-source:update', (_event, audioSourceId: string, update: AudioSourceUpdate) => {
    const source = director.updateAudioSource(audioSourceId, update);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return source;
  });

  ipcMain.handle('audio-source:clear', (_event, audioSourceId: string) => {
    const source = director.clearAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return source;
  });

  ipcMain.handle('audio-source:remove', (_event, audioSourceId: string) => {
    director.removeAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return true;
  });

  ipcMain.handle('audio-source:split-stereo', (_event, audioSourceId: string) => {
    const sources = director.splitStereoAudioSource(audioSourceId);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return sources;
  });

  ipcMain.handle('audio-source:metadata', (_event, report: AudioMetadataReport) => {
    const state = director.updateAudioMetadata(report);
    streamEngine.refreshMediaDurations();
    return state;
  });

  ipcMain.handle('audio-source:read-file-buffer', async (_event, url: string): Promise<ArrayBuffer | undefined> => {
    if (typeof url !== 'string' || !url.startsWith('file:')) {
      return undefined;
    }
    const data = await fs.promises.readFile(fileURLToPath(url));
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });

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
    const controlWindow = getControlWindow();
    if (controlWindow && !controlWindow.isDestroyed() && !controlWindow.webContents.isDestroyed()) {
      controlWindow.webContents.send('audio:meter-lanes', report);
    }
  });

  ipcMain.handle('audio:set-solo-output-ids', (_event, outputIds: VirtualOutputId[]) => {
    setSoloOutputIds(outputIds);
  });

  ipcMain.handle('audio:subcue-preview', (_event, command: AudioSubCuePreviewCommand) => {
    const audioWindow = getAudioWindow();
    if (audioWindow && !audioWindow.isDestroyed() && !audioWindow.webContents.isDestroyed()) {
      audioWindow.webContents.send('audio:subcue-preview-command', command);
    }
  });

  ipcMain.handle('audio:subcue-preview-position', (_event, position: AudioSubCuePreviewPosition) => {
    const controlWindow = getControlWindow();
    if (controlWindow && !controlWindow.isDestroyed() && !controlWindow.webContents.isDestroyed()) {
      controlWindow.webContents.send('audio:subcue-preview-position', position);
    }
  });

  ipcMain.handle('output:remove', (_event, outputId: string) => {
    director.removeVirtualOutput(outputId);
    setSoloOutputIds(getSoloOutputIds());
    scheduleShowConfigAutoSave();
    return true;
  });

  ipcMain.handle('show:prompt-unsaved-if-needed', (_event, kind: ShowUnsavedPromptKind) =>
    promptUnsavedChangesIfNeeded(kind),
  );

  ipcMain.handle('show:save', async (): Promise<ShowConfigOperationResult> => {
    currentShowConfigPathRef.value ??= getDefaultShowConfigPath(app.getPath('userData'));
    await ensureShowProjectStructure(currentShowConfigPathRef.value);
    await writeShowConfig(currentShowConfigPathRef.value, createPersistedShowForDisk());
    cancelPendingAutosaveWithoutFlush();
    setShowExplicitDirty(false);
    return { state: director.getState(), filePath: currentShowConfigPathRef.value, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle('show:save-as', async (): Promise<ShowConfigOperationResult | undefined> => {
    const result = await showSaveDialog({
      title: 'Save Xtream show config',
      defaultPath: currentShowConfigPathRef.value ?? getDefaultShowConfigPath(app.getPath('documents')),
      filters: [{ name: 'Xtream Show Config', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }
    currentShowConfigPathRef.value = result.filePath;
    await ensureShowProjectStructure(currentShowConfigPathRef.value);
    await writeShowConfig(currentShowConfigPathRef.value, createPersistedShowForDisk());
    cancelPendingAutosaveWithoutFlush();
    setShowExplicitDirty(false);
    await addRecentShow(app.getPath('userData'), currentShowConfigPathRef.value);
    return { state: director.getState(), filePath: currentShowConfigPathRef.value, issues: validateRuntimeState(director.getState()) };
  });

  ipcMain.handle(
    'show:create-project',
    async (_event, opts?: ShowDiskActionIpcOpts): Promise<ShowConfigOperationResult | undefined> => {
      if (!opts?.skipUnsavedPrompt && !(await promptUnsavedChangesIfNeeded('create'))) {
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
      await addRecentShow(app.getPath('userData'), currentShowConfigPathRef.value!);
      return { state: director.getState(), filePath: currentShowConfigPathRef.value, issues: validateRuntimeState(director.getState()) };
    },
  );

  ipcMain.handle('show:media-validation-issues', (): MediaValidationIssue[] => {
    return validateShowConfigMedia(createPersistedShowForDisk(), currentShowConfigPathRef.value ?? undefined);
  });

  ipcMain.handle('show:list-missing-media', (): MissingMediaListItem[] => {
    return listMissingMediaItems();
  });

  ipcMain.handle('show:relink-missing-media', async (_event, payload: MissingMediaRelinkPayload): Promise<DirectorState> => {
    const assetKind: 'visual' | 'audio' = payload.kind === 'visual' ? 'visual' : 'audio';
    const finalPath = await resolveRelinkPickerPath(payload.sourcePath, payload.mode, assetKind);
    applyResolvedRelink(payload, finalPath);
    scheduleShowConfigAutoSave();
    streamEngine.refreshMediaDurations();
    return director.getState();
  });

  ipcMain.handle('show:choose-batch-relink-directory', async (): Promise<string | undefined> => {
    const result = await showOpenDialog({
      title: 'Choose folder containing missing media',
      properties: ['openDirectory'],
    });
    return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0];
  });

  ipcMain.handle(
    'show:batch-relink-from-directory',
    async (_event, payload: BatchMissingMediaRelinkPayload): Promise<BatchMissingMediaRelinkResult> => {
      const dir = path.resolve(payload.directory);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(dir);
      } catch {
        throw new Error(`Not a directory: ${dir}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${dir}`);
      }
      let missing = listMissingMediaItems();
      if (payload.onlyIds && payload.onlyIds.length > 0) {
        const allow = new Set(payload.onlyIds);
        missing = missing.filter((m) => allow.has(m.id));
      }
      const relinkedIds: string[] = [];
      const notFoundFilenames: string[] = [];
      for (const item of missing) {
        const candidate = path.join(dir, item.filename);
        if (!fs.existsSync(candidate)) {
          notFoundFilenames.push(item.filename);
          continue;
        }
        const assetKind: 'visual' | 'audio' = item.kind === 'visual' ? 'visual' : 'audio';
        const finalPath = await resolveRelinkPickerPath(candidate, payload.mode, assetKind);
        applyResolvedRelink(
          { kind: item.kind, id: item.id, sourcePath: candidate, mode: payload.mode },
          finalPath,
        );
        relinkedIds.push(item.id);
      }
      if (relinkedIds.length > 0) {
        scheduleShowConfigAutoSave();
        streamEngine.refreshMediaDurations();
      }
      return { relinkedIds, notFoundFilenames };
    },
  );

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

  ipcMain.handle('show:get-current-path', (): string | undefined => currentShowConfigPathRef.value);

  ipcMain.handle(
    'show:open-default',
    async (_event, opts?: ShowDiskActionIpcOpts): Promise<ShowConfigOperationResult | undefined> => {
      const defaultShowPath = getDefaultShowConfigPath(app.getPath('userData'));
      if (!opts?.skipUnsavedPrompt && !(await promptUnsavedChangesIfNeeded('openDefault'))) {
        return undefined;
      }
      if (!fs.existsSync(defaultShowPath)) {
        await createEmptyShowProject(defaultShowPath);
      }
      return openShowConfigPath(defaultShowPath);
    },
  );

  ipcMain.handle(
    'show:open-recent',
    async (_event, filePath: string, opts?: ShowDiskActionIpcOpts): Promise<ShowConfigOperationResult | undefined> => {
      if (!fs.existsSync(filePath)) {
        await readRecentShows(app.getPath('userData'));
        return undefined;
      }
      if (!opts?.skipUnsavedPrompt && !(await promptUnsavedChangesIfNeeded('openRecent'))) {
        return undefined;
      }
      return openShowConfigPath(filePath);
    },
  );

  ipcMain.handle('show:update-settings', (_event, update: ShowSettingsUpdate) => {
    const state = director.updateShowSettings(update);
    scheduleShowConfigAutoSave();
    return state;
  });

  ipcMain.handle('app-control:merge-settings', (_event, patch: Partial<AppControlSettingsV1>) => {
    const merged = mergeAppControlSettings(app.getPath('userData'), patch);
    return director.applyPersistedAppControlSettings(merged);
  });

  ipcMain.handle(
    'show:choose-embedded-audio-import',
    async (_event, candidates: EmbeddedAudioImportCandidate[]): Promise<EmbeddedAudioImportChoice> => {
      const { payload, resolveChoice } = buildEmbeddedAudioImportPrompt(candidates);
      const responseIndex = await promptShellChoiceModal(payload, getControlWindow);
      return resolveChoice(responseIndex);
    },
  );

  ipcMain.handle(
    'show:open',
    async (_event, opts?: ShowDiskActionIpcOpts): Promise<ShowConfigOperationResult | undefined> => {
      if (!opts?.skipUnsavedPrompt && !(await promptUnsavedChangesIfNeeded('open'))) {
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
    },
  );

  ipcMain.handle('controlUi:get-for-path', (_event, filePath: string) => getControlUiStateForPath(app.getPath('userData'), filePath));

  ipcMain.handle('controlUi:save-snapshot', (_event, filePath: string, snapshot: ControlProjectUiStateV1) => {
    saveControlUiStateForPath(app.getPath('userData'), filePath, snapshot);
  });

  ipcMain.handle(
    'show:export-diagnostics',
    async (_event, attach?: DiagnosticsExportAttachPayload): Promise<string | undefined> => {
      const result = await showSaveDialog({
        title: 'Export Xtream diagnostics',
        defaultPath: path.join(app.getPath('documents'), `xtream-diagnostics-${Date.now()}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return undefined;
      }
      await writeJsonFile(
        result.filePath,
        createDiagnosticsReport(director.getState(), app.getVersion(), XTREAM_RUNTIME_VERSION, attach),
      );
      return result.filePath;
    },
  );

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

  ipcMain.handle('display:flash-identify-labels', (_event, durationMs?: number) => {
    displayRegistry?.flashIdentifyLabels(durationMs);
  });

  ipcMain.handle('renderer:ready', (_event, report: RendererReadyReport) => {
    if (isShuttingDown()) {
      return;
    }
    if (report.kind === 'audio') {
      director.markAudioRendererReady();
      broadcastSoloOutputIds();
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
    if (!isShuttingDown()) {
      director.ingestDrift(report);
    }
  });

  ipcMain.handle('renderer:preview-status', (_event, report: PreviewStatus) => {
    if (!isShuttingDown()) {
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
