import { describe, expect, it } from 'vitest';
import {
  evaluateVisualSubCueOpacity,
  getVisualSubCueBaseDurationMs,
  normalizeVisualFreezeFrameMs,
  normalizeVisualSourceRange,
  type VisualSubCueMediaInfo,
} from './visualSubCueTiming';

describe('visualSubCueTiming', () => {
  const video: VisualSubCueMediaInfo = { id: 'video', kind: 'file', type: 'video', durationSeconds: 10 };
  const image: VisualSubCueMediaInfo = { id: 'image', kind: 'file', type: 'image' };
  const live: VisualSubCueMediaInfo = { id: 'live', kind: 'live', type: 'video' };

  it('uses natural video duration with playback rate and legacy duration cap', () => {
    expect(getVisualSubCueBaseDurationMs({ visualId: 'video', playbackRate: 2 }, video)).toBe(5000);
    expect(getVisualSubCueBaseDurationMs({ visualId: 'video', playbackRate: 1, durationOverrideMs: 4000 }, video)).toBe(4000);
    expect(getVisualSubCueBaseDurationMs({ visualId: 'video', playbackRate: 2, sourceStartMs: 2000, sourceEndMs: 8000 }, video)).toBe(3000);
  });

  it('normalizes selected video source ranges', () => {
    expect(normalizeVisualSourceRange({ sourceStartMs: 2000, sourceEndMs: 12_000 }, video)).toEqual({
      startMs: 2000,
      endMs: 10_000,
      durationMs: 8000,
    });
  });

  it('requires explicit duration for image and live visual media', () => {
    expect(getVisualSubCueBaseDurationMs({ visualId: 'image' }, image)).toBeUndefined();
    expect(getVisualSubCueBaseDurationMs({ visualId: 'image', durationOverrideMs: 3000 }, image)).toBe(3000);
    expect(getVisualSubCueBaseDurationMs({ visualId: 'live' }, live)).toBeUndefined();
    expect(getVisualSubCueBaseDurationMs({ visualId: 'live', durationOverrideMs: 7000 }, live)).toBe(7000);
    expect(getVisualSubCueBaseDurationMs({ visualId: 'live', loop: { enabled: true, iterations: { type: 'infinite' } } }, live)).toBe(0);
  });

  it('evaluates visual fade opacity against base opacity', () => {
    expect(
      evaluateVisualSubCueOpacity({
        localTimeMs: 250,
        durationMs: 1000,
        baseOpacity: 0.8,
        fadeIn: { durationMs: 500, curve: 'linear' },
      }),
    ).toBeCloseTo(0.4, 5);
    expect(
      evaluateVisualSubCueOpacity({
        localTimeMs: 900,
        durationMs: 1000,
        baseOpacity: 0.5,
        fadeOut: { durationMs: 500, curve: 'linear' },
      }),
    ).toBeCloseTo(0.1, 5);
  });

  it('clamps freeze frame markers to known video duration', () => {
    expect(normalizeVisualFreezeFrameMs(12_000, video)).toBe(10_000);
    expect(normalizeVisualFreezeFrameMs(1500, live)).toBe(1500);
  });
});
