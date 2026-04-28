import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, StreamEnginePublicState } from '../shared/types';
import { deriveDirectorStateForStream } from './streamProjection';

describe('deriveDirectorStateForStream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects active stream audio and visual cues without mutating Patch routing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = {
      paused: true,
      rate: 1.25,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: true, startSeconds: 1, endSeconds: 2 },
      globalAudioMuted: true,
      globalDisplayBlackout: true,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {
        v1: { id: 'v1', kind: 'file', type: 'video', label: 'Video', url: 'file://video.mp4', durationSeconds: 10, playbackRate: 2, ready: true },
      },
      audioSources: {
        a1: { id: 'a1', type: 'external-file', label: 'Audio', url: 'file://audio.wav', durationSeconds: 12, playbackRate: 0.5, ready: true },
      },
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [{ audioSourceId: 'patch-audio', levelDb: 0 }],
          busLevelDb: 0,
          ready: true,
          physicalRoutingAvailable: true,
        },
      },
      displays: {
        d1: { id: 'd1', layout: { type: 'single', visualId: 'patch-visual' }, fullscreen: false, health: 'ready' },
      },
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 9_000,
        offsetStreamMs: 4_000,
        currentStreamMs: 5_250,
        sceneStates: {},
        expectedDurationMs: 20_000,
        activeAudioSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'aud',
            audioSourceId: 'a1',
            outputId: 'output-main',
            streamStartMs: 2_000,
            localStartMs: 500,
            levelDb: -6,
            playbackRate: 1.5,
          },
        ],
        activeVisualSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'vis',
            visualId: 'v1',
            target: { displayId: 'd1' },
            streamStartMs: 2_000,
            localStartMs: 1_000,
            playbackRate: 0.5,
          },
        ],
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);

    expect(state.outputs['output-main'].sources[0]?.audioSourceId).toBe('patch-audio');
    expect(derived.globalAudioMuted).toBe(true);
    expect(derived.globalDisplayBlackout).toBe(true);
    expect(derived.paused).toBe(false);
    expect(derived.anchorWallTimeMs).toBe(9000);
    expect(derived.offsetSeconds).toBe(4);
    expect(derived.loop.enabled).toBe(false);
    expect(derived.outputs['output-main'].sources).toMatchObject([{ levelDb: -6 }]);
    const audioId = derived.outputs['output-main'].sources[0]?.audioSourceId ?? '';
    expect(derived.audioSources[audioId]).toMatchObject({ playbackRate: 0.75, runtimeOffsetSeconds: 2.5 });
    expect(derived.displays.d1.layout).toMatchObject({ type: 'single' });
    const visualId = derived.displays.d1.layout.type === 'single' ? derived.displays.d1.layout.visualId ?? '' : '';
    expect(derived.visuals[visualId]).toMatchObject({ playbackRate: 1, runtimeOffsetSeconds: 3 });
    expect(derived.activeTimeline.durationSeconds).toBe(20);
  });
});
