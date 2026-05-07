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
  sub: Pick<PersistedVisualSubCueConfig, 'visualId' | 'durationOverrideMs' | 'playbackRate' | 'loop'>,
  media: VisualSubCueMediaInfo | undefined,
  knownDurationSeconds?: number,
): number | undefined {
  const durationOverrideMs = finiteNumber(sub.durationOverrideMs);
  if (isImageOrLiveVisual(media)) {
    if (durationOverrideMs === undefined && sub.loop?.enabled && sub.loop.iterations.type === 'infinite') {
      return 0;
    }
    return durationOverrideMs !== undefined ? Math.max(0, durationOverrideMs) : undefined;
  }

  const durationSeconds = finiteNumber(media?.durationSeconds) ?? finiteNumber(knownDurationSeconds);
  if (durationSeconds === undefined) {
    return durationOverrideMs !== undefined ? Math.max(0, durationOverrideMs) : undefined;
  }
  const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
  const mediaDurationMs = (durationSeconds * 1000) / rate;
  return durationOverrideMs !== undefined ? Math.min(mediaDurationMs, Math.max(0, durationOverrideMs)) : mediaDurationMs;
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
