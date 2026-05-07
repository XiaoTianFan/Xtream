import type {
  AudioSubCuePreviewPayload,
  AudioSubCuePreviewPosition,
  AudioSourceId,
  AudioSourceState,
  DirectorState,
  PersistedAudioSubCueConfig,
  SceneLoopPolicy,
  VirtualOutputId,
} from '../../../../shared/types';
import { resolveLoopTiming } from '../../../../shared/streamLoopTiming';
import {
  clampPitchShiftSemitones,
  evaluateFadeGain,
  getAudioSubCueBaseDurationMs,
} from '../../../../shared/audioSubCueAutomation';
import { createSubCueSection } from './subCueFormControls';
import { createDraggableNumberField } from './draggableNumberField';
import { loadAudioWaveformPeaks, resolveAudioWaveformUrl, type AudioWaveformPeaks } from './audioWaveformPeaks';
import { decorateRailButton } from '../../shared/icons';
import {
  automationValueToY,
  clampAutomationPointsForWaveform,
  clampFadeDurationMs,
  clampWaveformRange,
  cursorForAudioWaveformHit,
  cycleFadeCurve,
  hitTestAudioWaveform,
  msToWaveformX,
  normalizeWaveformRange,
  waveformXToMs,
  waveformYToAutomationValue,
  type AudioWaveformAutomationMode,
  type AudioWaveformHitTarget,
  type AudioWaveformRect,
} from './audioWaveformGeometry';

export type AudioSubCueWaveformEditorDeps = {
  sub: PersistedAudioSubCueConfig;
  currentState: DirectorState;
  patchSubCue: (update: Partial<PersistedAudioSubCueConfig>) => void;
};

type DragState = {
  target: AudioWaveformHitTarget;
  lastAutomationPoint?: {
    timeMs: number;
    value: number;
  };
};

const WAVEFORM_HEIGHT = 164;
const AUTOMATION_BUCKET_TARGET_COUNT = 96;
const AUTOMATION_BUCKET_MIN_MS = 100;
const AUTOMATION_BUCKET_MAX_MS = 1000;

type WaveformTheme = {
  background: string;
  grid: string;
  placeholder: string;
  text: string;
  peak: string;
  rangeFill: string;
  rangeLine: string;
  fadeFill: string;
  fadeLine: string;
  fadeEnvelope: string;
  levelActive: string;
  panActive: string;
  automationMuted: string;
  playhead: string;
  labelShadow: string;
};

const DARK_WAVEFORM_THEME: WaveformTheme = {
  background: 'rgba(11, 18, 27, 0.74)',
  grid: 'rgba(255, 255, 255, 0.08)',
  placeholder: 'rgba(174, 196, 215, 0.32)',
  text: 'rgba(226, 235, 242, 0.72)',
  peak: 'rgba(130, 166, 194, 0.72)',
  rangeFill: 'rgba(29, 201, 183, 0.11)',
  rangeLine: 'rgba(29, 201, 183, 0.92)',
  fadeFill: 'rgba(214, 164, 73, 0.19)',
  fadeLine: 'rgba(236, 185, 83, 0.95)',
  fadeEnvelope: 'rgba(236, 185, 83, 0.98)',
  levelActive: 'rgba(64, 216, 182, 0.96)',
  panActive: 'rgba(228, 121, 164, 0.96)',
  automationMuted: 'rgb(210, 220, 226)',
  playhead: 'rgba(255, 255, 255, 0.96)',
  labelShadow: 'rgba(0, 0, 0, 0.65)',
};

const LIGHT_WAVEFORM_THEME: WaveformTheme = {
  background: 'rgba(227, 224, 219, 0.92)',
  grid: 'rgba(70, 77, 82, 0.16)',
  placeholder: 'rgba(88, 104, 112, 0.28)',
  text: 'rgba(61, 58, 54, 0.74)',
  peak: 'rgba(71, 105, 128, 0.62)',
  rangeFill: 'rgba(74, 124, 133, 0.13)',
  rangeLine: 'rgba(42, 105, 116, 0.9)',
  fadeFill: 'rgba(154, 122, 74, 0.18)',
  fadeLine: 'rgba(134, 99, 42, 0.92)',
  fadeEnvelope: 'rgba(134, 99, 42, 0.96)',
  levelActive: 'rgba(22, 132, 109, 0.94)',
  panActive: 'rgba(166, 67, 111, 0.94)',
  automationMuted: 'rgb(70, 77, 82)',
  playhead: 'rgba(33, 31, 29, 0.92)',
  labelShadow: 'rgba(255, 255, 255, 0.75)',
};

export function createAudioSubCueWaveformEditor(deps: AudioSubCueWaveformEditorDeps): HTMLElement {
  const { sub, currentState, patchSubCue } = deps;
  let draftSub: PersistedAudioSubCueConfig = { ...sub };
  let pendingWaveformPatch: Partial<PersistedAudioSubCueConfig> | undefined;
  const source = currentState.audioSources[sub.audioSourceId];
  const sourceDurationMs = source?.durationSeconds !== undefined ? source.durationSeconds * 1000 : undefined;
  let automationMode: AudioWaveformAutomationMode | undefined = 'level';
  let peaks: AudioWaveformPeaks | undefined;
  let loadState: 'missing' | 'pending' | 'ready' | 'error' = source ? (source.ready ? 'pending' : 'pending') : 'missing';
  let hover: AudioWaveformHitTarget = { type: 'disabled' };
  let drag: DragState | undefined;
  let previewPlaying = false;
  let previewStartedAtMs: number | undefined;
  let previewPausedAtMs = 0;
  let previewSourceTimeMs: number | undefined;
  let previewFrame: number | undefined;
  let previewStopTimer: number | undefined;
  let themeRenderFrame: number | undefined;
  let disposed = false;

  const previewId = `subcue-preview:${sub.id}`;
  const root = document.createElement('div');
  root.className = 'stream-audio-waveform-editor';

  const rail = document.createElement('div');
  rail.className = 'stream-audio-waveform-rail';
  const playButton = createRailButton('Play', () => {
    const payload = buildAudioSubCuePreviewPayload(draftSub, currentState, previewId);
    if (!payload || !window.xtream.audioRuntime.preview) {
      return;
    }
    startPreview(payload, previewPausedAtMs);
  });
  const pauseButton = createRailButton('Pause', () => {
    pausePreview();
  });
  playButton.classList.add('stream-audio-waveform-transport');
  pauseButton.classList.add('stream-audio-waveform-transport');
  decorateRailButton(playButton, 'Play', 'Play preview', { iconSize: 17 });
  decorateRailButton(pauseButton, 'Pause', 'Pause preview', { iconSize: 17 });
  const previewAvailable = Boolean(buildAudioSubCuePreviewPayload(draftSub, currentState, previewId)) && Boolean(window.xtream.audioRuntime.preview);
  playButton.disabled = !previewAvailable;
  pauseButton.disabled = !previewAvailable;

  const levelButton = createModeButton('Level', true, () => {
    automationMode = automationMode === 'level' ? undefined : 'level';
    syncModeButtons();
    render();
  });
  const panButton = createModeButton('Pan', false, () => {
    automationMode = automationMode === 'pan' ? undefined : 'pan';
    syncModeButtons();
    render();
  });
  rail.append(playButton, pauseButton, levelButton, panButton);

  const stage = document.createElement('div');
  stage.className = 'stream-audio-waveform-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'stream-audio-waveform-canvas';
  canvas.height = WAVEFORM_HEIGHT;
  const clearAutomationButton = createClearAutomationButton(() => clearAutomation());
  stage.append(canvas, clearAutomationButton);

  const controls = document.createElement('div');
  controls.className = 'stream-audio-waveform-controls';
  const infinite = Boolean(sub.loop?.enabled && sub.loop.iterations?.type === 'infinite');
  const playTimesControl = createDraggableNumberField(
    'Play times',
    getPlayTimes(sub),
    (playTimes) => patchAndRefreshPreview(playTimesPatch(playTimes)),
    { min: 1, step: 1, dragStep: 0.05, integer: true, disabled: infinite },
  );
  const infiniteLoopButton = createInfiniteLoopToggle(infinite, (enabled) => patchAndRefreshPreview({ loop: enabled ? infiniteLoopPolicy() : playTimesPatch(getPlayTimes(draftSub)).loop }));
  controls.append(
    playTimesControl,
    infiniteLoopButton,
    createDraggableNumberField('Delay Start', sub.startOffsetMs ?? 0, (startOffsetMs) => patchAndRefreshPreview({ startOffsetMs }), {
      min: 0,
      step: 1,
      dragStep: 5,
      integer: true,
    }),
    createDraggableNumberField('Pitch', clampPitchShiftSemitones(sub.pitchShiftSemitones), (pitchShiftSemitones) => {
      patchAndRefreshPreview({ pitchShiftSemitones: clampPitchShiftSemitones(pitchShiftSemitones) });
    }, { min: -12, max: 12, step: 1, dragStep: 0.05 }),
    createDraggableNumberField('Rate', sub.playbackRate ?? 1, (playbackRate) => patchAndRefreshPreview({ playbackRate: Math.max(0.01, playbackRate ?? 1) }), {
      min: 0.01,
      step: 0.01,
      dragStep: 0.002,
    }),
  );

  const main = document.createElement('div');
  main.className = 'stream-audio-waveform-main';
  main.append(stage, controls);
  root.append(rail, main);

  const section = createSubCueSection('Timing', root);
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(stage);
  const themeObserver = new MutationObserver(() => scheduleThemeRender());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('xtream-theme-change', scheduleThemeRender);
  const disconnectObserver = createDisconnectObserver(section, () => cleanup());
  const unsubscribePreviewPosition = window.xtream.audioRuntime.onSubCuePreviewPosition?.((position) => {
    if (position.previewId !== previewId) {
      return;
    }
    applyPreviewPosition(position);
  });

  canvas.addEventListener('pointermove', (event) => {
    const point = canvasPoint(canvas, event);
    if (drag) {
      applyDrag(point.x, point.y);
      return;
    }
    hover = hitTest(point.x, point.y);
    canvas.style.cursor = cursorForAudioWaveformHit(hover);
    render();
  });
  canvas.addEventListener('pointerleave', () => {
    if (!drag) {
      hover = { type: 'disabled' };
      canvas.style.cursor = '';
      render();
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(canvas, event);
    const target = hitTest(point.x, point.y);
    if (target.type === 'disabled') {
      return;
    }
    if (target.type === 'seek') {
      seekPreviewTo(point.x);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drag = { target };
    if (target.type === 'automation-body') {
      applyAutomationPoint(point.x, point.y);
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag) {
      canvas.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    commitPendingWaveformPatch();
  });
  canvas.addEventListener('pointercancel', () => {
    drag = undefined;
    commitPendingWaveformPatch();
  });
  canvas.addEventListener('dblclick', (event) => {
    const point = canvasPoint(canvas, event);
    const target = hitTest(point.x, point.y);
    if (target.type === 'fade-in') {
      patchAndRefreshPreview({ fadeIn: { durationMs: draftSub.fadeIn?.durationMs ?? 0, curve: cycleFadeCurve(draftSub.fadeIn?.curve) } });
    } else if (target.type === 'fade-out') {
      patchAndRefreshPreview({ fadeOut: { durationMs: draftSub.fadeOut?.durationMs ?? 0, curve: cycleFadeCurve(draftSub.fadeOut?.curve) } });
    } else if (target.type === 'automation-point') {
      if (!automationMode) {
        return;
      }
      const key = automationMode === 'level' ? 'levelAutomation' : 'panAutomation';
      const points = (activeAutomationPoints() ?? []).filter((_point, index) => index !== target.index);
      patchAndRefreshPreview({ [key]: points.length ? points : undefined } as Partial<PersistedAudioSubCueConfig>);
    }
  });

  if (source && resolveAudioWaveformUrl(source, currentState)) {
    void loadAudioWaveformPeaks(source, currentState)
      .then((next) => {
        peaks = next;
        loadState = next ? 'ready' : 'missing';
        render();
      })
      .catch(() => {
        loadState = 'error';
        render();
      });
  } else {
    loadState = source ? 'pending' : 'missing';
  }

  render();
  return section;

  function syncModeButtons(): void {
    levelButton.classList.toggle('active', automationMode === 'level');
    levelButton.setAttribute('aria-pressed', String(automationMode === 'level'));
    panButton.classList.toggle('active', automationMode === 'pan');
    panButton.setAttribute('aria-pressed', String(automationMode === 'pan'));
  }

  function syncTimingControls(): void {
    const isInfinite = Boolean(draftSub.loop?.enabled && draftSub.loop.iterations?.type === 'infinite');
    infiniteLoopButton.classList.toggle('active', isInfinite);
    infiniteLoopButton.setAttribute('aria-pressed', String(isInfinite));
    const playTimesInput = playTimesControl.querySelector<HTMLInputElement>('input');
    const playTimesGrip = playTimesControl.querySelector<HTMLButtonElement>('.stream-draggable-number-grip');
    if (playTimesInput) {
      playTimesInput.disabled = isInfinite;
      playTimesInput.value = String(getPlayTimes(draftSub));
    }
    if (playTimesGrip) {
      playTimesGrip.disabled = isInfinite;
    }
  }

  function scheduleThemeRender(): void {
    if (disposed) {
      return;
    }
    cancelThemeRender();
    themeRenderFrame = window.requestAnimationFrame(() => {
      themeRenderFrame = window.requestAnimationFrame(() => {
        themeRenderFrame = undefined;
        render();
      });
    });
  }

  function cancelThemeRender(): void {
    if (themeRenderFrame !== undefined) {
      window.cancelAnimationFrame(themeRenderFrame);
      themeRenderFrame = undefined;
    }
  }

  function hitTest(x: number, y: number): AudioWaveformHitTarget {
    return hitTestAudioWaveform(
      {
        durationMs: sourceDurationMs,
        sourceStartMs: draftSub.sourceStartMs,
        sourceEndMs: draftSub.sourceEndMs,
        fadeIn: draftSub.fadeIn,
        fadeOut: draftSub.fadeOut,
        automationMode,
        automationPoints: activeAutomationPoints(),
      },
      waveformRect(),
      x,
      y,
    );
  }

  function activeAutomationPoints() {
    return automationMode === 'level' ? draftSub.levelAutomation : automationMode === 'pan' ? draftSub.panAutomation : undefined;
  }

  function applyDrag(x: number, y: number): void {
    if (!drag || !sourceDurationMs) {
      return;
    }
    const rect = waveformRect();
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const mediaMs = waveformXToMs(x, sourceDurationMs, rect);
    if (drag.target.type === 'range-start' || drag.target.type === 'range-end') {
      const next = clampWaveformRange({
        startMs: drag.target.type === 'range-start' ? mediaMs : range.startMs,
        endMs: drag.target.type === 'range-end' ? mediaMs : range.endMs ?? sourceDurationMs,
        durationMs: sourceDurationMs,
      });
      stageWaveformPatch({
        sourceStartMs: next.sourceStartMs,
        sourceEndMs: next.sourceEndMs,
      });
      return;
    }
    if (drag.target.type === 'fade-in') {
      stageWaveformPatch({
        fadeIn: {
          durationMs: clampFadeDurationMs(mediaMs - range.startMs, range.durationMs),
          curve: draftSub.fadeIn?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'fade-out') {
      stageWaveformPatch({
        fadeOut: {
          durationMs: clampFadeDurationMs((range.endMs ?? sourceDurationMs) - mediaMs, range.durationMs),
          curve: draftSub.fadeOut?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'automation-point') {
      applyAutomationPoint(x, y, { existingIndex: drag.target.index });
      return;
    }
    if (drag.target.type === 'automation-body') {
      applyAutomationPoint(x, y);
    }
  }

  function applyAutomationPoint(x: number, y: number, options: { existingIndex?: number } = {}): void {
    if (!sourceDurationMs || !automationMode) {
      return;
    }
    const rect = waveformRect();
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const selectedDuration = range.durationMs ?? sourceDurationMs;
    const points = clampAutomationPointsForWaveform(activeAutomationPoints(), automationMode, selectedDuration);
    const rawTimeMs = Math.max(0, waveformXToMs(x, sourceDurationMs, rect) - range.startMs);
    const bucketMs = getAutomationBucketMs(selectedDuration);
    const bucketTimeMs = Math.min(selectedDuration, Math.round(rawTimeMs / bucketMs) * bucketMs);
    const point = {
      timeMs: Math.round(bucketTimeMs),
      value: waveformYToAutomationValue(y, automationMode, rect),
    };
    const drawnPoints = drag?.lastAutomationPoint && options.existingIndex === undefined
      ? interpolateAutomationBuckets(drag.lastAutomationPoint, point, bucketMs)
      : [point];
    let next = points;
    for (const drawnPoint of drawnPoints) {
      const replaceIndex = options.existingIndex ?? next.findIndex((current) => current.timeMs === drawnPoint.timeMs);
      next =
        replaceIndex === -1
          ? [...next, drawnPoint]
          : next
              .map((current, index) => (index === replaceIndex ? drawnPoint : current))
              .filter((current, index) => index === replaceIndex || current.timeMs !== drawnPoint.timeMs);
    }
    if (drag) {
      drag.lastAutomationPoint = point;
    }
    const clamped = clampAutomationPointsForWaveform(next, automationMode, selectedDuration);
    const key = automationMode === 'level' ? 'levelAutomation' : 'panAutomation';
    stageWaveformPatch({ [key]: clamped } as Partial<PersistedAudioSubCueConfig>);
  }

  function render(): void {
    const hostWidth = Math.max(1, Math.floor(stage.clientWidth || 640));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = `${WAVEFORM_HEIGHT}px`;
    canvas.width = Math.floor(hostWidth * dpr);
    canvas.height = Math.floor(WAVEFORM_HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, hostWidth, WAVEFORM_HEIGHT);
    const rect = waveformRect();
    const theme = readWaveformTheme();
    drawBackground(ctx, rect, theme);
    drawPeaks(ctx, rect, loadState, peaks, theme);
    drawRangeAndFades(ctx, rect, theme);
    drawFadeEnvelope(ctx, rect, theme);
    drawAutomationLines(ctx, rect, theme);
    drawRangeTimeLabels(ctx, rect, theme);
    drawPreviewPlayhead(ctx, rect, theme);
  }

  function waveformRect(): AudioWaveformRect {
    const width = Math.max(1, stage.clientWidth || 640);
    return { left: 0, top: 0, width, height: WAVEFORM_HEIGHT };
  }

  function drawBackground(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    ctx.fillStyle = theme.background;
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      const x = rect.left + (rect.width * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
      ctx.stroke();
    }
  }

  function drawPeaks(
    ctx: CanvasRenderingContext2D,
    rect: AudioWaveformRect,
    state: typeof loadState,
    currentPeaks: AudioWaveformPeaks | undefined,
    theme: WaveformTheme,
  ): void {
    const mid = rect.top + rect.height / 2;
    if (state !== 'ready' || !currentPeaks?.buckets.length) {
      ctx.fillStyle = theme.placeholder;
      for (let i = 0; i < 96; i += 1) {
        const h = state === 'missing' ? 2 : 10 + ((i * 17) % 31);
        const x = rect.left + (i / 96) * rect.width;
        ctx.fillRect(x, mid - h / 2, Math.max(1, rect.width / 140), h);
      }
      ctx.fillStyle = theme.text;
      ctx.font = '12px sans-serif';
      ctx.fillText(state === 'error' ? 'Waveform unavailable' : state === 'missing' ? 'Missing audio source' : 'Loading waveform', rect.left + 12, rect.top + 22);
      return;
    }
    ctx.strokeStyle = theme.peak;
    ctx.lineWidth = Math.max(1, rect.width / currentPeaks.buckets.length);
    for (let i = 0; i < currentPeaks.buckets.length; i += 1) {
      const bucket = currentPeaks.buckets[i];
      const x = rect.left + (i / Math.max(1, currentPeaks.buckets.length - 1)) * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, mid + bucket.min * (rect.height * 0.42));
      ctx.lineTo(x, mid + bucket.max * (rect.height * 0.42));
      ctx.stroke();
    }
  }

  function drawRangeAndFades(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const startX = msToWaveformX(range.startMs, sourceDurationMs, rect);
    const endX = msToWaveformX(range.endMs ?? sourceDurationMs, sourceDurationMs, rect);
    ctx.fillStyle = theme.rangeFill;
    ctx.fillRect(startX, rect.top, Math.max(0, endX - startX), rect.height);
    ctx.strokeStyle = theme.rangeLine;
    ctx.lineWidth = 2;
    for (const x of [startX, endX]) {
      ctx.beginPath();
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
      ctx.stroke();
    }
    const fadeInX = msToWaveformX(range.startMs + (draftSub.fadeIn?.durationMs ?? 0), sourceDurationMs, rect);
    const fadeOutX = msToWaveformX((range.endMs ?? sourceDurationMs) - (draftSub.fadeOut?.durationMs ?? 0), sourceDurationMs, rect);
    ctx.fillStyle = theme.fadeFill;
    ctx.fillRect(startX, rect.top, Math.max(0, fadeInX - startX), rect.height);
    ctx.fillRect(fadeOutX, rect.top, Math.max(0, endX - fadeOutX), rect.height);
    ctx.strokeStyle = theme.fadeLine;
    ctx.beginPath();
    ctx.moveTo(fadeInX, rect.top);
    ctx.lineTo(fadeInX, rect.top + rect.height * 0.32);
    ctx.moveTo(fadeOutX, rect.top);
    ctx.lineTo(fadeOutX, rect.top + rect.height * 0.32);
    ctx.stroke();
  }

  function drawFadeEnvelope(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    if (!sourceDurationMs || (!draftSub.fadeIn?.durationMs && !draftSub.fadeOut?.durationMs)) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const durationMs = range.durationMs;
    if (!durationMs || durationMs <= 0) {
      return;
    }
    const sampleCount = Math.max(24, Math.min(160, Math.round(rect.width / 8)));
    ctx.save();
    ctx.strokeStyle = theme.fadeEnvelope;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let i = 0; i <= sampleCount; i += 1) {
      const localMs = (durationMs * i) / sampleCount;
      const gain = evaluateFadeGain({
        timeMs: localMs,
        durationMs,
        fadeIn: draftSub.fadeIn,
        fadeOut: draftSub.fadeOut,
      });
      const x = msToWaveformX(range.startMs + localMs, sourceDurationMs, rect);
      const y = fadeGainToY(gain, rect);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawAutomationLines(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    if (!sourceDurationMs) {
      return;
    }
    drawAutomationLine(ctx, rect, 'level', automationMode === 'level', theme);
    drawAutomationLine(ctx, rect, 'pan', automationMode === 'pan', theme);
  }

  function drawRangeTimeLabels(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const startX = msToWaveformX(range.startMs, sourceDurationMs, rect);
    const endX = msToWaveformX(range.endMs ?? sourceDurationMs, sourceDurationMs, rect);
    const y = rect.top + rect.height - 8;
    ctx.save();
    ctx.font = '10px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = theme.labelShadow;
    ctx.shadowBlur = 3;
    ctx.textAlign = 'left';
    ctx.fillText(formatRangeTimestamp(range.startMs), Math.min(rect.left + rect.width - 4, startX + 5), y);
    ctx.textAlign = 'right';
    ctx.fillText(formatRangeTimestamp(range.endMs ?? sourceDurationMs), Math.max(rect.left + 4, endX - 5), y);
    ctx.restore();
  }

  function formatRangeTimestamp(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const minutes = Math.floor(safeMs / 60000);
    const seconds = Math.floor((safeMs % 60000) / 1000);
    const millis = safeMs % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  function drawAutomationLine(
    ctx: CanvasRenderingContext2D,
    rect: AudioWaveformRect,
    mode: AudioWaveformAutomationMode,
    active: boolean,
    theme: WaveformTheme,
  ): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const points = clampAutomationPointsForWaveform(mode === 'level' ? draftSub.levelAutomation : draftSub.panAutomation, mode, range.durationMs);
    const color = active ? (mode === 'level' ? theme.levelActive : theme.panActive) : theme.automationMuted;
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = active ? 2 : 1.5;
    if (points.length === 0) {
      const fallback = mode === 'level' ? draftSub.levelDb ?? 0 : draftSub.pan ?? 0;
      const y = automationValueToY(fallback, mode, rect);
      ctx.beginPath();
      ctx.moveTo(rect.left, y);
      ctx.lineTo(rect.left + rect.width, y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    const firstY = automationValueToY(points[0].value, mode, rect);
    ctx.moveTo(rect.left, firstY);
    points.forEach((point) => {
      const x = msToWaveformX(range.startMs + point.timeMs, sourceDurationMs, rect);
      const y = automationValueToY(point.value, mode, rect);
      ctx.lineTo(x, y);
    });
    const lastY = automationValueToY(points[points.length - 1].value, mode, rect);
    ctx.lineTo(rect.left + rect.width, lastY);
    ctx.stroke();
    if (active) {
      for (const point of points) {
        const x = msToWaveformX(range.startMs + point.timeMs, sourceDurationMs, rect);
        const y = automationValueToY(point.value, mode, rect);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPreviewPlayhead(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, theme: WaveformTheme): void {
    if (!sourceDurationMs || (!previewPlaying && previewPausedAtMs <= 0 && previewSourceTimeMs === undefined)) {
      return;
    }
    const x = msToWaveformX(getPreviewPlayheadSourceMs(), sourceDurationMs, rect);
    ctx.strokeStyle = theme.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.top + rect.height);
    ctx.stroke();
  }

  function getPreviewElapsedMs(): number {
    if (previewStartedAtMs === undefined) {
      return previewPausedAtMs;
    }
    return previewPlaying ? performance.now() - previewStartedAtMs : previewPausedAtMs;
  }

  function getPreviewPlayheadSourceMs(): number {
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const rangeEndMs = range.endMs ?? sourceDurationMs ?? range.startMs;
    const rangeDurationMs = Math.max(1, rangeEndMs - range.startMs);
    const sourceMs =
      previewSourceTimeMs ??
      range.startMs + getPreviewElapsedMs() * Math.max(0.01, (source?.playbackRate ?? 1) * (draftSub.playbackRate ?? 1));
    if (draftSub.loop?.enabled && sourceMs >= rangeEndMs) {
      return range.startMs + ((sourceMs - range.startMs) % rangeDurationMs);
    }
    return Math.min(rangeEndMs, Math.max(range.startMs, sourceMs));
  }

  function sourceMsForPreviewLocalMs(localTimeMs: number): number {
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const sourceMs = range.startMs + Math.max(0, localTimeMs) * Math.max(0.01, (source?.playbackRate ?? 1) * (draftSub.playbackRate ?? 1));
    return Math.min(range.endMs ?? sourceDurationMs ?? sourceMs, Math.max(range.startMs, sourceMs));
  }

  function applyPreviewPosition(position: AudioSubCuePreviewPosition): void {
    previewSourceTimeMs = position.sourceTimeMs;
    previewPausedAtMs = position.localTimeMs;
    previewPlaying = position.playing;
    previewStartedAtMs = position.playing ? performance.now() - position.localTimeMs : undefined;
    if (!position.playing) {
      clearPreviewStopTimer();
    }
    render();
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

  function patchAndRefreshPreview(update: Partial<PersistedAudioSubCueConfig>): void {
    draftSub = { ...draftSub, ...update };
    syncTimingControls();
    patchSubCue(update);
    if (!previewPlaying) {
      render();
      return;
    }
    const resumeFromMs = getPreviewElapsedMs();
    const payload = buildAudioSubCuePreviewPayload(draftSub, currentState, previewId);
    if (!payload || !window.xtream.audioRuntime.preview) {
      stopPreview(true);
      return;
    }
    startPreview(payload, resumeFromMs);
  }

  function stageWaveformPatch(update: Partial<PersistedAudioSubCueConfig>): void {
    pendingWaveformPatch = { ...pendingWaveformPatch, ...update };
    draftSub = { ...draftSub, ...update };
    render();
  }

  function commitPendingWaveformPatch(): void {
    if (!pendingWaveformPatch) {
      return;
    }
    const update = pendingWaveformPatch;
    pendingWaveformPatch = undefined;
    patchAndRefreshPreview(update);
  }

  function startPreview(payload: AudioSubCuePreviewPayload, resumeFromMs: number): void {
    disconnectObserver.markConnected();
    clearPreviewStopTimer();
    void window.xtream.audioRuntime.preview({ type: 'play-audio-subcue-preview', payload });
    if (resumeFromMs > 0) {
      void window.xtream.audioRuntime.preview({
        type: 'seek-audio-subcue-preview',
        previewId,
        localTimeMs: resumeFromMs,
        sourceTimeMs: previewSourceTimeMs ?? sourceMsForPreviewLocalMs(resumeFromMs),
      });
    }
    previewPlaying = true;
    previewPausedAtMs = 0;
    previewSourceTimeMs = undefined;
    previewStartedAtMs = performance.now() - Math.max(0, resumeFromMs);
    schedulePreviewUiStop(payload, resumeFromMs);
    startPreviewTicker();
    render();
  }

  function pausePreview(): void {
    if (!window.xtream.audioRuntime.preview || (!previewPlaying && previewPausedAtMs <= 0)) {
      return;
    }
    const pausedAtMs = getPreviewElapsedMs();
    void window.xtream.audioRuntime.preview({ type: 'pause-audio-subcue-preview', previewId });
    previewPlaying = false;
    previewPausedAtMs = pausedAtMs;
    clearPreviewStopTimer();
    render();
  }

  function stopPreview(sendCommand: boolean): void {
    if (sendCommand && window.xtream.audioRuntime.preview && (previewPlaying || previewPausedAtMs > 0)) {
      void window.xtream.audioRuntime.preview({ type: 'stop-audio-subcue-preview', previewId });
    }
    previewPlaying = false;
    previewStartedAtMs = undefined;
    previewPausedAtMs = 0;
    previewSourceTimeMs = undefined;
    clearPreviewStopTimer();
    if (previewFrame !== undefined) {
      window.cancelAnimationFrame(previewFrame);
      previewFrame = undefined;
    }
    render();
  }

  function seekPreviewTo(x: number): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: draftSub.sourceStartMs, sourceEndMs: draftSub.sourceEndMs, durationMs: sourceDurationMs });
    const sourceTimeMs = Math.min(range.endMs ?? sourceDurationMs, Math.max(range.startMs, waveformXToMs(x, sourceDurationMs, waveformRect())));
    const playbackRate = Math.max(0.01, (source?.playbackRate ?? 1) * (draftSub.playbackRate ?? 1));
    previewSourceTimeMs = sourceTimeMs;
    previewPausedAtMs = Math.max(0, (sourceTimeMs - range.startMs) / playbackRate);
    previewStartedAtMs = previewPlaying ? performance.now() - previewPausedAtMs : undefined;
    if (window.xtream.audioRuntime.preview && (previewPlaying || previewPausedAtMs > 0)) {
      void window.xtream.audioRuntime.preview({ type: 'seek-audio-subcue-preview', previewId, sourceTimeMs, localTimeMs: previewPausedAtMs });
    }
    render();
  }

  function clearAutomation(): void {
    if (automationMode === 'level') {
      patchAndRefreshPreview({ levelAutomation: undefined });
      return;
    }
    if (automationMode === 'pan') {
      patchAndRefreshPreview({ panAutomation: undefined });
      return;
    }
    patchAndRefreshPreview({ levelAutomation: undefined, panAutomation: undefined });
  }

  function schedulePreviewUiStop(payload: AudioSubCuePreviewPayload, resumeFromMs: number): void {
    clearPreviewStopTimer();
    if (payload.loop?.enabled || payload.playTimeMs === undefined) {
      return;
    }
    previewStopTimer = window.setTimeout(() => {
      stopPreview(false);
    }, Math.max(0, payload.playTimeMs - resumeFromMs));
  }

  function clearPreviewStopTimer(): void {
    if (previewStopTimer !== undefined) {
      window.clearTimeout(previewStopTimer);
      previewStopTimer = undefined;
    }
  }

  function cleanup(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    unsubscribePreviewPosition?.();
    disconnectObserver.disconnect();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    window.removeEventListener('xtream-theme-change', scheduleThemeRender);
    cancelThemeRender();
    window.removeEventListener('beforeunload', cleanup);
    stopPreview(true);
  }
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

function readWaveformTheme(): WaveformTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? LIGHT_WAVEFORM_THEME : DARK_WAVEFORM_THEME;
}

function createRailButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'stream-audio-waveform-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createModeButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = createRailButton(label, onClick);
  button.classList.add('stream-audio-waveform-mode');
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  return button;
}

function createInfiniteLoopToggle(pressed: boolean, onToggle: (pressed: boolean) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-audio-waveform-loop${pressed ? ' active' : ''}`;
  button.textContent = 'Infinite Loop';
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', () => onToggle(button.getAttribute('aria-pressed') !== 'true'));
  return button;
}

function createClearAutomationButton(onClick: () => void): HTMLButtonElement {
  const button = createRailButton('Clear automation', onClick);
  button.classList.add('stream-audio-waveform-clear-automation');
  decorateRailButton(button, 'Trash2', 'Clear automation', { iconSize: 15 });
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  return button;
}

function getPlayTimes(sub: PersistedAudioSubCueConfig): number {
  if (sub.loop?.enabled && sub.loop.iterations.type === 'count') {
    return Math.max(1, Math.round(sub.loop.iterations.count));
  }
  return 1;
}

function playTimesPatch(value: number | undefined): Partial<PersistedAudioSubCueConfig> {
  const playTimes = Math.max(1, Math.round(value ?? 1));
  return {
    loop: playTimes <= 1 ? { enabled: false } : { enabled: true, iterations: { type: 'count', count: playTimes } },
  };
}

function getAutomationBucketMs(selectedDurationMs: number): number {
  const raw = selectedDurationMs / AUTOMATION_BUCKET_TARGET_COUNT;
  return Math.max(AUTOMATION_BUCKET_MIN_MS, Math.min(AUTOMATION_BUCKET_MAX_MS, Math.round(raw)));
}

function interpolateAutomationBuckets(
  from: { timeMs: number; value: number },
  to: { timeMs: number; value: number },
  bucketMs: number,
): Array<{ timeMs: number; value: number }> {
  if (from.timeMs === to.timeMs || bucketMs <= 0) {
    return [to];
  }
  const direction = from.timeMs < to.timeMs ? 1 : -1;
  const points: Array<{ timeMs: number; value: number }> = [];
  for (let timeMs = from.timeMs + direction * bucketMs; direction > 0 ? timeMs <= to.timeMs : timeMs >= to.timeMs; timeMs += direction * bucketMs) {
    const u = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    points.push({
      timeMs,
      value: from.value + (to.value - from.value) * u,
    });
  }
  if (points[points.length - 1]?.timeMs !== to.timeMs) {
    points.push(to);
  }
  return points;
}

function infiniteLoopPolicy(): SceneLoopPolicy {
  return { enabled: true, iterations: { type: 'infinite' } };
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function fadeGainToY(gain: number, rect: AudioWaveformRect): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(gain) ? gain : 0));
  return rect.top + (1 - clamped) * rect.height;
}

export function chooseAudioSubCuePreviewOutput(sub: PersistedAudioSubCueConfig, state: DirectorState): VirtualOutputId | undefined {
  const selected = sub.outputIds.find((outputId) => state.outputs[outputId]);
  return selected ?? (Object.keys(state.outputs).sort()[0] as VirtualOutputId | undefined);
}

export function buildAudioSubCuePreviewPayload(
  sub: PersistedAudioSubCueConfig,
  state: DirectorState,
  previewId: string,
): AudioSubCuePreviewPayload | undefined {
  const source = state.audioSources[sub.audioSourceId] as AudioSourceState | undefined;
  const url = resolveAudioWaveformUrl(source, state);
  const outputId = chooseAudioSubCuePreviewOutput(sub, state);
  const output = outputId ? state.outputs[outputId] : undefined;
  if (!source || !url || !outputId || !output) {
    return undefined;
  }
  return {
    previewId,
    audioSourceId: sub.audioSourceId as AudioSourceId,
    url,
    outputId,
    outputSinkId: output.sinkId,
    outputBusLevelDb: output.busLevelDb,
    outputPan: output.pan,
    sourceStartMs: sub.sourceStartMs,
    sourceEndMs: sub.sourceEndMs,
    fadeIn: sub.fadeIn,
    fadeOut: sub.fadeOut,
    levelDb: sub.levelDb,
    sourceLevelDb: source.levelDb,
    pan: sub.pan,
    levelAutomation: sub.levelAutomation,
    panAutomation: sub.panAutomation,
    playbackRate: (source.playbackRate ?? 1) * (sub.playbackRate ?? 1),
    pitchShiftSemitones: sub.pitchShiftSemitones,
    loop: sub.loop,
    playTimeMs: getAudioSubCuePreviewPlayTimeMs(sub, source.durationSeconds),
    channelMode: source.channelMode,
    channelCount: source.channelCount,
  };
}

function getAudioSubCuePreviewPlayTimeMs(sub: PersistedAudioSubCueConfig, sourceDurationSeconds: number | undefined): number | undefined {
  const baseDurationMs = getAudioSubCueBaseDurationMs(sub, sourceDurationSeconds);
  if (baseDurationMs === undefined) {
    return undefined;
  }
  return resolveLoopTiming(sub.loop, baseDurationMs).totalDurationMs;
}
