import { describe, expect, it } from 'vitest';
import { applyLoop, formatTimecode, getAudioEffectiveTime, getDirectorSeconds, getMediaEffectiveTime, parseTimecodeInput } from './timeline';

describe('timeline helpers', () => {
  it('wraps seconds inside enabled loop boundaries', () => {
    expect(applyLoop(8, { enabled: true, startSeconds: 2, endSeconds: 5 })).toBe(2);
    expect(applyLoop(3, { enabled: true, startSeconds: 2, endSeconds: 5 })).toBe(3);
  });

  it('computes loop-aware director seconds from anchor wall time', () => {
    expect(
      getDirectorSeconds(
        {
          paused: false,
          offsetSeconds: 4,
          anchorWallTimeMs: 1000,
          rate: 1,
          loop: { enabled: true, startSeconds: 2, endSeconds: 5 },
        },
        3500,
      ),
    ).toBe(3.5);
  });

  it('freezes media at its own end when looping is disabled', () => {
    expect(getMediaEffectiveTime(12, 10, { enabled: false, startSeconds: 0 })).toBe(9.999);
  });

  it('loops shorter media independently inside an enabled full-range loop', () => {
    expect(getMediaEffectiveTime(12, 5, { enabled: true, startSeconds: 0, endSeconds: 20 })).toBe(2);
  });

  it('silences audio after its own end when looping is disabled', () => {
    expect(getAudioEffectiveTime(12, 10, { enabled: false, startSeconds: 0 })).toEqual({ seconds: 9.999, audible: false });
  });

  it('loops shorter audio independently inside an enabled full-range loop', () => {
    expect(getAudioEffectiveTime(12, 5, { enabled: true, startSeconds: 0, endSeconds: 20 })).toEqual({ seconds: 2, audible: true });
  });

  it('formats timecode into hours when needed', () => {
    expect(formatTimecode(69 * 60)).toBe('01:09:00.000');
    expect(formatTimecode(125.25)).toBe('02:05.250');
  });

  it('parses flexible timecode seek input', () => {
    expect(parseTimecodeInput('01:02:03.500')).toEqual({ ok: true, seconds: 3723.5 });
    expect(parseTimecodeInput('02:03.500')).toEqual({ ok: true, seconds: 123.5 });
    expect(parseTimecodeInput('123.5')).toEqual({ ok: true, seconds: 123.5 });
    expect(parseTimecodeInput('01:99.000')).toMatchObject({ ok: false });
  });
});
