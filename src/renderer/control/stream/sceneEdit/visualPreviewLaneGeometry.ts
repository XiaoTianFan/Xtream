import type { FadeSpec } from '../../../../shared/types';
import { clampNumber } from '../../../../shared/audioSubCueAutomation';

export type VisualPreviewLaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type VisualPreviewLaneHitTarget =
  | { type: 'fade-in' }
  | { type: 'fade-out' }
  | { type: 'loop-start' }
  | { type: 'loop-end' }
  | { type: 'range-start' }
  | { type: 'range-end' }
  | { type: 'freeze-marker' }
  | { type: 'drop-freeze' }
  | { type: 'seek' }
  | { type: 'disabled' };

export type VisualPreviewLaneModel = {
  durationMs?: number;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  sourceStartMs?: number;
  sourceEndMs?: number;
  rangeEditable?: boolean;
  innerLoopRange?: { startMs: number; endMs: number };
  innerLoopEditable?: boolean;
  freezeFrameMs?: number;
  freezeLocalTimeMs?: number;
  freezePinMode?: boolean;
  fadeOutDisabled?: boolean;
};

const DEFAULT_LANE_DURATION_MS = 10_000;
const FADE_HIT_HEIGHT_PX = 40;
const FADE_HANDLE_HIT_PX = 10;
const RANGE_EDGE_HIT_PX = 8;
const LOOP_HIT_HEIGHT_PX = 34;
const FREEZE_HIT_PX = 9;

export function normalizeVisualDurationForLane(durationMs: number | undefined, fallbackMs = DEFAULT_LANE_DURATION_MS): number {
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(durationMs);
  }
  return Math.max(1, Math.round(fallbackMs));
}

export function msToLaneX(ms: number, durationMs: number | undefined, rect: VisualPreviewLaneRect): number {
  const duration = normalizeVisualDurationForLane(durationMs);
  return rect.left + clampNumber(ms / duration, 0, 1) * rect.width;
}

export function laneXToMs(x: number, durationMs: number | undefined, rect: VisualPreviewLaneRect): number {
  const duration = normalizeVisualDurationForLane(durationMs);
  if (rect.width <= 0) {
    return 0;
  }
  return clampNumber((x - rect.left) / rect.width, 0, 1) * duration;
}

export function clampVisualFadeDurationMs(durationMs: number, laneDurationMs: number | undefined): number {
  const duration = normalizeVisualDurationForLane(laneDurationMs);
  return Math.round(clampNumber(durationMs, 0, duration / 2));
}

export function clampFreezeFrameMs(freezeFrameMs: number | undefined, maxMs: number | undefined): number | undefined {
  if (freezeFrameMs === undefined || !Number.isFinite(freezeFrameMs)) {
    return undefined;
  }
  const upper = maxMs !== undefined && Number.isFinite(maxMs) ? Math.max(0, maxMs) : Number.POSITIVE_INFINITY;
  return Math.round(clampNumber(freezeFrameMs, 0, upper));
}

export function hitTestVisualPreviewLane(
  model: VisualPreviewLaneModel,
  rect: VisualPreviewLaneRect,
  x: number,
  y: number,
): VisualPreviewLaneHitTarget {
  if (x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height || rect.width <= 0 || rect.height <= 0) {
    return { type: 'disabled' };
  }
  const durationMs = normalizeVisualDurationForLane(model.durationMs);
  const topHit = y <= rect.top + FADE_HIT_HEIGHT_PX;
  const bottomHit = y >= rect.top + rect.height - LOOP_HIT_HEIGHT_PX;
  const rangeStartMs = model.rangeEditable ? clampNumber(model.sourceStartMs ?? 0, 0, durationMs) : 0;
  const rangeEndMs = model.rangeEditable ? clampNumber(model.sourceEndMs ?? durationMs, rangeStartMs, durationMs) : durationMs;
  const rangeStartX = msToLaneX(rangeStartMs, durationMs, rect);
  const rangeEndX = msToLaneX(rangeEndMs, durationMs, rect);
  const fadeInX = msToLaneX(rangeStartMs + (model.fadeIn?.durationMs ?? 0), durationMs, rect);
  const fadeOutX = msToLaneX(rangeEndMs - (model.fadeOut?.durationMs ?? 0), durationMs, rect);
  const loopStartX = model.innerLoopRange ? msToLaneX(model.innerLoopRange.startMs, durationMs, rect) : undefined;
  const loopEndX = model.innerLoopRange ? msToLaneX(model.innerLoopRange.endMs, durationMs, rect) : undefined;

  if (topHit && x <= Math.max(rangeStartX + FADE_HANDLE_HIT_PX, fadeInX + FADE_HANDLE_HIT_PX)) {
    return { type: 'fade-in' };
  }
  if (!model.fadeOutDisabled && topHit && x >= Math.min(rangeEndX - FADE_HANDLE_HIT_PX, fadeOutX - FADE_HANDLE_HIT_PX)) {
    return { type: 'fade-out' };
  }
  if (model.innerLoopEditable && bottomHit && loopStartX !== undefined && Math.abs(loopStartX - x) <= RANGE_EDGE_HIT_PX) {
    return { type: 'loop-start' };
  }
  if (model.innerLoopEditable && bottomHit && loopEndX !== undefined && Math.abs(loopEndX - x) <= RANGE_EDGE_HIT_PX) {
    return { type: 'loop-end' };
  }
  if (model.rangeEditable && Math.abs(x - rangeStartX) <= RANGE_EDGE_HIT_PX) {
    return { type: 'range-start' };
  }
  if (model.rangeEditable && Math.abs(x - rangeEndX) <= RANGE_EDGE_HIT_PX) {
    return { type: 'range-end' };
  }

  const freezeLocalTimeMs = model.freezeLocalTimeMs ?? model.freezeFrameMs;
  if (freezeLocalTimeMs !== undefined && Number.isFinite(freezeLocalTimeMs)) {
    const markerX = msToLaneX(freezeLocalTimeMs, durationMs, rect);
    if (Math.abs(markerX - x) <= FREEZE_HIT_PX) {
      return { type: 'freeze-marker' };
    }
  }

  if (model.freezePinMode) {
    return { type: 'drop-freeze' };
  }
  return { type: 'seek' };
}

export function cursorForVisualPreviewLaneHit(hit: VisualPreviewLaneHitTarget): string {
  switch (hit.type) {
    case 'fade-in':
      return 'ew-resize';
    case 'fade-out':
      return 'ew-resize';
    case 'range-start':
    case 'range-end':
    case 'loop-start':
    case 'loop-end':
      return 'ew-resize';
    case 'freeze-marker':
      return 'grab';
    case 'drop-freeze':
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
