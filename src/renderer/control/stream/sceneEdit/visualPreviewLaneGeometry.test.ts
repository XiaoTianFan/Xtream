import { describe, expect, it } from 'vitest';
import {
  clampFreezeFrameMs,
  clampVisualFadeDurationMs,
  hitTestVisualPreviewLane,
  laneXToMs,
  msToLaneX,
  normalizeVisualDurationForLane,
  type VisualPreviewLaneRect,
} from './visualPreviewLaneGeometry';

const rect: VisualPreviewLaneRect = { left: 10, top: 20, width: 400, height: 120 };

describe('visualPreviewLaneGeometry', () => {
  it('maps timeline milliseconds to lane pixels and back', () => {
    expect(msToLaneX(2500, 10_000, rect)).toBe(110);
    expect(laneXToMs(210, 10_000, rect)).toBe(5000);
    expect(laneXToMs(-100, 10_000, rect)).toBe(0);
  });

  it('normalizes unknown durations to a stable finite lane span', () => {
    expect(normalizeVisualDurationForLane(undefined)).toBe(10_000);
    expect(normalizeVisualDurationForLane(0, 3000)).toBe(3000);
  });

  it('clamps visual fades to half the lane duration', () => {
    expect(clampVisualFadeDurationMs(9000, 10_000)).toBe(5000);
    expect(clampVisualFadeDurationMs(-10, 10_000)).toBe(0);
  });

  it('clamps freeze markers to known media duration when present', () => {
    expect(clampFreezeFrameMs(12_345, 5000)).toBe(5000);
    expect(clampFreezeFrameMs(-20, 5000)).toBe(0);
    expect(clampFreezeFrameMs(undefined, 5000)).toBeUndefined();
  });

  it('prioritizes fade handles over freeze markers over seek/drop targets', () => {
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, freezeLocalTimeMs: 250 }, rect, 18, 30)).toEqual({ type: 'fade-in' });
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, freezeLocalTimeMs: 5000, freezePinMode: true }, rect, 210, 80)).toEqual({
      type: 'freeze-marker',
    });
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, freezePinMode: true }, rect, 260, 80)).toEqual({ type: 'drop-freeze' });
    expect(hitTestVisualPreviewLane({ durationMs: 10_000 }, rect, 260, 80)).toEqual({ type: 'seek' });
  });

  it('hit tests editable video source range edges', () => {
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, sourceStartMs: 1000, sourceEndMs: 9000, rangeEditable: true }, rect, 50, 90)).toEqual({
      type: 'range-start',
    });
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, sourceStartMs: 1000, sourceEndMs: 9000, rangeEditable: true }, rect, 370, 90)).toEqual({
      type: 'range-end',
    });
  });

  it('disables fade-out hit testing for infinite renders', () => {
    expect(hitTestVisualPreviewLane({ durationMs: 10_000, fadeOutDisabled: true }, rect, 405, 30)).toEqual({ type: 'seek' });
  });
});
