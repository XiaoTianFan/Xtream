import type { AudioSourceState, CurvePoint, FadeSpec, PersistedAudioSubCueConfig } from './types';

export type AudioSubCueMediaInfo = Pick<AudioSourceState, 'id' | 'durationSeconds' | 'playbackRate'>;

export const AUDIO_SUBCUE_LEVEL_MIN_DB = -60;
export const AUDIO_SUBCUE_LEVEL_MAX_DB = 12;
export const AUDIO_SUBCUE_PAN_MIN = -1;
export const AUDIO_SUBCUE_PAN_MAX = 1;
export const AUDIO_SUBCUE_PITCH_MIN_SEMITONES = -12;
export const AUDIO_SUBCUE_PITCH_MAX_SEMITONES = 12;

export type AudioSourceRange = {
  startMs: number;
  endMs?: number;
  durationMs?: number;
};

function finiteNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function clampPitchShiftSemitones(value: number | undefined): number {
  return clampNumber(finiteNumber(value) ?? 0, AUDIO_SUBCUE_PITCH_MIN_SEMITONES, AUDIO_SUBCUE_PITCH_MAX_SEMITONES);
}

export function normalizeAudioSourceRange(args: {
  sourceStartMs?: number;
  sourceEndMs?: number;
  sourceDurationMs?: number;
}): AudioSourceRange {
  const durationMs = finiteNumber(args.sourceDurationMs);
  const maxEnd = durationMs !== undefined ? Math.max(0, durationMs) : undefined;
  const rawStart = Math.max(0, finiteNumber(args.sourceStartMs) ?? 0);
  const startMs = maxEnd !== undefined ? Math.min(rawStart, maxEnd) : rawStart;
  const rawEnd = finiteNumber(args.sourceEndMs);
  const endMs =
    rawEnd !== undefined
      ? Math.max(startMs, maxEnd !== undefined ? Math.min(Math.max(0, rawEnd), maxEnd) : Math.max(0, rawEnd))
      : maxEnd;
  return {
    startMs,
    endMs,
    durationMs: endMs !== undefined ? Math.max(0, endMs - startMs) : undefined,
  };
}

export function getAudioSubCueSelectedSourceDurationMs(
  sub: Pick<PersistedAudioSubCueConfig, 'sourceStartMs' | 'sourceEndMs'>,
  sourceDurationSeconds: number | undefined,
): number | undefined {
  return normalizeAudioSourceRange({
    sourceStartMs: sub.sourceStartMs,
    sourceEndMs: sub.sourceEndMs,
    sourceDurationMs: sourceDurationSeconds !== undefined ? sourceDurationSeconds * 1000 : undefined,
  }).durationMs;
}

export function getAudioSubCueBaseDurationMs(
  sub: Pick<PersistedAudioSubCueConfig, 'sourceStartMs' | 'sourceEndMs' | 'durationOverrideMs' | 'playbackRate'>,
  sourceDurationSeconds: number | undefined,
  sourcePlaybackRate = 1,
): number | undefined {
  const selectedSourceDurationMs = getAudioSubCueSelectedSourceDurationMs(sub, sourceDurationSeconds);
  const sourceRate = sourcePlaybackRate > 0 ? sourcePlaybackRate : 1;
  const rate = sourceRate * (sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1);
  let base = selectedSourceDurationMs === undefined ? undefined : selectedSourceDurationMs / rate;
  if (base === undefined && sub.durationOverrideMs === undefined) {
    return undefined;
  }
  if (base === undefined) {
    base = sub.durationOverrideMs;
  } else if (sub.durationOverrideMs !== undefined) {
    base = Math.min(base, sub.durationOverrideMs);
  }
  return base;
}

export function normalizeFadeSpec(spec: FadeSpec | undefined, maxDurationMs: number | undefined): FadeSpec | undefined {
  if (!spec || !Number.isFinite(spec.durationMs)) {
    return undefined;
  }
  const cap = maxDurationMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, maxDurationMs);
  return {
    durationMs: Math.min(cap, Math.max(0, spec.durationMs)),
    curve: spec.curve === 'equal-power' || spec.curve === 'log' ? spec.curve : 'linear',
  };
}

function fadeCurveProgress(t: number, curve: FadeSpec['curve'] | undefined): number {
  const x = clampNumber(t, 0, 1);
  if (curve === 'equal-power') {
    return Math.sin((x * Math.PI) / 2);
  }
  if (curve === 'log') {
    return Math.log10(1 + x * 9);
  }
  return x;
}

export function evaluateFadeGain(args: {
  timeMs: number;
  durationMs: number | undefined;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
}): number {
  const durationMs = finiteNumber(args.durationMs);
  const timeMs = Math.max(0, finiteNumber(args.timeMs) ?? 0);
  let gain = 1;
  const fadeIn = normalizeFadeSpec(args.fadeIn, durationMs === undefined ? undefined : durationMs / 2);
  if (fadeIn && fadeIn.durationMs > 0 && timeMs < fadeIn.durationMs) {
    gain *= fadeCurveProgress(timeMs / fadeIn.durationMs, fadeIn.curve);
  }
  const fadeOut = normalizeFadeSpec(args.fadeOut, durationMs === undefined ? undefined : durationMs / 2);
  if (fadeOut && fadeOut.durationMs > 0 && durationMs !== undefined) {
    const fadeOutStart = Math.max(0, durationMs - fadeOut.durationMs);
    if (timeMs > fadeOutStart) {
      gain *= 1 - fadeCurveProgress((timeMs - fadeOutStart) / fadeOut.durationMs, fadeOut.curve);
    }
  }
  return clampNumber(gain, 0, 1);
}

function sortedCurvePoints(points: CurvePoint[] | undefined, min: number, max: number): CurvePoint[] {
  return (points ?? [])
    .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.value))
    .map((point) => ({
      ...point,
      timeMs: Math.max(0, point.timeMs),
      value: clampNumber(point.value, min, max),
    }))
    .sort((left, right) => left.timeMs - right.timeMs);
}

export function evaluateCurvePointValue(points: CurvePoint[] | undefined, timeMs: number, fallback: number, min: number, max: number): number {
  const sorted = sortedCurvePoints(points, min, max);
  if (sorted.length === 0) {
    return clampNumber(fallback, min, max);
  }
  const t = Math.max(0, finiteNumber(timeMs) ?? 0);
  if (t <= sorted[0].timeMs) {
    return sorted[0].value;
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const left = sorted[i - 1];
    const right = sorted[i];
    if (t <= right.timeMs) {
      if (right.timeMs <= left.timeMs || left.interpolation === 'hold') {
        return left.value;
      }
      const u = (t - left.timeMs) / (right.timeMs - left.timeMs);
      return left.value + (right.value - left.value) * clampNumber(u, 0, 1);
    }
  }
  return sorted[sorted.length - 1].value;
}

export function evaluateAudioSubCueLevelDb(baseDb: number | undefined, points: CurvePoint[] | undefined, timeMs: number): number {
  return evaluateCurvePointValue(points, timeMs, baseDb ?? 0, AUDIO_SUBCUE_LEVEL_MIN_DB, AUDIO_SUBCUE_LEVEL_MAX_DB);
}

export function evaluateAudioSubCuePan(basePan: number | undefined, points: CurvePoint[] | undefined, timeMs: number): number {
  return evaluateCurvePointValue(points, timeMs, basePan ?? 0, AUDIO_SUBCUE_PAN_MIN, AUDIO_SUBCUE_PAN_MAX);
}

export function clampAudioAutomationPoints(
  points: CurvePoint[] | undefined,
  durationMs: number | undefined,
  min: number,
  max: number,
): CurvePoint[] | undefined {
  if (!points?.length) {
    return undefined;
  }
  const maxTime = durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(0, durationMs) : undefined;
  return sortedCurvePoints(points, min, max).map((point) => ({
    ...point,
    timeMs: maxTime === undefined ? point.timeMs : Math.min(point.timeMs, maxTime),
  }));
}
