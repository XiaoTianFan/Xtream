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
} from '../../../shared/types';

/** Which editor is visible in Scene Edit bottom tab: scene defaults vs one sub-cue. */
export type SceneEditSelection =
  | { kind: 'scene' }
  | { kind: 'subcue'; sceneId: SceneId; subCueId: SubCueId };

export type StreamMode = 'list' | 'flow';

export type BottomTab = 'scene' | 'mixer' | 'displays';

export type DetailPane =
  | { type: 'display'; id: string; returnTab: BottomTab }
  | { type: 'output'; id: string; returnTab: BottomTab };

export type StreamSurfaceRefs = Partial<Record<string, HTMLElement>>;

export type StreamSurfaceOptions = {
  getAudioDevices: () => MediaDeviceInfo[];
  getDisplayMonitors: () => DisplayMonitorInfo[];
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  showActions: ShowActions;
};

export type StreamSurfaceController = SurfaceController & {
  applyOutputMeterReport: (report: OutputMeterReport) => void;
  syncPreviewElements: () => void;
  exportProjectUiSnapshot: () => ControlProjectUiStreamState;
  applyImportedProjectUi: (
    snapshot: ControlProjectUiStreamState | undefined,
    directorState: DirectorState,
    streamPublic: StreamEnginePublicState,
  ) => void;
};
