import { describe, expect, it } from 'vitest';
import {
  isElapsedWithinSubCueTotal,
  mapElapsedToSubCuePassPhase,
  mapPassElapsedToMediaElapsed,
  normalizeSubCuePassLoopPolicies,
  resolveSubCuePassLoopTiming,
} from './subCuePassLoopTiming';

const baseDurationMs = 30_000;
const range = { startMs: 10_000, endMs: 20_000 };

describe('subCuePassLoopTiming', () => {
  it('A1 resolves a single pass with no inner loop to the base duration', () => {
    const timing = resolveSubCuePassLoopTiming({ baseDurationMs });

    expect(timing.passDurationMs).toBe(30_000);
    expect(timing.totalDurationMs).toBe(30_000);
    expect(mapElapsedToSubCuePassPhase(0, timing)).toMatchObject({ passIndex: 0, passElapsedMs: 0, mediaElapsedMs: 0 });
    expect(mapElapsedToSubCuePassPhase(10_000, timing)).toMatchObject({ passElapsedMs: 10_000, mediaElapsedMs: 10_000 });
    expect(isElapsedWithinSubCueTotal(29_999, timing)).toBe(true);
    expect(isElapsedWithinSubCueTotal(30_000, timing)).toBe(false);
  });

  it('A2 repeats counted passes and resets pass-local phase', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      pass: { iterations: { type: 'count', count: 2 } },
    });

    expect(timing.passDurationMs).toBe(30_000);
    expect(timing.totalDurationMs).toBe(60_000);
    expect(mapElapsedToSubCuePassPhase(30_000, timing)).toMatchObject({
      passIndex: 1,
      passElapsedMs: 0,
      mediaElapsedMs: 0,
      phaseZeroElapsedMs: 30_000,
    });
    expect(mapElapsedToSubCuePassPhase(59_999, timing)).toMatchObject({ passIndex: 1, passElapsedMs: 29_999, mediaElapsedMs: 29_999 });
  });

  it('A3 keeps an infinite pass indefinite and wraps every pass duration', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      pass: { iterations: { type: 'infinite' } },
    });

    expect(timing.totalDurationMs).toBeUndefined();
    expect(mapElapsedToSubCuePassPhase(90_000, timing)).toMatchObject({
      passIndex: 3,
      passElapsedMs: 0,
      mediaElapsedMs: 0,
      phaseZeroElapsedMs: 90_000,
    });
  });

  it('B1 treats loop count 0 as no loop even when a range is present', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      innerLoop: { enabled: true, range, iterations: { type: 'count', count: 0 } },
    });

    expect(timing.innerLoop.enabled).toBe(false);
    expect(timing.totalDurationMs).toBe(30_000);
  });

  it('B2 adds one extra traversal after the natural loop range traversal', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      innerLoop: { enabled: true, range, iterations: { type: 'count', count: 1 } },
    });

    expect(timing.passDurationMs).toBe(40_000);
    expect(timing.totalDurationMs).toBe(40_000);
    expect(mapPassElapsedToMediaElapsed(19_999, timing)).toEqual({ mediaElapsedMs: 19_999, insideInfiniteInnerLoop: false });
    expect(mapPassElapsedToMediaElapsed(20_000, timing)).toEqual({ mediaElapsedMs: 10_000, insideInfiniteInnerLoop: false });
    expect(mapPassElapsedToMediaElapsed(29_999, timing)).toEqual({ mediaElapsedMs: 19_999, insideInfiniteInnerLoop: false });
    expect(mapPassElapsedToMediaElapsed(30_000, timing)).toEqual({ mediaElapsedMs: 20_000, insideInfiniteInnerLoop: false });
    expect(mapPassElapsedToMediaElapsed(40_000, timing)).toEqual({ mediaElapsedMs: 30_000, insideInfiniteInnerLoop: false });
  });

  it('B3/B4 multiplies finite pass and finite inner-loop expansion exactly', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      pass: { iterations: { type: 'count', count: 2 } },
      innerLoop: { enabled: true, range, iterations: { type: 'count', count: 3 } },
    });

    expect(timing.passDurationMs).toBe(60_000);
    expect(timing.totalDurationMs).toBe(120_000);
    expect(mapElapsedToSubCuePassPhase(60_000, timing)).toMatchObject({ passIndex: 1, passElapsedMs: 0, mediaElapsedMs: 0 });
    expect(mapElapsedToSubCuePassPhase(110_000, timing)).toMatchObject({ passIndex: 1, passElapsedMs: 50_000, mediaElapsedMs: 20_000 });
  });

  it('B5 lets an infinite pass repeat finite inner-loop passes forever', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      pass: { iterations: { type: 'infinite' } },
      innerLoop: { enabled: true, range, iterations: { type: 'count', count: 3 } },
    });

    expect(timing.passDurationMs).toBe(60_000);
    expect(timing.totalDurationMs).toBeUndefined();
    expect(mapElapsedToSubCuePassPhase(120_000, timing)).toMatchObject({ passIndex: 2, passElapsedMs: 0, mediaElapsedMs: 0 });
  });

  it('B6 traps playback inside an infinite inner loop after the loop end', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      innerLoop: { enabled: true, range, iterations: { type: 'infinite' } },
    });

    expect(timing.passDurationMs).toBeUndefined();
    expect(timing.totalDurationMs).toBeUndefined();
    expect(mapElapsedToSubCuePassPhase(19_999, timing)).toMatchObject({ mediaElapsedMs: 19_999, insideInfiniteInnerLoop: false });
    expect(mapElapsedToSubCuePassPhase(20_000, timing)).toMatchObject({ mediaElapsedMs: 10_000, insideInfiniteInnerLoop: true });
    expect(mapElapsedToSubCuePassPhase(35_000, timing)).toMatchObject({ mediaElapsedMs: 15_000, insideInfiniteInnerLoop: true });
  });

  it('B7 normalizes loop infinity with pass count above 1 to pass count 1', () => {
    const normalized = normalizeSubCuePassLoopPolicies({
      pass: { iterations: { type: 'count', count: 4 } },
      innerLoop: { enabled: true, range, iterations: { type: 'infinite' } },
      baseDurationMs,
    });

    expect(normalized.pass).toEqual({ iterations: { type: 'count', count: 1 } });
    expect(normalized.innerLoop).toEqual({ enabled: true, range, iterations: { type: 'infinite' } });
  });

  it('B8 clears inner-loop infinity when pass infinity is also active', () => {
    const normalized = normalizeSubCuePassLoopPolicies({
      pass: { iterations: { type: 'infinite' } },
      innerLoop: { enabled: true, range, iterations: { type: 'infinite' } },
      baseDurationMs,
    });

    expect(normalized.pass).toEqual({ iterations: { type: 'infinite' } });
    expect(normalized.innerLoop).toEqual({ enabled: false, range });
  });

  it('preserves a legacy custom loop with no end as loop-to-pass-end', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      legacyLoop: { enabled: true, range: { startMs: 10_000 }, iterations: { type: 'count', count: 2 } },
    });

    expect(timing.innerLoop).toMatchObject({
      enabled: true,
      range: { startMs: 10_000, endMs: 30_000 },
      iterations: { type: 'count', count: 1 },
    });
    expect(timing.totalDurationMs).toBe(50_000);
  });

  it('disables collapsed inner-loop ranges instead of expanding them to a 1ms loop', () => {
    const timing = resolveSubCuePassLoopTiming({
      baseDurationMs,
      innerLoop: { enabled: true, range: { startMs: 20_000, endMs: 10_000 }, iterations: { type: 'count', count: 2 } },
    });

    expect(timing.innerLoop.enabled).toBe(false);
    expect(timing.totalDurationMs).toBe(30_000);
  });
});
