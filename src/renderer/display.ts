import './styles.css';
import { describeLayout, getLayoutSlots } from '../shared/layouts';
import { getDirectorSeconds } from '../shared/timeline';
import type { DirectorState, DisplayWindowState, LayoutProfile, SlotId, SlotState } from '../shared/types';

const root = document.querySelector<HTMLDivElement>('#displayRoot');
const params = new URLSearchParams(window.location.search);
const displayId = params.get('id') ?? 'unknown-display';
const showDiagnosticsOverlay = params.get('diagnostics') === '1';

let currentDisplay: DisplayWindowState | undefined;
let currentRenderSignature = '';
let currentState: DirectorState | undefined;
let currentDirectorSeconds = 0;
let driftTimer: number | undefined;
let syncTimer: number | undefined;
const appliedCorrectionRevisions = new Set<number>();

const videoElements = new Map<SlotId, HTMLVideoElement>();
const SEEK_THRESHOLD_SECONDS = 0.12;

if (!root) {
  throw new Error('Missing display root.');
}

const displayRoot = root;

function renderLayout(layout: LayoutProfile, slotsById: Record<SlotId, SlotState>): void {
  displayRoot.className = layout.type === 'split' ? 'display-root split' : 'display-root';
  displayRoot.replaceChildren();
  videoElements.clear();

  const slots = getLayoutSlots(layout);
  for (const slot of slots) {
    const slotElement = createSlotElement(slot, slotsById[slot]);
    displayRoot.append(slotElement);
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

  const renderSignature = createRenderSignature(display.layout, state.slots);
  if (currentRenderSignature !== renderSignature) {
    renderLayout(display.layout, state.slots);
    currentRenderSignature = renderSignature;
  }

  currentDisplay = display;
  syncVideoElements(state);
}

function createSlotElement(slotId: SlotId, slot: SlotState | undefined): HTMLElement {
  const slotElement = document.createElement('section');
  slotElement.className = 'slot';

  if (slot?.videoUrl) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = slot.videoUrl;
    video.dataset.slotId = slotId;
    video.addEventListener('loadedmetadata', () => {
      void window.xtream.slots.reportMetadata({
        slotId,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
        ready: true,
      });
    });
    video.addEventListener('error', () => {
      void window.xtream.slots.reportMetadata({
        slotId,
        ready: false,
        error: video.error?.message ?? 'Video failed to load.',
      });
    });

    if (showDiagnosticsOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'slot-overlay';
      overlay.append(createTextSpan(`Slot ${slotId}`), createTextSpan('muted video rail'));
      slotElement.append(video, overlay);
    } else {
      slotElement.append(video);
    }
    videoElements.set(slotId, video);
    return slotElement;
  }

  const slotLabel = document.createElement('span');
  slotLabel.textContent = slotId;

  const slotMeta = document.createElement('small');
  slotMeta.textContent = 'no video selected';

  slotElement.append(slotLabel, slotMeta);
  return slotElement;
}

function createTextSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function createRenderSignature(layout: LayoutProfile, slotsById: Record<SlotId, SlotState>): string {
  const slotParts = getLayoutSlots(layout).map((slotId) => {
    const slot = slotsById[slotId];
    return `${slotId}:${slot?.videoUrl ?? 'empty'}:${slot?.ready ? 'ready' : 'not-ready'}:${slot?.error ?? ''}`;
  });

  return `${describeLayout(layout)}|${slotParts.join('|')}`;
}

function syncVideoElements(state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  currentDirectorSeconds = targetSeconds;

  for (const video of videoElements.values()) {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }

    const correction = state.corrections.displays[displayId];
    const shouldApplyCorrection =
      correction?.action === 'seek' &&
      correction.targetSeconds !== undefined &&
      !appliedCorrectionRevisions.has(correction.revision);
    const correctionTarget = shouldApplyCorrection ? correction.targetSeconds : undefined;
    const effectiveTarget = correctionTarget ?? targetSeconds;

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
      void video.play().catch(() => {
        // Muted video should autoplay, but keep sync attempts non-fatal on platform quirks.
      });
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
  const videos = Array.from(videoElements.values()).filter(
    (video) => video.readyState >= HTMLMediaElement.HAVE_METADATA,
  );
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
    syncVideoElements(currentState);
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
