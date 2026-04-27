import './styles.css';
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
const appliedCorrectionRevisions = new Set<number>();
const videoElements = new Map<VisualId, HTMLVideoElement>();
const SEEK_THRESHOLD_SECONDS = 0.12;

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
  const display = state.displays[displayId];
  if (!display) {
    displayRoot.replaceChildren();
    const missing = document.createElement('section');
    missing.className = 'slot';
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
  visualElement.className = 'slot';
  if (visual?.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
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
  overlay.className = 'slot-overlay';
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
    return `${visualId}:${visual?.url ?? 'empty'}:${visual?.ready ? 'ready' : 'not-ready'}:${visual?.error ?? ''}`;
  });
  return `${describeLayout(layout)}|${visualParts.join('|')}`;
}

function syncVideoElements(display: DisplayWindowState, state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  currentDirectorSeconds = targetSeconds;
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
    const visualDuration = visualId ? state.visuals[visualId]?.durationSeconds : undefined;
    const effectiveTarget = getMediaEffectiveTime(shouldApplyCorrection ? correction.targetSeconds! : targetSeconds, visualDuration, state.loop);
    if (Math.abs(video.currentTime - effectiveTarget) > SEEK_THRESHOLD_SECONDS) {
      video.currentTime = clampVideoTime(effectiveTarget, video);
    }
    if (correction?.revision !== undefined && shouldApplyCorrection) {
      appliedCorrectionRevisions.add(correction.revision);
    }
    video.playbackRate = state.rate;
    if (state.paused) {
      video.pause();
    } else if (video.paused) {
      void video.play().catch(() => undefined);
    }
  }
}

function clampVideoTime(seconds: number, video: HTMLVideoElement): number {
  const safeSeconds = Math.max(0, seconds);
  if (!Number.isFinite(video.duration)) {
    return safeSeconds;
  }
  return Math.min(safeSeconds, Math.max(0, video.duration - 0.001));
}

window.xtream.director.onState(handleState);
void window.xtream.renderer.ready({ kind: 'display', displayId });
void window.xtream.director.getState().then(handleState);

driftTimer = window.setInterval(() => {
  const videos = Array.from(videoElements.values()).filter((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA);
  const directorSeconds = currentState ? getDirectorSeconds(currentState) : currentDirectorSeconds;
  currentDirectorSeconds = directorSeconds;
  const driftSeconds =
    videos.length > 0
      ? videos.reduce((max, video) => {
          const drift = video.currentTime - directorSeconds;
          return Math.abs(drift) > Math.abs(max) ? drift : max;
        }, 0)
      : 0;
  void window.xtream.renderer.reportDrift({
    kind: 'display',
    displayId,
    observedSeconds: videos[0]?.currentTime ?? directorSeconds,
    directorSeconds,
    driftSeconds,
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
