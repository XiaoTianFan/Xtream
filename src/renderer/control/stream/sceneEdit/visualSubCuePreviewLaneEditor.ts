import type {
  DirectorState,
  PersistedVisualSubCueConfig,
  SceneLoopPolicy,
  VisualState,
  VisualSubCuePreviewPayload,
  VisualSubCuePreviewPosition,
} from '../../../../shared/types';
import { evaluateFadeGain } from '../../../../shared/audioSubCueAutomation';
import { mapElapsedToLoopPhase, resolveLoopTiming } from '../../../../shared/streamLoopTiming';
import {
  clampVisualSourceRange,
  getVisualSubCueBaseDurationMs,
  normalizeVisualSourceRange,
  normalizeVisualFreezeFrameMs,
} from '../../../../shared/visualSubCueTiming';
import { decorateRailButton } from '../../shared/icons';
import { createSubCueSection } from './subCueFormControls';
import { createDraggableNumberField } from './draggableNumberField';
import {
  createPlaceholderVisualPreviewSnapshots,
  getCachedVisualPreviewSnapshots,
  loadVisualPreviewSnapshots,
  setLiveVisualPreviewSnapshot,
  type VisualPreviewSnapshot,
} from './visualPreviewSnapshots';
import {
  clampFreezeFrameMs,
  clampVisualFadeDurationMs,
  cursorForVisualPreviewLaneHit,
  cycleFadeCurve,
  hitTestVisualPreviewLane,
  laneXToMs,
  msToLaneX,
  normalizeVisualDurationForLane,
  type VisualPreviewLaneHitTarget,
  type VisualPreviewLaneRect,
} from './visualPreviewLaneGeometry';

export type VisualSubCuePreviewLaneEditorDeps = {
  sub: PersistedVisualSubCueConfig;
  currentState: DirectorState;
  patchSubCue: (update: Partial<PersistedVisualSubCueConfig>) => void;
};

type VisualPreviewMediaMode = 'video-file' | 'image' | 'live' | 'missing';

type DragState = {
  target: VisualPreviewLaneHitTarget;
};

const VISUAL_LANE_HEIGHT = 164;
const SNAPSHOT_COUNT = 12;
const DEFAULT_IMAGE_OR_LIVE_LANE_MS = 10_000;
const VISUAL_LANE_EDGE_STROKE_PX = 2;

export function createVisualSubCuePreviewLaneEditor(deps: VisualSubCuePreviewLaneEditorDeps): HTMLElement {
  const { currentState, patchSubCue } = deps;
  let draftSub: PersistedVisualSubCueConfig = { ...deps.sub, targets: [...deps.sub.targets] };
  let pendingLanePatch: Partial<PersistedVisualSubCueConfig> | undefined;
  const cachedSnapshots = getCachedVisualPreviewSnapshots(selectedVisual(), { sampleCount: SNAPSHOT_COUNT });
  let snapshots: VisualPreviewSnapshot[] =
    cachedSnapshots ?? createPlaceholderVisualPreviewSnapshots(laneSnapshotDurationMs(), SNAPSHOT_COUNT, selectedVisual() ? 'pending' : 'placeholder');
  let snapshotState: 'pending' | 'ready' | 'missing' | 'error' = visualSnapshotState(selectedVisual(), cachedSnapshots);
  let snapshotLoadVersion = 0;
  let hover: VisualPreviewLaneHitTarget = { type: 'disabled' };
  let drag: DragState | undefined;
  let freezePinMode = false;
  let previewPlaying = false;
  let previewActive = false;
  let previewStartedAtMs: number | undefined;
  let previewPausedAtMs = 0;
  let previewSourceTimeMs: number | undefined;
  let previewFrame: number | undefined;
  let previewDispatchMessage: string | undefined;
  const previewPositions = new Map<string, VisualSubCuePreviewPosition>();
  let activeFreezeMenu: HTMLElement | undefined;
  let disposed = false;

  const previewId = `visual-subcue-preview:${draftSub.id}`;
  const root = document.createElement('div');
  root.className = 'stream-visual-preview-lane-editor';
  for (const eventName of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) {
    root.addEventListener(eventName, (event) => {
      if (eventName === 'click') {
        dismissFreezeMarkerMenu();
      }
      event.stopPropagation();
    });
  }

  const rail = document.createElement('div');
  rail.className = 'stream-visual-preview-lane-rail stream-audio-waveform-rail';
  const playButton = createRailButton('Play', () => {
    const payload = buildVisualSubCuePreviewPayload(draftSub, currentState, previewId, getPreviewElapsedMs());
    if (!payload || !window.xtream.visualRuntime?.preview) {
      return;
    }
    startPreview(payload);
  });
  const pauseButton = createRailButton('Pause', () => pausePreview());
  const freezeButton = createRailButton('Freeze pin', () => {
    freezePinMode = !freezePinMode;
    syncRailButtons();
    render();
  });
  decorateRailButton(playButton, 'Play', 'Play preview', { iconSize: 17 });
  decorateRailButton(pauseButton, 'Pause', 'Pause preview', { iconSize: 17 });
  decorateRailButton(freezeButton, 'Plus', 'Drop freeze marker', { iconSize: 17 });
  playButton.classList.add('stream-visual-preview-lane-transport');
  pauseButton.classList.add('stream-visual-preview-lane-transport');
  freezeButton.classList.add('stream-visual-preview-lane-freeze-pin');
  rail.append(playButton, pauseButton, freezeButton);

  const main = document.createElement('div');
  main.className = 'stream-visual-preview-lane-main stream-audio-waveform-main';

  const stage = document.createElement('div');
  stage.className = 'stream-visual-preview-lane-stage';
  const tiles = document.createElement('div');
  tiles.className = 'stream-visual-preview-lane-tiles';
  const overlay = document.createElement('div');
  overlay.className = 'stream-visual-preview-lane-overlay';
  const status = document.createElement('div');
  status.className = 'stream-visual-preview-lane-status';
  stage.append(tiles, overlay, status);

  const controls = document.createElement('div');
  controls.className = 'stream-visual-preview-lane-controls stream-audio-waveform-controls';
  const timingControls = createTimingControls();
  controls.append(...timingControls);

  main.append(stage, controls);
  root.append(rail, main);

  const section = createSubCueSection('Timing', root);
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(stage);
  const disconnectObserver = createDisconnectObserver(section, () => cleanup());
  const unsubscribePreviewPosition = window.xtream.visualRuntime?.onSubCuePreviewPosition?.((position) => {
    if (position.previewId !== previewId) {
      return;
    }
    previewPositions.set(position.displayId, position);
    const selectedPosition = selectedPreviewPosition();
    if (!selectedPosition) {
      return;
    }
    previewSourceTimeMs = selectedPosition.sourceTimeMs;
    previewPausedAtMs = selectedPosition.localTimeMs;
    previewPlaying = selectedPosition.playing;
    previewStartedAtMs = selectedPosition.playing ? performance.now() - selectedPosition.localTimeMs : undefined;
    if (!selectedPosition.playing) {
      stopPreviewTicker();
    }
    render();
  });
  const unsubscribePreviewSnapshot = window.xtream.visualRuntime?.onSubCuePreviewSnapshot?.((report) => {
    const visual = selectedVisual();
    if (!visual || visual.kind !== 'live' || visual.id !== report.visualId || !report.dataUrl) {
      return;
    }
    setLiveVisualPreviewSnapshot(visual, report.dataUrl, report.timeMs ?? getPreviewCursorMs());
    void loadSnapshots();
  });

  stage.addEventListener('pointermove', (event) => {
    const point = lanePoint(stage, event);
    if (drag) {
      applyDrag(point.x);
      return;
    }
    hover = hitTest(point.x, point.y);
    stage.style.cursor = cursorForVisualPreviewLaneHit(hover);
    render();
  });
  stage.addEventListener('pointerleave', () => {
    if (!drag) {
      hover = { type: 'disabled' };
      stage.style.cursor = '';
      render();
    }
  });
  stage.addEventListener('pointerdown', (event) => {
    const point = lanePoint(stage, event);
    const target = hitTest(point.x, point.y);
    if (target.type === 'disabled') {
      return;
    }
    if (target.type === 'seek') {
      seekPreviewTo(point.x);
      return;
    }
    stage.setPointerCapture(event.pointerId);
    drag = { target };
    if (target.type === 'drop-freeze' || target.type === 'freeze-marker') {
      applyFreezeAtX(point.x);
    }
  });
  stage.addEventListener('pointerup', (event) => {
    if (drag) {
      stage.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    commitPendingLanePatch();
  });
  stage.addEventListener('pointercancel', () => {
    drag = undefined;
    commitPendingLanePatch();
  });
  stage.addEventListener('dblclick', (event) => {
    const point = lanePoint(stage, event);
    const target = hitTest(point.x, point.y);
    if (target.type === 'fade-in') {
      patchAndRefreshPreview({
        fadeIn: { durationMs: draftSub.fadeIn?.durationMs ?? 0, curve: cycleFadeCurve(draftSub.fadeIn?.curve) },
      });
    } else if (target.type === 'fade-out' && !isInfiniteRender()) {
      patchAndRefreshPreview({
        fadeOut: { durationMs: draftSub.fadeOut?.durationMs ?? 0, curve: cycleFadeCurve(draftSub.fadeOut?.curve) },
      });
    }
  });
  stage.addEventListener('contextmenu', (event) => {
    const point = lanePoint(stage, event);
    if (hitTest(point.x, point.y).type !== 'freeze-marker') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showFreezeMarkerMenu(event.clientX, event.clientY);
  });

  void loadSnapshots();
  syncRailButtons();
  syncTimingControls();
  render();
  return section;

  function selectedVisual(): VisualState | undefined {
    return currentState.visuals[draftSub.visualId];
  }

  function mediaMode(): VisualPreviewMediaMode {
    const visual = selectedVisual();
    if (!visual) {
      return 'missing';
    }
    if (visual.kind === 'live') {
      return 'live';
    }
    return visual.type === 'image' ? 'image' : 'video-file';
  }

  function supportsFreeze(): boolean {
    return mediaMode() === 'video-file' || mediaMode() === 'live';
  }

  function mediaDurationMs(): number | undefined {
    const visual = selectedVisual();
    return visual?.durationSeconds !== undefined ? visual.durationSeconds * 1000 : undefined;
  }

  function playbackRate(): number {
    return draftSub.playbackRate && draftSub.playbackRate > 0 ? draftSub.playbackRate : 1;
  }

  function laneDurationMs(): number {
    if (mediaMode() === 'video-file') {
      return normalizeVisualDurationForLane(mediaDurationMs(), DEFAULT_IMAGE_OR_LIVE_LANE_MS);
    }
    const visual = selectedVisual();
    const base = getVisualSubCueBaseDurationMs(draftSub, visual);
    return normalizeVisualDurationForLane(base, DEFAULT_IMAGE_OR_LIVE_LANE_MS);
  }

  function selectedSourceRange(): { startMs: number; endMs: number; durationMs: number } {
    const durationMs = laneDurationMs();
    const range = normalizeVisualSourceRange(draftSub, selectedVisual());
    const startMs = Math.min(durationMs, Math.max(0, range.startMs));
    const endMs = Math.max(startMs, Math.min(durationMs, range.endMs ?? durationMs));
    return { startMs, endMs, durationMs: Math.max(0, endMs - startMs) };
  }

  function selectedLocalDurationMs(): number {
    const visual = selectedVisual();
    const base = getVisualSubCueBaseDurationMs(draftSub, visual);
    return normalizeVisualDurationForLane(base, DEFAULT_IMAGE_OR_LIVE_LANE_MS);
  }

  function laneSnapshotDurationMs(): number | undefined {
    const visual = selectedVisual();
    if (visual?.durationSeconds !== undefined) {
      return visual.durationSeconds * 1000;
    }
    return draftSub.durationOverrideMs;
  }

  function freezeLocalTimeMs(): number | undefined {
    if (draftSub.freezeFrameMs === undefined || !supportsFreeze()) {
      return undefined;
    }
    return mediaMode() === 'video-file' ? draftSub.freezeFrameMs : draftSub.freezeFrameMs;
  }

  function freezeFrameFromLocalTimeMs(localTimeMs: number): number | undefined {
    if (!supportsFreeze()) {
      return undefined;
    }
    const raw = mediaMode() === 'video-file' ? localTimeMs : localTimeMs;
    return clampFreezeFrameMs(raw, mediaMode() === 'video-file' ? mediaDurationMs() : undefined);
  }

  function isInfiniteRender(): boolean {
    return Boolean(draftSub.loop?.enabled && draftSub.loop.iterations.type === 'infinite');
  }

  function hitTest(x: number, y: number): VisualPreviewLaneHitTarget {
    return hitTestVisualPreviewLane(
      {
        durationMs: laneDurationMs(),
        fadeIn: draftSub.fadeIn,
        fadeOut: draftSub.fadeOut,
        sourceStartMs: mediaMode() === 'video-file' ? selectedSourceRange().startMs : undefined,
        sourceEndMs: mediaMode() === 'video-file' ? selectedSourceRange().endMs : undefined,
        rangeEditable: mediaMode() === 'video-file',
        freezeFrameMs: supportsFreeze() ? draftSub.freezeFrameMs : undefined,
        freezeLocalTimeMs: freezeLocalTimeMs(),
        freezePinMode: freezePinMode && supportsFreeze(),
        fadeOutDisabled: isInfiniteRender(),
      },
      laneRect(),
      x,
      y,
    );
  }

  function applyDrag(x: number): void {
    if (!drag) {
      return;
    }
    if (drag.target.type === 'range-start' || drag.target.type === 'range-end') {
      if (mediaMode() !== 'video-file') {
        return;
      }
      const durationMs = laneDurationMs();
      const range = selectedSourceRange();
      const mediaMs = laneXToMs(x, durationMs, laneRect());
      const next = clampVisualSourceRange({
        startMs: drag.target.type === 'range-start' ? mediaMs : range.startMs,
        endMs: drag.target.type === 'range-end' ? mediaMs : range.endMs,
        durationMs,
      });
      stageLanePatch({
        sourceStartMs: next.sourceStartMs,
        sourceEndMs: next.sourceEndMs,
      });
      return;
    }
    if (drag.target.type === 'fade-in') {
      const durationMs = laneDurationMs();
      const range = mediaMode() === 'video-file' ? selectedSourceRange() : { startMs: 0, endMs: durationMs, durationMs };
      const rate = mediaMode() === 'video-file' ? playbackRate() : 1;
      stageLanePatch({
        fadeIn: {
          durationMs: clampVisualFadeDurationMs((laneXToMs(x, durationMs, laneRect()) - range.startMs) / rate, range.durationMs / rate),
          curve: draftSub.fadeIn?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'fade-out') {
      if (isInfiniteRender()) {
        return;
      }
      const durationMs = laneDurationMs();
      const range = mediaMode() === 'video-file' ? selectedSourceRange() : { startMs: 0, endMs: durationMs, durationMs };
      const rate = mediaMode() === 'video-file' ? playbackRate() : 1;
      stageLanePatch({
        fadeOut: {
          durationMs: clampVisualFadeDurationMs((range.endMs - laneXToMs(x, durationMs, laneRect())) / rate, range.durationMs / rate),
          curve: draftSub.fadeOut?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'drop-freeze' || drag.target.type === 'freeze-marker') {
      applyFreezeAtX(x);
    }
  }

  function applyFreezeAtX(x: number): void {
    const localTimeMs = laneXToMs(x, laneDurationMs(), laneRect());
    const freezeFrameMs = freezeFrameFromLocalTimeMs(localTimeMs);
    if (freezeFrameMs === undefined) {
      return;
    }
    stageLanePatch({ freezeFrameMs });
  }

  function stageLanePatch(update: Partial<PersistedVisualSubCueConfig>): void {
    pendingLanePatch = { ...pendingLanePatch, ...update };
    draftSub = { ...draftSub, ...update };
    syncTimingControls();
    render();
  }

  function commitPendingLanePatch(): void {
    if (!pendingLanePatch) {
      return;
    }
    const update = pendingLanePatch;
    pendingLanePatch = undefined;
    patchAndRefreshPreview(update);
  }

  function patchAndRefreshPreview(update: Partial<PersistedVisualSubCueConfig>): void {
    draftSub = { ...draftSub, ...update };
    syncRailButtons();
    syncTimingControls();
    patchSubCue(update);
    render();
    if (previewPlaying) {
      const payload = buildVisualSubCuePreviewPayload(draftSub, currentState, previewId, getPreviewElapsedMs());
      if (payload) {
        startPreview(payload);
      }
    }
  }

  function render(): void {
    renderSnapshots();
    renderOverlay();
    renderStatus();
  }

  function renderSnapshots(): void {
    const wanted = snapshots.length ? snapshots : createPlaceholderVisualPreviewSnapshots(laneSnapshotDurationMs(), SNAPSHOT_COUNT);
    if (tiles.childElementCount !== wanted.length) {
      tiles.replaceChildren(...wanted.map(() => document.createElement('div')));
    }
    [...tiles.children].forEach((child, index) => {
      const tile = child as HTMLElement;
      const snapshot = wanted[index];
      tile.className = `stream-visual-preview-lane-tile ${snapshot.state}`;
      tile.style.backgroundImage = snapshot.dataUrl ? `url("${snapshot.dataUrl}")` : '';
      tile.title = snapshot.error ?? formatTimestamp(snapshot.timeMs);
    });
  }

  function renderOverlay(): void {
    const durationMs = laneDurationMs();
    const rect = laneRect();
    const range = mediaMode() === 'video-file' ? selectedSourceRange() : { startMs: 0, endMs: durationMs, durationMs };
    const rate = mediaMode() === 'video-file' ? playbackRate() : 1;
    const rangeStartX = msToLaneX(range.startMs, durationMs, rect);
    const rangeEndX = msToLaneX(range.endMs, durationMs, rect);
    const fadeInX = clampLaneX(msToLaneX(range.startMs + (draftSub.fadeIn?.durationMs ?? 0) * rate, durationMs, rect), rangeStartX, rangeEndX);
    const fadeOutX = clampLaneX(msToLaneX(range.endMs - (draftSub.fadeOut?.durationMs ?? 0) * rate, durationMs, rect), rangeStartX, rangeEndX);
    const rangeEndLocalX = laneOverlayX(rangeEndX, rect, 'end');
    const rangeStartLocalX = Math.min(laneOverlayX(rangeStartX, rect, 'start'), rangeEndLocalX);
    const fadeInLocalX = clampLaneX(laneOverlayX(fadeInX, rect, 'handle'), rangeStartLocalX, rangeEndLocalX);
    const fadeOutLocalX = clampLaneX(laneOverlayX(fadeOutX, rect, 'handle'), rangeStartLocalX, rangeEndLocalX);
    const playheadX = msToLaneX(getPreviewLaneCursorMs(), durationMs, rect) - rect.left;
    const markerLocalMs = freezeLocalTimeMs();
    const markerX = markerLocalMs === undefined ? undefined : msToLaneX(markerLocalMs, durationMs, rect) - rect.left;
    overlay.replaceChildren(
      ...(mediaMode() === 'video-file' ? [createOverlayRegion('stream-visual-preview-lane-range', rangeStartLocalX, Math.max(0, rangeEndLocalX - rangeStartLocalX))] : []),
      ...(mediaMode() === 'video-file' ? [createOverlayRangeEdge('start', rangeStartLocalX), createOverlayRangeEdge('end', rangeEndLocalX)] : []),
      createOverlayRegion('stream-visual-preview-lane-fade in', rangeStartLocalX, Math.max(0, fadeInLocalX - rangeStartLocalX)),
      createOverlayRegion('stream-visual-preview-lane-fade out', fadeOutLocalX, Math.max(0, rangeEndLocalX - fadeOutLocalX), isInfiniteRender()),
      createOverlayFadeCurve(durationMs, rect),
      ...(markerX !== undefined ? [createOverlayMarker(markerX)] : []),
      createOverlayPlayhead(playheadX),
    );
    overlay.classList.toggle('pin-mode', freezePinMode && supportsFreeze());
  }

  function renderStatus(): void {
    const visual = selectedVisual();
    if (!visual) {
      status.textContent = 'Missing visual';
      status.hidden = false;
      return;
    }
    if (snapshotState === 'pending') {
      status.textContent = displayPreviewStatusMessage() ?? (mediaMode() === 'live' ? 'Live preview placeholder' : 'Loading preview snapshots');
      status.hidden = false;
      return;
    }
    if (snapshotState === 'error') {
      status.textContent = 'Preview snapshots unavailable';
      status.hidden = false;
      return;
    }
    const previewMessage = displayPreviewStatusMessage();
    if (previewMessage) {
      status.textContent = previewMessage;
      status.hidden = false;
      return;
    }
    status.hidden = true;
  }

  function createOverlayRegion(className: string, leftPx: number, widthPx: number, disabled = false): HTMLElement {
    const region = document.createElement('div');
    region.className = className;
    region.style.left = `${leftPx}px`;
    region.style.width = `${widthPx}px`;
    region.classList.toggle('disabled', disabled);
    return region;
  }

  function createOverlayMarker(leftPx: number): HTMLElement {
    const marker = document.createElement('div');
    marker.className = 'stream-visual-preview-lane-marker';
    marker.style.left = `${leftPx}px`;
    return marker;
  }

  function createOverlayPlayhead(leftPx: number): HTMLElement {
    const playhead = document.createElement('div');
    playhead.className = 'stream-visual-preview-lane-playhead';
    playhead.style.left = `${leftPx}px`;
    return playhead;
  }

  function createOverlayRangeEdge(edge: 'start' | 'end', leftPx: number): HTMLElement {
    const marker = document.createElement('div');
    marker.className = `stream-visual-preview-lane-range-edge ${edge}`;
    marker.style.left = `${leftPx}px`;
    return marker;
  }

  function createOverlayFadeCurve(durationMs: number, rect: VisualPreviewLaneRect): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'stream-visual-preview-lane-fade-curve');
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', visualFadeEnvelopePath(durationMs, rect));
    svg.append(path);
    return svg;
  }

  function visualFadeEnvelopePath(durationMs: number, rect: VisualPreviewLaneRect): string {
    const fadeOut = isInfiniteRender() ? undefined : draftSub.fadeOut;
    if (!draftSub.fadeIn?.durationMs && !fadeOut?.durationMs) {
      return '';
    }
    const range = mediaMode() === 'video-file' ? selectedSourceRange() : { startMs: 0, endMs: durationMs, durationMs };
    const rate = mediaMode() === 'video-file' ? playbackRate() : 1;
    const localDurationMs = Math.max(1, range.durationMs / rate);
    const sampleCount = Math.max(24, Math.min(160, Math.round(rect.width / 8)));
    const parts: string[] = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const localMs = (localDurationMs * i) / sampleCount;
      const mediaMs = range.startMs + localMs * rate;
      const gain = evaluateFadeGain({
        timeMs: localMs,
        durationMs: localDurationMs,
        fadeIn: draftSub.fadeIn,
        fadeOut,
      });
      const x = msToLaneX(mediaMs, durationMs, rect) - rect.left;
      const y = fadeGainToY(gain, rect);
      parts.push(`${i === 0 ? 'M' : 'L'} ${roundPathNumber(x)} ${roundPathNumber(y)}`);
    }
    return parts.join(' ');
  }

  async function loadSnapshots(): Promise<void> {
    const loadVersion = ++snapshotLoadVersion;
    const visual = selectedVisual();
    const cached = getCachedVisualPreviewSnapshots(visual, { sampleCount: SNAPSHOT_COUNT });
    if (cached) {
      snapshots = cached;
      snapshotState = visualSnapshotState(visual, cached);
      render();
      return;
    }
    snapshots = createPlaceholderVisualPreviewSnapshots(laneSnapshotDurationMs(), SNAPSHOT_COUNT, visual ? 'pending' : 'placeholder');
    snapshotState = visual ? 'pending' : 'missing';
    render();
    const loaded = await loadVisualPreviewSnapshots(visual, { sampleCount: SNAPSHOT_COUNT });
    if (disposed || loadVersion !== snapshotLoadVersion) {
      return;
    }
    snapshots = loaded;
    snapshotState = !visual ? 'missing' : loaded.some((snapshot) => snapshot.state === 'error') ? 'error' : 'ready';
    render();
  }

  function visualSnapshotState(
    visual: VisualState | undefined,
    loaded: VisualPreviewSnapshot[] | undefined,
  ): 'pending' | 'ready' | 'missing' | 'error' {
    if (!visual) {
      return 'missing';
    }
    if (!loaded) {
      return 'pending';
    }
    return loaded.some((snapshot) => snapshot.state === 'error') ? 'error' : 'ready';
  }

  function createTimingControls(): HTMLElement[] {
    const mode = mediaMode();
    const infinite = isInfiniteRender();
    const items: HTMLElement[] = [];
    if (mode === 'video-file') {
      items.push(
        createDraggableNumberField('Play times', getPlayTimes(draftSub), (value) => patchAndRefreshPreview(playTimesPatch(value)), {
          min: 1,
          step: 1,
          dragStep: 0.05,
          integer: true,
          disabled: infinite,
        }),
        createInfiniteToggle('Infinite Loop', infinite, (enabled) =>
          patchAndRefreshPreview({ loop: enabled ? infiniteLoopPolicy() : playTimesPatch(getPlayTimes(draftSub)).loop }),
        ),
      );
    } else {
      items.push(
        createDraggableNumberField('Duration', draftSub.durationOverrideMs, (durationOverrideMs) => patchAndRefreshPreview({ durationOverrideMs }), {
          min: 0,
          step: 1,
          dragStep: 5,
          integer: true,
          disabled: infinite,
          placeholder: 'ms',
        }),
        createInfiniteToggle('Infinite Render', infinite, (enabled) => patchAndRefreshPreview({ loop: enabled ? infiniteLoopPolicy() : { enabled: false } })),
      );
    }
    items.push(
      createDraggableNumberField('Delay Start', draftSub.startOffsetMs ?? 0, (startOffsetMs) => patchAndRefreshPreview({ startOffsetMs }), {
        min: 0,
        step: 1,
        dragStep: 5,
        integer: true,
      }),
    );
    if (supportsFreeze()) {
      items.push(
        createDraggableNumberField('Freeze Frame', draftSub.freezeFrameMs, (freezeFrameMs) => {
          const visual = selectedVisual();
          patchAndRefreshPreview({
            freezeFrameMs: freezeFrameMs === undefined ? undefined : normalizeVisualFreezeFrameMs(freezeFrameMs, visual),
          });
        }, { min: 0, step: 1, dragStep: 5, integer: true, placeholder: 'off' }),
      );
    }
    if (mode === 'video-file') {
      items.push(
        createDraggableNumberField('Playback Rate', draftSub.playbackRate ?? 1, (playbackRate) => patchAndRefreshPreview({ playbackRate: Math.max(0.01, playbackRate ?? 1) }), {
          min: 0.01,
          step: 0.01,
          dragStep: 0.002,
        }),
      );
    }
    return items;
  }

  function syncRailButtons(): void {
    const payload = buildVisualSubCuePreviewPayload(draftSub, currentState, previewId, getPreviewElapsedMs());
    const previewAvailable = Boolean(payload) && Boolean(window.xtream.visualRuntime?.preview);
    playButton.disabled = !previewAvailable;
    pauseButton.disabled = !previewAvailable;
    freezeButton.disabled = !supportsFreeze();
    freezeButton.classList.toggle('active', freezePinMode && supportsFreeze());
    freezeButton.setAttribute('aria-pressed', String(freezePinMode && supportsFreeze()));
  }

  function syncTimingControls(): void {
    const infinite = isInfiniteRender();
    const mode = mediaMode();
    const fields = [...controls.querySelectorAll<HTMLElement>('.stream-draggable-number')];
    const loopButton = controls.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-loop');
    loopButton?.classList.toggle('active', infinite);
    loopButton?.setAttribute('aria-pressed', String(infinite));
    const primary = fields[0];
    setDraggableDisabled(primary, infinite);
    if (mode === 'video-file') {
      setDraggableValue(primary, getPlayTimes(draftSub));
    } else {
      setDraggableValue(primary, draftSub.durationOverrideMs);
    }
    setDraggableValue(fields.find((field) => field.textContent?.includes('Freeze Frame')), draftSub.freezeFrameMs);
  }

  function getPreviewElapsedMs(): number {
    if (previewStartedAtMs === undefined) {
      return previewPausedAtMs;
    }
    return previewPlaying ? performance.now() - previewStartedAtMs : previewPausedAtMs;
  }

  function getPreviewCursorMs(): number {
    return previewPausedAtMs > 0 || previewPlaying ? getPreviewElapsedMs() : 0;
  }

  function getPreviewLaneCursorMs(): number {
    if (mediaMode() !== 'video-file') {
      return getPreviewCursorMs();
    }
    return previewSourceTimeMs ?? sourceMsForPreviewLocalMs(getPreviewCursorMs()) ?? selectedSourceRange().startMs;
  }

  function startPreview(payload: VisualSubCuePreviewPayload): void {
    disconnectObserver.markConnected();
    previewDispatchMessage = undefined;
    void Promise.resolve(window.xtream.visualRuntime.preview({ type: 'play-visual-subcue-preview', payload })).then((result) => {
      if (!result) {
        return;
      }
      if (disposed || result.previewId !== previewId) {
        return;
      }
      if (result.deliveredDisplayIds.length === 0 && result.targetDisplayIds.length > 0) {
        previewDispatchMessage = 'Assigned display window is not open';
        stopPreview(false);
        render();
        return;
      }
      if (result.missingDisplayIds.length > 0) {
        previewDispatchMessage = `Display preview unavailable: ${result.missingDisplayIds.join(', ')}`;
        render();
      }
    }).catch((error: unknown) => {
      previewDispatchMessage = error instanceof Error ? error.message : 'Display preview could not be started';
      stopPreview(false);
      render();
    });
    previewActive = true;
    previewPlaying = true;
    previewPausedAtMs = Math.max(0, payload.startedAtLocalMs ?? 0);
    previewSourceTimeMs = undefined;
    previewPositions.clear();
    previewStartedAtMs = performance.now() - previewPausedAtMs;
    startPreviewTicker();
    render();
  }

  function pausePreview(): void {
    if (!window.xtream.visualRuntime?.preview || (!previewPlaying && previewPausedAtMs <= 0)) {
      return;
    }
    const pausedAtMs = getPreviewElapsedMs();
    void window.xtream.visualRuntime.preview({ type: 'pause-visual-subcue-preview', previewId });
    previewPlaying = false;
    previewPausedAtMs = pausedAtMs;
    previewStartedAtMs = undefined;
    stopPreviewTicker();
    render();
  }

  function stopPreview(sendCommand: boolean): void {
    if (sendCommand && window.xtream.visualRuntime?.preview && previewActive) {
      void window.xtream.visualRuntime.preview({ type: 'stop-visual-subcue-preview', previewId });
    }
    previewPlaying = false;
    previewActive = false;
    previewStartedAtMs = undefined;
    previewPausedAtMs = 0;
    previewSourceTimeMs = undefined;
    previewPositions.clear();
    stopPreviewTicker();
    render();
  }

  function seekPreviewTo(x: number): void {
    const laneMs = laneXToMs(x, laneDurationMs(), laneRect());
    const range = mediaMode() === 'video-file' ? selectedSourceRange() : undefined;
    const localTimeMs = range ? Math.max(0, (Math.min(range.endMs, Math.max(range.startMs, laneMs)) - range.startMs) / playbackRate()) : laneMs;
    previewPausedAtMs = localTimeMs;
    previewStartedAtMs = previewPlaying ? performance.now() - localTimeMs : undefined;
    previewSourceTimeMs = range ? Math.min(range.endMs, Math.max(range.startMs, laneMs)) : sourceMsForPreviewLocalMs(localTimeMs);
    if (window.xtream.visualRuntime?.preview && previewActive) {
      void window.xtream.visualRuntime.preview({
        type: 'seek-visual-subcue-preview',
        previewId,
        localTimeMs,
        sourceTimeMs: previewSourceTimeMs,
      });
    }
    render();
  }

  function sourceMsForPreviewLocalMs(localTimeMs: number): number | undefined {
    const mode = mediaMode();
    if (mode === 'image' || mode === 'missing') {
      return undefined;
    }
    const visual = selectedVisual();
    const durationMs = visual?.durationSeconds !== undefined ? visual.durationSeconds * 1000 : undefined;
    const rate = playbackRate();
    if (mode === 'live' || durationMs === undefined) {
      return Math.max(0, localTimeMs * rate);
    }
    const range = selectedSourceRange();
    const baseDurationMs = range.durationMs / rate;
    const timing = resolveLoopTiming(draftSub.loop, baseDurationMs);
    const phaseMs = Math.min(baseDurationMs, mapElapsedToLoopPhase(Math.max(0, localTimeMs), timing));
    return Math.min(range.endMs, Math.max(range.startMs, range.startMs + phaseMs * rate));
  }

  function startPreviewTicker(): void {
    if (previewFrame !== undefined) {
      return;
    }
    const tick = () => {
      render();
      if (previewPlaying) {
        previewFrame = window.requestAnimationFrame(tick);
      } else {
        previewFrame = undefined;
      }
    };
    previewFrame = window.requestAnimationFrame(tick);
  }

  function stopPreviewTicker(): void {
    if (previewFrame !== undefined) {
      window.cancelAnimationFrame(previewFrame);
      previewFrame = undefined;
    }
  }

  function laneRect(): VisualPreviewLaneRect {
    return {
      left: 0,
      top: 0,
      width: Math.max(1, stage.clientWidth || stage.getBoundingClientRect().width || 640),
      height: VISUAL_LANE_HEIGHT,
    };
  }

  function cleanup(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    dismissFreezeMarkerMenu();
    unsubscribePreviewPosition?.();
    unsubscribePreviewSnapshot?.();
    disconnectObserver.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener('beforeunload', cleanup);
    stopPreview(true);
  }

  function selectedPreviewPosition(): VisualSubCuePreviewPosition | undefined {
    const displayOrder = new Map<string, number>();
    draftSub.targets.forEach((target, index) => {
      if (!displayOrder.has(target.displayId)) {
        displayOrder.set(target.displayId, index);
      }
    });
    return [...previewPositions.values()].sort((left, right) => {
      const leftOrder = displayOrder.get(left.displayId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = displayOrder.get(right.displayId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.displayId.localeCompare(right.displayId);
    })[0];
  }

  function displayPreviewStatusMessage(): string | undefined {
    if (previewDispatchMessage) {
      return previewDispatchMessage;
    }
    const previews = currentState.previews ?? {};
    const statuses = draftSub.targets
      .map((target) => previews[`visual-subcue:${previewId}:${target.displayId}`])
      .filter((status): status is NonNullable<(typeof previews)[string]> => status !== undefined);
    const error = statuses.find((status) => status.ready === false && status.error);
    if (error?.error) {
      return error.error;
    }
    if (previewActive && draftSub.targets.length > 0 && statuses.length === 0) {
      return 'Waiting for display preview';
    }
    return undefined;
  }

  function showFreezeMarkerMenu(clientX: number, clientY: number): void {
    dismissFreezeMarkerMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu stream-visual-preview-lane-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary context-menu-item';
    remove.setAttribute('role', 'menuitem');
    remove.textContent = 'Remove freeze marker';
    remove.addEventListener('click', () => {
      dismissFreezeMarkerMenu();
      patchAndRefreshPreview({ freezeFrameMs: undefined });
    });
    menu.append(remove);
    document.body.append(menu);
    positionContextMenu(menu, clientX, clientY);
    activeFreezeMenu = menu;
    document.addEventListener('click', dismissFreezeMarkerMenu, { once: true });
    window.addEventListener('blur', dismissFreezeMarkerMenu, { once: true });
  }

  function dismissFreezeMarkerMenu(): void {
    activeFreezeMenu?.remove();
    activeFreezeMenu = undefined;
  }
}

function fadeGainToY(gain: number, rect: VisualPreviewLaneRect): number {
  return rect.height - Math.max(0, Math.min(1, gain)) * rect.height;
}

function roundPathNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - bounds.height - 4))}px`;
}

function clampLaneX(x: number, minX: number, maxX: number): number {
  return Math.max(minX, Math.min(maxX, x));
}

function laneOverlayX(x: number, rect: VisualPreviewLaneRect, edge: 'start' | 'end' | 'handle'): number {
  const localX = x - rect.left;
  const max = Math.max(0, rect.width - (edge === 'start' ? 0 : VISUAL_LANE_EDGE_STROKE_PX));
  return Math.max(0, Math.min(max, localX));
}

function createRailButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'stream-visual-preview-lane-button stream-audio-waveform-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createInfiniteToggle(label: string, pressed: boolean, onToggle: (pressed: boolean) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-visual-preview-lane-loop stream-audio-waveform-loop${pressed ? ' active' : ''}`;
  button.textContent = label;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', () => onToggle(button.getAttribute('aria-pressed') !== 'true'));
  return button;
}

function getPlayTimes(sub: PersistedVisualSubCueConfig): number {
  if (sub.loop?.enabled && sub.loop.iterations.type === 'count') {
    return Math.max(1, Math.round(sub.loop.iterations.count));
  }
  return 1;
}

function playTimesPatch(value: number | undefined): Partial<PersistedVisualSubCueConfig> {
  const playTimes = Math.max(1, Math.round(value ?? 1));
  return {
    loop: playTimes <= 1 ? { enabled: false } : { enabled: true, iterations: { type: 'count', count: playTimes } },
  };
}

function infiniteLoopPolicy(): SceneLoopPolicy {
  return { enabled: true, iterations: { type: 'infinite' } };
}

function setDraggableDisabled(field: HTMLElement | undefined, disabled: boolean): void {
  if (!field) {
    return;
  }
  const input = field.querySelector<HTMLInputElement>('input');
  const grip = field.querySelector<HTMLButtonElement>('.stream-draggable-number-grip');
  if (input) {
    input.disabled = disabled;
  }
  if (grip) {
    grip.disabled = disabled;
  }
}

function setDraggableValue(field: HTMLElement | undefined, value: number | undefined): void {
  const input = field?.querySelector<HTMLInputElement>('input');
  if (!input) {
    return;
  }
  input.value = value !== undefined && Number.isFinite(value) ? String(value) : '';
}

function formatTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const seconds = Math.floor(safeMs / 1000);
  const millis = safeMs % 1000;
  return `${seconds}.${String(millis).padStart(3, '0')}s`;
}

function lanePoint(element: HTMLElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function createDisconnectObserver(element: HTMLElement, cleanup: () => void): { disconnect: () => void; markConnected: () => void } {
  let wasConnected = element.isConnected;
  const createdAtMs = performance.now();
  let interval: number | undefined;
  const stopWatching = () => {
    observer.disconnect();
    if (interval !== undefined) {
      window.clearInterval(interval);
      interval = undefined;
    }
  };
  const checkConnection = () => {
    if (element.isConnected) {
      wasConnected = true;
      return;
    }
    if (wasConnected) {
      cleanup();
      return;
    }
    if (performance.now() - createdAtMs > 1000) {
      stopWatching();
    }
  };
  const observer = new MutationObserver(() => {
    checkConnection();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  interval = window.setInterval(checkConnection, 250);
  window.addEventListener('beforeunload', cleanup);
  return {
    disconnect: stopWatching,
    markConnected: () => {
      wasConnected = wasConnected || element.isConnected;
    },
  };
}

export function buildVisualSubCuePreviewPayload(
  sub: PersistedVisualSubCueConfig,
  state: DirectorState,
  previewId: string,
  startedAtLocalMs = 0,
): VisualSubCuePreviewPayload | undefined {
  const visual = state.visuals[sub.visualId];
  if (!visual || sub.targets.length === 0) {
    return undefined;
  }
  const targets = sub.targets.map((target) => ({
    displayId: target.displayId,
    ...(target.zoneId ? { zoneId: target.zoneId } : {}),
  }));
  const playbackRate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
  const durationMs = getVisualSubCueBaseDurationMs(sub, visual);
  return {
    previewId,
    visualId: sub.visualId,
    targets,
    visual,
    sourceStartMs: visual.kind === 'file' && visual.type === 'video' ? sub.sourceStartMs : undefined,
    sourceEndMs: visual.kind === 'file' && visual.type === 'video' ? sub.sourceEndMs : undefined,
    playTimeMs: visual.kind === 'file' && visual.type === 'video' ? durationMs : undefined,
    durationMs: visual.kind === 'live' || visual.type === 'image' ? durationMs : undefined,
    playbackRate,
    fadeIn: sub.fadeIn,
    fadeOut: sub.fadeOut,
    freezeFrameMs: sub.freezeFrameMs,
    loop: sub.loop,
    startedAtLocalMs: Math.max(0, startedAtLocalMs),
  };
}
