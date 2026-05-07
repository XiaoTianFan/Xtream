import { describe, expect, it } from 'vitest';
import {
  clampAudioAutomationPoints,
  clampPitchShiftSemitones,
  evaluateAudioSubCueLevelDb,
  evaluateAudioSubCuePan,
  evaluateCurvePointValue,
  evaluateFadeGain,
  getAudioSubCueBaseDurationMs,
  normalizeAudioSourceRange,
} from './audioSubCueAutomation';

describe('audioSubCueAutomation', () => {
  it('normalizes source ranges against known duration', () => {
    expect(normalizeAudioSourceRange({ sourceStartMs: 2_000, sourceEndMs: 12_000, sourceDurationMs: 10_000 })).toEqual({
      startMs: 2_000,
      endMs: 10_000,
      durationMs: 8_000,
    });
  });

  it('uses selected source range and playback rate for base duration', () => {
    const base = getAudioSubCueBaseDurationMs(
      { sourceStartMs: 2_000, sourceEndMs: 8_000, playbackRate: 2 },
      12,
    );
    expect(base).toBe(3_000);
  });

  it('keeps duration override as a cap and fallback', () => {
    expect(getAudioSubCueBaseDurationMs({ durationOverrideMs: 4_000, playbackRate: 1 }, undefined)).toBe(4_000);
    expect(getAudioSubCueBaseDurationMs({ sourceStartMs: 0, sourceEndMs: 10_000, durationOverrideMs: 3_000, playbackRate: 1 }, 20)).toBe(3_000);
  });

  it('clamps pitch shift to one octave each direction', () => {
    expect(clampPitchShiftSemitones(-20)).toBe(-12);
    expect(clampPitchShiftSemitones(20)).toBe(12);
    expect(clampPitchShiftSemitones(undefined)).toBe(0);
  });

  it('evaluates linear and hold automation curves', () => {
    const points = [
      { timeMs: 0, value: -12 },
      { timeMs: 1000, value: 0 },
      { timeMs: 2000, value: 6, interpolation: 'hold' as const },
      { timeMs: 3000, value: -6 },
    ];
    expect(evaluateCurvePointValue(points, 500, -3, -60, 12)).toBe(-6);
    expect(evaluateCurvePointValue(points, 2500, -3, -60, 12)).toBe(6);
    expect(evaluateAudioSubCueLevelDb(undefined, undefined, 500)).toBe(0);
    expect(evaluateAudioSubCuePan(0, [{ timeMs: 0, value: -1 }, { timeMs: 1000, value: 1 }], 250)).toBe(-0.5);
  });

  it('clamps automation point time and value', () => {
    expect(clampAudioAutomationPoints([{ timeMs: 5000, value: 99 }], 1000, -1, 1)).toEqual([{ timeMs: 1000, value: 1 }]);
  });

  it('evaluates fades with range caps', () => {
    expect(evaluateFadeGain({ timeMs: 250, durationMs: 1000, fadeIn: { durationMs: 500, curve: 'linear' } })).toBe(0.5);
    expect(evaluateFadeGain({ timeMs: 900, durationMs: 1000, fadeOut: { durationMs: 500, curve: 'linear' } })).toBeCloseTo(0.2, 5);
  });
});
