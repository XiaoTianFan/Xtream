/// <reference path="./global.d.ts" />
import './display.css';
import { describeLayout, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds, getMediaEffectiveTime } from '../shared/timeline';
import type {
  DirectorState,
  DisplayWindowState,
  LoopState,
  StreamEnginePublicState,
  VisualId,
  VisualLayoutProfile,
  VisualMetadataReport,
  VisualState,
} from '../shared/types';
import { createPlaybackSyncKey, getMediaSyncState, syncTimedMediaElement } from './control/media/mediaSync';
import { hasEmbeddedAudioTrack } from './control/media/mediaMetadata';
import { attachLiveVisualStream, reportLiveVisualError } from './control/media/liveCaptureRuntime';
import { buildStreamDisplayFrames, deriveDirectorStateForStream, type StreamDisplayFrame, type StreamDisplayLayer } from './streamProjection';
import { formatDisplayWindowTitle } from '../shared/displayWindowTitle';

const root = document.querySelector<HTMLDivElement>('#displayRoot');
const params = new URLSearchParams(window.location.search);
const displayId = params.get('id') ?? 'unknown-display';
const showDiagnosticsOverlay = params.get('diagnostics') === '1';
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
const videoFrameStats = new WeakMap<HTMLVideoElement, VideoFrameStats>();
const DISPLAY_SYNC_INTERVAL_MS = 500;
const DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS = 0.5;
const SYNC_KEY_SEEK_THRESHOLD_SECONDS = 0.12;

type RenderMode = 'patch' | 'stream' | 'missing';

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
  for (const cleanup of liveVisualCleanups.values()) {
    cleanup();
  }
  liveVisualCleanups.clear();
  videoElements.clear();
}

function renderLayout(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): void {
  displayRoot.className = layout.type === 'split' ? 'display-root split' : 'display-root';
  cleanupRenderedMedia();
  displayRoot.replaceChildren();
  currentRenderMode = 'patch';
  currentStreamZoneSignature = '';
  for (const visualId of getLayoutVisualIds(layout)) {
    displayRoot.append(createVisualElement(visualId, visualsById[visualId]));
  }
}

function renderStreamFrame(frame: StreamDisplayFrame): void {
  displayRoot.className = frame.layout.type === 'split' ? 'display-root split stream-frame' : 'display-root stream-frame';
  const zoneIds = frame.layout.type === 'split' ? (['L', 'R'] as const) : (['single'] as const);
  const zoneSignature = `${frame.displayId}:${frame.layout.type}:${zoneIds.join('|')}`;
  if (currentRenderMode !== 'stream' || currentStreamZoneSignature !== zoneSignature) {
    cleanupRenderedMedia();
    displayRoot.replaceChildren();
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
      output.className = 'display-output display-output-zone';
      output.dataset.zoneId = zoneId;
      displayRoot.append(output);
    }
    const zone = frame.zones.find((candidate) => candidate.zoneId === zoneId);
    const selectedLayers = (zone?.layers ?? []).filter((layer) => layer.selected);
    reconcileStreamZone(output, zoneId, selectedLayers);
  }
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
  displayRoot.classList.toggle('blacked-out', effectiveState.globalDisplayBlackout);
  const display = effectiveState.displays[displayId];
  if (!display) {
    document.title = formatDisplayWindowTitle({ id: displayId });
    if (currentRenderMode !== 'missing') {
      cleanupRenderedMedia();
      displayRoot.replaceChildren();
      const missing = document.createElement('section');
      missing.className = 'display-output';
      missing.textContent = 'UNMAPPED';
      displayRoot.append(missing);
      currentRenderMode = 'missing';
      currentStreamZoneSignature = '';
      currentRenderSignature = '';
    }
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
  syncVideoElements(display, effectiveState);
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
  if (visual?.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = visualId;
    applyVisualStyle(video, visual);
    observeVideoFrames(video);
    visualElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(visualId, `live ${visual.capture.source}`)] : []));
    const metadataOptions = shouldReportMetadata
      ? { reportMetadata: (report: VisualMetadataReport) => void window.xtream.visuals.reportMetadata(report) }
      : {};
    void attachLiveVisualStream(visual, video, metadataOptions)
      .then((attachment) => {
        liveVisualCleanups.set(visualId, attachment.cleanup);
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

function createStreamLayerElement(layer: StreamDisplayLayer, index: number): HTMLElement {
  const layerElement = document.createElement('div');
  layerElement.className = `display-layer display-layer--${layer.blendAlgorithm}`;
  layerElement.dataset.layerId = layer.layerId;
  layerElement.dataset.visualId = layer.layerId;
  layerElement.dataset.sourceVisualId = layer.sourceVisualId;
  layerElement.dataset.sceneId = layer.sceneId;
  layerElement.dataset.subCueId = layer.subCueId;
  layerElement.style.zIndex = String(index + 1);
  layerElement.style.opacity = String(layer.opacity);
  layerElement.style.setProperty('--display-layer-transition', `${layer.transitionMs}ms`);
  layerElement.style.mixBlendMode = cssBlendMode(layer.blendAlgorithm);
  const visual = layer.visual;
  if (visual.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = layer.layerId;
    applyVisualStyle(video, visual);
    observeVideoFrames(video);
    layerElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, `stream live ${visual.capture.source}`)] : []));
    void attachLiveVisualStream(visual, video, {})
      .then((attachment) => {
        liveVisualCleanups.set(layer.layerId, attachment.cleanup);
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
        return `${layer.layerId}:${layer.order}:${layer.opacity}:${layer.blendAlgorithm}:${visual.kind}:${
          visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty'
        }:${visual.ready ? 'ready' : 'not-ready'}:${visual.error ?? ''}:${visual.opacity ?? 1}:${visual.brightness ?? 1}:${
          visual.contrast ?? 1
        }:${visual.playbackRate ?? 1}`;
      });
    return `${zone.zoneId}[${layers.join(',')}]`;
  });
  return `stream:${frame.displayId}:${frame.layout.type}:${frame.mode}:${frame.algorithm}:${frame.transitionMs}:${zones.join('|')}`;
}

function syncVideoElements(display: DisplayWindowState, state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  currentDirectorSeconds = targetSeconds;
  const syncKey = createPlaybackSyncKey(state);
  for (const video of videoElements.values()) {
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
    const runtime = visual as (VisualState & { runtimeOffsetSeconds?: number; runtimeLoop?: LoopState }) | undefined;
    const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
    const effectiveTarget = getMediaEffectiveTime(
      (baseTarget - runtimeOffsetSeconds) * (visual?.playbackRate ?? 1),
      visualDuration,
      runtime?.runtimeLoop ?? state.loop,
    );
    syncTimedMediaElement(
      video,
      effectiveTarget,
      !state.paused,
      shouldApplyCorrection ? `${syncKey}:correction:${correction.revision}` : syncKey,
      DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS,
      {
        syncKeySeekThresholdSeconds: SYNC_KEY_SEEK_THRESHOLD_SECONDS,
        onSeekStart: () => {
          mediaSeekCount += 1;
        },
        onSeekComplete: ({ durationMs, usedFallback }) => {
          lastMediaSeekDurationMs = durationMs;
          if (usedFallback) {
            mediaSeekFallbackCount += 1;
          }
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
}

function applyVisualStyle(element: HTMLElement, visual: VisualState): void {
  element.style.opacity = element.closest('.display-layer') ? '1' : String(visual.opacity ?? 1);
  element.style.filter = `brightness(${visual.brightness ?? 1}) contrast(${visual.contrast ?? 1})`;
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
  const videos = Array.from(videoElements.values()).filter((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA);
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
          const runtime = visual as (VisualState & { runtimeOffsetSeconds?: number; runtimeLoop?: LoopState }) | undefined;
          const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
          const targetSeconds = getMediaEffectiveTime(
            (directorSeconds - runtimeOffsetSeconds) * (visual?.playbackRate ?? 1),
            visual?.durationSeconds,
            runtime?.runtimeLoop ?? state.loop,
          );
          const drift = video.currentTime - targetSeconds;
          return Math.abs(drift) > Math.abs(max) ? drift : max;
        }, 0)
      : 0;
  const videoDiagnostics = summarizeVideoDiagnostics(videos);
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
}, DISPLAY_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  unsubscribeIdentifyFlash?.();
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
