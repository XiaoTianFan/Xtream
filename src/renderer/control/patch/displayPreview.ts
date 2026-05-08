import { getDirectorSeconds, getMediaEffectiveTime } from '../../../shared/timeline';
import type { DirectorState, DisplayWindowState, DisplayZoneId, LoopState, VisualId, VisualLayoutProfile, VisualState } from '../../../shared/types';
import { DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS } from '../../../shared/types';
import { createPreviewLabel } from '../shared/dom';
import { createPlaybackSyncKey, syncTimedMediaElement } from '../media/mediaSync';
import { attachLiveVisualStream, reportLiveVisualError } from '../media/liveCaptureRuntime';
import type { DisplayPreviewProgressEdge } from '../shared/types';

const DISPLAY_PREVIEW_MAX_WIDTH = 854;
const DISPLAY_PREVIEW_MAX_HEIGHT = 480;
const DISPLAY_PREVIEW_DURATION_MATCH_TOLERANCE_SECONDS = 0.05;
const displayPreviewCanvases = new WeakMap<HTMLVideoElement, { canvas: HTMLCanvasElement; lastDrawMs: number }>();
const livePreviewCleanups = new Map<HTMLVideoElement, () => void>();

type RuntimeVisualState = VisualState & {
  runtimeOffsetSeconds?: number;
  runtimeLoop?: LoopState;
};

export type DisplayPreviewZoneEntry = {
  zoneId: DisplayZoneId;
  visualId?: VisualId;
};

export function getDisplayPreviewMinFrameIntervalMs(state: DirectorState): number {
  const fps = state.controlDisplayPreviewMaxFps ?? DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS;
  const clamped = Math.min(60, Math.max(1, fps));
  return 1000 / clamped;
}

export function applyVisualStyle(element: HTMLElement, visual: VisualState): void {
  element.style.opacity = String(visual.opacity ?? 1);
  element.style.filter = `brightness(${visual.brightness ?? 1}) contrast(${visual.contrast ?? 1})`;
}

export function applyDisplayBlackoutFadeStyle(element: HTMLElement, fadeOutSeconds: number): void {
  element.style.setProperty('--display-blackout-fade', `${Math.max(0, fadeOutSeconds)}s`);
}

export function createDisplayPreview(display: DisplayWindowState, state: DirectorState | undefined): HTMLElement {
  const preview = document.createElement('div');
  preview.className = `display-preview ${display.layout.type}`;
  preview.classList.toggle('blacked-out', Boolean(state?.globalDisplayBlackout));
  if (state) {
    applyDisplayBlackoutFadeStyle(preview, state.globalDisplayBlackoutFadeOutSeconds);
  }
  if (!state) {
    preview.textContent = 'Preview unavailable';
    return preview;
  }
  for (const entry of getDisplayPreviewZoneEntries(display.layout)) {
    preview.append(createDisplayPreviewPane(display, state, entry));
  }
  const progressEdge = getDisplayPreviewProgressEdge(display, state);
  if (progressEdge) {
    preview.append(createDisplayPreviewProgressEdge(progressEdge));
  }
  return preview;
}

export function getDisplayPreviewZoneEntries(layout: VisualLayoutProfile): DisplayPreviewZoneEntry[] {
  if (layout.type === 'single') {
    return [{ zoneId: 'single', visualId: layout.visualId }];
  }
  return [
    { zoneId: 'L', visualId: layout.visualIds[0] },
    { zoneId: 'R', visualId: layout.visualIds[1] },
  ];
}

function createDisplayPreviewPane(display: DisplayWindowState, state: DirectorState, entry: DisplayPreviewZoneEntry): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'display-preview-pane';
  pane.dataset.displayZone = entry.zoneId;
  if (!entry.visualId) {
    pane.append(createPreviewLabel('No visual selected', getDisplayZoneEmptyLabel(entry.zoneId)));
    return pane;
  }

  pane.dataset.visualId = entry.visualId;
  const visual = state.visuals[entry.visualId];
  if (!visual?.url) {
    if (visual?.kind === 'live') {
      const video = document.createElement('video');
      video.dataset.visualId = entry.visualId;
      video.dataset.livePreviewVideo = 'true';
      applyVisualStyle(video, visual);
      void attachLiveVisualStream(visual, video, {
        reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report),
      })
        .then((attachment) => {
          livePreviewCleanups.set(video, attachment.cleanup);
          reportPreviewStatus(`display:${display.id}:${entry.visualId}`, entry.visualId, true, undefined, display.id);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Live preview failed.';
          reportLiveVisualError(visual, { reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report) }, message);
          reportPreviewStatus(
            `display:${display.id}:${entry.visualId}`,
            entry.visualId,
            false,
            message,
            display.id,
          );
        });
      pane.append(video);
    } else {
      pane.append(createPreviewLabel(visual?.label ?? entry.visualId, visual ? 'No preview available' : 'Missing visual'));
    }
    return pane;
  }

  if (visual.type === 'image') {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    image.addEventListener('load', () => reportPreviewStatus(`display:${display.id}:${entry.visualId}`, entry.visualId, true, undefined, display.id));
    image.addEventListener('error', () =>
      reportPreviewStatus(`display:${display.id}:${entry.visualId}`, entry.visualId, false, `${display.id} image preview failed to load.`, display.id),
    );
    pane.append(image);
    return pane;
  }

  if (state.performanceMode) {
    pane.append(createPreviewLabel(visual.label, 'video preview disabled in performance mode'));
    return pane;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = visual.url;
  video.dataset.visualId = entry.visualId;
  video.dataset.previewVideo = 'true';
  video.style.display = 'none';
  applyVisualStyle(video, visual);
  video.playbackRate = state.rate * (visual.playbackRate ?? 1);
  video.addEventListener('loadedmetadata', () => reportPreviewStatus(`display:${display.id}:${entry.visualId}`, entry.visualId, true, undefined, display.id));
  video.addEventListener('error', () =>
    reportPreviewStatus(`display:${display.id}:${entry.visualId}`, entry.visualId, false, `${display.id} video preview failed to load.`, display.id),
  );
  const canvas = createDisplayPreviewCanvas(video);
  pane.append(video, canvas);
  return pane;
}

function getDisplayZoneEmptyLabel(zoneId: DisplayZoneId): string {
  if (zoneId === 'L') {
    return 'Left zone';
  }
  if (zoneId === 'R') {
    return 'Right zone';
  }
  return 'Drop visual here';
}

function getDisplayPreviewProgressEdge(display: DisplayWindowState, state: DirectorState): DisplayPreviewProgressEdge | undefined {
  if (state.performanceMode) {
    return undefined;
  }
  if (display.layout.type === 'single') {
    return getVisualProgressEdge(state.visuals[display.layout.visualId ?? '']);
  }
  const [leftVisualId, rightVisualId] = display.layout.visualIds;
  if (!leftVisualId || !rightVisualId) {
    return undefined;
  }
  const leftEdge = getVisualProgressEdge(state.visuals[leftVisualId]);
  const rightEdge = getVisualProgressEdge(state.visuals[rightVisualId]);
  if (!leftEdge || !rightEdge) {
    return undefined;
  }
  if (Math.abs(leftEdge.durationSeconds - rightEdge.durationSeconds) > DISPLAY_PREVIEW_DURATION_MATCH_TOLERANCE_SECONDS) {
    return undefined;
  }
  return leftEdge;
}

function getVisualProgressEdge(visual: VisualState | undefined): DisplayPreviewProgressEdge | undefined {
  if (visual?.type !== 'video' || !visual.url || !Number.isFinite(visual.durationSeconds) || visual.durationSeconds === undefined || visual.durationSeconds <= 0) {
    return undefined;
  }
  return {
    visualId: visual.id,
    durationSeconds: visual.durationSeconds,
    playbackRate: visual.playbackRate ?? 1,
  };
}

function createDisplayPreviewProgressEdge(edge: DisplayPreviewProgressEdge): HTMLDivElement {
  const progress = document.createElement('div');
  progress.className = 'display-preview-progress-edge';
  progress.dataset.progressVisualId = edge.visualId;
  progress.dataset.progressDurationSeconds = String(edge.durationSeconds);
  progress.dataset.progressPlaybackRate = String(edge.playbackRate);
  progress.style.setProperty('--display-preview-progress', '0%');
  return progress;
}

function reportPreviewStatus(key: string, visualId: string | undefined, ready: boolean, error?: string, displayId?: string): void {
  void window.xtream.renderer.reportPreviewStatus({
    key,
    displayId,
    visualId,
    ready,
    error,
    reportedAtWallTimeMs: Date.now(),
  });
}

function createDisplayPreviewCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'display-preview-canvas';
  canvas.width = DISPLAY_PREVIEW_MAX_WIDTH;
  canvas.height = DISPLAY_PREVIEW_MAX_HEIGHT;
  displayPreviewCanvases.set(video, { canvas, lastDrawMs: 0 });
  video.addEventListener('loadedmetadata', () => resizeDisplayPreviewCanvas(video, canvas));
  return canvas;
}

function resizeDisplayPreviewCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const sourceWidth = video.videoWidth || DISPLAY_PREVIEW_MAX_WIDTH;
  const sourceHeight = video.videoHeight || DISPLAY_PREVIEW_MAX_HEIGHT;
  const scale = Math.min(DISPLAY_PREVIEW_MAX_WIDTH / sourceWidth, DISPLAY_PREVIEW_MAX_HEIGHT / sourceHeight, 1);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
}

function drawDisplayPreviewFrame(video: HTMLVideoElement, state: DirectorState): void {
  const preview = displayPreviewCanvases.get(video);
  if (!preview || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const now = performance.now();
  const minInterval = getDisplayPreviewMinFrameIntervalMs(state);
  if (now - preview.lastDrawMs < minInterval) {
    return;
  }
  preview.lastDrawMs = now;
  if (video.videoWidth > 0 && video.videoHeight > 0 && (preview.canvas.width === DISPLAY_PREVIEW_MAX_WIDTH || preview.canvas.height === DISPLAY_PREVIEW_MAX_HEIGHT)) {
    resizeDisplayPreviewCanvas(video, preview.canvas);
  }
  const context = preview.canvas.getContext('2d');
  context?.drawImage(video, 0, 0, preview.canvas.width, preview.canvas.height);
}

export function getPreviewVisualIds(layout: VisualLayoutProfile): VisualId[] {
  return layout.type === 'single' ? (layout.visualId ? [layout.visualId] : []) : layout.visualIds.filter(Boolean) as VisualId[];
}

function getPreviewEffectiveTargetSeconds(
  directorSeconds: number,
  visual: VisualState | undefined,
  fallbackDurationSeconds: number | undefined,
  stateLoop: LoopState,
): number {
  const runtime = visual as RuntimeVisualState | undefined;
  const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
  const playbackRate = visual?.playbackRate ?? 1;
  return getMediaEffectiveTime(
    (directorSeconds - runtimeOffsetSeconds) * playbackRate,
    visual?.durationSeconds ?? fallbackDurationSeconds,
    runtime?.runtimeLoop ?? stateLoop,
  );
}

export function syncPreviewElements(state: DirectorState): void {
  cleanupDisconnectedLivePreviews();
  syncDisplayPreviewProgressEdges(state);
  if (state.performanceMode) {
    document.querySelectorAll<HTMLVideoElement>('video[data-preview-video="true"]').forEach((video) => video.pause());
    return;
  }
  const targetSeconds = getDirectorSeconds(state);
  const syncKey = createPlaybackSyncKey(state);
  const videos = document.querySelectorAll<HTMLVideoElement>('video[data-preview-video="true"]');
  for (const video of videos) {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }
    const visualId = video.dataset.visualId;
    const visual = visualId ? state.visuals[visualId] : undefined;
    const effectiveTarget = getPreviewEffectiveTargetSeconds(targetSeconds, visual, video.duration, state.loop);
    video.playbackRate = state.rate;
    if (visual) {
      video.playbackRate = state.rate * (visual.playbackRate ?? 1);
      applyVisualStyle(video, visual);
    }
    syncTimedMediaElement(video, effectiveTarget, !state.paused, syncKey, 0.75);
    drawDisplayPreviewFrame(video, state);
  }
}

function cleanupDisconnectedLivePreviews(): void {
  for (const [video, cleanup] of livePreviewCleanups) {
    if (video.isConnected) {
      continue;
    }
    cleanup();
    livePreviewCleanups.delete(video);
  }
}

function syncDisplayPreviewProgressEdges(state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  document.querySelectorAll<HTMLElement>('[data-display-preview]').forEach((preview) => {
    const displayId = preview.dataset.displayPreview;
    const display = displayId ? state.displays[displayId] : undefined;
    const edge = display ? getDisplayPreviewProgressEdge(display, state) : undefined;
    let edgeElement = preview.querySelector<HTMLElement>('.display-preview-progress-edge');
    if (!edge) {
      edgeElement?.style.setProperty('--display-preview-progress', '0%');
      edgeElement?.setAttribute('hidden', '');
      return;
    }
    if (!edgeElement) {
      edgeElement = createDisplayPreviewProgressEdge(edge);
      preview.append(edgeElement);
    }
    edgeElement.hidden = false;
    edgeElement.dataset.progressVisualId = edge.visualId;
    edgeElement.dataset.progressDurationSeconds = String(edge.durationSeconds);
    edgeElement.dataset.progressPlaybackRate = String(edge.playbackRate);
    const effectiveTarget = getPreviewEffectiveTargetSeconds(targetSeconds, state.visuals[edge.visualId], edge.durationSeconds, state.loop);
    const progress = Math.min(100, Math.max(0, (effectiveTarget / edge.durationSeconds) * 100));
    edgeElement.style.setProperty('--display-preview-progress', `${progress}%`);
  });
}
