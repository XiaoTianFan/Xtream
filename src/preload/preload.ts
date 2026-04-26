import { contextBridge, ipcRenderer } from 'electron';
import type {
  DirectorEventName,
  DirectorState,
  AudioCapabilitiesReport,
  AudioMetadataReport,
  AudioRoutingState,
  AudioSinkSelection,
  DisplayCreateOptions,
  DisplayMonitorInfo,
  DisplayUpdate,
  DisplayWindowState,
  DriftReport,
  ModePresetResult,
  PlaybackMode,
  RendererReadyReport,
  ShowConfigOperationResult,
  SlotId,
  SlotMetadataReport,
  SlotState,
  TransportCommand,
} from '../shared/types';

const DIRECTOR_EVENTS = new Set<DirectorEventName>(['director:state']);

const api = {
  director: {
    getState: (): Promise<DirectorState> => ipcRenderer.invoke('director:get-state'),
    setMode: (mode: PlaybackMode): Promise<DirectorState> => ipcRenderer.invoke('director:set-mode', mode),
    applyModePreset: (mode: PlaybackMode): Promise<ModePresetResult> =>
      ipcRenderer.invoke('director:apply-mode-preset', mode),
    transport: (command: TransportCommand): Promise<DirectorState> =>
      ipcRenderer.invoke('director:transport', command),
    onState: (callback: (state: DirectorState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: DirectorState) => callback(state);
      ipcRenderer.on('director:state', listener);
      return () => ipcRenderer.removeListener('director:state', listener);
    },
  },
  displays: {
    create: (options?: DisplayCreateOptions): Promise<DisplayWindowState> =>
      ipcRenderer.invoke('display:create', options),
    update: (id: string, update: DisplayUpdate): Promise<DisplayWindowState> =>
      ipcRenderer.invoke('display:update', id, update),
    close: (id: string): Promise<boolean> => ipcRenderer.invoke('display:close', id),
    listMonitors: (): Promise<DisplayMonitorInfo[]> => ipcRenderer.invoke('display:list-monitors'),
    reopen: (id: string): Promise<DisplayWindowState> => ipcRenderer.invoke('display:reopen', id),
  },
  slots: {
    pickVideo: (slotId: SlotId): Promise<SlotState | undefined> => ipcRenderer.invoke('slot:pick-video', slotId),
    clearVideo: (slotId: SlotId): Promise<SlotState> => ipcRenderer.invoke('slot:clear-video', slotId),
    reportMetadata: (report: SlotMetadataReport): Promise<DirectorState> =>
      ipcRenderer.invoke('slot:metadata', report),
  },
  audio: {
    pickFile: (): Promise<AudioRoutingState | undefined> => ipcRenderer.invoke('audio:pick-file'),
    clearFile: (): Promise<AudioRoutingState> => ipcRenderer.invoke('audio:clear-file'),
    reportMetadata: (report: AudioMetadataReport): Promise<DirectorState> =>
      ipcRenderer.invoke('audio:metadata', report),
    setSink: (selection: AudioSinkSelection): Promise<DirectorState> =>
      ipcRenderer.invoke('audio:set-sink', selection),
    reportCapabilities: (report: AudioCapabilitiesReport): Promise<DirectorState> =>
      ipcRenderer.invoke('audio:capabilities', report),
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
  },
  events: {
    hasDirectorEvent: (eventName: string): boolean => DIRECTOR_EVENTS.has(eventName as DirectorEventName),
  },
};

contextBridge.exposeInMainWorld('xtream', api);

export type XtreamApi = typeof api;
