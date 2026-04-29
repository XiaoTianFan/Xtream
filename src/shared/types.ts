import type { ShowOpenProfileLogEntry } from './showOpenProfile';

export type MediaId = string;
export type VisualId = MediaId;
export type AudioSourceId = MediaId;
export type VirtualOutputId = string;
export type DisplayWindowId = string;

export type VisualMediaType = 'video' | 'image';
export type AudioChannelMode = 'stereo' | 'left' | 'right';
export type EmbeddedAudioExtractionMode = 'representation' | 'file';
export type AudioExtractionFormat = 'm4a' | 'wav';
export type AudioExtractionStatus = 'pending' | 'ready' | 'failed';
export type EmbeddedAudioImportChoice = 'skip' | 'representation' | 'file';
export type EmbeddedAudioImportCandidate = {
  label: string;
  durationSeconds?: number;
};

export type VisualLayoutProfile =
  | { type: 'single'; visualId?: VisualId }
  | { type: 'split'; visualIds: [VisualId | undefined, VisualId | undefined] };

export type LayoutProfile = VisualLayoutProfile;

export type PresetId = 'split-display-one-screen' | 'two-displays';

export type DisplayHealth = 'starting' | 'ready' | 'stale' | 'degraded' | 'closed';

export type DisplayWindowState = {
  id: DisplayWindowId;
  label?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  displayId?: string;
  fullscreen: boolean;
  alwaysOnTop?: boolean;
  layout: VisualLayoutProfile;
  health: DisplayHealth;
  lastDriftSeconds?: number;
  lastFrameRateFps?: number;
  lastPresentedFrameRateFps?: number;
  lastDroppedVideoFrames?: number;
  lastTotalVideoFrames?: number;
  lastMaxVideoFrameGapMs?: number;
  lastMediaSeekCount?: number;
  lastMediaSeekFallbackCount?: number;
  lastMediaSeekDurationMs?: number;
  degradationReason?: string;
};

export type CaptureCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LiveVisualCaptureConfig =
  | {
      source: 'webcam';
      deviceId?: string;
      groupId?: string;
      facingMode?: string;
      label?: string;
      includeAudio?: boolean;
      audioDeviceId?: string;
      revision?: number;
    }
  | {
      source: 'screen';
      sourceId?: string;
      displayId?: string;
      label?: string;
      revision?: number;
    }
  | {
      source: 'screen-region';
      sourceId?: string;
      displayId?: string;
      label?: string;
      crop: CaptureCropRect;
      revision?: number;
    }
  | {
      source: 'window';
      sourceId?: string;
      appName?: string;
      windowName?: string;
      label?: string;
      revision?: number;
    };

export type LiveDesktopSourceSummary = {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId?: string;
  thumbnailDataUrl?: string;
  appIconDataUrl?: string;
};

export type LiveCaptureCreate = {
  label?: string;
  capture: LiveVisualCaptureConfig;
};

type BaseVisualState = {
  id: VisualId;
  label: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasEmbeddedAudio?: boolean;
  previewUrl?: string;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  playbackRate?: number;
  fileSizeBytes?: number;
  ready: boolean;
  error?: string;
};

export type FileVisualState = BaseVisualState & {
  kind: 'file';
  type: VisualMediaType;
  path?: string;
  url?: string;
};

export type LiveVisualState = BaseVisualState & {
  kind: 'live';
  type: 'video';
  capture: LiveVisualCaptureConfig;
  linkedAudioSourceId?: AudioSourceId;
  durationSeconds?: undefined;
  path?: undefined;
  url?: undefined;
};

export type VisualState = FileVisualState | LiveVisualState;

export type AudioSourceState =
  | {
      id: AudioSourceId;
      label: string;
      type: 'external-file';
      path?: string;
      url?: string;
      durationSeconds?: number;
      playbackRate?: number;
      levelDb?: number;
      channelCount?: number;
      channelMode?: AudioChannelMode;
      derivedFromAudioSourceId?: AudioSourceId;
      fileSizeBytes?: number;
      ready: boolean;
      error?: string;
    }
  | {
      id: AudioSourceId;
      label: string;
      type: 'embedded-visual';
      visualId: VisualId;
      extractionMode: EmbeddedAudioExtractionMode;
      extractedPath?: string;
      extractedUrl?: string;
      extractedFormat?: AudioExtractionFormat;
      extractionStatus?: AudioExtractionStatus;
      durationSeconds?: number;
      playbackRate?: number;
      levelDb?: number;
      channelCount?: number;
      channelMode?: AudioChannelMode;
      derivedFromAudioSourceId?: AudioSourceId;
      fileSizeBytes?: number;
      ready: boolean;
      error?: string;
    };

export type VirtualOutputSourceSelection = {
  id?: string;
  audioSourceId: AudioSourceId;
  levelDb: number;
  /** Constant-power pan: -1 = full left, 0 = center, 1 = full right. */
  pan?: number;
  muted?: boolean;
  solo?: boolean;
};

export type MeterLaneState = {
  id: string;
  label: string;
  audioSourceId: AudioSourceId;
  channelIndex: number;
  db: number;
  clipped: boolean;
};

export type OutputMeterReport = {
  outputId: VirtualOutputId;
  lanes: MeterLaneState[];
  peakDb: number;
  reportedAtWallTimeMs: number;
};

export type VirtualOutputState = {
  id: VirtualOutputId;
  label: string;
  sources: VirtualOutputSourceSelection[];
  sinkId?: string;
  sinkLabel?: string;
  busLevelDb: number;
  /** Constant-power bus pan: -1 = full left, 0 = center, 1 = full right. */
  pan?: number;
  muted?: boolean;
  meterDb?: number;
  meterLanes?: MeterLaneState[];
  ready: boolean;
  physicalRoutingAvailable: boolean;
  /** Delays the mixed bus to this physical output (higher = heard later). */
  outputDelaySeconds?: number;
  fallbackAccepted?: boolean;
  fallbackReason?: string;
  error?: string;
};

export type ActiveTimelineState = {
  durationSeconds?: number;
  assignedVideoIds: VisualId[];
  activeAudioSourceIds: AudioSourceId[];
  loopRangeLimit?: { startSeconds: number; endSeconds: number };
  notice?: string;
};

export type PreviewStatus = {
  key: string;
  displayId?: DisplayWindowId;
  visualId?: VisualId;
  ready: boolean;
  error?: string;
  reportedAtWallTimeMs: number;
};

export type LoopState = {
  enabled: boolean;
  startSeconds: number;
  endSeconds?: number;
};

/** Default fade duration (seconds) for global audio mute and display blackout when a show file omits these fields. */
export const SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS = 1;

/** Default max FPS for control-window display preview canvas compositing when a show file omits `controlDisplayPreviewMaxFps`. */
export const DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS = 15;

export type DirectorState = {
  paused: boolean;
  rate: number;
  audioExtractionFormat: AudioExtractionFormat;
  anchorWallTimeMs: number;
  offsetSeconds: number;
  loop: LoopState;
  globalAudioMuted: boolean;
  globalDisplayBlackout: boolean;
  /** Seconds to ramp output bus gain when toggling global audio mute (0 = instant). */
  globalAudioMuteFadeOutSeconds: number;
  /** Seconds for display / preview blackout opacity transition (0 = instant). */
  globalDisplayBlackoutFadeOutSeconds: number;
  /** Runtime-only fade override for the current global audio mute transition. */
  globalAudioMuteFadeOverrideSeconds?: number;
  /** Runtime-only fade override for the current global display blackout transition. */
  globalDisplayBlackoutFadeOverrideSeconds?: number;
  /**
   * Max redraw rate for control-window display preview canvases (file video → canvas path), app-controlled.
   * Typical range 1–60; default when unset is 15.
   */
  controlDisplayPreviewMaxFps: number;
  performanceMode: boolean;
  visuals: Record<VisualId, VisualState>;
  audioSources: Record<AudioSourceId, AudioSourceState>;
  outputs: Record<VirtualOutputId, VirtualOutputState>;
  displays: Record<DisplayWindowId, DisplayWindowState>;
  /** Visual mingle algorithms per display (persist-only; omitted when empty). Derived from persisted show display config in `Director.getState()`. */
  displayVisualMingle?: Partial<Record<DisplayWindowId, NonNullable<PersistedDisplayConfigV8['visualMingle']>>>;
  activeTimeline: ActiveTimelineState;
  /** True after the dedicated audio BrowserWindow renderer invokes `renderer:ready` (IPC). Independent of show load. */
  audioRendererReady: boolean;
  readiness: ShowReadinessState;
  corrections: CorrectionState;
  previews: Record<string, PreviewStatus>;
};

export type ReadinessIssue = {
  severity: 'warning' | 'error';
  target: string;
  message: string;
};

export type ShowReadinessState = {
  ready: boolean;
  checkedAtWallTimeMs: number;
  issues: ReadinessIssue[];
};

export type CorrectionAction = 'none' | 'seek' | 'degraded';

export type RailCorrection = {
  action: CorrectionAction;
  targetSeconds?: number;
  driftSeconds: number;
  issuedAtWallTimeMs: number;
  reason?: string;
  revision: number;
};

export type CorrectionState = {
  audio?: RailCorrection;
  displays: Record<DisplayWindowId, RailCorrection>;
};

export type PersistedFileVisualConfig = Pick<
  FileVisualState,
  'id' | 'label' | 'type' | 'path' | 'opacity' | 'brightness' | 'contrast' | 'playbackRate' | 'fileSizeBytes'
> & { kind?: 'file' };

export type PersistedLiveVisualConfig = Pick<
  LiveVisualState,
  'id' | 'label' | 'kind' | 'type' | 'capture' | 'opacity' | 'brightness' | 'contrast' | 'playbackRate' | 'linkedAudioSourceId'
>;

export type PersistedVisualConfig = PersistedFileVisualConfig | PersistedLiveVisualConfig;

export type PersistedAudioSourceConfig =
  | {
      id: AudioSourceId;
      label: string;
      type: 'external-file';
      path?: string;
      playbackRate?: number;
      levelDb?: number;
      channelCount?: number;
      channelMode?: AudioChannelMode;
      derivedFromAudioSourceId?: AudioSourceId;
      fileSizeBytes?: number;
    }
  | {
      id: AudioSourceId;
      label: string;
      type: 'embedded-visual';
      visualId: VisualId;
      extractionMode?: EmbeddedAudioExtractionMode;
      extractedPath?: string;
      extractedFormat?: AudioExtractionFormat;
      extractionStatus?: AudioExtractionStatus;
      playbackRate?: number;
      levelDb?: number;
      channelCount?: number;
      channelMode?: AudioChannelMode;
      derivedFromAudioSourceId?: AudioSourceId;
      fileSizeBytes?: number;
    };

export type PersistedVirtualOutputConfig = {
  id: VirtualOutputId;
  label: string;
  sources: VirtualOutputSourceSelection[];
  sinkId?: string;
  sinkLabel?: string;
  busLevelDb: number;
  pan?: number;
  muted?: boolean;
  outputDelaySeconds?: number;
  fallbackAccepted?: boolean;
};

export type PersistedDisplayConfig = {
  id?: DisplayWindowId;
  label?: string;
  layout: VisualLayoutProfile;
  fullscreen: boolean;
  alwaysOnTop?: boolean;
  displayId?: string;
  bounds?: DisplayWindowState['bounds'];
};

/** --- Schema v8: Stream workspace (CueStream) --- */

export type StreamId = string;
export type SceneId = string;
export type SubCueId = string;

export type VisualMingleAlgorithm =
  | 'latest'
  | 'alpha-over'
  | 'additive'
  | 'multiply'
  | 'screen'
  | 'lighten'
  | 'darken'
  | 'crossfade';

export type PersistedDisplayConfigV8 = PersistedDisplayConfig & {
  visualMingle?: {
    algorithm: VisualMingleAlgorithm;
    defaultTransitionMs?: number;
  };
};

export type SceneTrigger =
  | { type: 'manual' }
  | { type: 'simultaneous-start'; followsSceneId?: SceneId }
  | { type: 'follow-end'; followsSceneId?: SceneId }
  | { type: 'time-offset'; followsSceneId?: SceneId; offsetMs: number }
  | { type: 'at-timecode'; timecodeMs: number };

export type SceneLoopPolicy =
  | { enabled: false }
  | {
      enabled: true;
      range?: { startMs: number; endMs?: number };
      iterations: { type: 'count'; count: number } | { type: 'infinite' };
    };

export type CurvePoint = {
  timeMs: number;
  value: number;
  interpolation?: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'equal-power';
};

export type FadeSpec = {
  durationMs: number;
  curve?: 'linear' | 'equal-power' | 'log';
};

export type DisplayZoneId = 'single' | 'L' | 'R';

export type VisualDisplayTarget = {
  displayId: DisplayWindowId;
  zoneId?: DisplayZoneId;
};

export type SubCueRef = {
  sceneId: SceneId;
  subCueId: SubCueId;
};

export type PersistedAudioSubCueConfig = {
  id: SubCueId;
  kind: 'audio';
  audioSourceId: AudioSourceId;
  outputIds: VirtualOutputId[];
  startOffsetMs?: number;
  durationOverrideMs?: number;
  loop?: SceneLoopPolicy;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  levelDb?: number;
  pan?: number;
  /** Mirrors virtual output slot mute/solo for Patch routing round-trip through the hidden scene. */
  muted?: boolean;
  solo?: boolean;
  /** Stable Patch routing row id for round-tripping virtual output source assignments. */
  outputSourceSelectionId?: string;
  levelAutomation?: CurvePoint[];
  panAutomation?: CurvePoint[];
  playbackRate?: number;
};

export type PersistedVisualSubCueConfig = {
  id: SubCueId;
  kind: 'visual';
  visualId: VisualId;
  targets: VisualDisplayTarget[];
  startOffsetMs?: number;
  durationOverrideMs?: number;
  loop?: SceneLoopPolicy;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  freezeFrameMs?: number;
  playbackRate?: number;
};

export type PersistedControlSubCueConfig = {
  id: SubCueId;
  kind: 'control';
  startOffsetMs?: number;
  durationOverrideMs?: number;
  action:
    | { type: 'play-scene'; sceneId: SceneId }
    | { type: 'stop-scene'; sceneId: SceneId; fadeOutMs?: number }
    | { type: 'pause-scene'; sceneId: SceneId }
    | { type: 'resume-scene'; sceneId: SceneId }
    | {
        type: 'set-audio-subcue-level';
        subCueRef: SubCueRef;
        targetDb: number;
        durationMs?: number;
        curve?: FadeSpec['curve'];
      }
    | { type: 'set-audio-subcue-pan'; subCueRef: SubCueRef; targetPan: number; durationMs?: number }
    | { type: 'stop-subcue'; subCueRef: SubCueRef; fadeOutMs?: number }
    | { type: 'set-global-audio-muted'; muted: boolean; fadeInMs?: number; fadeOutMs?: number; fadeMs?: number }
    | { type: 'set-global-display-blackout'; blackout: boolean; fadeInMs?: number; fadeOutMs?: number; fadeMs?: number };
};

export type PersistedSubCueConfig = PersistedAudioSubCueConfig | PersistedVisualSubCueConfig | PersistedControlSubCueConfig;

export type PersistedSceneConfig = {
  id: SceneId;
  title?: string;
  note?: string;
  disabled?: boolean;
  trigger: SceneTrigger;
  loop: SceneLoopPolicy;
  preload: {
    enabled: boolean;
    leadTimeMs?: number;
  };
  subCueOrder: SubCueId[];
  subCues: Record<SubCueId, PersistedSubCueConfig>;
  flow?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type PersistedStreamConfig = {
  id: StreamId;
  label: string;
  sceneOrder: SceneId[];
  scenes: Record<SceneId, PersistedSceneConfig>;
  playbackSettings?: StreamPlaybackSettings;
  flowViewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};

export type StreamPausedPlayBehavior = 'selection-aware' | 'preserve-paused-cursor';

export type StreamPlaybackSettings = {
  pausedPlayBehavior: StreamPausedPlayBehavior;
  runningEditOrphanPolicy: 'fade-out' | 'let-finish';
  runningEditOrphanFadeOutMs: number;
};

export type PersistedPatchSceneProjection = {
  /** Hidden manual Scene used only by the Patch workspace compatibility projection. */
  scene: PersistedSceneConfig;
  migratedFromSchemaVersion?: 7;
};

export type PersistedShowConfigV3 = {
  schemaVersion: 3;
  savedAt: string;
  rate?: number;
  loop: LoopState;
  visuals: Record<VisualId, PersistedVisualConfig>;
  audioSources: Record<AudioSourceId, PersistedAudioSourceConfig>;
  outputs: Record<VirtualOutputId, PersistedVirtualOutputConfig>;
  displays: PersistedDisplayConfig[];
};

export type PersistedShowConfigV4 = Omit<PersistedShowConfigV3, 'schemaVersion'> & {
  schemaVersion: 4;
};

export type PersistedShowConfigV5 = Omit<PersistedShowConfigV4, 'schemaVersion'> & {
  schemaVersion: 5;
  audioExtractionFormat: AudioExtractionFormat;
  globalAudioMuteFadeOutSeconds?: number;
  globalDisplayBlackoutFadeOutSeconds?: number;
};

export type PersistedShowConfigV6 = Omit<PersistedShowConfigV5, 'schemaVersion'> & {
  schemaVersion: 6;
};

export type PersistedShowConfigV7 = Omit<PersistedShowConfigV6, 'schemaVersion'> & {
  schemaVersion: 7;
};

export type PersistedShowConfigV8 = {
  schemaVersion: 8;
  savedAt: string;
  rate?: number;
  audioExtractionFormat: AudioExtractionFormat;
  globalAudioMuteFadeOutSeconds?: number;
  globalDisplayBlackoutFadeOutSeconds?: number;
  /** When omitted, {@link DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS} is used after load. */
  controlDisplayPreviewMaxFps?: number;

  visuals: Record<VisualId, PersistedVisualConfig>;
  audioSources: Record<AudioSourceId, PersistedAudioSourceConfig>;
  outputs: Record<VirtualOutputId, PersistedVirtualOutputConfig>;
  displays: PersistedDisplayConfigV8[];

  stream: PersistedStreamConfig;

  patchCompatibility: PersistedPatchSceneProjection;
};

/** v9: extraction format and display preview FPS moved to {@link AppControlSettingsV1} (machine-local JSON). */
export type PersistedShowConfigV9 = Omit<
  PersistedShowConfigV8,
  'schemaVersion' | 'audioExtractionFormat' | 'controlDisplayPreviewMaxFps'
> & {
  schemaVersion: 9;
};

/** On disk and after migration; v7 kept for migration input only. */
export type PersistedShowConfig = PersistedShowConfigV9;

export type SceneRuntimeState = {
  sceneId: SceneId;
  status: 'disabled' | 'ready' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed' | 'skipped';
  scheduledStartMs?: number;
  startedAtStreamMs?: number;
  endedAtStreamMs?: number;
  progress?: number;
  error?: string;
};

export type StreamTimelineCalculationStatus = 'valid' | 'invalid';

export type StreamTimelineIssue = {
  severity: 'error' | 'warning';
  sceneId?: SceneId;
  subCueId?: SubCueId;
  message: string;
};

export type StreamScheduleEntry = {
  sceneId: SceneId;
  startMs?: number;
  durationMs?: number;
  endMs?: number;
  triggerKnown: boolean;
};

export type CalculatedStreamTimeline = {
  revision: number;
  status: StreamTimelineCalculationStatus;
  entries: Record<SceneId, StreamScheduleEntry>;
  expectedDurationMs?: number;
  calculatedAtWallTimeMs: number;
  issues: StreamTimelineIssue[];
  notice?: string;
};

export type StreamRuntimeAudioSubCue = {
  sceneId: SceneId;
  subCueId: SubCueId;
  audioSourceId: AudioSourceId;
  outputId: VirtualOutputId;
  streamStartMs: number;
  localStartMs: number;
  localEndMs?: number;
  levelDb: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
  playbackRate: number;
  mediaLoop?: LoopState;
  orphaned?: boolean;
  fadeOutStartedWallTimeMs?: number;
  fadeOutDurationMs?: number;
};

export type StreamRuntimeVisualSubCue = {
  sceneId: SceneId;
  subCueId: SubCueId;
  visualId: VisualId;
  target: VisualDisplayTarget;
  streamStartMs: number;
  localStartMs: number;
  localEndMs?: number;
  playbackRate: number;
  mediaLoop?: LoopState;
  orphaned?: boolean;
  fadeOutStartedWallTimeMs?: number;
  fadeOutDurationMs?: number;
};

export type StreamRuntimeState = {
  status: 'idle' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed';
  originWallTimeMs?: number;
  startedWallTimeMs?: number;
  offsetStreamMs?: number;
  pausedAtStreamMs?: number;
  pausedCursorMs?: number;
  selectedSceneIdAtPause?: SceneId;
  currentStreamMs?: number;
  cursorSceneId?: SceneId;
  sceneStates: Record<SceneId, SceneRuntimeState>;
  expectedDurationMs?: number;
  activeAudioSubCues?: StreamRuntimeAudioSubCue[];
  activeVisualSubCues?: StreamRuntimeVisualSubCue[];
  timelineNotice?: string;
};

export type StreamCommand =
  | { type: 'play'; sceneId?: SceneId; source?: 'global' | 'scene-row' | 'flow-card' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'jump-next'; referenceSceneId?: SceneId }
  | { type: 'back-to-first' }
  | { type: 'seek'; timeMs: number };

export type StreamEditCommand =
  | { type: 'update-stream'; label?: string; playbackSettings?: Partial<StreamPlaybackSettings> }
  | { type: 'create-scene'; afterSceneId?: SceneId; trigger?: SceneTrigger }
  | { type: 'update-scene'; sceneId: SceneId; update: Partial<PersistedSceneConfig> }
  | { type: 'duplicate-scene'; sceneId: SceneId }
  | { type: 'remove-scene'; sceneId: SceneId }
  | { type: 'reorder-scenes'; sceneOrder: SceneId[] }
  | {
      type: 'update-subcue';
      sceneId: SceneId;
      subCueId: SubCueId;
      update: Partial<PersistedSubCueConfig>;
    };

export type StreamEnginePublicState = {
  stream: PersistedStreamConfig;
  playbackStream: PersistedStreamConfig;
  runtime: StreamRuntimeState | null;
  editTimeline: CalculatedStreamTimeline;
  playbackTimeline: CalculatedStreamTimeline;
  validationMessages: string[];
};

export type MediaValidationIssue = {
  severity: 'warning' | 'error';
  target: string;
  message: string;
};

export type ShowConfigOperationResult = {
  state: DirectorState;
  filePath?: string;
  issues: MediaValidationIssue[];
  /** Set when the show was opened from disk so the control renderer can correlate profile logs with main. */
  openProfileRunId?: string;
};

export type DiagnosticsReportLogs = {
  /** Show-open checkpoints (main + renderer), same source as Config → profile log. */
  showOpenProfile: ShowOpenProfileLogEntry[];
};

/** Optional structured data attached from the control renderer when exporting diagnostics. */
export type DiagnosticsExportAttachPayload = {
  showOpenProfileLog?: ShowOpenProfileLogEntry[];
};

export type DiagnosticsReport = {
  generatedAt: string;
  appVersion: string;
  runtimeVersion: string;
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  state: DirectorState;
  issues: MediaValidationIssue[];
  readiness: ShowReadinessState;
  logs: DiagnosticsReportLogs;
};

export type RendererKind = 'control' | 'display' | 'audio';

export type RendererReadyReport = {
  kind: RendererKind;
  displayId?: DisplayWindowId;
};

export type DriftReport = {
  kind: RendererKind;
  displayId?: DisplayWindowId;
  observedSeconds: number;
  directorSeconds: number;
  driftSeconds: number;
  frameRateFps?: number;
  presentedFrameRateFps?: number;
  droppedVideoFrames?: number;
  totalVideoFrames?: number;
  maxVideoFrameGapMs?: number;
  mediaSeekCount?: number;
  mediaSeekFallbackCount?: number;
  mediaSeekDurationMs?: number;
  reportedAtWallTimeMs: number;
};

export type DisplayCreateOptions = {
  id?: DisplayWindowId;
  label?: string;
  layout?: VisualLayoutProfile;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  displayId?: string;
  bounds?: DisplayWindowState['bounds'];
};

export type DisplayUpdate = Partial<Pick<DisplayWindowState, 'label' | 'layout' | 'fullscreen' | 'alwaysOnTop' | 'displayId'>> & {
  /** Persisted-only field; stripped before applying to Electron display window state. */
  visualMingle?: PersistedDisplayConfigV8['visualMingle'];
};

export type DisplayMonitorInfo = {
  id: string;
  label: string;
  bounds: NonNullable<DisplayWindowState['bounds']>;
  workArea: NonNullable<DisplayWindowState['bounds']>;
  scaleFactor: number;
  internal: boolean;
};

export type DisplayIdentifyFlashPayload = {
  label: string;
  durationMs: number;
};

export type VisualMetadataReport = {
  visualId: VisualId;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasEmbeddedAudio?: boolean;
  ready: boolean;
  error?: string;
};

export type VisualImportItem = {
  id?: VisualId;
  label?: string;
  type: VisualMediaType;
  path: string;
  url: string;
};

export type AudioMetadataReport = {
  audioSourceId: AudioSourceId;
  durationSeconds?: number;
  channelCount?: number;
  ready: boolean;
  error?: string;
};

export type AudioSourceCreateResult = AudioSourceState | undefined;
export type AudioSourceSplitResult = [AudioSourceState, AudioSourceState];
export type VisualUpdate = Partial<Pick<VisualState, 'label' | 'opacity' | 'brightness' | 'contrast' | 'playbackRate'>>;
export type AudioSourceUpdate = Partial<Pick<AudioSourceState, 'label' | 'playbackRate' | 'levelDb'>>;
export type GlobalStateUpdate = Partial<
  Pick<
    DirectorState,
    | 'globalAudioMuted'
    | 'globalDisplayBlackout'
    | 'globalAudioMuteFadeOverrideSeconds'
    | 'globalDisplayBlackoutFadeOverrideSeconds'
    | 'performanceMode'
  >
>;
/** Fade curves stored in `.xtream-show.json` — not app-wide prefs. */
export type ShowProjectFileSettingsUpdate = Partial<Pick<DirectorState, 'globalAudioMuteFadeOutSeconds' | 'globalDisplayBlackoutFadeOutSeconds'>>;
export type ShowSettingsUpdate = ShowProjectFileSettingsUpdate;

/** Machine-local app JSON (`app-control-settings.json`) excluding version field; used when merging persisted snapshot into {@link DirectorState}. */
export type AppControlRuntimePreferencesUpdate = Partial<Pick<DirectorState, 'audioExtractionFormat' | 'controlDisplayPreviewMaxFps'>>;

export type VirtualOutputUpdate = Partial<
  Pick<
    VirtualOutputState,
    | 'label'
    | 'sources'
    | 'sinkId'
    | 'sinkLabel'
    | 'busLevelDb'
    | 'pan'
    | 'muted'
    | 'outputDelaySeconds'
    | 'fallbackAccepted'
    | 'physicalRoutingAvailable'
    | 'fallbackReason'
    | 'error'
  >
>;
export type VirtualOutputSourceSelectionUpdate = Partial<Pick<VirtualOutputSourceSelection, 'levelDb' | 'pan' | 'muted' | 'solo'>>;

export type AudioCapabilityStatus =
  | 'unknown'
  | 'split-available'
  | 'api-unavailable'
  | 'single-sink'
  | 'duplicate-sink-selection'
  | 'missing-selection';

export type AudioFallbackReason =
  | 'none'
  | 'api-unavailable'
  | 'single-sink'
  | 'duplicate-sink-selection'
  | 'missing-selection';

export type PresetResult = {
  state: DirectorState;
  primaryDisplayId?: DisplayWindowId;
};

export type TransportCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; seconds: number }
  | { type: 'set-rate'; rate: number }
  | { type: 'set-loop'; loop: LoopState };

export type RecentShowEntry = {
  filePath: string;
  displayName: string;
  lastOpenedAt: string;
};

export type LaunchShowData = {
  recentShows: RecentShowEntry[];
  defaultShow: {
    filePath: string;
    exists: boolean;
  };
};

/** App-wide control preferences (userData JSON, not tied to a show file). */
export type AppControlSettingsV1 = {
  v: 1;
  performanceMode: boolean;
  audioExtractionFormat: AudioExtractionFormat;
  controlDisplayPreviewMaxFps: number;
};

/** Per-project persisted control-shell UI (persisted beside app data, keyed by show file path). */
export type ControlSurfaceId = 'patch' | 'stream' | 'performance' | 'config';

export type ControlProjectUiPatchLayout = {
  mediaWidthPx?: number;
  footerHeightPx?: number;
  mixerWidthPx?: number;
  assetPreviewHeightPx?: number;
};

export type ControlProjectUiStreamDetail =
  | { type: 'display'; id: string; returnTab: 'scene' | 'mixer' | 'displays' }
  | { type: 'output'; id: string; returnTab: 'scene' | 'mixer' | 'displays' }
  | { type: 'visual'; id: string; returnTab: 'scene' | 'mixer' | 'displays' }
  | { type: 'audio-source'; id: string; returnTab: 'scene' | 'mixer' | 'displays' };

export type ControlProjectUiStreamState = {
  mode?: 'list' | 'flow';
  bottomTab?: 'scene' | 'mixer' | 'displays';
  selectedSceneId?: string;
  /** Selected panel in Scene Edit: scene-level form vs a specific sub-cue (sceneId aligns with selectedSceneId). */
  sceneEditSelection?: { kind: 'scene' } | { kind: 'subcue'; subCueId: string };
  expandedListSceneIds?: string[];
  layout?: {
    mediaWidthPx?: number;
    bottomHeightPx?: number;
    assetPreviewHeightPx?: number;
  };
  detailPane?: ControlProjectUiStreamDetail;
};

export type ControlProjectUiStateV1 = {
  v: 1;
  activeSurface: ControlSurfaceId;
  patch?: ControlProjectUiPatchLayout;
  stream?: ControlProjectUiStreamState;
};

export type IpcChannels = {
  'director:get-state': () => DirectorState;
  'director:apply-preset': (preset: PresetId) => PresetResult;
  'director:transport': (command: TransportCommand) => DirectorState;
  'director:update-global-state': (update: GlobalStateUpdate) => DirectorState;
  'visual:add': () => VisualState[] | undefined;
  'visual:add-dropped': (filePaths: string[]) => VisualState[];
  'visual:update': (visualId: VisualId, update: VisualUpdate) => VisualState;
  'visual:replace': (visualId: VisualId) => VisualState | undefined;
  'visual:clear': (visualId: VisualId) => VisualState;
  'visual:remove': (visualId: VisualId) => boolean;
  'visual:metadata': (report: VisualMetadataReport) => DirectorState;
  'live-capture:list-desktop-sources': () => LiveDesktopSourceSummary[];
  'live-capture:create': (request: LiveCaptureCreate) => VisualState;
  'live-capture:update': (visualId: VisualId, capture: LiveVisualCaptureConfig) => VisualState;
  'live-capture:prepare-display-stream': (visualId: VisualId, sourceId?: string) => boolean;
  'live-capture:release-display-stream': (visualId: VisualId) => void;
  'live-capture:permission-status': () => Record<string, string>;
  'audio-source:add-file': () => AudioSourceCreateResult;
  'audio-source:add-dropped': (filePaths: string[]) => AudioSourceState[];
  'audio-source:add-embedded': (visualId: VisualId, mode?: EmbeddedAudioExtractionMode) => AudioSourceState;
  'audio-source:extract-embedded': (visualId: VisualId, format?: AudioExtractionFormat) => Promise<AudioSourceState>;
  'audio-source:replace-file': (audioSourceId: AudioSourceId) => AudioSourceCreateResult;
  'audio-source:clear': (audioSourceId: AudioSourceId) => AudioSourceCreateResult;
  'audio-source:update': (audioSourceId: AudioSourceId, update: AudioSourceUpdate) => AudioSourceState;
  'audio-source:remove': (audioSourceId: AudioSourceId) => boolean;
  'audio-source:split-stereo': (audioSourceId: AudioSourceId) => AudioSourceSplitResult;
  'audio-source:metadata': (report: AudioMetadataReport) => DirectorState;
  'output:create': () => VirtualOutputState;
  'output:update': (outputId: VirtualOutputId, update: VirtualOutputUpdate) => VirtualOutputState;
  'output:add-source': (outputId: VirtualOutputId, audioSourceId: AudioSourceId) => VirtualOutputState;
  'output:update-source': (outputId: VirtualOutputId, selectionId: string, update: VirtualOutputSourceSelectionUpdate) => VirtualOutputState;
  'output:remove-source': (outputId: VirtualOutputId, selectionId: string) => VirtualOutputState;
  'output:meter': (report: OutputMeterReport) => VirtualOutputState;
  'audio:meter-report': (report: OutputMeterReport) => void;
  'audio:set-solo-output-ids': (outputIds: VirtualOutputId[]) => void;
  'output:remove': (outputId: VirtualOutputId) => boolean;
  'show:save': () => ShowConfigOperationResult;
  'show:save-as': () => ShowConfigOperationResult | undefined;
  'show:create-project': () => ShowConfigOperationResult | undefined;
  'show:get-launch-data': () => LaunchShowData;
  'show:open-default': () => ShowConfigOperationResult | undefined;
  'show:open-recent': (filePath: string) => ShowConfigOperationResult | undefined;
  'show:update-settings': (update: ShowSettingsUpdate) => DirectorState;
  'app-control:merge-settings': (patch: Partial<Pick<DirectorState, 'performanceMode' | 'audioExtractionFormat' | 'controlDisplayPreviewMaxFps'>>) => DirectorState;
  'show:choose-embedded-audio-import': (candidates: EmbeddedAudioImportCandidate[]) => Promise<EmbeddedAudioImportChoice>;
  'show:open': () => ShowConfigOperationResult | undefined;
  'show:export-diagnostics': (attach?: DiagnosticsExportAttachPayload) => string | undefined;
  'display:create': (options?: DisplayCreateOptions) => DisplayWindowState;
  'display:update': (id: DisplayWindowId, update: DisplayUpdate) => DisplayWindowState;
  'display:close': (id: DisplayWindowId) => boolean;
  'display:remove': (id: DisplayWindowId) => boolean;
  'display:list-monitors': () => DisplayMonitorInfo[];
  'display:reopen': (id: DisplayWindowId) => DisplayWindowState;
  'display:flash-identify-labels': (durationMs?: number) => void;
  'renderer:ready': (report: RendererReadyReport) => void;
  'renderer:drift': (report: DriftReport) => void;
  'renderer:preview-status': (report: PreviewStatus) => void;
  'stream:get-state': () => StreamEnginePublicState;
  'stream:edit': (command: StreamEditCommand) => StreamEnginePublicState;
  'stream:transport': (command: StreamCommand) => StreamEnginePublicState;
  'controlUi:get-for-path': (filePath: string) => ControlProjectUiStateV1 | undefined;
  'controlUi:save-snapshot': (filePath: string, snapshot: ControlProjectUiStateV1) => void;
};

export type DirectorEventName = 'director:state';
export type StreamEventName = 'stream:state';
