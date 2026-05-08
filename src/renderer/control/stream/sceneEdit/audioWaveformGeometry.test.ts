import { describe, expect, it } from 'vitest';
import {
  clampFadeDurationMs,
  clampWaveformRange,
  cursorForAudioWaveformHit,
  cycleFadeCurve,
  hitTestAudioWaveform,
  msToWaveformX,
  waveformXToMs,
} from './audioWaveformGeometry';

describe('audioWaveformGeometry', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 160 };

  it('maps milliseconds to canvas x and back', () => {
    expect(msToWaveformX(2500, 10_000, rect)).toBe(250);
    expect(waveformXToMs(750, 10_000, rect)).toBe(7500);
  });

  it('clamps source range and fade duration inside known media duration', () => {
    expect(clampWaveformRange({ startMs: -100, endMs: 12_000, durationMs: 10_000 })).toMatchObject({
      sourceStartMs: undefined,
      sourceEndMs: undefined,
      selectedDurationMs: 10_000,
    });
    expect(clampFadeDurationMs(8000, 10_000)).toBe(5000);
  });

  it('hit tests fade handles, range edges, and automation points in priority order', () => {
    const model = {
      durationMs: 10_000,
      sourceStartMs: 1000,
      sourceEndMs: 9000,
      fadeIn: { durationMs: 1000, curve: 'linear' as const },
      fadeOut: { durationMs: 1000, curve: 'linear' as const },
      automationMode: 'level' as const,
      automationPoints: [{ timeMs: 4000, value: 0 }],
    };

    expect(hitTestAudioWaveform(model, rect, 105, 8)).toEqual({ type: 'fade-in' });
    expect(hitTestAudioWaveform(model, rect, 900, 80)).toEqual({ type: 'range-end' });
    expect(hitTestAudioWaveform(model, rect, 500, 27)).toEqual({ type: 'automation-point', index: 0 });
    expect(cursorForAudioWaveformHit({ type: 'range-start' })).toBe('ew-resize');
  });

  it('returns seek targets when automation editing is disabled', () => {
    expect(
      hitTestAudioWaveform(
        {
          durationMs: 10_000,
          sourceStartMs: 1000,
          sourceEndMs: 9000,
          automationMode: undefined,
          automationPoints: [{ timeMs: 4000, value: 0 }],
        },
        rect,
        500,
        80,
      ),
    ).toEqual({ type: 'seek' });
    expect(cursorForAudioWaveformHit({ type: 'seek' })).toBe('pointer');
  });

  it('hit tests bottom inner-loop handles before generic range seeking', () => {
    expect(
      hitTestAudioWaveform(
        {
          durationMs: 10_000,
          sourceStartMs: 1000,
          sourceEndMs: 9000,
          innerLoopEditable: true,
          innerLoopRange: { startMs: 3000, endMs: 6000 },
        },
        rect,
        300,
        148,
      ),
    ).toEqual({ type: 'loop-start' });
    expect(cursorForAudioWaveformHit({ type: 'loop-start' })).toBe('nesw-resize');
    expect(cursorForAudioWaveformHit({ type: 'loop-end' })).toBe('nwse-resize');
  });

  it('cycles fade curves in the authored order', () => {
    expect(cycleFadeCurve(undefined)).toBe('linear');
    expect(cycleFadeCurve('linear')).toBe('equal-power');
    expect(cycleFadeCurve('equal-power')).toBe('log');
    expect(cycleFadeCurve('log')).toBe('linear');
  });
});
