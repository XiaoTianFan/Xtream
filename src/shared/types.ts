export type PlaybackMode = 1 | 2 | 3;

export type SlotId = string;

export type DisplayWindowId = string;

export type AudioOutputPath = 'main' | 'left' | 'right';

export type AudioSourceMode = 'none' | 'external-file' | 'embedded-slot';

export type LayoutProfile =
  | { type: 'single'; slot: SlotId }
  | { type: 'split'; slots: [SlotId, SlotId] };

export type DisplayHealth = 'starting' | 'ready' | 'stale' | 'degraded' | 'closed';

export type DisplayWindowState = {
  id: DisplayWindowId;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  displayId?: string;
  fullscreen: boolean;
  layout: LayoutProfile;
  health: DisplayHealth;
  lastDriftSeconds?: number;
  degradationReason?: string;
};

export type SlotState = {
  id: SlotId;
  videoPath?: string;
  videoUrl?: string;
  durationSeconds?: number;
  ready: boolean;
  error?: string;
};

export type AudioRoutingState = {
  sourceMode: AudioSourceMode;
  path?: string;
  url?: string;
  embeddedSlotId?: SlotId;
  sinkId?: string;
  sinkLabel?: string;
  leftSinkId?: string;
  leftSinkLabel?: string;
  rightSinkId?: string;
  rightSinkLabel?: string;
  durationSeconds?: number;
  ready: boolean;
  error?: string;
  lastDriftSeconds?: number;
  degraded?: boolean;
  degradationReason?: string;
  physicalSplitAvailable: boolean;
  fallbackAccepted: boolean;
  capabilityStatus?: AudioCapabilityStatus;
  fallbackReason?: AudioFallbackReason;
};

export type LoopState = {
  enabled: boolean;
  startSeconds: number;
  endSeconds?: number;
};

export type DirectorState = {
  paused: boolean;
  rate: number;
  anchorWallTimeMs: number;
  offsetSeconds: number;
  durationPolicy: 'audio' | 'longest-video';
  durationSeconds?: number;
  loop: LoopState;
  mode: PlaybackMode;
  slots: Record<SlotId, SlotState>;
  audio: AudioRoutingState;
  displays: Record<DisplayWindowId, DisplayWindowState>;
  readiness: ShowReadinessState;
  corrections: CorrectionState;
};

export type ReadinessTarget =
  | 'audio'
  | 'audio:mode3'
  | 'duration'
  | 'display'
  | 'loop'
  | `slot:${SlotId}`
  | `display:${DisplayWindowId}`;

export type ReadinessIssue = {
  severity: 'warning' | 'error';
  target: ReadinessTarget | string;
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

export type PersistedSlotConfig = {
  id: SlotId;
  videoPath?: string;
};

export type PersistedAudioConfig = {
  sourceMode?: AudioSourceMode;
  path?: string;
  embeddedSlotId?: SlotId;
  sinkId?: string;
  sinkLabel?: string;
  leftSinkId?: string;
  leftSinkLabel?: string;
  rightSinkId?: string;
  rightSinkLabel?: string;
  fallbackAccepted: boolean;
};

export type PersistedDisplayConfig = {
  layout: LayoutProfile;
  fullscreen: boolean;
  displayId?: string;
  bounds?: DisplayWindowState['bounds'];
};

export type PersistedShowConfig = {
  schemaVersion: 1;
  savedAt: string;
  mode: PlaybackMode;
  rate?: number;
  durationPolicy: DirectorState['durationPolicy'];
  loop: LoopState;
  slots: PersistedSlotConfig[];
  audio: PersistedAudioConfig;
  displays: PersistedDisplayConfig[];
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
};

export type DiagnosticsReport = {
  generatedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  state: DirectorState;
  issues: MediaValidationIssue[];
  readiness: ShowReadinessState;
};

export type RendererKind = 'control' | 'display';

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
  reportedAtWallTimeMs: number;
};

export type DisplayCreateOptions = {
  layout?: LayoutProfile;
  fullscreen?: boolean;
  displayId?: string;
};

export type DisplayUpdate = Partial<Pick<DisplayWindowState, 'layout' | 'fullscreen' | 'displayId'>>;

export type DisplayMonitorInfo = {
  id: string;
  label: string;
  bounds: NonNullable<DisplayWindowState['bounds']>;
  workArea: NonNullable<DisplayWindowState['bounds']>;
  scaleFactor: number;
  internal: boolean;
};

export type SlotMetadataReport = {
  slotId: SlotId;
  durationSeconds?: number;
  ready: boolean;
  error?: string;
};

export type AudioMetadataReport = {
  durationSeconds?: number;
  ready: boolean;
  error?: string;
};

export type AudioSinkSelection = {
  path: AudioOutputPath;
  sinkId?: string;
  sinkLabel?: string;
};

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

export type AudioCapabilitiesReport = {
  physicalSplitAvailable: boolean;
  fallbackAccepted?: boolean;
  capabilityStatus?: AudioCapabilityStatus;
  fallbackReason?: AudioFallbackReason;
};

export type EmbeddedAudioSelection = {
  slotId?: SlotId;
};

export type ModePresetResult = {
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

export type IpcChannels = {
  'director:get-state': () => DirectorState;
  'director:set-mode': (mode: PlaybackMode) => DirectorState;
  'director:apply-mode-preset': (mode: PlaybackMode) => ModePresetResult;
  'director:transport': (command: TransportCommand) => DirectorState;
  'slot:pick-video': (slotId: SlotId) => SlotState | undefined;
  'slot:clear-video': (slotId: SlotId) => SlotState;
  'slot:metadata': (report: SlotMetadataReport) => DirectorState;
  'audio:pick-file': () => AudioRoutingState | undefined;
  'audio:clear-file': () => AudioRoutingState;
  'audio:set-embedded-source': (selection: EmbeddedAudioSelection) => AudioRoutingState;
  'audio:metadata': (report: AudioMetadataReport) => DirectorState;
  'audio:set-sink': (selection: AudioSinkSelection) => DirectorState;
  'audio:capabilities': (report: AudioCapabilitiesReport) => DirectorState;
  'show:save': () => ShowConfigOperationResult;
  'show:save-as': () => ShowConfigOperationResult | undefined;
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
};

export type DirectorEventName = 'director:state';
