import type { SurfaceController } from '../app/surfaceRouter';
import type { ShowActions } from '../app/showActions';
import type {
  ControlProjectUiStreamState,
  DirectorState,
  DisplayMonitorInfo,
  OutputMeterReport,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
  VirtualOutputId,
} from '../../../shared/types';

/** Which editor is visible in Scene Edit bottom tab: scene defaults vs one sub-cue. */
export type SceneEditSelection =
  | { kind: 'scene' }
  | { kind: 'subcue'; sceneId: SceneId; subCueId: SubCueId };

export type StreamMode = 'list' | 'flow';

export type BottomTab = 'scene' | 'mixer' | 'displays';

export type DetailPane =
  | { type: 'display'; id: string; returnTab: BottomTab }
  | { type: 'output'; id: string; returnTab: BottomTab }
  | { type: 'visual'; id: string; returnTab: BottomTab }
  | { type: 'audio-source'; id: string; returnTab: BottomTab };

export type StreamSurfaceRefs = Partial<Record<string, HTMLElement>>;

export type StreamSurfaceOptions = {
  getAudioDevices: () => MediaDeviceInfo[];
  getDisplayMonitors: () => DisplayMonitorInfo[];
  getPresentationState: () => DirectorState | undefined;
  getEngineSoloOutputIds: () => VirtualOutputId[];
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  showActions: ShowActions;
  getShowConfigPath: () => string | undefined;
};

export type StreamSurfaceController = SurfaceController & {
  handleWorkspaceTransportKeydown: (event: KeyboardEvent) => boolean;
  applyOutputMeterReport: (report: OutputMeterReport) => void;
  applyEngineSoloOutputIds: (outputIds: VirtualOutputId[]) => void;
  tickMixerBallistics: () => void;
  syncPreviewElements: (presentation: DirectorState) => void;
  exportProjectUiSnapshot: () => ControlProjectUiStreamState;
  applyImportedProjectUi: (
    snapshot: ControlProjectUiStreamState | undefined,
    directorState: DirectorState,
    streamPublic: StreamEnginePublicState,
  ) => void;
  /** Apply persisted stream layout CSS when the surface is mounted (Patch↔Stream pane sync). */
  applyStoredTwinLayoutPrefs: (prefs: { mediaWidthPx?: number; bottomHeightPx?: number; assetPreviewHeightPx?: number }) => void;
};
