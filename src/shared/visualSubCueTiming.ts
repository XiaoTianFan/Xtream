import type { FadeSpec, PersistedVisualSubCueConfig, VisualState } from './types';
import { clampNumber, evaluateFadeGain, normalizeFadeSpec } from './audioSubCueAutomation';

export type VisualSubCueMediaInfo = Pick<VisualState, 'id' | 'kind' | 'type' | 'durationSeconds'>;

function finiteNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

export function isFiniteVideoVisual(media: VisualSubCueMediaInfo | undefined, knownDurationSeconds: number | undefined): boolean {
  if (media) {
    return media.kind === 'file' && media.type === 'video';
  }
  return knownDurationSeconds !== undefined;
}

export function isImageOrLiveVisual(media: VisualSubCueMediaInfo | undefined): boolean {
  return Boolean(media && (media.kind === 'live' || media.type === 'image'));
}

export function getVisualSubCueBaseDurationMs(
  sub: Pick<PersistedVisualSubCueConfig, 'visualId' | 'sourceStartMs' | 'sourceEndMs' | 'durationOverrideMs' | 'playbackRate' | 'loop' | 'pass'>,
  media: VisualSubCueMediaInfo | undefined,
  knownDurationSeconds?: number,
): number | undefined {
  const durationOverrideMs = finiteNumber(sub.durationOverrideMs);
  if (isImageOrLiveVisual(media)) {
    const hasInfiniteRender =
      sub.pass?.iterations.type === 'infinite' ||
      (!sub.pass && sub.loop?.enabled && sub.loop.iterations.type === 'infinite');
    if (durationOverrideMs === undefined && hasInfiniteRender) {
      return 0;
    }
    return durationOverrideMs !== undefined ? Math.max(0, durationOverrideMs) : undefined;
  }

  const durationSeconds = finiteNumber(media?.durationSeconds) ?? finiteNumber(knownDurationSeconds);
  if (durationSeconds === undefined) {
    return durationOverrideMs !== undefined ? Math.max(0, durationOverrideMs) : undefined;
  }
  const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
  const sourceRange = normalizeVisualSourceRange(sub, media, knownDurationSeconds);
  const mediaDurationMs = (sourceRange.durationMs ?? durationSeconds * 1000) / rate;
  return durationOverrideMs !== undefined ? Math.min(mediaDurationMs, Math.max(0, durationOverrideMs)) : mediaDurationMs;
}

export function normalizeVisualSourceRange(
  sub: Pick<PersistedVisualSubCueConfig, 'sourceStartMs' | 'sourceEndMs'>,
  media: VisualSubCueMediaInfo | undefined,
  knownDurationSeconds?: number,
): { startMs: number; endMs?: number; durationMs?: number } {
  const durationSeconds = finiteNumber(media?.durationSeconds) ?? finiteNumber(knownDurationSeconds);
  const sourceDurationMs = durationSeconds !== undefined ? Math.max(0, durationSeconds * 1000) : undefined;
  const maxEnd = sourceDurationMs;
  const rawStart = Math.max(0, finiteNumber(sub.sourceStartMs) ?? 0);
  const startMs = maxEnd !== undefined ? Math.min(rawStart, maxEnd) : rawStart;
  const rawEnd = finiteNumber(sub.sourceEndMs);
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

export function clampVisualSourceRange(args: {
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

export function evaluateVisualSubCueOpacity(args: {
  localTimeMs: number;
  durationMs?: number;
  baseOpacity?: number;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
}): number {
  const baseOpacity = clampNumber(args.baseOpacity ?? 1, 0, 1);
  const fade = evaluateFadeGain({
    timeMs: args.localTimeMs,
    durationMs: args.durationMs,
    fadeIn: args.fadeIn,
    fadeOut: args.fadeOut,
  });
  return clampNumber(baseOpacity * fade, 0, 1);
}

export function normalizeVisualFreezeFrameMs(
  freezeFrameMs: number | undefined,
  media: VisualSubCueMediaInfo | undefined,
  knownDurationSeconds?: number,
): number | undefined {
  const raw = finiteNumber(freezeFrameMs);
  if (raw === undefined) {
    return undefined;
  }
  const maxMs = finiteNumber(media?.durationSeconds) ?? finiteNumber(knownDurationSeconds);
  const upper = maxMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, maxMs * 1000);
  return Math.round(clampNumber(raw, 0, upper));
}

export function normalizeVisualFadeSpec(spec: FadeSpec | undefined, durationMs: number | undefined): FadeSpec | undefined {
  return normalizeFadeSpec(spec, durationMs === undefined ? undefined : durationMs / 2);
}
