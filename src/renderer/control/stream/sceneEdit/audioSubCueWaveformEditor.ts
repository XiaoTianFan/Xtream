import type {
  AudioSubCuePreviewPayload,
  AudioSourceId,
  AudioSourceState,
  DirectorState,
  PersistedAudioSubCueConfig,
  SceneLoopPolicy,
  VirtualOutputId,
} from '../../../../shared/types';
import {
  AUDIO_SUBCUE_LEVEL_MAX_DB,
  AUDIO_SUBCUE_LEVEL_MIN_DB,
  AUDIO_SUBCUE_PAN_MAX,
  AUDIO_SUBCUE_PAN_MIN,
  clampPitchShiftSemitones,
  getAudioSubCueBaseDurationMs,
} from '../../../../shared/audioSubCueAutomation';
import { createSubCueSection } from './subCueFormControls';
import { createDraggableNumberField } from './draggableNumberField';
import { loadAudioWaveformPeaks, resolveAudioWaveformUrl, type AudioWaveformPeaks } from './audioWaveformPeaks';
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
};

const WAVEFORM_HEIGHT = 164;

export function createAudioSubCueWaveformEditor(deps: AudioSubCueWaveformEditorDeps): HTMLElement {
  const { sub, currentState, patchSubCue } = deps;
  const source = currentState.audioSources[sub.audioSourceId];
  const sourceDurationMs = source?.durationSeconds !== undefined ? source.durationSeconds * 1000 : undefined;
  const selectedDurationMs = normalizeWaveformRange({
    sourceStartMs: sub.sourceStartMs,
    sourceEndMs: sub.sourceEndMs,
    durationMs: sourceDurationMs,
  }).durationMs;
  let automationMode: AudioWaveformAutomationMode = 'level';
  let peaks: AudioWaveformPeaks | undefined;
  let loadState: 'missing' | 'pending' | 'ready' | 'error' = source ? (source.ready ? 'pending' : 'pending') : 'missing';
  let hover: AudioWaveformHitTarget = { type: 'disabled' };
  let drag: DragState | undefined;
  let previewPlaying = false;
  let previewStartedAtMs: number | undefined;
  let previewPausedAtMs = 0;
  let previewFrame: number | undefined;

  const previewId = `subcue-preview:${sub.id}`;
  const root = document.createElement('div');
  root.className = 'stream-audio-waveform-editor';

  const rail = document.createElement('div');
  rail.className = 'stream-audio-waveform-rail';
  const playButton = createRailButton('Play', () => {
    const payload = buildAudioSubCuePreviewPayload(sub, currentState, previewId);
    if (!payload || !window.xtream.audioRuntime.preview) {
      return;
    }
    void window.xtream.audioRuntime.preview({ type: 'play-audio-subcue-preview', payload });
    previewPlaying = true;
    previewStartedAtMs = performance.now();
    previewPausedAtMs = 0;
    startPreviewTicker();
  });
  const pauseButton = createRailButton('Pause', () => {
    if (!window.xtream.audioRuntime.preview) {
      return;
    }
    void window.xtream.audioRuntime.preview({ type: 'pause-audio-subcue-preview', previewId });
    previewPlaying = false;
    previewPausedAtMs = getPreviewElapsedMs();
    render();
  });
  playButton.classList.add('stream-audio-waveform-transport');
  pauseButton.classList.add('stream-audio-waveform-transport');

  const levelButton = createModeButton('Level', true, () => {
    automationMode = 'level';
    levelButton.classList.add('active');
    levelButton.setAttribute('aria-pressed', 'true');
    panButton.classList.remove('active');
    panButton.setAttribute('aria-pressed', 'false');
    render();
  });
  const panButton = createModeButton('Pan', false, () => {
    automationMode = 'pan';
    panButton.classList.add('active');
    panButton.setAttribute('aria-pressed', 'true');
    levelButton.classList.remove('active');
    levelButton.setAttribute('aria-pressed', 'false');
    render();
  });
  rail.append(playButton, pauseButton, levelButton, panButton);

  const stage = document.createElement('div');
  stage.className = 'stream-audio-waveform-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'stream-audio-waveform-canvas';
  canvas.height = WAVEFORM_HEIGHT;
  stage.append(canvas);

  const controls = document.createElement('div');
  controls.className = 'stream-audio-waveform-controls';
  const infinite = Boolean(sub.loop?.enabled && sub.loop.iterations?.type === 'infinite');
  controls.append(
    createDraggableNumberField(
      'Play ms',
      Math.round(sub.durationOverrideMs ?? getAudioSubCueBaseDurationMs(sub, source?.durationSeconds) ?? selectedDurationMs ?? 0),
      (durationOverrideMs) => patchSubCue({ durationOverrideMs }),
      { min: 0, step: 1, dragStep: 5, integer: true, disabled: infinite },
    ),
    createInfiniteLoopToggle(infinite, (enabled) => patchSubCue({ loop: enabled ? infiniteLoopPolicy() : { enabled: false } })),
    createDraggableNumberField('Start ms', sub.startOffsetMs ?? 0, (startOffsetMs) => patchSubCue({ startOffsetMs }), {
      min: 0,
      step: 1,
      dragStep: 5,
      integer: true,
    }),
    createDraggableNumberField('Pitch', clampPitchShiftSemitones(sub.pitchShiftSemitones), (pitchShiftSemitones) => {
      patchSubCue({ pitchShiftSemitones: clampPitchShiftSemitones(pitchShiftSemitones) });
    }, { min: -12, max: 12, step: 1, dragStep: 0.05 }),
    createDraggableNumberField('Rate', sub.playbackRate ?? 1, (playbackRate) => patchSubCue({ playbackRate: Math.max(0.01, playbackRate ?? 1) }), {
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
  });
  canvas.addEventListener('dblclick', (event) => {
    const point = canvasPoint(canvas, event);
    const target = hitTest(point.x, point.y);
    if (target.type === 'fade-in') {
      patchSubCue({ fadeIn: { durationMs: sub.fadeIn?.durationMs ?? 0, curve: cycleFadeCurve(sub.fadeIn?.curve) } });
    } else if (target.type === 'fade-out') {
      patchSubCue({ fadeOut: { durationMs: sub.fadeOut?.durationMs ?? 0, curve: cycleFadeCurve(sub.fadeOut?.curve) } });
    } else if (target.type === 'automation-point') {
      const key = automationMode === 'level' ? 'levelAutomation' : 'panAutomation';
      const points = (activeAutomationPoints() ?? []).filter((_point, index) => index !== target.index);
      patchSubCue({ [key]: points.length ? points : undefined } as Partial<PersistedAudioSubCueConfig>);
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

  function hitTest(x: number, y: number): AudioWaveformHitTarget {
    return hitTestAudioWaveform(
      {
        durationMs: sourceDurationMs,
        sourceStartMs: sub.sourceStartMs,
        sourceEndMs: sub.sourceEndMs,
        fadeIn: sub.fadeIn,
        fadeOut: sub.fadeOut,
        automationMode,
        automationPoints: activeAutomationPoints(),
      },
      waveformRect(),
      x,
      y,
    );
  }

  function activeAutomationPoints() {
    return automationMode === 'level' ? sub.levelAutomation : sub.panAutomation;
  }

  function applyDrag(x: number, y: number): void {
    if (!drag || !sourceDurationMs) {
      return;
    }
    const rect = waveformRect();
    const range = normalizeWaveformRange({ sourceStartMs: sub.sourceStartMs, sourceEndMs: sub.sourceEndMs, durationMs: sourceDurationMs });
    const mediaMs = waveformXToMs(x, sourceDurationMs, rect);
    if (drag.target.type === 'range-start' || drag.target.type === 'range-end') {
      const next = clampWaveformRange({
        startMs: drag.target.type === 'range-start' ? mediaMs : range.startMs,
        endMs: drag.target.type === 'range-end' ? mediaMs : range.endMs ?? sourceDurationMs,
        durationMs: sourceDurationMs,
      });
      patchSubCue({
        sourceStartMs: next.sourceStartMs,
        sourceEndMs: next.sourceEndMs,
        durationOverrideMs: Math.round((next.selectedDurationMs ?? 0) / Math.max(0.01, sub.playbackRate ?? 1)),
      });
      return;
    }
    if (drag.target.type === 'fade-in') {
      patchSubCue({
        fadeIn: {
          durationMs: clampFadeDurationMs(mediaMs - range.startMs, range.durationMs),
          curve: sub.fadeIn?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'fade-out') {
      patchSubCue({
        fadeOut: {
          durationMs: clampFadeDurationMs((range.endMs ?? sourceDurationMs) - mediaMs, range.durationMs),
          curve: sub.fadeOut?.curve ?? 'linear',
        },
      });
      return;
    }
    if (drag.target.type === 'automation-point') {
      applyAutomationPoint(x, y, drag.target.index);
    }
  }

  function applyAutomationPoint(x: number, y: number, existingIndex?: number): void {
    if (!sourceDurationMs) {
      return;
    }
    const rect = waveformRect();
    const range = normalizeWaveformRange({ sourceStartMs: sub.sourceStartMs, sourceEndMs: sub.sourceEndMs, durationMs: sourceDurationMs });
    const selectedDuration = range.durationMs ?? sourceDurationMs;
    const points = clampAutomationPointsForWaveform(activeAutomationPoints(), automationMode, selectedDuration);
    const point = {
      timeMs: Math.round(Math.max(0, waveformXToMs(x, sourceDurationMs, rect) - range.startMs)),
      value: waveformYToAutomationValue(y, automationMode, rect),
    };
    const next = existingIndex === undefined ? [...points, point] : points.map((current, index) => (index === existingIndex ? point : current));
    const clamped = clampAutomationPointsForWaveform(next, automationMode, selectedDuration);
    const key = automationMode === 'level' ? 'levelAutomation' : 'panAutomation';
    patchSubCue({ [key]: clamped } as Partial<PersistedAudioSubCueConfig>);
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
    drawBackground(ctx, rect);
    drawPeaks(ctx, rect, loadState, peaks);
    drawRangeAndFades(ctx, rect);
    drawAutomation(ctx, rect);
    drawPreviewPlayhead(ctx, rect);
  }

  function waveformRect(): AudioWaveformRect {
    const width = Math.max(1, stage.clientWidth || 640);
    return { left: 0, top: 0, width, height: WAVEFORM_HEIGHT };
  }

  function drawBackground(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect): void {
    ctx.fillStyle = 'rgba(11, 18, 27, 0.74)';
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      const x = rect.left + (rect.width * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
      ctx.stroke();
    }
  }

  function drawPeaks(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect, state: typeof loadState, currentPeaks: AudioWaveformPeaks | undefined): void {
    const mid = rect.top + rect.height / 2;
    if (state !== 'ready' || !currentPeaks?.buckets.length) {
      ctx.fillStyle = 'rgba(174, 196, 215, 0.32)';
      for (let i = 0; i < 96; i += 1) {
        const h = state === 'missing' ? 2 : 10 + ((i * 17) % 31);
        const x = rect.left + (i / 96) * rect.width;
        ctx.fillRect(x, mid - h / 2, Math.max(1, rect.width / 140), h);
      }
      ctx.fillStyle = 'rgba(226, 235, 242, 0.72)';
      ctx.font = '12px sans-serif';
      ctx.fillText(state === 'error' ? 'Waveform unavailable' : state === 'missing' ? 'Missing audio source' : 'Loading waveform', rect.left + 12, rect.top + 22);
      return;
    }
    ctx.strokeStyle = 'rgba(130, 166, 194, 0.72)';
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

  function drawRangeAndFades(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: sub.sourceStartMs, sourceEndMs: sub.sourceEndMs, durationMs: sourceDurationMs });
    const startX = msToWaveformX(range.startMs, sourceDurationMs, rect);
    const endX = msToWaveformX(range.endMs ?? sourceDurationMs, sourceDurationMs, rect);
    ctx.fillStyle = 'rgba(29, 201, 183, 0.11)';
    ctx.fillRect(startX, rect.top, Math.max(0, endX - startX), rect.height);
    ctx.strokeStyle = 'rgba(29, 201, 183, 0.92)';
    ctx.lineWidth = 2;
    for (const x of [startX, endX]) {
      ctx.beginPath();
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
      ctx.stroke();
    }
    const fadeInX = msToWaveformX(range.startMs + (sub.fadeIn?.durationMs ?? 0), sourceDurationMs, rect);
    const fadeOutX = msToWaveformX((range.endMs ?? sourceDurationMs) - (sub.fadeOut?.durationMs ?? 0), sourceDurationMs, rect);
    ctx.fillStyle = 'rgba(214, 164, 73, 0.19)';
    ctx.fillRect(startX, rect.top, Math.max(0, fadeInX - startX), rect.height);
    ctx.fillRect(fadeOutX, rect.top, Math.max(0, endX - fadeOutX), rect.height);
    ctx.strokeStyle = 'rgba(236, 185, 83, 0.95)';
    ctx.beginPath();
    ctx.moveTo(fadeInX, rect.top);
    ctx.lineTo(fadeInX, rect.top + rect.height * 0.32);
    ctx.moveTo(fadeOutX, rect.top);
    ctx.lineTo(fadeOutX, rect.top + rect.height * 0.32);
    ctx.stroke();
  }

  function drawAutomation(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect): void {
    if (!sourceDurationMs) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: sub.sourceStartMs, sourceEndMs: sub.sourceEndMs, durationMs: sourceDurationMs });
    const points = clampAutomationPointsForWaveform(activeAutomationPoints(), automationMode, range.durationMs);
    const color = automationMode === 'level' ? 'rgba(64, 216, 182, 0.96)' : 'rgba(228, 121, 164, 0.96)';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (points.length === 0) {
      const fallback = automationMode === 'level' ? sub.levelDb ?? 0 : sub.pan ?? 0;
      const y = automationValueToY(fallback, automationMode, rect);
      ctx.beginPath();
      ctx.moveTo(msToWaveformX(range.startMs, sourceDurationMs, rect), y);
      ctx.lineTo(msToWaveformX(range.endMs ?? sourceDurationMs, sourceDurationMs, rect), y);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = msToWaveformX(range.startMs + point.timeMs, sourceDurationMs, rect);
      const y = automationValueToY(point.value, automationMode, rect);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    for (const point of points) {
      const x = msToWaveformX(range.startMs + point.timeMs, sourceDurationMs, rect);
      const y = automationValueToY(point.value, automationMode, rect);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPreviewPlayhead(ctx: CanvasRenderingContext2D, rect: AudioWaveformRect): void {
    if (!sourceDurationMs || (!previewPlaying && previewPausedAtMs <= 0)) {
      return;
    }
    const range = normalizeWaveformRange({ sourceStartMs: sub.sourceStartMs, sourceEndMs: sub.sourceEndMs, durationMs: sourceDurationMs });
    const elapsed = getPreviewElapsedMs() * Math.max(0.01, sub.playbackRate ?? 1);
    const x = msToWaveformX(range.startMs + elapsed, sourceDurationMs, rect);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
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

function createInfiniteLoopToggle(pressed: boolean, onToggle: (pressed: boolean) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-audio-waveform-loop${pressed ? ' active' : ''}`;
  button.textContent = 'Loop';
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', () => onToggle(button.getAttribute('aria-pressed') !== 'true'));
  return button;
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
    playTimeMs: sub.durationOverrideMs ?? getAudioSubCueBaseDurationMs(sub, source.durationSeconds),
    channelMode: source.channelMode,
    channelCount: source.channelCount,
  };
}
