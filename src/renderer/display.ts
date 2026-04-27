/// <reference path="./global.d.ts" />
import './display.css';
import { describeLayout, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds, getMediaEffectiveTime } from '../shared/timeline';
import type { DirectorState, DisplayWindowState, VisualId, VisualLayoutProfile, VisualState } from '../shared/types';
import { createPlaybackSyncKey, getMediaSyncState, syncTimedMediaElement } from './control/mediaSync';
import { hasEmbeddedAudioTrack } from './mediaMetadata';

const root = document.querySelector<HTMLDivElement>('#displayRoot');
const params = new URLSearchParams(window.location.search);
const displayId = params.get('id') ?? 'unknown-display';
const showDiagnosticsOverlay = params.get('diagnostics') === '1';

let currentRenderSignature = '';
let currentState: DirectorState | undefined;
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
const videoFrameStats = new WeakMap<HTMLVideoElement, VideoFrameStats>();
const DISPLAY_SYNC_INTERVAL_MS = 500;
const DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS = 0.5;
const SYNC_KEY_SEEK_THRESHOLD_SECONDS = 0.12;

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

function renderLayout(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): void {
  displayRoot.className = layout.type === 'split' ? 'display-root split' : 'display-root';
  displayRoot.replaceChildren();
  videoElements.clear();
  for (const visualId of getLayoutVisualIds(layout)) {
    displayRoot.append(createVisualElement(visualId, visualsById[visualId]));
  }
}

function handleState(state: DirectorState): void {
  currentState = state;
  currentDirectorSeconds = getDirectorSeconds(state);
  displayRoot.style.setProperty('--display-blackout-fade', `${Math.max(0, state.globalDisplayBlackoutFadeOutSeconds)}s`);
  displayRoot.classList.toggle('blacked-out', state.globalDisplayBlackout);
  const display = state.displays[displayId];
  if (!display) {
    displayRoot.replaceChildren();
    const missing = document.createElement('section');
    missing.className = 'display-output';
    missing.textContent = 'UNMAPPED';
    displayRoot.append(missing);
    return;
  }
  const renderSignature = createRenderSignature(display.layout, state.visuals);
  if (currentRenderSignature !== renderSignature) {
    renderLayout(display.layout, state.visuals);
    currentRenderSignature = renderSignature;
  }
  syncVideoElements(display, state);
}

function createVisualElement(visualId: VisualId, visual: VisualState | undefined): HTMLElement {
  const visualElement = document.createElement('section');
  visualElement.className = 'display-output';
  if (visual?.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    image.addEventListener('load', () => {
      void window.xtream.visuals.reportMetadata({
        visualId,
        width: image.naturalWidth,
        height: image.naturalHeight,
        ready: true,
      });
    });
    image.addEventListener('error', () => {
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
    return `${visualId}:${visual?.url ?? 'empty'}:${visual?.ready ? 'ready' : 'not-ready'}:${visual?.error ?? ''}:${visual?.opacity ?? 1}:${
      visual?.brightness ?? 1
    }:${visual?.contrast ?? 1}:${visual?.playbackRate ?? 1}`;
  });
  return `${describeLayout(layout)}|${visualParts.join('|')}`;
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
    const effectiveTarget = getMediaEffectiveTime(baseTarget * (visual?.playbackRate ?? 1), visualDuration, state.loop);
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
  element.style.opacity = String(visual.opacity ?? 1);
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
void window.xtream.renderer.ready({ kind: 'display', displayId });
void window.xtream.director.getState().then(handleState);

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
          const targetSeconds = getMediaEffectiveTime(directorSeconds * (visual?.playbackRate ?? 1), visual?.durationSeconds, state.loop);
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
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
  if (syncTimer !== undefined) {
    window.clearInterval(syncTimer);
  }
});
