/// <reference path="./global.d.ts" />
import './display.css';
import { describeLayout, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds, getMediaEffectiveTime } from '../shared/timeline';
import type { DirectorState, DisplayWindowState, VisualId, VisualLayoutProfile, VisualState } from '../shared/types';

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
const appliedCorrectionRevisions = new Set<number>();
const videoElements = new Map<VisualId, HTMLVideoElement>();
const mediaSyncStates = new WeakMap<HTMLMediaElement, MediaSyncState>();
const SEEK_THRESHOLD_SECONDS = 0.12;

type MediaSyncState = {
  pendingSeekSeconds?: number;
  playAfterSeek?: boolean;
  lastPlayAttemptMs?: number;
  lastSyncKey?: string;
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
        hasEmbeddedAudio: hasAudioTracks(video),
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

function hasAudioTracks(video: HTMLVideoElement): boolean | undefined {
  const maybeTracks = video as HTMLVideoElement & {
    audioTracks?: { length: number };
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
  };
  if (maybeTracks.audioTracks) {
    return maybeTracks.audioTracks.length > 0;
  }
  if (typeof maybeTracks.mozHasAudio === 'boolean') {
    return maybeTracks.mozHasAudio;
  }
  if (typeof maybeTracks.webkitAudioDecodedByteCount === 'number') {
    return maybeTracks.webkitAudioDecodedByteCount > 0;
  }
  return undefined;
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
    syncTimedMediaElement(video, effectiveTarget, !state.paused, shouldApplyCorrection ? `${syncKey}:correction:${correction.revision}` : syncKey, 0.75, clampVideoTime);
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

function syncTimedMediaElement(
  element: HTMLMediaElement,
  targetSeconds: number,
  shouldPlay: boolean,
  syncKey: string,
  driftSeekThresholdSeconds: number,
  clamp: (seconds: number, element: HTMLMediaElement) => number,
): void {
  const state = getMediaSyncState(element);
  const clampedTarget = clamp(targetSeconds, element);
  const hasPendingSeek = state.pendingSeekSeconds !== undefined;
  if (hasPendingSeek) {
    state.playAfterSeek = shouldPlay;
    if (!shouldPlay) {
      element.pause();
    }
    return;
  }

  const syncKeyChanged = state.lastSyncKey !== syncKey;
  state.lastSyncKey = syncKey;
  const driftSeconds = Math.abs(element.currentTime - clampedTarget);
  const shouldSeek = syncKeyChanged ? driftSeconds > 0.05 : driftSeconds > driftSeekThresholdSeconds;
  if (shouldSeek) {
    state.pendingSeekSeconds = clampedTarget;
    state.playAfterSeek = shouldPlay;
    const completeSeek = () => {
      element.removeEventListener('seeked', completeSeek);
      state.pendingSeekSeconds = undefined;
      if (state.playAfterSeek) {
        requestMediaPlay(element, state, true);
      }
    };
    element.addEventListener('seeked', completeSeek, { once: true });
    element.currentTime = clampedTarget;
    window.setTimeout(() => {
      if (state.pendingSeekSeconds === clampedTarget) {
        completeSeek();
      }
    }, 250);
    if (!shouldPlay) {
      element.pause();
    }
    return;
  }

  if (!shouldPlay) {
    element.pause();
    return;
  }
  requestMediaPlay(element, state);
}

function createPlaybackSyncKey(state: DirectorState): string {
  return JSON.stringify({
    paused: state.paused,
    anchorWallTimeMs: state.anchorWallTimeMs,
    offsetSeconds: state.offsetSeconds,
    rate: state.rate,
    loop: state.loop,
  });
}

function getMediaSyncState(element: HTMLMediaElement): MediaSyncState {
  let state = mediaSyncStates.get(element);
  if (!state) {
    state = {};
    mediaSyncStates.set(element, state);
  }
  return state;
}

function requestMediaPlay(element: HTMLMediaElement, state = getMediaSyncState(element), immediate = false): void {
  const now = Date.now();
  if (!immediate && state.lastPlayAttemptMs !== undefined && now - state.lastPlayAttemptMs < 500) {
    return;
  }
  state.lastPlayAttemptMs = now;
  void element.play().catch(() => undefined);
}

function clampVideoTime(seconds: number, video: HTMLMediaElement): number {
  const safeSeconds = Math.max(0, seconds);
  if (!Number.isFinite(video.duration)) {
    return safeSeconds;
  }
  return Math.min(safeSeconds, Math.max(0, video.duration - 0.001));
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
          const visualDuration = visualId ? state.visuals[visualId]?.durationSeconds : undefined;
          const targetSeconds = getMediaEffectiveTime(directorSeconds, visualDuration, state.loop);
          const drift = video.currentTime - targetSeconds;
          return Math.abs(drift) > Math.abs(max) ? drift : max;
        }, 0)
      : 0;
  void window.xtream.renderer.reportDrift({
    kind: 'display',
    displayId,
    observedSeconds: videos[0]?.currentTime ?? directorSeconds,
    directorSeconds,
    driftSeconds,
    frameRateFps: lastFrameRateFps,
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
}, 250);

window.addEventListener('beforeunload', () => {
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
  if (syncTimer !== undefined) {
    window.clearInterval(syncTimer);
  }
});
