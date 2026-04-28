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
  performanceMode: boolean;
  visuals: Record<VisualId, VisualState>;
  audioSources: Record<AudioSourceId, AudioSourceState>;
  outputs: Record<VirtualOutputId, VirtualOutputState>;
  displays: Record<DisplayWindowId, DisplayWindowState>;
  activeTimeline: ActiveTimelineState;
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

export type PersistedShowConfig = PersistedShowConfigV7;

export type MediaValidationIssue = {
  severity: 'warning' | 'error';
  target: string;
  message: string;
};

export type ShowConfigOperationResult = {
  state: DirectorState;
  filePath?: string;
  issues: MediaValidationIssue[];
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

export type DisplayUpdate = Partial<Pick<DisplayWindowState, 'label' | 'layout' | 'fullscreen' | 'alwaysOnTop' | 'displayId'>>;

export type DisplayMonitorInfo = {
  id: string;
  label: string;
  bounds: NonNullable<DisplayWindowState['bounds']>;
  workArea: NonNullable<DisplayWindowState['bounds']>;
  scaleFactor: number;
  internal: boolean;
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
export type GlobalStateUpdate = Partial<Pick<DirectorState, 'globalAudioMuted' | 'globalDisplayBlackout' | 'performanceMode'>>;
/** Fields persisted in the show project file (`.xtream-show.json`), not application-wide preferences. */
export type ShowProjectFileSettingsUpdate = Partial<
  Pick<DirectorState, 'audioExtractionFormat' | 'globalAudioMuteFadeOutSeconds' | 'globalDisplayBlackoutFadeOutSeconds'>
>;
export type ShowSettingsUpdate = ShowProjectFileSettingsUpdate;

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
  'output:meter': (report: OutputMeterReport) => VirtualOutputState;
  'audio:meter-report': (report: OutputMeterReport) => void;
  'audio:set-solo-output-ids': (outputIds: VirtualOutputId[]) => void;
  'output:remove': (outputId: VirtualOutputId) => boolean;
  'show:save': () => ShowConfigOperationResult;
  'show:save-as': () => ShowConfigOperationResult | undefined;
  'show:create-project': () => ShowConfigOperationResult | undefined;
  'show:get-launch-data': () => LaunchShowData;
  'show:open-default': () => ShowConfigOperationResult;
  'show:open-recent': (filePath: string) => ShowConfigOperationResult | undefined;
  'show:update-settings': (update: ShowSettingsUpdate) => DirectorState;
  'show:choose-embedded-audio-import': (candidates: EmbeddedAudioImportCandidate[]) => Promise<EmbeddedAudioImportChoice>;
  'show:open': () => ShowConfigOperationResult | undefined;
  'show:export-diagnostics': () => string | undefined;
  'display:create': (options?: DisplayCreateOptions) => DisplayWindowState;
  'display:update': (id: DisplayWindowId, update: DisplayUpdate) => DisplayWindowState;
  'display:close': (id: DisplayWindowId) => boolean;
  'display:remove': (id: DisplayWindowId) => boolean;
  'display:list-monitors': () => DisplayMonitorInfo[];
  'display:reopen': (id: DisplayWindowId) => DisplayWindowState;
  'renderer:ready': (report: RendererReadyReport) => void;
  'renderer:drift': (report: DriftReport) => void;
  'renderer:preview-status': (report: PreviewStatus) => void;
};

export type DirectorEventName = 'director:state';
