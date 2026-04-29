import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ShowOpenProfileLogEntry } from '../shared/showOpenProfile';
import type {
  AudioMetadataReport,
  AudioExtractionFormat,
  EmbeddedAudioImportCandidate,
  AudioSourceId,
  AudioSourceSplitResult,
  AudioSourceState,
  AudioSourceUpdate,
  DirectorEventName,
  DirectorState,
  DisplayCreateOptions,
  DisplayIdentifyFlashPayload,
  DisplayMonitorInfo,
  DisplayUpdate,
  DisplayWindowState,
  DriftReport,
  EmbeddedAudioImportChoice,
  GlobalStateUpdate,
  LiveCaptureCreate,
  LiveDesktopSourceSummary,
  LiveVisualCaptureConfig,
  PreviewStatus,
  OutputMeterReport,
  PresetId,
  PresetResult,
  ControlProjectUiStateV1,
  DiagnosticsExportAttachPayload,
  LaunchShowData,
  MediaValidationIssue,
  RendererReadyReport,
  ShowSettingsUpdate,
  ShowConfigOperationResult,
  StreamCommand,
  StreamEditCommand,
  StreamEnginePublicState,
  StreamEventName,
  TransportCommand,
  VisualId,
  VisualMetadataReport,
  VisualState,
  VisualUpdate,
  VirtualOutputId,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputState,
  VirtualOutputUpdate,
} from '../shared/types';

const DIRECTOR_EVENTS = new Set<DirectorEventName>(['director:state']);
const STREAM_EVENTS = new Set<StreamEventName>(['stream:state']);

const api = {
  director: {
    getState: (): Promise<DirectorState> => ipcRenderer.invoke('director:get-state'),
    applyPreset: (preset: PresetId): Promise<PresetResult> => ipcRenderer.invoke('director:apply-preset', preset),
    transport: (command: TransportCommand): Promise<DirectorState> => ipcRenderer.invoke('director:transport', command),
    updateGlobalState: (update: GlobalStateUpdate): Promise<DirectorState> => ipcRenderer.invoke('director:update-global-state', update),
    onState: (callback: (state: DirectorState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: DirectorState) => callback(state);
      ipcRenderer.on('director:state', listener);
      return () => ipcRenderer.removeListener('director:state', listener);
    },
  },
  displays: {
    create: (options?: DisplayCreateOptions): Promise<DisplayWindowState> => ipcRenderer.invoke('display:create', options),
    update: (id: string, update: DisplayUpdate): Promise<DisplayWindowState> => ipcRenderer.invoke('display:update', id, update),
    close: (id: string): Promise<boolean> => ipcRenderer.invoke('display:close', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('display:remove', id),
    listMonitors: (): Promise<DisplayMonitorInfo[]> => ipcRenderer.invoke('display:list-monitors'),
    reopen: (id: string): Promise<DisplayWindowState> => ipcRenderer.invoke('display:reopen', id),
    flashIdentifyLabels: (durationMs?: number): Promise<void> => ipcRenderer.invoke('display:flash-identify-labels', durationMs),
    onIdentifyFlash: (callback: (payload: DisplayIdentifyFlashPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: DisplayIdentifyFlashPayload) => callback(payload);
      ipcRenderer.on('display:identify-flash', listener);
      return () => ipcRenderer.removeListener('display:identify-flash', listener);
    },
  },
  visuals: {
    add: (): Promise<VisualState[] | undefined> => ipcRenderer.invoke('visual:add'),
    addDropped: (filePaths: string[]): Promise<VisualState[]> => ipcRenderer.invoke('visual:add-dropped', filePaths),
    update: (visualId: VisualId, update: VisualUpdate): Promise<VisualState> => ipcRenderer.invoke('visual:update', visualId, update),
    replace: (visualId: VisualId): Promise<VisualState | undefined> => ipcRenderer.invoke('visual:replace', visualId),
    clear: (visualId: VisualId): Promise<VisualState> => ipcRenderer.invoke('visual:clear', visualId),
    remove: (visualId: VisualId): Promise<boolean> => ipcRenderer.invoke('visual:remove', visualId),
    reportMetadata: (report: VisualMetadataReport): Promise<DirectorState> => ipcRenderer.invoke('visual:metadata', report),
  },
  liveCapture: {
    listDesktopSources: (): Promise<LiveDesktopSourceSummary[]> => ipcRenderer.invoke('live-capture:list-desktop-sources'),
    create: (request: LiveCaptureCreate): Promise<VisualState> => ipcRenderer.invoke('live-capture:create', request),
    update: (visualId: VisualId, capture: LiveVisualCaptureConfig): Promise<VisualState> =>
      ipcRenderer.invoke('live-capture:update', visualId, capture),
    prepareDisplayStream: (visualId: VisualId, sourceId?: string): Promise<boolean> =>
      ipcRenderer.invoke('live-capture:prepare-display-stream', visualId, sourceId),
    releaseDisplayStream: (visualId: VisualId): Promise<void> => ipcRenderer.invoke('live-capture:release-display-stream', visualId),
    permissionStatus: (): Promise<Record<string, string>> => ipcRenderer.invoke('live-capture:permission-status'),
  },
  audioSources: {
    addFile: (): Promise<AudioSourceState | undefined> => ipcRenderer.invoke('audio-source:add-file'),
    addDropped: (filePaths: string[]): Promise<AudioSourceState[]> => ipcRenderer.invoke('audio-source:add-dropped', filePaths),
    addEmbedded: (visualId: VisualId, mode?: 'representation' | 'file'): Promise<AudioSourceState> =>
      ipcRenderer.invoke('audio-source:add-embedded', visualId, mode),
    extractEmbedded: (visualId: VisualId, format?: AudioExtractionFormat): Promise<AudioSourceState> =>
      ipcRenderer.invoke('audio-source:extract-embedded', visualId, format),
    replaceFile: (audioSourceId: AudioSourceId): Promise<AudioSourceState | undefined> =>
      ipcRenderer.invoke('audio-source:replace-file', audioSourceId),
    clear: (audioSourceId: AudioSourceId): Promise<AudioSourceState | undefined> => ipcRenderer.invoke('audio-source:clear', audioSourceId),
    update: (audioSourceId: AudioSourceId, update: AudioSourceUpdate): Promise<AudioSourceState> =>
      ipcRenderer.invoke('audio-source:update', audioSourceId, update),
    remove: (audioSourceId: AudioSourceId): Promise<boolean> => ipcRenderer.invoke('audio-source:remove', audioSourceId),
    splitStereo: (audioSourceId: AudioSourceId): Promise<AudioSourceSplitResult> => ipcRenderer.invoke('audio-source:split-stereo', audioSourceId),
    reportMetadata: (report: AudioMetadataReport): Promise<DirectorState> => ipcRenderer.invoke('audio-source:metadata', report),
  },
  outputs: {
    create: (): Promise<VirtualOutputState> => ipcRenderer.invoke('output:create'),
    update: (outputId: VirtualOutputId, update: VirtualOutputUpdate): Promise<VirtualOutputState> =>
      ipcRenderer.invoke('output:update', outputId, update),
    addSource: (outputId: VirtualOutputId, audioSourceId: AudioSourceId): Promise<VirtualOutputState> =>
      ipcRenderer.invoke('output:add-source', outputId, audioSourceId),
    updateSource: (outputId: VirtualOutputId, selectionId: string, update: VirtualOutputSourceSelectionUpdate): Promise<VirtualOutputState> =>
      ipcRenderer.invoke('output:update-source', outputId, selectionId, update),
    removeSource: (outputId: VirtualOutputId, selectionId: string): Promise<VirtualOutputState> =>
      ipcRenderer.invoke('output:remove-source', outputId, selectionId),
    reportMeter: (report: OutputMeterReport): Promise<VirtualOutputState> => ipcRenderer.invoke('output:meter', report),
    remove: (outputId: VirtualOutputId): Promise<boolean> => ipcRenderer.invoke('output:remove', outputId),
  },
  audioRuntime: {
    setSoloOutputIds: (outputIds: VirtualOutputId[]): Promise<void> => ipcRenderer.invoke('audio:set-solo-output-ids', outputIds),
    reportMeter: (report: OutputMeterReport): Promise<void> => ipcRenderer.invoke('audio:meter-report', report),
    onMeterLanes: (callback: (report: OutputMeterReport) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, report: OutputMeterReport) => callback(report);
      ipcRenderer.on('audio:meter-lanes', listener);
      return () => ipcRenderer.removeListener('audio:meter-lanes', listener);
    },
    onSoloOutputIds: (callback: (outputIds: VirtualOutputId[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, outputIds: VirtualOutputId[]) => callback(outputIds);
      ipcRenderer.on('audio:solo-output-ids', listener);
      return () => ipcRenderer.removeListener('audio:solo-output-ids', listener);
    },
  },
  stream: {
    getState: (): Promise<StreamEnginePublicState> => ipcRenderer.invoke('stream:get-state'),
    edit: (command: StreamEditCommand): Promise<StreamEnginePublicState> => ipcRenderer.invoke('stream:edit', command),
    transport: (command: StreamCommand): Promise<StreamEnginePublicState> => ipcRenderer.invoke('stream:transport', command),
    onState: (callback: (state: StreamEnginePublicState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: StreamEnginePublicState) => callback(state);
      ipcRenderer.on('stream:state', listener);
      return () => ipcRenderer.removeListener('stream:state', listener);
    },
  },
  show: {
    save: (): Promise<ShowConfigOperationResult> => ipcRenderer.invoke('show:save'),
    saveAs: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:save-as'),
    createProject: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:create-project'),
    getLaunchData: (): Promise<LaunchShowData> => ipcRenderer.invoke('show:get-launch-data'),
    openDefault: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:open-default'),
    openRecent: (filePath: string): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:open-recent', filePath),
    updateSettings: (update: ShowSettingsUpdate): Promise<DirectorState> => ipcRenderer.invoke('show:update-settings', update),
    chooseEmbeddedAudioImport: (candidates: EmbeddedAudioImportCandidate[]): Promise<EmbeddedAudioImportChoice> =>
      ipcRenderer.invoke('show:choose-embedded-audio-import', candidates),
    open: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:open'),
    exportDiagnostics: (attach?: DiagnosticsExportAttachPayload): Promise<string | undefined> =>
      ipcRenderer.invoke('show:export-diagnostics', attach),
    getMediaValidationIssues: (): Promise<MediaValidationIssue[]> => ipcRenderer.invoke('show:media-validation-issues'),
  },
  controlUi: {
    getForPath: (filePath: string): Promise<ControlProjectUiStateV1 | undefined> => ipcRenderer.invoke('controlUi:get-for-path', filePath),
    saveSnapshot: (filePath: string, snapshot: ControlProjectUiStateV1): Promise<void> =>
      ipcRenderer.invoke('controlUi:save-snapshot', filePath, snapshot),
  },
  showOpenProfile: {
    onLog: (callback: (entry: ShowOpenProfileLogEntry) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: ShowOpenProfileLogEntry) => callback(entry);
      ipcRenderer.on('show-open-profile:log', listener);
      return () => ipcRenderer.removeListener('show-open-profile:log', listener);
    },
  },
  renderer: {
    ready: (report: RendererReadyReport): Promise<void> => ipcRenderer.invoke('renderer:ready', report),
    reportDrift: (report: DriftReport): Promise<void> => ipcRenderer.invoke('renderer:drift', report),
    reportPreviewStatus: (report: PreviewStatus): Promise<void> => ipcRenderer.invoke('renderer:preview-status', report),
  },
  events: {
    hasDirectorEvent: (eventName: string): boolean => DIRECTOR_EVENTS.has(eventName as DirectorEventName),
    hasStreamEvent: (eventName: string): boolean => STREAM_EVENTS.has(eventName as StreamEventName),
  },
  platform: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('xtream', api);

export type XtreamApi = typeof api;
