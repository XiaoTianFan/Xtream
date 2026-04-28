import { describe, expect, it } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import { clampAudioPan, computeAudioGraphSignature, getEffectiveOutputGain } from './audioRuntime';

const output = {
  id: 'output-main',
  busLevelDb: -6,
};

function graphTestState(overrides: { outputPan?: number; sourcePan?: number } = {}): DirectorState {
  const { outputPan = 0, sourcePan = 0 } = overrides;
  return {
    paused: true,
    rate: 1,
    audioExtractionFormat: 'm4a',
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    performanceMode: false,
    visuals: {},
    audioSources: {
      s1: {
        id: 's1',
        label: 'S',
        type: 'external-file',
        path: 'F:\\media\\a.wav',
        url: 'file:///F:/media/a.wav',
        ready: true,
        channelCount: 2,
        channelMode: 'stereo',
      },
    },
    outputs: {
      o1: {
        id: 'o1',
        label: 'O',
        sources: [{ audioSourceId: 's1', levelDb: 0, pan: sourcePan }],
        busLevelDb: 0,
        pan: outputPan,
        ready: true,
        physicalRoutingAvailable: true,
        fallbackReason: 'none',
      },
    },
    displays: {},
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } satisfies DirectorState;
}

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

describe('clampAudioPan', () => {
  it('defaults undefined and non-finite values to center', () => {
    expect(clampAudioPan(undefined)).toBe(0);
    expect(clampAudioPan(Number.NaN)).toBe(0);
  });

  it('clamps to the Web Audio pan range', () => {
    expect(clampAudioPan(2)).toBe(1);
    expect(clampAudioPan(-1.5)).toBe(-1);
    expect(clampAudioPan(0.2)).toBe(0.2);
  });
});

describe('computeAudioGraphSignature', () => {
  it('is unchanged when only bus or source pan values change', () => {
    const a = graphTestState({ outputPan: 0, sourcePan: 0 });
    const b = graphTestState({ outputPan: 0.8, sourcePan: -0.3 });
    expect(computeAudioGraphSignature(a)).toBe(computeAudioGraphSignature(b));
  });

  it('changes when a source route or channel mode changes', () => {
    const a = graphTestState();
    const c: DirectorState = {
      ...a,
      audioSources: {
        s1: { ...a.audioSources.s1, channelMode: 'left' },
      },
    };
    expect(computeAudioGraphSignature(a)).not.toBe(computeAudioGraphSignature(c));
  });
});
