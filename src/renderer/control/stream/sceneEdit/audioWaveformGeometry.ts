import type { CurvePoint, FadeSpec } from '../../../../shared/types';
import {
  AUDIO_SUBCUE_LEVEL_MAX_DB,
  AUDIO_SUBCUE_LEVEL_MIN_DB,
  AUDIO_SUBCUE_PAN_MAX,
  AUDIO_SUBCUE_PAN_MIN,
  clampNumber,
  normalizeAudioSourceRange,
} from '../../../../shared/audioSubCueAutomation';

export type AudioWaveformAutomationMode = 'level' | 'pan';

export type AudioWaveformRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type AudioWaveformHitTarget =
  | { type: 'fade-in' }
  | { type: 'fade-out' }
  | { type: 'range-start' }
  | { type: 'range-end' }
  | { type: 'automation-point'; index: number }
  | { type: 'automation-body' }
  | { type: 'seek' }
  | { type: 'disabled' };

export type AudioWaveformModel = {
  durationMs?: number;
  sourceStartMs?: number;
  sourceEndMs?: number;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  automationPoints?: CurvePoint[];
  automationMode?: AudioWaveformAutomationMode;
};

const EDGE_HIT_PX = 8;
const FADE_HIT_HEIGHT_PX = 34;
const POINT_HIT_PX = 8;

export function msToWaveformX(ms: number, durationMs: number | undefined, rect: AudioWaveformRect): number {
  if (!durationMs || durationMs <= 0) {
    return rect.left;
  }
  return rect.left + clampNumber(ms / durationMs, 0, 1) * rect.width;
}

export function waveformXToMs(x: number, durationMs: number | undefined, rect: AudioWaveformRect): number {
  if (!durationMs || durationMs <= 0 || rect.width <= 0) {
    return 0;
  }
  return clampNumber((x - rect.left) / rect.width, 0, 1) * durationMs;
}

export function automationValueToY(value: number, mode: AudioWaveformAutomationMode, rect: AudioWaveformRect): number {
  const min = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MIN_DB : AUDIO_SUBCUE_PAN_MIN;
  const max = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MAX_DB : AUDIO_SUBCUE_PAN_MAX;
  const u = (clampNumber(value, min, max) - min) / (max - min);
  return rect.top + (1 - u) * rect.height;
}

export function waveformYToAutomationValue(y: number, mode: AudioWaveformAutomationMode, rect: AudioWaveformRect): number {
  const min = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MIN_DB : AUDIO_SUBCUE_PAN_MIN;
  const max = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MAX_DB : AUDIO_SUBCUE_PAN_MAX;
  const u = 1 - clampNumber((y - rect.top) / rect.height, 0, 1);
  return min + u * (max - min);
}

export function normalizeWaveformRange(model: Pick<AudioWaveformModel, 'sourceStartMs' | 'sourceEndMs' | 'durationMs'>): {
  startMs: number;
  endMs?: number;
  durationMs?: number;
} {
  return normalizeAudioSourceRange({
    sourceStartMs: model.sourceStartMs,
    sourceEndMs: model.sourceEndMs,
    sourceDurationMs: model.durationMs,
  });
}

export function clampWaveformRange(args: {
  startMs: number;
  endMs: number | undefined;
  durationMs: number | undefined;
  minSpanMs?: number;
}): { sourceStartMs?: number; sourceEndMs?: number; selectedDurationMs?: number } {
  const durationMs = args.durationMs !== undefined && Number.isFinite(args.durationMs) ? Math.max(0, args.durationMs) : undefined;
  const minSpanMs = args.minSpanMs ?? 1;
  const maxEnd = durationMs ?? Math.max(args.startMs, args.endMs ?? args.startMs + minSpanMs);
  const startMs = clampNumber(args.startMs, 0, Math.max(0, maxEnd - minSpanMs));
  const endMs = clampNumber(args.endMs ?? maxEnd, startMs + minSpanMs, maxEnd);
  return {
    sourceStartMs: startMs > 0 ? Math.round(startMs) : undefined,
    sourceEndMs: durationMs !== undefined && Math.abs(endMs - durationMs) < 1 ? undefined : Math.round(endMs),
    selectedDurationMs: Math.max(0, endMs - startMs),
  };
}

export function clampFadeDurationMs(durationMs: number, selectedDurationMs: number | undefined): number {
  const cap = selectedDurationMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, selectedDurationMs / 2);
  return Math.round(clampNumber(durationMs, 0, cap));
}

export function clampAutomationPointsForWaveform(
  points: CurvePoint[] | undefined,
  mode: AudioWaveformAutomationMode,
  durationMs: number | undefined,
): CurvePoint[] {
  const min = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MIN_DB : AUDIO_SUBCUE_PAN_MIN;
  const max = mode === 'level' ? AUDIO_SUBCUE_LEVEL_MAX_DB : AUDIO_SUBCUE_PAN_MAX;
  const maxTime = durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(0, durationMs) : undefined;
  return (points ?? [])
    .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.value))
    .map((point) => ({
      ...point,
      timeMs: Math.round(maxTime === undefined ? Math.max(0, point.timeMs) : clampNumber(point.timeMs, 0, maxTime)),
      value: mode === 'level' ? Math.round(clampNumber(point.value, min, max) * 10) / 10 : Math.round(clampNumber(point.value, min, max) * 100) / 100,
    }))
    .sort((left, right) => left.timeMs - right.timeMs);
}

export function hitTestAudioWaveform(model: AudioWaveformModel, rect: AudioWaveformRect, x: number, y: number): AudioWaveformHitTarget {
  if (!model.durationMs || model.durationMs <= 0 || x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) {
    return { type: 'disabled' };
  }
  const range = normalizeWaveformRange(model);
  const rangeStartX = msToWaveformX(range.startMs, model.durationMs, rect);
  const rangeEndX = msToWaveformX(range.endMs ?? model.durationMs, model.durationMs, rect);
  const topHit = y <= rect.top + FADE_HIT_HEIGHT_PX;
  const fadeInX = msToWaveformX(range.startMs + (model.fadeIn?.durationMs ?? 0), model.durationMs, rect);
  const fadeOutX = msToWaveformX((range.endMs ?? model.durationMs) - (model.fadeOut?.durationMs ?? 0), model.durationMs, rect);

  if (topHit && x <= Math.max(rangeStartX + EDGE_HIT_PX, fadeInX + EDGE_HIT_PX)) {
    return { type: 'fade-in' };
  }
  if (topHit && x >= Math.min(rangeEndX - EDGE_HIT_PX, fadeOutX - EDGE_HIT_PX)) {
    return { type: 'fade-out' };
  }
  if (Math.abs(x - rangeStartX) <= EDGE_HIT_PX) {
    return { type: 'range-start' };
  }
  if (Math.abs(x - rangeEndX) <= EDGE_HIT_PX) {
    return { type: 'range-end' };
  }

  if (model.automationMode) {
    const selectedDurationMs = range.durationMs;
    const points = clampAutomationPointsForWaveform(model.automationPoints, model.automationMode, selectedDurationMs);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const pointX = msToWaveformX(range.startMs + point.timeMs, model.durationMs, rect);
      const pointY = automationValueToY(point.value, model.automationMode, rect);
      if (Math.hypot(pointX - x, pointY - y) <= POINT_HIT_PX) {
        return { type: 'automation-point', index };
      }
    }
    return { type: 'automation-body' };
  }
  return { type: 'seek' };
}

export function cursorForAudioWaveformHit(hit: AudioWaveformHitTarget): string {
  switch (hit.type) {
    case 'fade-in':
      return 'nwse-resize';
    case 'fade-out':
      return 'nesw-resize';
    case 'range-start':
    case 'range-end':
      return 'ew-resize';
    case 'automation-point':
      return 'move';
    case 'automation-body':
      return 'crosshair';
    case 'seek':
      return 'pointer';
    case 'disabled':
      return 'not-allowed';
  }
}

export function cycleFadeCurve(curve: FadeSpec['curve'] | undefined): FadeSpec['curve'] {
  if (curve === 'linear') {
    return 'equal-power';
  }
  if (curve === 'equal-power') {
    return 'log';
  }
  return 'linear';
}
