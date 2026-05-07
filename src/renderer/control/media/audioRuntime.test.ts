/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import {
  clampAudioPan,
  computeAudioGraphSignature,
  findOutputSourceSelectionForRuntime,
  getAudioRuntimeDebugSnapshot,
  getRuntimeAudioTarget,
  getEffectiveOutputGain,
  playAudioSubCuePreview,
  resetAudioRuntimeForTests,
  syncVirtualAudioGraph,
} from './audioRuntime';

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
    controlDisplayPreviewMaxFps: 15,
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
    audioRendererReady: true,
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } satisfies DirectorState;
}

function addStreamRuntimeSource(state: DirectorState): DirectorState {
  const streamAudioId = 'stream-audio:scene-b:aud:output-main';
  return {
    ...state,
    audioSources: {
      ...state.audioSources,
      [streamAudioId]: {
        ...state.audioSources.s1,
        id: streamAudioId,
      },
    },
    outputs: {
      ...state.outputs,
      o1: {
        ...state.outputs.o1,
        sources: [...state.outputs.o1.sources, { audioSourceId: streamAudioId, levelDb: 0, pan: 0 }],
      },
    },
  };
}

const closeContext = vi.fn();

class FakeAudioParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeAudioNode {
  constructor(readonly context: FakeAudioContext) {}
  connect<T>(node: T): T {
    return node;
  }
  disconnect = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakePannerNode extends FakeAudioNode {
  pan = new FakeAudioParam();
}

class FakeDelayNode extends FakeAudioNode {
  delayTime = new FakeAudioParam();
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 1024;
  getFloatTimeDomainData(data: Float32Array): void {
    data.fill(0);
  }
}

class FakeSplitterNode extends FakeAudioNode {
  override connect<T>(node: T): T {
    return node;
  }
}

class FakeAudioContext {
  currentTime = 0;
  destination = new FakeAudioNode(this);
  createGain(): FakeGainNode {
    return new FakeGainNode(this);
  }
  createStereoPanner(): FakePannerNode {
    return new FakePannerNode(this);
  }
  createDelay(): FakeDelayNode {
    return new FakeDelayNode(this);
  }
  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode(this);
  }
  createMediaElementSource(): FakeAudioNode {
    return new FakeAudioNode(this);
  }
  createChannelSplitter(): FakeSplitterNode {
    return new FakeSplitterNode(this);
  }
  createMediaStreamDestination(): FakeAudioNode & { stream: MediaStream } {
    return Object.assign(new FakeAudioNode(this), { stream: {} as MediaStream });
  }
  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());
  setSinkId = vi.fn(() => Promise.resolve());
  close = vi.fn(() => {
    closeContext();
    return Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  closeContext.mockClear();
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  window.xtream = {
    audioSources: { reportMetadata: vi.fn() },
    audioRuntime: { reportMeter: vi.fn() },
    outputs: { update: vi.fn(() => Promise.resolve({})) },
  } as unknown as typeof window.xtream;
});

afterEach(async () => {
  await resetAudioRuntimeForTests();
  vi.useRealTimers();
});

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

  it('ignores stream automation values so per-frame edits do not rebuild the graph', () => {
    const a = graphTestState();
    const b: DirectorState = {
      ...a,
      outputs: {
        ...a.outputs,
        o1: {
          ...a.outputs.o1,
          sources: [
            {
              ...a.outputs.o1.sources[0],
              runtimeLevelAutomation: [{ timeMs: 0, value: -12 }],
              runtimePanAutomation: [{ timeMs: 500, value: 1 }],
            },
          ],
        },
      },
    };
    expect(computeAudioGraphSignature(a)).toBe(computeAudioGraphSignature(b));
  });
});

describe('getRuntimeAudioTarget', () => {
  it('uses selected Stream source range for target time and audible gating', () => {
    const source = {
      ...graphTestState().audioSources.s1,
      durationSeconds: 4,
      playbackRate: 1,
      runtimeOffsetSeconds: 10,
      runtimeSourceStartSeconds: 2,
      runtimeSourceEndSeconds: 6,
    };

    expect(getRuntimeAudioTarget(source, 11, { enabled: false, startSeconds: 0 })).toEqual({ seconds: 3, audible: true });
    expect(getRuntimeAudioTarget(source, 15, { enabled: false, startSeconds: 0 }).audible).toBe(false);
  });

  it('keeps infinite selected-range Stream audio audible beyond the source play time cap', () => {
    const source = {
      ...graphTestState().audioSources.s1,
      durationSeconds: undefined,
      playbackRate: 1,
      runtimeOffsetSeconds: 0,
      runtimeSourceStartSeconds: 2,
      runtimeSourceEndSeconds: 6,
      runtimeLoop: { enabled: true, startSeconds: 2, endSeconds: 6 },
    };

    expect(getRuntimeAudioTarget(source, 13, { enabled: false, startSeconds: 0 })).toEqual({ seconds: 3, audible: true });
  });
});

describe('audio sub-cue preview runtime', () => {
  it('automatically disposes finite previews at play time', () => {
    playAudioSubCuePreview({
      previewId: 'preview-a',
      audioSourceId: 's1',
      url: 'file:///F:/media/a.wav',
      outputId: 'o1',
      playbackRate: 1,
      playTimeMs: 1000,
    });

    vi.advanceTimersByTime(1000);

    expect(closeContext).toHaveBeenCalledTimes(1);
  });
});

describe('syncVirtualAudioGraph', () => {
  it('adds a Stream runtime source to an existing Patch output without closing the output context', () => {
    const patchOnly = graphTestState();
    const withStream = addStreamRuntimeSource(patchOnly);

    syncVirtualAudioGraph(patchOnly);
    closeContext.mockClear();
    syncVirtualAudioGraph(withStream);

    expect(closeContext).not.toHaveBeenCalled();
    expect(getAudioRuntimeDebugSnapshot().outputs).toEqual([
      { outputId: 'o1', sourceIds: ['s1', 'stream-audio:scene-b:aud:output-main'] },
    ]);
  });

  it('removes a transient Stream runtime source without rebuilding the Patch output bus', () => {
    const patchOnly = graphTestState();
    const withStream = addStreamRuntimeSource(patchOnly);

    syncVirtualAudioGraph(withStream);
    closeContext.mockClear();
    syncVirtualAudioGraph(patchOnly);
    vi.advanceTimersByTime(50);

    expect(closeContext).not.toHaveBeenCalled();
    expect(getAudioRuntimeDebugSnapshot().outputs).toEqual([{ outputId: 'o1', sourceIds: ['s1'] }]);
  });
});

describe('findOutputSourceSelectionForRuntime', () => {
  it('matches duplicate audio source routes by selection id', () => {
    const selections = [
      { id: 'route-a', audioSourceId: 's1', levelDb: -3, pan: 0 },
      { id: 'route-b', audioSourceId: 's1', levelDb: -18, pan: 0 },
    ];

    expect(findOutputSourceSelectionForRuntime(selections, 'route-b', 's1')?.levelDb).toBe(-18);
  });
});
