/// <reference path="./global.d.ts" />
import './display.css';
import { describeLayout, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds, getMediaEffectiveTime } from '../shared/timeline';
import { mapElapsedToLoopPhase, resolveLoopTiming } from '../shared/streamLoopTiming';
import {
  mapElapsedToSubCuePassPhase,
  mapPassElapsedToMediaElapsed,
  resolveSubCuePassLoopTiming,
} from '../shared/subCuePassLoopTiming';
import type {
  DirectorState,
  DisplayWindowState,
  DisplayZoneId,
  LoopState,
  RuntimeSubCueTiming,
  StreamEnginePublicState,
  VisualId,
  VisualLayoutProfile,
  VisualMetadataReport,
  VisualSubCuePreviewCommand,
  VisualSubCuePreviewPayload,
  VisualState,
} from '../shared/types';
import { createPlaybackSyncKey, getMediaSyncState, syncTimedMediaElement } from './control/media/mediaSync';
import { hasEmbeddedAudioTrack } from './control/media/mediaMetadata';
import { attachLiveVisualStream, reportLiveVisualError } from './control/media/liveCaptureRuntime';
import { buildStreamDisplayFrames, deriveDirectorStateForStream, type StreamDisplayFrame, type StreamDisplayLayer } from './streamProjection';
import { formatDisplayWindowTitle } from '../shared/displayWindowTitle';
import { evaluateVisualSubCueOpacity } from '../shared/visualSubCueTiming';

const root = document.querySelector<HTMLDivElement>('#displayRoot');
const params = new URLSearchParams(window.location.search);
const displayId = params.get('id') ?? 'unknown-display';
const showDiagnosticsOverlay = params.get('diagnostics') === '1';
const debugDisplayRefresh =
  showDiagnosticsOverlay ||
  params.get('debugDisplay') === '1' ||
  params.get('displayDebug') === '1' ||
  readDisplayDebugFlag();
document.title = formatDisplayWindowTitle({ id: displayId });

let currentRenderSignature = '';
let currentState: DirectorState | undefined;
let latestDirectorState: DirectorState | undefined;
let currentStreamState: StreamEnginePublicState | undefined;
let currentDirectorSeconds = 0;
let driftTimer: number | undefined;
let syncTimer: number | undefined;
let frameCounter = 0;
let lastFrameSampleMs = performance.now();
let lastFrameRateFps: number | undefined;
let mediaSeekCount = 0;
let mediaSeekFallbackCount = 0;
let lastMediaSeekDurationMs: number | undefined;
const appliedCorrectionRevisions = new Set<number>();
const videoElements = new Map<VisualId, HTMLVideoElement>();
const liveVisualCleanups = new Map<VisualId, () => void>();
const liveFreezeCanvases = new WeakMap<HTMLVideoElement, HTMLCanvasElement>();
const videoFrameStats = new WeakMap<HTMLVideoElement, VideoFrameStats>();
const DISPLAY_SYNC_INTERVAL_MS = 500;
const DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS = 0.5;
const SYNC_KEY_SEEK_THRESHOLD_SECONDS = 0.12;

type RenderMode = 'patch' | 'stream' | 'missing';
type DisplayDebugDetail = Record<string, unknown>;

type VideoPlaybackQualitySnapshot = {
  totalVideoFrames?: number;
  droppedVideoFrames?: number;
  corruptedVideoFrames?: number;
};

type FrameTrackedVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  getVideoPlaybackQuality?: () => VideoPlaybackQualitySnapshot;
};

type VideoFrameStats = {
  presentedFrames: number;
  samplePresentedFrames: number;
  sampleWallTimeMs: number;
  maxFrameGapMs: number;
  lastFrameWallTimeMs?: number;
  presentedFrameRateFps?: number;
};

if (!root) {
  throw new Error('Missing display root.');
}

const displayRoot = root;

const identifyOverlay = document.querySelector<HTMLElement>('#displayIdentifyOverlay');
let identifyHideTimer: number | undefined;
let currentRenderMode: RenderMode | undefined;
let currentStreamZoneSignature = '';
let lastBlackoutState: boolean | undefined;
let lastStreamDebugSignature = '';
let lastDriftDebugSignature = '';

type VisualPreviewRuntime = {
  payload: VisualSubCuePreviewPayload;
  targetZones: Set<DisplayZoneId>;
  playing: boolean;
  paused: boolean;
  anchorLocalTimeMs: number;
  anchorWallTimeMs?: number;
  localTimeMs: number;
  sourceTimeMs?: number;
  lastReportWallTimeMs?: number;
  completed?: boolean;
};

const visualPreviewRuntimes = new Map<string, VisualPreviewRuntime>();
let visualPreviewRoot: HTMLElement | undefined;
let visualPreviewFrame: number | undefined;

function readDisplayDebugFlag(): boolean {
  try {
    return window.localStorage?.getItem('xtream:display-debug') === '1';
  } catch {
    return false;
  }
}

function rounded(value: number | undefined, digits = 3): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function debugDisplay(event: string, detail: DisplayDebugDetail = {}): void {
  if (!debugDisplayRefresh) {
    return;
  }
  console.debug(`[xtream-display:${displayId}] ${event}`, {
    displayId,
    event,
    renderMode: currentRenderMode,
    t: Math.round(performance.now()),
    ...detail,
  });
}

function summarizeStreamLayer(layer: StreamDisplayLayer): DisplayDebugDetail {
  return {
    layerId: layer.layerId,
    sourceVisualId: layer.sourceVisualId,
    timelineId: layer.timelineId,
    timelineKind: layer.timelineKind,
    timelineOrderIndex: layer.timelineOrderIndex,
    threadOrderIndex: layer.threadOrderIndex,
    runtimeInstanceId: layer.runtimeInstanceId,
    sceneId: layer.sceneId,
    subCueId: layer.subCueId,
    zoneId: layer.zoneId,
    streamStartMs: rounded(layer.streamStartMs, 1),
    localStartMs: rounded(layer.localStartMs, 1),
    absoluteStartMs: rounded(layer.absoluteStartMs, 1),
    selected: layer.selected,
    opacity: rounded(layer.opacity),
    visualKind: layer.visual.kind,
    visualType: layer.visual.type,
    url: layer.visual.kind === 'live' ? undefined : layer.visual.url,
    runtimeOffsetSeconds: rounded(layer.visual.runtimeOffsetSeconds),
    playbackRate: rounded(layer.visual.playbackRate),
    mediaSignature: streamLayerMediaSignature(layer),
  };
}

function summarizeStreamRuntime(): DisplayDebugDetail {
  const runtime = currentStreamState?.runtime;
  const timelines = Object.values(runtime?.timelineInstances ?? {}).map((timeline) => ({
    id: timeline.id,
    kind: timeline.kind,
    status: timeline.status,
    cursorMs: rounded(timeline.cursorMs, 1),
    offsetMs: rounded(timeline.offsetMs, 1),
    pausedAtMs: rounded(timeline.pausedAtMs, 1),
    threadCount: timeline.orderedThreadInstanceIds.length,
  }));
  return {
    runtimeStatus: runtime?.status,
    currentStreamMs: rounded(runtime?.currentStreamMs, 1),
    activeVisualCueCount: runtime?.activeVisualSubCues?.length ?? 0,
    activeAudioCueCount: runtime?.activeAudioSubCues?.length ?? 0,
    timelineCount: timelines.length,
    timelines,
  };
}

function summarizeStreamFrame(frame: StreamDisplayFrame): DisplayDebugDetail {
  return {
    displayId: frame.displayId,
    layout: frame.layout.type,
    mode: frame.mode,
    algorithm: frame.algorithm,
    transitionMs: frame.transitionMs,
    zones: frame.zones.map((zone) => ({
      zoneId: zone.zoneId,
      layerCount: zone.layers.length,
      selectedLayerIds: zone.layers.filter((layer) => layer.selected).map((layer) => layer.layerId),
    })),
    selectedLayers: frame.zones.flatMap((zone) => zone.layers.filter((layer) => layer.selected).map(summarizeStreamLayer)),
    ...summarizeStreamRuntime(),
  };
}

function logStreamFrameIfChanged(frame: StreamDisplayFrame): void {
  if (!debugDisplayRefresh) {
    return;
  }
  const signature = createStreamFrameRenderSignature(frame);
  if (signature === lastStreamDebugSignature) {
    return;
  }
  debugDisplay('stream-frame-change', {
    signature,
    previousSignature: lastStreamDebugSignature || undefined,
    ...summarizeStreamFrame(frame),
  });
  lastStreamDebugSignature = signature;
}

function replaceDisplayRoot(reason: string, detail: DisplayDebugDetail = {}): void {
  debugDisplay('root-replace', {
    reason,
    childCount: displayRoot.childElementCount,
    videoCount: videoElements.size,
    liveVisualCount: liveVisualCleanups.size,
    streamZoneSignature: currentStreamZoneSignature || undefined,
    renderSignature: currentRenderSignature || undefined,
    ...detail,
  });
  cleanupRenderedMedia();
  displayRoot.replaceChildren();
}

function applyBlackoutState(blackedOut: boolean): void {
  displayRoot.classList.toggle('blacked-out', blackedOut);
  if (lastBlackoutState === blackedOut) {
    return;
  }
  debugDisplay('blackout-change', {
    blackedOut,
    previous: lastBlackoutState,
  });
  lastBlackoutState = blackedOut;
}

function setupIdentifyFlashOverlay(): (() => void) | undefined {
  if (!identifyOverlay) {
    return undefined;
  }
  return window.xtream.displays.onIdentifyFlash((payload) => {
    if (identifyHideTimer !== undefined) {
      window.clearTimeout(identifyHideTimer);
    }
    identifyOverlay.textContent = payload.label;
    identifyOverlay.hidden = false;
    identifyOverlay.setAttribute('aria-hidden', 'false');
    const ms = payload.durationMs > 0 ? payload.durationMs : 3000;
    identifyHideTimer = window.setTimeout(() => {
      identifyOverlay.hidden = true;
      identifyOverlay.setAttribute('aria-hidden', 'true');
      identifyHideTimer = undefined;
    }, ms);
  });
}

const unsubscribeIdentifyFlash = setupIdentifyFlashOverlay();

function cleanupMediaForVisualId(visualId: VisualId): void {
  const hadLiveCleanup = liveVisualCleanups.has(visualId);
  const hadVideo = videoElements.has(visualId);
  if (hadLiveCleanup || hadVideo) {
    debugDisplay('media-cleanup-visual', { visualId, hadLiveCleanup, hadVideo });
  }
  const cleanup = liveVisualCleanups.get(visualId);
  if (cleanup) {
    cleanup();
    liveVisualCleanups.delete(visualId);
  }
  videoElements.delete(visualId);
}

function cleanupMediaInElement(element: Element): void {
  const ids = new Set<VisualId>();
  if (element instanceof HTMLElement && element.dataset.visualId) {
    ids.add(element.dataset.visualId);
  }
  for (const child of element.querySelectorAll<HTMLElement>('[data-visual-id]')) {
    if (child.dataset.visualId) {
      ids.add(child.dataset.visualId);
    }
  }
  for (const id of ids) {
    cleanupMediaForVisualId(id);
  }
}

function cleanupRenderedMedia(): void {
  if (liveVisualCleanups.size > 0 || videoElements.size > 0) {
    debugDisplay('media-cleanup-all', {
      liveVisualCount: liveVisualCleanups.size,
      videoCount: videoElements.size,
    });
  }
  for (const cleanup of liveVisualCleanups.values()) {
    cleanup();
  }
  liveVisualCleanups.clear();
  videoElements.clear();
}

function renderLayout(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): void {
  displayRoot.className = layout.type === 'split' ? 'display-root split' : 'display-root';
  replaceDisplayRoot('patch-layout', {
    layout: describeLayout(layout),
    visualIds: getLayoutVisualIds(layout),
  });
  currentRenderMode = 'patch';
  currentStreamZoneSignature = '';
  for (const visualId of getLayoutVisualIds(layout)) {
    displayRoot.append(createVisualElement(visualId, visualsById[visualId]));
  }
}

function renderStreamFrame(frame: StreamDisplayFrame): void {
  logStreamFrameIfChanged(frame);
  displayRoot.className = frame.layout.type === 'split' ? 'display-root split stream-frame' : 'display-root stream-frame';
  const zoneIds = frame.layout.type === 'split' ? (['L', 'R'] as const) : (['single'] as const);
  const zoneSignature = `${frame.displayId}:${frame.layout.type}:${zoneIds.join('|')}`;
  if (currentRenderMode !== 'stream' || currentStreamZoneSignature !== zoneSignature) {
    replaceDisplayRoot('stream-zone-layout', {
      previousMode: currentRenderMode,
      previousZoneSignature: currentStreamZoneSignature || undefined,
      nextZoneSignature: zoneSignature,
      ...summarizeStreamFrame(frame),
    });
    currentRenderMode = 'stream';
    currentStreamZoneSignature = zoneSignature;
    for (const zoneId of zoneIds) {
      const output = document.createElement('section');
      output.className = 'display-output display-output-zone';
      output.dataset.zoneId = zoneId;
      displayRoot.append(output);
    }
  }
  for (const zoneId of zoneIds) {
    const output =
      displayRoot.querySelector<HTMLElement>(`.display-output-zone[data-zone-id="${zoneId}"]`) ??
      document.createElement('section');
    if (!output.isConnected) {
      debugDisplay('stream-zone-output-add', { zoneId, zoneSignature });
      output.className = 'display-output display-output-zone';
      output.dataset.zoneId = zoneId;
      displayRoot.append(output);
    }
    const zone = frame.zones.find((candidate) => candidate.zoneId === zoneId);
    const selectedLayers = (zone?.layers ?? []).filter((layer) => layer.selected);
    reconcileStreamZone(output, zoneId, selectedLayers);
  }
}

function localPreviewTargetZones(payload: VisualSubCuePreviewPayload): Set<DisplayZoneId> {
  const zones = new Set<DisplayZoneId>();
  for (const target of payload.targets) {
    if (target.displayId === displayId) {
      zones.add(target.zoneId ?? 'single');
    }
  }
  return zones;
}

function handleVisualPreviewCommand(command: VisualSubCuePreviewCommand): void {
  if (command.type === 'play-visual-subcue-preview') {
    const targetZones = localPreviewTargetZones(command.payload);
    if (targetZones.size === 0) {
      return;
    }
    stopVisualPreview(command.payload.previewId, false);
    const localTimeMs = Math.max(0, command.payload.startedAtLocalMs ?? 0);
    visualPreviewRuntimes.set(command.payload.previewId, {
      payload: command.payload,
      targetZones,
      playing: true,
      paused: false,
      anchorLocalTimeMs: localTimeMs,
      anchorWallTimeMs: performance.now(),
      localTimeMs,
    });
    renderVisualPreviewOverlays();
    scheduleVisualPreviewFrame();
    return;
  }

  const runtime = visualPreviewRuntimes.get(command.previewId);
  if (!runtime) {
    return;
  }

  if (command.type === 'pause-visual-subcue-preview') {
    updateVisualPreviewTime(runtime);
    runtime.playing = false;
    runtime.paused = true;
    runtime.anchorWallTimeMs = undefined;
    syncVisualPreviewRuntime(runtime, true);
    renderVisualPreviewOverlays();
    return;
  }

  if (command.type === 'seek-visual-subcue-preview') {
    const nextLocalTimeMs = Math.max(0, command.localTimeMs);
    runtime.localTimeMs = nextLocalTimeMs;
    runtime.sourceTimeMs = command.sourceTimeMs;
    runtime.completed = false;
    runtime.anchorLocalTimeMs = nextLocalTimeMs;
    runtime.anchorWallTimeMs = runtime.playing ? performance.now() : undefined;
    syncVisualPreviewRuntime(runtime, true);
    renderVisualPreviewOverlays();
    scheduleVisualPreviewFrame();
    return;
  }

  stopVisualPreview(command.previewId, true);
}

function ensureVisualPreviewRoot(split: boolean): HTMLElement {
  if (!visualPreviewRoot) {
    visualPreviewRoot = document.createElement('div');
    visualPreviewRoot.className = 'display-preview-root';
    document.body.append(visualPreviewRoot);
  }
  visualPreviewRoot.className = split ? 'display-preview-root split' : 'display-preview-root';
  return visualPreviewRoot;
}

function renderVisualPreviewOverlays(): void {
  const active = [...visualPreviewRuntimes.values()].filter((runtime) => runtime.targetZones.size > 0);
  if (active.length === 0) {
    clearVisualPreviewRoot();
    return;
  }
  const split = active.some((runtime) => runtime.targetZones.has('L') || runtime.targetZones.has('R'));
  const zoneIds: DisplayZoneId[] = split ? ['L', 'R'] : ['single'];
  const root = ensureVisualPreviewRoot(split);
  const wantedZoneIds = new Set(zoneIds);
  for (const child of [...root.children]) {
    const element = child as HTMLElement;
    if (!element.dataset.zoneId || !wantedZoneIds.has(element.dataset.zoneId as DisplayZoneId)) {
      cleanupMediaInElement(element);
      element.remove();
    }
  }

  for (const zoneId of zoneIds) {
    let zone = root.querySelector<HTMLElement>(`.display-preview-zone[data-zone-id="${zoneId}"]`);
    if (!zone) {
      zone = document.createElement('section');
      zone.className = 'display-output display-output-zone display-preview-zone';
      zone.dataset.zoneId = zoneId;
      root.append(zone);
    }
    const runtime = newestPreviewForZone(zoneId);
    reconcileVisualPreviewZone(zone, runtime, zoneId);
  }
}

function newestPreviewForZone(zoneId: DisplayZoneId): VisualPreviewRuntime | undefined {
  let selected: VisualPreviewRuntime | undefined;
  for (const runtime of visualPreviewRuntimes.values()) {
    if (runtime.targetZones.has(zoneId)) {
      selected = runtime;
    }
  }
  return selected;
}

function reconcileVisualPreviewZone(zone: HTMLElement, runtime: VisualPreviewRuntime | undefined, zoneId: DisplayZoneId): void {
  zone.classList.toggle('active', runtime !== undefined);
  if (!runtime) {
    if (zone.childElementCount > 0) {
      cleanupMediaInElement(zone);
      zone.replaceChildren();
    }
    return;
  }
  const previewId = runtime.payload.previewId;
  const mediaSignature = visualPreviewMediaSignature(runtime);
  let layer: HTMLElement | undefined = zone.querySelector<HTMLElement>('.display-preview-layer') ?? undefined;
  if (layer && (layer.dataset.previewId !== previewId || layer.dataset.mediaSignature !== mediaSignature)) {
    cleanupMediaInElement(layer);
    layer.remove();
    layer = undefined;
  }
  if (!layer) {
    layer = createVisualPreviewLayer(runtime, zoneId);
    zone.replaceChildren(layer);
  }
  applyVisualPreviewLayerState(layer, runtime);
  syncVisualPreviewRuntime(runtime, false);
}

function createVisualPreviewLayer(runtime: VisualPreviewRuntime, zoneId: DisplayZoneId): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'display-layer display-preview-layer';
  layer.dataset.previewId = runtime.payload.previewId;
  layer.dataset.layerId = visualPreviewLayerId(runtime.payload.previewId, zoneId);
  layer.dataset.visualId = layer.dataset.layerId;
  layer.dataset.mediaSignature = visualPreviewMediaSignature(runtime);
  layer.style.zIndex = '2147483000';
  appendVisualPreviewMedia(layer, runtime, zoneId);
  const badge = document.createElement('div');
  badge.className = 'display-preview-badge';
  badge.textContent = 'PREVIEW';
  layer.append(badge);
  return layer;
}

function appendVisualPreviewMedia(layer: HTMLElement, runtime: VisualPreviewRuntime, zoneId: DisplayZoneId): void {
  const visual = previewVisualForRuntime(runtime);
  const layerId = visualPreviewLayerId(runtime.payload.previewId, zoneId);
  if (visual.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = layerId;
    applyVisualStyle(video, visual);
    observeVideoFrames(video);
    layer.append(video);
    void attachLiveVisualStream(visual, video, {})
      .then((attachment) => {
        if (layer.isConnected) {
          liveVisualCleanups.set(layerId, attachment.cleanup);
          reportLivePreviewSnapshotWhenReady(visual, video, runtime.localTimeMs);
          reportVisualPreviewStatus(runtime.payload, true);
        } else {
          attachment.cleanup();
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Live visual preview failed.';
        reportLiveVisualError(visual, {}, message);
        reportVisualPreviewStatus(runtime.payload, false, message);
      });
    return;
  }
  if (visual.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    image.addEventListener('load', () => reportVisualPreviewStatus(runtime.payload, true), { once: true });
    image.addEventListener('error', () => reportVisualPreviewStatus(runtime.payload, false, 'Visual sub-cue image preview failed to load.'), { once: true });
    image.src = visual.url;
    layer.append(image);
    return;
  }
  if (visual.url) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.dataset.visualId = layerId;
    applyVisualStyle(video, visual);
    observeVideoFrames(video);
    video.addEventListener(
      'loadedmetadata',
      () => {
        reportVisualPreviewStatus(runtime.payload, true);
        syncVisualPreviewRuntime(runtime, true);
      },
      { once: true },
    );
    video.addEventListener(
      'error',
      () => reportVisualPreviewStatus(runtime.payload, false, video.error?.message ?? 'Visual sub-cue video preview failed to load.'),
      { once: true },
    );
    video.src = visual.url;
    layer.append(video);
    videoElements.set(layerId, video);
    return;
  }
  const visualLabel = document.createElement('span');
  visualLabel.textContent = visual.label;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'preview visual missing media';
  layer.append(visualLabel, visualMeta);
  reportVisualPreviewStatus(runtime.payload, false, 'Visual sub-cue preview media is unavailable.');
}

function previewVisualForRuntime(runtime: VisualPreviewRuntime): VisualState {
  const visual = runtime.payload.visual;
  return {
    ...visual,
    opacity: visual.opacity ?? 1,
    playbackRate: (visual.playbackRate ?? 1) * (runtime.payload.playbackRate ?? 1),
  } as VisualState;
}

function applyVisualPreviewLayerState(layer: HTMLElement, runtime: VisualPreviewRuntime): void {
  const phase = getVisualPreviewPassPhase(runtime.payload, runtime.localTimeMs);
  layer.style.opacity = String(
    evaluateVisualSubCueOpacity({
      localTimeMs: phase?.passElapsedMs ?? runtime.localTimeMs,
      durationMs: phase?.durationMs ?? effectiveVisualPreviewDurationMs(runtime.payload),
      baseOpacity: runtime.payload.visual.opacity ?? 1,
      fadeIn: runtime.payload.fadeIn,
      fadeOut: runtime.payload.fadeOut,
    }),
  );
}

function resolveRuntimeSubCueTiming(timing: RuntimeSubCueTiming) {
  return resolveSubCuePassLoopTiming({
    baseDurationMs: timing.baseDurationMs,
    pass: timing.pass,
    innerLoop: timing.innerLoop,
  });
}

function mapRuntimeSubCueMediaElapsedMs(localMs: number, timing: RuntimeSubCueTiming): { mediaElapsedMs: number; audible: boolean } {
  const resolved = resolveRuntimeSubCueTiming(timing);
  const passLocalMs = Math.max(0, localMs);
  const mapped = mapPassElapsedToMediaElapsed(passLocalMs, resolved);
  return {
    mediaElapsedMs: mapped.mediaElapsedMs,
    audible: resolved.passDurationMs === undefined || passLocalMs < resolved.passDurationMs,
  };
}

function resolveVisualPreviewSubCueTiming(payload: VisualSubCuePreviewPayload) {
  const timing = payload.subCueTiming;
  if (!timing) {
    return undefined;
  }
  return resolveRuntimeSubCueTiming(timing);
}

function getVisualPreviewPassPhase(
  payload: VisualSubCuePreviewPayload,
  localMs: number,
): { passElapsedMs: number; mediaElapsedMs: number; durationMs?: number } | undefined {
  const timing = resolveVisualPreviewSubCueTiming(payload);
  if (!timing) {
    return undefined;
  }
  const phase = mapElapsedToSubCuePassPhase(localMs, timing);
  return {
    passElapsedMs: phase.passElapsedMs,
    mediaElapsedMs: phase.mediaElapsedMs,
    durationMs: timing.passDurationMs,
  };
}

function syncVisualPreviewRuntime(runtime: VisualPreviewRuntime, forceReport: boolean): void {
  updateVisualPreviewTime(runtime);
  const visual = previewVisualForRuntime(runtime);
  const mediaDurationMs = visual.durationSeconds !== undefined ? visual.durationSeconds * 1000 : undefined;
  const sourceTimeMs = runtime.sourceTimeMs ?? sourceTimeMsForVisualPreview(runtime, mediaDurationMs);
  runtime.sourceTimeMs = sourceTimeMs;
  for (const zoneId of runtime.targetZones) {
    const layerId = visualPreviewLayerId(runtime.payload.previewId, zoneId);
    const video = videoElements.get(layerId) ?? findPreviewVideo(layerId);
    if (!video) {
      continue;
    }
    const freezeMs = runtime.payload.freezeFrameMs;
    const freezeClockMs = visual.kind === 'live' ? runtime.localTimeMs : sourceTimeMs;
    const frozen = freezeMs !== undefined && Number.isFinite(freezeMs) && freezeClockMs >= freezeMs;
    if (visual.kind === 'live') {
      if (frozen) {
        freezeLiveVideo(video, visual);
      } else {
        unfreezeLiveVideo(video);
      }
      continue;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const targetSeconds = frozen ? clampFreezeTargetSeconds(freezeMs! / 1000, visual.durationSeconds) : sourceTimeMs / 1000;
      if (Math.abs(video.currentTime - targetSeconds) > 0.08) {
        video.currentTime = targetSeconds;
      }
      video.playbackRate = visual.playbackRate ?? 1;
      if (runtime.playing && !frozen) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }
  applyVisualPreviewLayerStates(runtime);
  reportVisualPreviewPosition(runtime, forceReport);
}

function applyVisualPreviewLayerStates(runtime: VisualPreviewRuntime): void {
  const root = visualPreviewRoot;
  if (!root) {
    return;
  }
  for (const layer of root.querySelectorAll<HTMLElement>(`.display-preview-layer[data-preview-id="${cssEscape(runtime.payload.previewId)}"]`)) {
    applyVisualPreviewLayerState(layer, runtime);
  }
}

function updateVisualPreviewTime(runtime: VisualPreviewRuntime): void {
  if (!runtime.playing || runtime.anchorWallTimeMs === undefined) {
    return;
  }
  runtime.localTimeMs = Math.max(0, runtime.anchorLocalTimeMs + performance.now() - runtime.anchorWallTimeMs);
  runtime.sourceTimeMs = undefined;
  const durationMs = effectiveVisualPreviewDurationMs(runtime.payload);
  const infinite = isInfiniteVisualPreview(runtime.payload);
  if (!infinite && durationMs !== undefined && runtime.localTimeMs >= durationMs) {
    runtime.localTimeMs = durationMs;
    runtime.playing = false;
    runtime.paused = false;
    runtime.completed = true;
    runtime.anchorWallTimeMs = undefined;
  }
}

function sourceTimeMsForVisualPreview(runtime: VisualPreviewRuntime, mediaDurationMs: number | undefined): number {
  const playbackRate = runtime.payload.playbackRate && runtime.payload.playbackRate > 0 ? runtime.payload.playbackRate : 1;
  const sourceStartMs = Math.max(0, runtime.payload.sourceStartMs ?? 0);
  const sourceEndMs = Math.max(sourceStartMs, runtime.payload.sourceEndMs ?? mediaDurationMs ?? sourceStartMs);
  const selectedDurationMs = Math.max(0, sourceEndMs - sourceStartMs);
  const naturalLocalDurationMs = selectedDurationMs > 0 ? selectedDurationMs / playbackRate : mediaDurationMs !== undefined && mediaDurationMs > 0 ? mediaDurationMs / playbackRate : undefined;
  const phase = getVisualPreviewPassPhase(runtime.payload, runtime.localTimeMs);
  if (phase) {
    return Math.max(sourceStartMs, Math.min(sourceEndMs || Number.POSITIVE_INFINITY, sourceStartMs + phase.mediaElapsedMs * playbackRate));
  }
  if (naturalLocalDurationMs === undefined || !runtime.payload.loop?.enabled) {
    return Math.max(sourceStartMs, Math.min(sourceEndMs || Number.POSITIVE_INFINITY, sourceStartMs + runtime.localTimeMs * playbackRate));
  }
  const timing = resolveLoopTiming(runtime.payload.loop, naturalLocalDurationMs);
  if (timing.loopDurationMs <= 0) {
    return sourceStartMs + timing.loopStartMs * playbackRate;
  }
  const phaseMs =
    timing.totalDurationMs !== undefined && runtime.localTimeMs >= timing.totalDurationMs
      ? timing.loopEndMs
      : mapElapsedToLoopPhase(runtime.localTimeMs, timing);
  return Math.max(sourceStartMs, Math.min(sourceEndMs || Number.POSITIVE_INFINITY, sourceStartMs + phaseMs * playbackRate));
}

function effectiveVisualPreviewDurationMs(payload: VisualSubCuePreviewPayload): number | undefined {
  const timing = resolveVisualPreviewSubCueTiming(payload);
  if (timing) {
    return timing.totalDurationMs;
  }
  const explicitMs =
    payload.playTimeMs !== undefined && Number.isFinite(payload.playTimeMs) && payload.playTimeMs > 0
      ? payload.playTimeMs
      : payload.durationMs !== undefined && Number.isFinite(payload.durationMs) && payload.durationMs > 0
        ? payload.durationMs
        : undefined;
  if (explicitMs !== undefined) {
    return resolveLoopTiming(payload.loop, explicitMs).totalDurationMs;
  }
  const mediaDurationMs = payload.visual.durationSeconds !== undefined ? payload.visual.durationSeconds * 1000 : undefined;
  if (!mediaDurationMs || mediaDurationMs <= 0) {
    return undefined;
  }
  const rate = payload.playbackRate ?? 1;
  const baseMs = mediaDurationMs / (rate > 0 ? rate : 1);
  return resolveLoopTiming(payload.loop, baseMs).totalDurationMs;
}

function isInfiniteVisualPreview(payload: VisualSubCuePreviewPayload): boolean {
  const timing = resolveVisualPreviewSubCueTiming(payload);
  return Boolean(
    timing?.totalDurationMs === undefined && timing !== undefined ||
      payload.loop?.enabled === true && payload.loop.iterations.type === 'infinite',
  );
}

function reportVisualPreviewPosition(runtime: VisualPreviewRuntime, force: boolean): void {
  const now = performance.now();
  if (!force && runtime.lastReportWallTimeMs !== undefined && now - runtime.lastReportWallTimeMs < 100) {
    return;
  }
  runtime.lastReportWallTimeMs = now;
  void window.xtream.visualRuntime.reportSubCuePreviewPosition({
    previewId: runtime.payload.previewId,
    displayId,
    localTimeMs: runtime.localTimeMs,
    sourceTimeMs: runtime.sourceTimeMs,
    playing: runtime.playing,
    paused: runtime.paused,
  });
}

function reportVisualPreviewStatus(payload: VisualSubCuePreviewPayload, ready: boolean, error?: string): void {
  void window.xtream.renderer.reportPreviewStatus({
    key: `visual-subcue:${payload.previewId}:${displayId}`,
    displayId,
    visualId: payload.visualId,
    ready,
    error,
    reportedAtWallTimeMs: Date.now(),
  });
}

function reportLivePreviewSnapshotWhenReady(visual: VisualState, video: HTMLVideoElement, timeMs: number): void {
  let reported = false;
  const report = (): void => {
    if (reported) {
      return;
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      return;
    }
    reported = true;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    void window.xtream.visualRuntime.reportSubCuePreviewSnapshot({
      visualId: visual.id,
      dataUrl: canvas.toDataURL('image/jpeg', 0.72),
      timeMs,
    });
  };
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    report();
    return;
  }
  video.addEventListener('loadedmetadata', report, { once: true });
  video.addEventListener('canplay', report, { once: true });
}

function scheduleVisualPreviewFrame(): void {
  if (visualPreviewFrame !== undefined || visualPreviewRuntimes.size === 0) {
    return;
  }
  visualPreviewFrame = window.requestAnimationFrame(tickVisualPreviewFrame);
}

function tickVisualPreviewFrame(): void {
  visualPreviewFrame = undefined;
  let hasPlayingPreview = false;
  const completedPreviewIds: string[] = [];
  for (const runtime of visualPreviewRuntimes.values()) {
    syncVisualPreviewRuntime(runtime, false);
    if (runtime.completed) {
      completedPreviewIds.push(runtime.payload.previewId);
      continue;
    }
    hasPlayingPreview ||= runtime.playing;
  }
  for (const previewId of completedPreviewIds) {
    stopVisualPreview(previewId, true);
  }
  if (hasPlayingPreview) {
    scheduleVisualPreviewFrame();
  }
}

function stopVisualPreview(previewId: string, report: boolean): void {
  const runtime = visualPreviewRuntimes.get(previewId);
  if (!runtime) {
    return;
  }
  for (const zoneId of runtime.targetZones) {
    const layerId = visualPreviewLayerId(previewId, zoneId);
    const layer = visualPreviewRoot?.querySelector<HTMLElement>(`.display-preview-layer[data-layer-id="${cssEscape(layerId)}"]`);
    if (layer) {
      cleanupMediaInElement(layer);
      layer.remove();
    } else {
      cleanupMediaForVisualId(layerId);
    }
  }
  visualPreviewRuntimes.delete(previewId);
  if (report) {
    reportVisualPreviewPosition({ ...runtime, playing: false, paused: false }, true);
  }
  renderVisualPreviewOverlays();
}

function clearVisualPreviewRoot(): void {
  if (!visualPreviewRoot) {
    return;
  }
  cleanupMediaInElement(visualPreviewRoot);
  visualPreviewRoot.remove();
  visualPreviewRoot = undefined;
}

function clearAllVisualPreviews(): void {
  for (const previewId of [...visualPreviewRuntimes.keys()]) {
    stopVisualPreview(previewId, false);
  }
  visualPreviewRuntimes.clear();
  clearVisualPreviewRoot();
  if (visualPreviewFrame !== undefined) {
    window.cancelAnimationFrame(visualPreviewFrame);
    visualPreviewFrame = undefined;
  }
}

function findPreviewVideo(layerId: string): HTMLVideoElement | undefined {
  return visualPreviewRoot?.querySelector<HTMLVideoElement>(`video[data-visual-id="${cssEscape(layerId)}"]`) ?? undefined;
}

function visualPreviewLayerId(previewId: string, zoneId: DisplayZoneId): string {
  return `visual-preview:${previewId}:${zoneId}`;
}

function visualPreviewMediaSignature(runtime: VisualPreviewRuntime): string {
  const visual = runtime.payload.visual;
  return [
    runtime.payload.previewId,
    visual.id,
    visual.kind,
    visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty',
    visual.type,
    runtime.payload.playbackRate ?? '',
    runtime.payload.freezeFrameMs ?? '',
  ].join('|');
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function handleState(state: DirectorState): void {
  latestDirectorState = state;
  const effectiveState = deriveDirectorStateForStream(state, currentStreamState);
  const streamFrame = buildStreamDisplayFrames(state, currentStreamState)[displayId];
  currentState = effectiveState;
  currentDirectorSeconds = getDirectorSeconds(effectiveState);
  displayRoot.style.setProperty(
    '--display-blackout-fade',
    `${Math.max(0, effectiveState.globalDisplayBlackoutFadeOverrideSeconds ?? effectiveState.globalDisplayBlackoutFadeOutSeconds)}s`,
  );
  const blackedOut = effectiveState.globalDisplayBlackout;
  const display = effectiveState.displays[displayId];
  if (!display) {
    document.title = formatDisplayWindowTitle({ id: displayId });
    if (currentRenderMode !== 'missing') {
      replaceDisplayRoot('display-missing', { knownDisplayIds: Object.keys(effectiveState.displays) });
      const missing = document.createElement('section');
      missing.className = 'display-output';
      missing.textContent = 'UNMAPPED';
      displayRoot.append(missing);
      currentRenderMode = 'missing';
      currentStreamZoneSignature = '';
      currentRenderSignature = '';
    }
    applyBlackoutState(blackedOut);
    return;
  }
  document.title = formatDisplayWindowTitle(display);
  if (streamFrame) {
    renderStreamFrame(streamFrame);
    currentRenderSignature = createStreamFrameRenderSignature(streamFrame);
  } else {
    const renderSignature = createRenderSignature(display.layout, effectiveState.visuals);
    if (currentRenderMode !== 'patch' || currentRenderSignature !== renderSignature) {
      renderLayout(display.layout, effectiveState.visuals);
      currentRenderSignature = renderSignature;
    }
  }
  applyBlackoutState(blackedOut);
  syncVideoElements(display, effectiveState);
  renderVisualPreviewOverlays();
}

function handleStreamState(state: StreamEnginePublicState): void {
  currentStreamState = state;
  if (latestDirectorState) {
    handleState(latestDirectorState);
  }
}

function createVisualElement(visualId: VisualId, visual: VisualState | undefined): HTMLElement {
  const visualElement = document.createElement('section');
  visualElement.className = 'display-output';
  const shouldReportMetadata = !isStreamRuntimeVisualId(visualId);
  debugDisplay('patch-visual-element-create', {
    visualId,
    kind: visual?.kind,
    type: visual?.type,
    url: visual?.kind === 'live' ? undefined : visual?.url,
    ready: visual?.ready,
  });
  if (visual?.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = visualId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    visualElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(visualId, `live ${visual.capture.source}`)] : []));
    const metadataOptions = shouldReportMetadata
      ? { reportMetadata: (report: VisualMetadataReport) => void window.xtream.visuals.reportMetadata(report) }
      : {};
    void attachLiveVisualStream(visual, video, metadataOptions)
      .then((attachment) => {
        if (visualElement.isConnected) {
          liveVisualCleanups.set(visualId, attachment.cleanup);
        } else {
          attachment.cleanup();
        }
      })
      .catch((error: unknown) => {
        reportLiveVisualError(
          visual,
          metadataOptions,
          error instanceof Error ? error.message : 'Live visual capture failed.',
        );
      });
    return visualElement;
  }
  if (visual?.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    image.addEventListener('load', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        width: image.naturalWidth,
        height: image.naturalHeight,
        ready: true,
      });
    });
    image.addEventListener('error', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({ visualId, ready: false, error: 'Image failed to load.' });
    });
    visualElement.append(image, ...(showDiagnosticsOverlay ? [createOverlay(visualId, 'static image')] : []));
    return visualElement;
  }
  if (visual?.url) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = visual.url;
    video.dataset.visualId = visualId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    video.addEventListener('loadedmetadata', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        hasEmbeddedAudio: hasEmbeddedAudioTrack(video),
        ready: true,
      });
    });
    video.addEventListener('error', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        ready: false,
        error: video.error?.message ?? 'Video failed to load.',
      });
    });
    observeVideoFrames(video);
    visualElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(visualId, 'muted visual rail')] : []));
    videoElements.set(visualId, video);
    return visualElement;
  }
  const visualLabel = document.createElement('span');
  visualLabel.textContent = visual?.label ?? visualId;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'no visual selected';
  visualElement.append(visualLabel, visualMeta);
  return visualElement;
}

function createNoSignalPlaceholder(zoneId: StreamDisplayFrame['zones'][number]['zoneId']): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'display-output-placeholder';
  const visualLabel = document.createElement('span');
  visualLabel.textContent = zoneId === 'single' ? 'NO SIGNAL' : zoneId;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'no stream visual';
  placeholder.append(visualLabel, visualMeta);
  return placeholder;
}

function streamLayerMediaSignature(layer: StreamDisplayLayer): string {
  const visual = layer.visual;
  return `${layer.layerId}:${layer.sourceVisualId}:${visual.kind}:${visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty'}:${
    visual.ready ? 'ready' : 'not-ready'
  }:${visual.error ?? ''}:${visual.type ?? ''}`;
}

function applyStreamLayerElementState(layerElement: HTMLElement, layer: StreamDisplayLayer, index: number): void {
  layerElement.className = `display-layer display-layer--${layer.blendAlgorithm}`;
  layerElement.dataset.layerId = layer.layerId;
  layerElement.dataset.visualId = layer.layerId;
  layerElement.dataset.sourceVisualId = layer.sourceVisualId;
  layerElement.dataset.sceneId = layer.sceneId;
  layerElement.dataset.subCueId = layer.subCueId;
  layerElement.dataset.mediaSignature = streamLayerMediaSignature(layer);
  layerElement.style.zIndex = String(index + 1);
  layerElement.style.opacity = String(layer.opacity);
  layerElement.style.setProperty('--display-layer-transition', `${layer.transitionMs}ms`);
  layerElement.style.mixBlendMode = cssBlendMode(layer.blendAlgorithm);
  const media = layerElement.querySelector<HTMLElement>('video,img');
  if (media) {
    applyVisualStyle(media, layer.visual);
  }
}

function reconcileStreamZone(output: HTMLElement, zoneId: StreamDisplayFrame['zones'][number]['zoneId'], layers: StreamDisplayLayer[]): void {
  const wantedLayerIds = new Set(layers.map((layer) => layer.layerId));
  for (const child of [...output.children]) {
    const element = child as HTMLElement;
    const layerId = element.dataset.layerId;
    if (layerId && !wantedLayerIds.has(layerId)) {
      debugDisplay('stream-layer-remove', {
        zoneId,
        layerId,
        wantedLayerIds: [...wantedLayerIds],
        mediaSignature: element.dataset.mediaSignature,
      });
      cleanupMediaInElement(element);
      element.remove();
    } else if (!layerId && layers.length > 0) {
      debugDisplay('stream-placeholder-remove', { zoneId });
      element.remove();
    }
  }

  if (layers.length === 0) {
    if (!output.querySelector('.display-output-placeholder')) {
      debugDisplay('stream-zone-placeholder', { zoneId });
      output.replaceChildren(createNoSignalPlaceholder(zoneId));
    }
    return;
  }

  for (const [index, layer] of layers.entries()) {
    let layerElement = [...output.querySelectorAll<HTMLElement>('.display-layer')].find(
      (candidate) => candidate.dataset.layerId === layer.layerId,
    );
    const mediaSignature = streamLayerMediaSignature(layer);
    if (layerElement && layerElement.dataset.mediaSignature !== mediaSignature) {
      debugDisplay('stream-layer-replace', {
        zoneId,
        previousMediaSignature: layerElement.dataset.mediaSignature,
        mediaSignature,
        layer: summarizeStreamLayer(layer),
      });
      cleanupMediaInElement(layerElement);
      const replacement = createStreamLayerElement(layer, index);
      layerElement.replaceWith(replacement);
      layerElement = replacement;
    } else if (!layerElement) {
      debugDisplay('stream-layer-add', {
        zoneId,
        mediaSignature,
        layer: summarizeStreamLayer(layer),
      });
      layerElement = createStreamLayerElement(layer, index);
    }
    applyStreamLayerElementState(layerElement, layer, index);
    output.append(layerElement);
  }
}

function createStreamLayerElement(layer: StreamDisplayLayer, index: number): HTMLElement {
  const layerElement = document.createElement('div');
  debugDisplay('stream-layer-element-create', {
    index,
    layer: summarizeStreamLayer(layer),
  });
  applyStreamLayerElementState(layerElement, layer, index);
  const visual = layer.visual;
  if (visual.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = layer.layerId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    layerElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, `stream live ${visual.capture.source}`)] : []));
    void attachLiveVisualStream(visual, video, {})
      .then((attachment) => {
        if (layerElement.isConnected) {
          liveVisualCleanups.set(layer.layerId, attachment.cleanup);
        } else {
          attachment.cleanup();
        }
      })
      .catch((error: unknown) => {
        reportLiveVisualError(visual, {}, error instanceof Error ? error.message : 'Live visual capture failed.');
      });
    return layerElement;
  }
  if (visual.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    layerElement.append(image, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, 'stream image layer')] : []));
    return layerElement;
  }
  if (visual.url) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = visual.url;
    video.dataset.visualId = layer.layerId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    layerElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, 'stream video layer')] : []));
    videoElements.set(layer.layerId, video);
    return layerElement;
  }
  const visualLabel = document.createElement('span');
  visualLabel.textContent = visual.label;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'stream visual missing media';
  layerElement.append(visualLabel, visualMeta);
  return layerElement;
}

function cssBlendMode(algorithm: StreamDisplayLayer['blendAlgorithm']): string {
  if (algorithm === 'additive') {
    return 'plus-lighter';
  }
  if (algorithm === 'alpha-over' || algorithm === 'latest' || algorithm === 'crossfade') {
    return 'normal';
  }
  return algorithm;
}

function isStreamRuntimeVisualId(visualId: string): boolean {
  return visualId.startsWith('stream-visual:');
}

function isVisualPreviewLayerId(visualId: string | undefined): boolean {
  return visualId?.startsWith('visual-preview:') === true;
}

function createOverlay(visualId: string, detail: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'display-output-overlay';
  overlay.append(createTextSpan(`Visual ${visualId}`), createTextSpan(detail));
  return overlay;
}

function createTextSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function createRenderSignature(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): string {
  const visualParts = getLayoutVisualIds(layout).map((visualId) => {
    const visual = visualsById[visualId];
    return `${visualId}:${visual?.kind ?? 'file'}:${visual?.url ?? 'empty'}:${
      visual?.kind === 'live' ? JSON.stringify(visual.capture) : ''
    }:${visual?.ready ? 'ready' : 'not-ready'}:${visual?.error ?? ''}:${visual?.opacity ?? 1}:${
      visual?.brightness ?? 1
    }:${visual?.contrast ?? 1}:${visual?.playbackRate ?? 1}`;
  });
  return `${describeLayout(layout)}|${visualParts.join('|')}`;
}

function createStreamFrameRenderSignature(frame: StreamDisplayFrame): string {
  const zones = frame.zones.map((zone) => {
    const layers = zone.layers
      .filter((layer) => layer.selected)
      .map((layer) => {
        const visual = layer.visual;
        return `${layer.layerId}:${layer.order}:${layer.blendAlgorithm}:${visual.kind}:${
          visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty'
        }:${visual.ready ? 'ready' : 'not-ready'}:${visual.error ?? ''}`;
      });
    return `${zone.zoneId}[${layers.join(',')}]`;
  });
  return `stream:${frame.displayId}:${frame.layout.type}:${frame.mode}:${frame.algorithm}:${frame.transitionMs}:${zones.join('|')}`;
}

function syncVideoWhenReady(video: HTMLVideoElement): void {
  const sync = (event: Event) => {
    debugDisplay('video-ready-event', {
      eventType: event.type,
      visualId: video.dataset.visualId,
      readyState: video.readyState,
      currentTime: rounded(video.currentTime),
      duration: rounded(video.duration),
      src: video.currentSrc || video.src || undefined,
    });
    const state = currentState;
    const display = state?.displays[displayId];
    if (state && display) {
      syncVideoElements(display, state);
    }
  };
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('canplay', sync);
}

function syncVideoElements(display: DisplayWindowState, state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  currentDirectorSeconds = targetSeconds;
  const syncKey = createPlaybackSyncKey(state);
  for (const video of videoElements.values()) {
    if (isVisualPreviewLayerId(video.dataset.visualId)) {
      continue;
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }
    const correction = state.corrections.displays[display.id];
    const shouldApplyCorrection =
      correction?.action === 'seek' &&
      correction.targetSeconds !== undefined &&
      !appliedCorrectionRevisions.has(correction.revision);
    const visualId = video.dataset.visualId;
    const visual = visualId ? state.visuals[visualId] : undefined;
    const visualDuration = visual?.durationSeconds;
    const baseTarget = shouldApplyCorrection ? correction.targetSeconds! : targetSeconds;
    const runtime = visual as
      | (VisualState & {
          runtimeOffsetSeconds?: number;
          runtimeSourceStartSeconds?: number;
          runtimeSourceEndSeconds?: number;
          runtimeLoop?: LoopState;
          runtimeFreezeFrameSeconds?: number;
          runtimeSubCueTiming?: RuntimeSubCueTiming;
        })
      | undefined;
    const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
    const runtimeSourceStartSeconds = runtime?.runtimeSourceStartSeconds ?? 0;
    const runtimeSourceEndSeconds = runtime?.runtimeSourceEndSeconds;
    const localSeconds = Math.max(0, baseTarget - runtimeOffsetSeconds);
    const runtimeMapped = runtime?.runtimeSubCueTiming
      ? mapRuntimeSubCueMediaElapsedMs(localSeconds * 1000, runtime.runtimeSubCueTiming)
      : undefined;
    const rawMediaTarget =
      runtimeSourceStartSeconds +
      (runtimeMapped ? runtimeMapped.mediaElapsedMs / 1000 : localSeconds) * (visual?.playbackRate ?? 1);
    const freezeSeconds = runtime?.runtimeFreezeFrameSeconds;
    const frozen = freezeSeconds !== undefined && Number.isFinite(freezeSeconds) && rawMediaTarget >= freezeSeconds;
    const effectiveTarget = frozen
      ? clampFreezeTargetSeconds(freezeSeconds, visualDuration)
      : runtimeMapped
        ? Math.max(runtimeSourceStartSeconds, Math.min(rawMediaTarget, runtimeSourceEndSeconds ?? visualDuration ?? Number.POSITIVE_INFINITY))
        : getMediaEffectiveTime(
            rawMediaTarget,
            runtimeSourceEndSeconds ?? visualDuration,
            runtime?.runtimeLoop ?? state.loop,
          );
    const syncStateBefore = getMediaSyncState(video);
    const syncKeyChanged = syncStateBefore.lastSyncKey !== syncKey;
    const driftBeforeSeconds = video.currentTime - effectiveTarget;
    if (debugDisplayRefresh && correction?.action !== 'none' && correction?.revision !== undefined && shouldApplyCorrection) {
      debugDisplay('media-correction-apply', {
        visualId,
        correctionAction: correction.action,
        correctionRevision: correction.revision,
        correctionTargetSeconds: rounded(correction.targetSeconds),
        correctionDriftSeconds: rounded(correction.driftSeconds),
        directorSeconds: rounded(targetSeconds),
        effectiveTargetSeconds: rounded(effectiveTarget),
        currentTime: rounded(video.currentTime),
        driftBeforeSeconds: rounded(driftBeforeSeconds),
      });
    }
    syncTimedMediaElement(
      video,
      effectiveTarget,
      !state.paused && !frozen,
      shouldApplyCorrection ? `${syncKey}:correction:${correction.revision}` : syncKey,
      DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS,
      {
        syncKeySeekThresholdSeconds: SYNC_KEY_SEEK_THRESHOLD_SECONDS,
        onSeekStart: (seekTargetSeconds) => {
          mediaSeekCount += 1;
          debugDisplay('media-seek-start', {
            visualId,
            seekTargetSeconds: rounded(seekTargetSeconds),
            effectiveTargetSeconds: rounded(effectiveTarget),
            directorSeconds: rounded(targetSeconds),
            baseTargetSeconds: rounded(baseTarget),
            runtimeOffsetSeconds: rounded(runtimeOffsetSeconds),
            currentTime: rounded(video.currentTime),
            driftBeforeSeconds: rounded(driftBeforeSeconds),
            syncKeyChanged,
            shouldApplyCorrection,
            correctionAction: correction?.action,
            correctionRevision: correction?.revision,
            playbackRate: rounded(video.playbackRate),
            stateRate: rounded(state.rate),
            visualPlaybackRate: rounded(visual?.playbackRate),
            readyState: video.readyState,
            pendingSeekSeconds: rounded(syncStateBefore.pendingSeekSeconds),
            src: video.currentSrc || video.src || undefined,
          });
        },
        onSeekComplete: ({ durationMs, usedFallback }) => {
          lastMediaSeekDurationMs = durationMs;
          if (usedFallback) {
            mediaSeekFallbackCount += 1;
          }
          debugDisplay('media-seek-complete', {
            visualId,
            durationMs: rounded(durationMs, 1),
            usedFallback,
            currentTime: rounded(video.currentTime),
            mediaSeekCount,
            mediaSeekFallbackCount,
          });
        },
      },
    );
    if (correction?.revision !== undefined && shouldApplyCorrection) {
      appliedCorrectionRevisions.add(correction.revision);
    }
    video.playbackRate = state.rate * (visual?.playbackRate ?? 1);
    if (visual) {
      applyVisualStyle(video, visual);
    }
  }
  syncLiveFreezeElements(state, targetSeconds);
}

function applyVisualStyle(element: HTMLElement, visual: VisualState): void {
  element.style.opacity = element.closest('.display-layer') ? '1' : String(visual.opacity ?? 1);
  element.style.filter = `brightness(${visual.brightness ?? 1}) contrast(${visual.contrast ?? 1})`;
}

function clampFreezeTargetSeconds(seconds: number, durationSeconds: number | undefined): number {
  const safe = Math.max(0, seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds === undefined || durationSeconds <= 0) {
    return safe;
  }
  return Math.min(safe, Math.max(0, durationSeconds - 0.001));
}

function syncLiveFreezeElements(state: DirectorState, targetSeconds: number): void {
  for (const video of displayRoot.querySelectorAll<HTMLVideoElement>('video[data-visual-id]')) {
    const visualId = video.dataset.visualId;
    const visual = visualId ? state.visuals[visualId] : undefined;
    if (visual?.kind !== 'live') {
      continue;
    }
    const runtime = visual as VisualState & { runtimeOffsetSeconds?: number; runtimeFreezeFrameSeconds?: number };
    const freezeSeconds = runtime.runtimeFreezeFrameSeconds;
    const runtimeOffsetSeconds = runtime.runtimeOffsetSeconds ?? 0;
    const localSeconds = (targetSeconds - runtimeOffsetSeconds) * (visual.playbackRate ?? 1);
    const shouldFreeze = freezeSeconds !== undefined && Number.isFinite(freezeSeconds) && localSeconds >= freezeSeconds;
    if (!shouldFreeze) {
      unfreezeLiveVideo(video);
      continue;
    }
    freezeLiveVideo(video, visual);
  }
}

function freezeLiveVideo(video: HTMLVideoElement, visual: VisualState): void {
  if (liveFreezeCanvases.has(video)) {
    return;
  }
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'display-live-freeze-canvas';
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  applyVisualStyle(canvas, visual);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.after(canvas);
  video.style.visibility = 'hidden';
  liveFreezeCanvases.set(video, canvas);
}

function unfreezeLiveVideo(video: HTMLVideoElement): void {
  const canvas = liveFreezeCanvases.get(video);
  if (!canvas) {
    return;
  }
  canvas.remove();
  video.style.visibility = '';
  liveFreezeCanvases.delete(video);
}

function observeVideoFrames(video: HTMLVideoElement): void {
  const trackedVideo = video as FrameTrackedVideo;
  if (!trackedVideo.requestVideoFrameCallback) {
    return;
  }
  const stats: VideoFrameStats = {
    presentedFrames: 0,
    samplePresentedFrames: 0,
    sampleWallTimeMs: performance.now(),
    maxFrameGapMs: 0,
  };
  videoFrameStats.set(video, stats);
  const recordFrame = (now: number) => {
    if (!videoFrameStats.has(video)) {
      return;
    }
    if (stats.lastFrameWallTimeMs !== undefined) {
      stats.maxFrameGapMs = Math.max(stats.maxFrameGapMs, now - stats.lastFrameWallTimeMs);
    }
    stats.lastFrameWallTimeMs = now;
    stats.presentedFrames += 1;
    trackedVideo.requestVideoFrameCallback?.(recordFrame);
  };
  trackedVideo.requestVideoFrameCallback(recordFrame);
}

function summarizeVideoDiagnostics(videos: HTMLVideoElement[]): {
  presentedFrameRateFps?: number;
  droppedVideoFrames?: number;
  totalVideoFrames?: number;
  maxVideoFrameGapMs?: number;
} {
  let presentedFrameRateFps = 0;
  let presentedFrameSamples = 0;
  let maxVideoFrameGapMs: number | undefined;
  let droppedVideoFrames: number | undefined;
  let totalVideoFrames: number | undefined;
  const now = performance.now();
  for (const video of videos) {
    const stats = videoFrameStats.get(video);
    if (stats) {
      const elapsedMs = now - stats.sampleWallTimeMs;
      if (elapsedMs > 0) {
        stats.presentedFrameRateFps = ((stats.presentedFrames - stats.samplePresentedFrames) * 1000) / elapsedMs;
        stats.samplePresentedFrames = stats.presentedFrames;
        stats.sampleWallTimeMs = now;
      }
      if (stats.presentedFrameRateFps !== undefined) {
        presentedFrameRateFps += stats.presentedFrameRateFps;
        presentedFrameSamples += 1;
      }
      maxVideoFrameGapMs = Math.max(maxVideoFrameGapMs ?? 0, stats.maxFrameGapMs);
      stats.maxFrameGapMs = 0;
    }
    const quality = (video as FrameTrackedVideo).getVideoPlaybackQuality?.();
    if (quality) {
      droppedVideoFrames = (droppedVideoFrames ?? 0) + (quality.droppedVideoFrames ?? 0);
      totalVideoFrames = (totalVideoFrames ?? 0) + (quality.totalVideoFrames ?? 0);
    }
  }
  return {
    presentedFrameRateFps: presentedFrameSamples > 0 ? presentedFrameRateFps / presentedFrameSamples : undefined,
    droppedVideoFrames,
    totalVideoFrames,
    maxVideoFrameGapMs,
  };
}

window.xtream.director.onState(handleState);
window.xtream.stream.onState(handleStreamState);
const unsubscribeVisualPreviewCommands = window.xtream.visualRuntime.onSubCuePreviewCommand(handleVisualPreviewCommand);
void window.xtream.renderer.ready({ kind: 'display', displayId });
void window.xtream.director.getState().then(handleState);
void window.xtream.stream.getState().then(handleStreamState);

function sampleFrameRate(): void {
  frameCounter += 1;
  const now = performance.now();
  if (now - lastFrameSampleMs >= 1000) {
    lastFrameRateFps = (frameCounter * 1000) / (now - lastFrameSampleMs);
    frameCounter = 0;
    lastFrameSampleMs = now;
  }
  window.requestAnimationFrame(sampleFrameRate);
}

window.requestAnimationFrame(sampleFrameRate);

driftTimer = window.setInterval(() => {
  if (currentState?.paused) {
    return;
  }
  const videos = Array.from(videoElements.values()).filter(
    (video) => !isVisualPreviewLayerId(video.dataset.visualId) && video.readyState >= HTMLMediaElement.HAVE_METADATA,
  );
  const directorSeconds = currentState ? getDirectorSeconds(currentState) : currentDirectorSeconds;
  currentDirectorSeconds = directorSeconds;
  if (videos.some((video) => getMediaSyncState(video).pendingSeekSeconds !== undefined)) {
    return;
  }
  const driftSeconds =
    videos.length > 0 && currentState
      ? videos.reduce((max, video) => {
          const visualId = video.dataset.visualId;
          const state = currentState!;
          const visual = visualId ? state.visuals[visualId] : undefined;
          const runtime = visual as
            | (VisualState & {
                runtimeOffsetSeconds?: number;
                runtimeSourceStartSeconds?: number;
                runtimeSourceEndSeconds?: number;
                runtimeLoop?: LoopState;
                runtimeSubCueTiming?: RuntimeSubCueTiming;
              })
            | undefined;
          const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
          const runtimeSourceStartSeconds = runtime?.runtimeSourceStartSeconds ?? 0;
          const localSeconds = Math.max(0, directorSeconds - runtimeOffsetSeconds);
          const runtimeMapped = runtime?.runtimeSubCueTiming
            ? mapRuntimeSubCueMediaElapsedMs(localSeconds * 1000, runtime.runtimeSubCueTiming)
            : undefined;
          const rawTargetSeconds =
            runtimeSourceStartSeconds +
            (runtimeMapped ? runtimeMapped.mediaElapsedMs / 1000 : localSeconds) * (visual?.playbackRate ?? 1);
          const targetSeconds = runtimeMapped
            ? Math.max(runtimeSourceStartSeconds, Math.min(rawTargetSeconds, runtime?.runtimeSourceEndSeconds ?? visual?.durationSeconds ?? Number.POSITIVE_INFINITY))
            : getMediaEffectiveTime(
                rawTargetSeconds,
                runtime?.runtimeSourceEndSeconds ?? visual?.durationSeconds,
                runtime?.runtimeLoop ?? state.loop,
              );
          const drift = video.currentTime - targetSeconds;
          return Math.abs(drift) > Math.abs(max) ? drift : max;
        }, 0)
      : 0;
  const videoDiagnostics = summarizeVideoDiagnostics(videos);
  const displayCorrection = currentState?.corrections.displays[displayId];
  const driftDebugSignature = `${videos.length}:${rounded(driftSeconds)}:${rounded(videoDiagnostics.maxVideoFrameGapMs, 1)}:${mediaSeekCount}:${mediaSeekFallbackCount}:${
    displayCorrection?.revision ?? 'none'
  }`;
  if (
    debugDisplayRefresh &&
    driftDebugSignature !== lastDriftDebugSignature &&
    (Math.abs(driftSeconds) > 0.1 || mediaSeekCount > 0 || mediaSeekFallbackCount > 0)
  ) {
    debugDisplay('drift-report', {
      videos: videos.map((video) => ({
        visualId: video.dataset.visualId,
        currentTime: rounded(video.currentTime),
        readyState: video.readyState,
        pendingSeekSeconds: rounded(getMediaSyncState(video).pendingSeekSeconds),
        src: video.currentSrc || video.src || undefined,
      })),
      directorSeconds: rounded(directorSeconds),
      driftSeconds: rounded(driftSeconds),
      frameRateFps: rounded(lastFrameRateFps),
      presentedFrameRateFps: rounded(videoDiagnostics.presentedFrameRateFps),
      droppedVideoFrames: videoDiagnostics.droppedVideoFrames,
      totalVideoFrames: videoDiagnostics.totalVideoFrames,
      maxVideoFrameGapMs: rounded(videoDiagnostics.maxVideoFrameGapMs, 1),
      mediaSeekCount,
      mediaSeekFallbackCount,
      mediaSeekDurationMs: rounded(lastMediaSeekDurationMs, 1),
      correction: displayCorrection,
      ...summarizeStreamRuntime(),
    });
    lastDriftDebugSignature = driftDebugSignature;
  }
  void window.xtream.renderer.reportDrift({
    kind: 'display',
    displayId,
    observedSeconds: videos[0]?.currentTime ?? directorSeconds,
    directorSeconds,
    driftSeconds,
    frameRateFps: lastFrameRateFps,
    presentedFrameRateFps: videoDiagnostics.presentedFrameRateFps,
    droppedVideoFrames: videoDiagnostics.droppedVideoFrames,
    totalVideoFrames: videoDiagnostics.totalVideoFrames,
    maxVideoFrameGapMs: videoDiagnostics.maxVideoFrameGapMs,
    mediaSeekCount,
    mediaSeekFallbackCount,
    mediaSeekDurationMs: lastMediaSeekDurationMs,
    reportedAtWallTimeMs: Date.now(),
  });
}, 1000);

syncTimer = window.setInterval(() => {
  if (currentState) {
    const display = currentState.displays[displayId];
    if (display) {
      syncVideoElements(display, currentState);
    }
  }
  const completedPreviewIds: string[] = [];
  for (const runtime of visualPreviewRuntimes.values()) {
    syncVisualPreviewRuntime(runtime, false);
    if (runtime.completed) {
      completedPreviewIds.push(runtime.payload.previewId);
    }
  }
  for (const previewId of completedPreviewIds) {
    stopVisualPreview(previewId, true);
  }
}, DISPLAY_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  unsubscribeIdentifyFlash?.();
  unsubscribeVisualPreviewCommands?.();
  clearAllVisualPreviews();
  if (identifyHideTimer !== undefined) {
    window.clearTimeout(identifyHideTimer);
  }
  for (const cleanup of liveVisualCleanups.values()) {
    cleanup();
  }
  liveVisualCleanups.clear();
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
  if (syncTimer !== undefined) {
    window.clearInterval(syncTimer);
  }
});
