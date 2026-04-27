import { contextBridge, ipcRenderer } from 'electron';
import type {
  AudioMetadataReport,
  AudioSourceId,
  AudioSourceState,
  AudioSourceUpdate,
  DirectorEventName,
  DirectorState,
  DisplayCreateOptions,
  DisplayMonitorInfo,
  DisplayUpdate,
  DisplayWindowState,
  DriftReport,
  GlobalStateUpdate,
  PreviewStatus,
  PresetId,
  PresetResult,
  RendererReadyReport,
  ShowConfigOperationResult,
  TransportCommand,
  VisualId,
  VisualMetadataReport,
  VisualState,
  VisualUpdate,
  VirtualOutputId,
  VirtualOutputState,
  VirtualOutputUpdate,
} from '../shared/types';

const DIRECTOR_EVENTS = new Set<DirectorEventName>(['director:state']);

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
  audioSources: {
    addFile: (): Promise<AudioSourceState | undefined> => ipcRenderer.invoke('audio-source:add-file'),
    addEmbedded: (visualId: VisualId): Promise<AudioSourceState> => ipcRenderer.invoke('audio-source:add-embedded', visualId),
    replaceFile: (audioSourceId: AudioSourceId): Promise<AudioSourceState | undefined> =>
      ipcRenderer.invoke('audio-source:replace-file', audioSourceId),
    clear: (audioSourceId: AudioSourceId): Promise<AudioSourceState | undefined> => ipcRenderer.invoke('audio-source:clear', audioSourceId),
    update: (audioSourceId: AudioSourceId, update: AudioSourceUpdate): Promise<AudioSourceState> =>
      ipcRenderer.invoke('audio-source:update', audioSourceId, update),
    remove: (audioSourceId: AudioSourceId): Promise<boolean> => ipcRenderer.invoke('audio-source:remove', audioSourceId),
    reportMetadata: (report: AudioMetadataReport): Promise<DirectorState> => ipcRenderer.invoke('audio-source:metadata', report),
  },
  outputs: {
    create: (): Promise<VirtualOutputState> => ipcRenderer.invoke('output:create'),
    update: (outputId: VirtualOutputId, update: VirtualOutputUpdate): Promise<VirtualOutputState> =>
      ipcRenderer.invoke('output:update', outputId, update),
    reportMeter: (outputId: VirtualOutputId, meterDb: number): Promise<VirtualOutputState> => ipcRenderer.invoke('output:meter', outputId, meterDb),
    remove: (outputId: VirtualOutputId): Promise<boolean> => ipcRenderer.invoke('output:remove', outputId),
  },
  show: {
    save: (): Promise<ShowConfigOperationResult> => ipcRenderer.invoke('show:save'),
    saveAs: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:save-as'),
    open: (): Promise<ShowConfigOperationResult | undefined> => ipcRenderer.invoke('show:open'),
    exportDiagnostics: (): Promise<string | undefined> => ipcRenderer.invoke('show:export-diagnostics'),
  },
  renderer: {
    ready: (report: RendererReadyReport): Promise<void> => ipcRenderer.invoke('renderer:ready', report),
    reportDrift: (report: DriftReport): Promise<void> => ipcRenderer.invoke('renderer:drift', report),
    reportPreviewStatus: (report: PreviewStatus): Promise<void> => ipcRenderer.invoke('renderer:preview-status', report),
  },
  events: {
    hasDirectorEvent: (eventName: string): boolean => DIRECTOR_EVENTS.has(eventName as DirectorEventName),
  },
};

contextBridge.exposeInMainWorld('xtream', api);

export type XtreamApi = typeof api;
