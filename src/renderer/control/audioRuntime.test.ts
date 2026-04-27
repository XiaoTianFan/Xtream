import { describe, expect, it } from 'vitest';
import { getEffectiveOutputGain } from './audioRuntime';

const output = {
  id: 'output-main',
  busLevelDb: -6,
};

describe('getEffectiveOutputGain', () => {
  it('uses bus gain when no mute or solo is active', () => {
    expect(getEffectiveOutputGain(false, output, new Set())).toBeCloseTo(0.501187, 6);
  });

  it('silences globally muted outputs', () => {
    expect(getEffectiveOutputGain(true, output, new Set())).toBe(0);
  });

  it('silences muted outputs even when soloed', () => {
    expect(getEffectiveOutputGain(false, { ...output, muted: true }, new Set([output.id]))).toBe(0);
  });

  it('keeps soloed outputs live and silences non-soloed outputs', () => {
    const soloIds = new Set([output.id]);

    expect(getEffectiveOutputGain(false, output, soloIds)).toBeCloseTo(0.501187, 6);
    expect(getEffectiveOutputGain(false, { ...output, id: 'output-monitor' }, soloIds)).toBe(0);
  });
});
