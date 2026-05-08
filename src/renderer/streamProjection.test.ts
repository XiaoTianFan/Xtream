import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, StreamEnginePublicState } from '../shared/types';
import { buildStreamDisplayFrames, deriveDirectorStateForStream } from './streamProjection';

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
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: {
        revision: 1,
        status: 'valid',
        entries: {},
        calculatedAtWallTimeMs: 0,
        issues: [],
      },
      playbackTimeline: {
        revision: 1,
        status: 'valid',
        entries: {},
        calculatedAtWallTimeMs: 0,
        issues: [],
      },
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
            sourceStartMs: 1_000,
            sourceEndMs: 9_000,
            levelDb: -6,
            pan: -0.25,
            playbackRate: 1.5,
            fadeIn: { durationMs: 250, curve: 'linear' },
            fadeOut: { durationMs: 500, curve: 'equal-power' },
            levelAutomation: [{ timeMs: 0, value: -12 }, { timeMs: 1000, value: -3 }],
            panAutomation: [{ timeMs: 0, value: -1 }, { timeMs: 1000, value: 1 }],
            pitchShiftSemitones: 3,
            mediaLoop: { enabled: true, startSeconds: 0, endSeconds: 12 },
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
            sourceStartMs: 1_000,
            sourceEndMs: 9_000,
            playbackRate: 0.5,
            freezeFrameMs: 2500,
            mediaLoop: { enabled: true, startSeconds: 0, endSeconds: 10 },
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
    expect(derived.audioSources[audioId]).toMatchObject({
      playbackRate: 0.75,
      runtimeOffsetSeconds: 2.5,
      runtimeSourceStartSeconds: 1,
      runtimeSourceEndSeconds: 9,
      runtimePitchShiftSemitones: 3,
      runtimeLoop: { enabled: true, endSeconds: 12 },
    });
    expect(derived.outputs['output-main'].sources[0]).toMatchObject({
      pan: -0.25,
      runtimeSubCueStartMs: 2500,
      runtimeFadeIn: { durationMs: 250, curve: 'linear' },
      runtimeFadeOut: { durationMs: 500, curve: 'equal-power' },
      runtimeLevelAutomation: [{ timeMs: 0, value: -12 }, { timeMs: 1000, value: -3 }],
      runtimePanAutomation: [{ timeMs: 0, value: -1 }, { timeMs: 1000, value: 1 }],
    });
    expect(derived.displays.d1.layout).toMatchObject({ type: 'single' });
    const visualId = derived.displays.d1.layout.type === 'single' ? derived.displays.d1.layout.visualId ?? '' : '';
    expect(derived.visuals[visualId]).toMatchObject({
      playbackRate: 1,
      runtimeOffsetSeconds: 3,
      runtimeSourceStartSeconds: 1,
      runtimeSourceEndSeconds: 9,
      runtimeFreezeFrameSeconds: 2.5,
      runtimeLoop: { enabled: true, endSeconds: 10 },
    });
    expect(derived.activeTimeline.durationSeconds).toBe(20);
  });

  it('applies authored visual fades before projected display opacity', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_250);
    const state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {
        v1: { id: 'v1', kind: 'file', type: 'video', label: 'Video', url: 'file://video.mp4', durationSeconds: 10, opacity: 0.8, ready: true },
      },
      audioSources: {},
      outputs: {},
      displays: {
        d1: { id: 'd1', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
      },
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 1_000,
        offsetStreamMs: 250,
        currentStreamMs: 250,
        sceneStates: {},
        activeVisualSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'vis',
            visualId: 'v1',
            target: { displayId: 'd1' },
            streamStartMs: 0,
            localStartMs: 0,
            localEndMs: 1000,
            playbackRate: 1,
            fadeIn: { durationMs: 500, curve: 'linear' },
          },
        ],
      },
    } satisfies StreamEnginePublicState;

    const frame = buildStreamDisplayFrames(state, streamState).d1;

    expect(frame.zones[0]?.layers[0]?.opacity).toBeCloseTo(0.4, 5);
  });

  it('applies orphan fade metadata to projected audio level and visual opacity', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_250);
    const state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {
        v1: { id: 'v1', kind: 'file', type: 'video', label: 'Video', url: 'file://video.mp4', durationSeconds: 10, opacity: 0.8, ready: true },
      },
      audioSources: {
        a1: { id: 'a1', type: 'external-file', label: 'Audio', url: 'file://audio.wav', durationSeconds: 12, ready: true },
      },
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          ready: true,
          physicalRoutingAvailable: true,
        },
      },
      displays: {
        d1: { id: 'd1', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
      },
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 1_000,
        offsetStreamMs: 0,
        sceneStates: {},
        activeAudioSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'aud',
            audioSourceId: 'a1',
            outputId: 'output-main',
            streamStartMs: 0,
            localStartMs: 0,
            levelDb: -6,
            playbackRate: 1,
            orphaned: true,
            fadeOutStartedWallTimeMs: 1_000,
            fadeOutDurationMs: 500,
          },
        ],
        activeVisualSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'vis',
            visualId: 'v1',
            target: { displayId: 'd1' },
            streamStartMs: 0,
            localStartMs: 0,
            playbackRate: 1,
            orphaned: true,
            fadeOutStartedWallTimeMs: 1_000,
            fadeOutDurationMs: 500,
          },
        ],
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);

    expect(derived.outputs['output-main'].sources[0]?.levelDb).toBeCloseTo(-12.02, 2);
    const visualId = derived.displays.d1.layout.type === 'single' ? derived.displays.d1.layout.visualId ?? '' : '';
    expect(derived.visuals[visualId]).toMatchObject({ opacity: 0.4 });
  });

  it('keeps active and orphaned audio projections distinct for the same sub-cue', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_100);
    const state = streamDisplayFrameDirectorState({
      audioSources: {
        a1: { id: 'a1', type: 'external-file', label: 'Audio', url: 'file://audio.wav', durationSeconds: 12, ready: true },
      } as DirectorState['audioSources'],
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          ready: true,
          physicalRoutingAvailable: true,
        },
      } as DirectorState['outputs'],
    });
    const cue = {
      sceneId: 'scene-1',
      subCueId: 'aud',
      audioSourceId: 'a1',
      outputId: 'output-main',
      streamStartMs: 0,
      localStartMs: 0,
      levelDb: 0,
      playbackRate: 1,
    };
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 0,
        offsetStreamMs: 0,
        sceneStates: {},
        activeAudioSubCues: [
          { ...cue, streamStartMs: 2_000 },
          { ...cue, orphaned: true, fadeOutStartedWallTimeMs: 1_000, fadeOutDurationMs: 500 },
        ],
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);
    const sourceIds = derived.outputs['output-main'].sources.map((source) => source.audioSourceId);

    expect(sourceIds).toHaveLength(2);
    expect(new Set(sourceIds).size).toBe(2);
    expect(sourceIds.some((id) => id.includes(':orphan') || id.includes(':1000'))).toBe(true);
  });

  it('does not project infinite audio sub-cues with the source duration as a play-time cap', () => {
    const state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {},
      audioSources: {
        a1: { id: 'a1', type: 'external-file', label: 'Loop', url: 'file://loop.wav', durationSeconds: 4, ready: true },
      },
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          ready: true,
          physicalRoutingAvailable: true,
        },
      },
      displays: {},
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 0,
        offsetStreamMs: 0,
        sceneStates: {},
        activeAudioSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'aud',
            audioSourceId: 'a1',
            outputId: 'output-main',
            streamStartMs: 0,
            localStartMs: 0,
            sourceStartMs: 1000,
            sourceEndMs: 3000,
            levelDb: 0,
            playbackRate: 1,
            mediaLoop: { enabled: true, startSeconds: 1, endSeconds: 3 },
          },
        ],
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);
    const audioId = derived.outputs['output-main'].sources[0]?.audioSourceId ?? '';

    expect(derived.audioSources[audioId]?.durationSeconds).toBeUndefined();
    expect(derived.audioSources[audioId]).toMatchObject({
      runtimeSourceStartSeconds: 1,
      runtimeSourceEndSeconds: 3,
      runtimeLoop: { enabled: true, startSeconds: 1, endSeconds: 3 },
    });
  });

  it('projects overlapping scene cues with their own absolute runtime offsets', () => {
    vi.spyOn(Date, 'now').mockReturnValue(40_000);
    const state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {
        v1: { id: 'v1', kind: 'file', type: 'video', label: 'Wide', url: 'file://wide.mp4', durationSeconds: 60, ready: true },
        v2: { id: 'v2', kind: 'file', type: 'video', label: 'Inset', url: 'file://inset.mp4', durationSeconds: 20, ready: true },
      },
      audioSources: {
        a1: { id: 'a1', type: 'external-file', label: 'Bed', url: 'file://bed.wav', durationSeconds: 60, ready: true },
        a2: { id: 'a2', type: 'external-file', label: 'Hit', url: 'file://hit.wav', durationSeconds: 20, ready: true },
      },
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          ready: true,
          physicalRoutingAvailable: true,
        },
      },
      displays: {
        d1: { id: 'd1', layout: { type: 'split', visualIds: [undefined, undefined] }, fullscreen: false, health: 'ready' },
      },
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      playbackStream: { id: 'stream-main', label: 'Main', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 30_000,
        offsetStreamMs: 30_000,
        currentStreamMs: 40_000,
        sceneStates: {},
        expectedDurationMs: 60_000,
        activeAudioSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'aud-1',
            audioSourceId: 'a1',
            outputId: 'output-main',
            streamStartMs: 0,
            localStartMs: 0,
            levelDb: -3,
            playbackRate: 1,
          },
          {
            sceneId: 'scene-2',
            subCueId: 'aud-2',
            audioSourceId: 'a2',
            outputId: 'output-main',
            streamStartMs: 30_000,
            localStartMs: 1_000,
            levelDb: -9,
            playbackRate: 1,
          },
        ],
        activeVisualSubCues: [
          {
            sceneId: 'scene-1',
            subCueId: 'vis-1',
            visualId: 'v1',
            target: { displayId: 'd1', zoneId: 'L' },
            streamStartMs: 0,
            localStartMs: 0,
            playbackRate: 1,
          },
          {
            sceneId: 'scene-2',
            subCueId: 'vis-2',
            visualId: 'v2',
            target: { displayId: 'd1', zoneId: 'R' },
            streamStartMs: 30_000,
            localStartMs: 1_000,
            playbackRate: 1,
          },
        ],
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);
    const sourceIds = derived.outputs['output-main'].sources.map((source) => source.audioSourceId);
    const visualIds = derived.displays.d1.layout.type === 'split' ? derived.displays.d1.layout.visualIds : [];
    const projectedAudio = derived.audioSources as Record<string, { runtimeOffsetSeconds?: number }>;
    const projectedVisuals = derived.visuals as Record<string, { runtimeOffsetSeconds?: number }>;

    expect(sourceIds.map((id) => projectedAudio[id]?.runtimeOffsetSeconds)).toEqual([0, 31]);
    expect(visualIds.map((id) => (id ? projectedVisuals[id]?.runtimeOffsetSeconds : undefined))).toEqual([0, 31]);
    expect(derived.activeTimeline.activeAudioSourceIds).toHaveLength(2);
    expect(derived.activeTimeline.assignedVideoIds).toHaveLength(2);
  });

  it('freezes derived director timeline when transport is running but no scene row is playing media', () => {
    vi.spyOn(Date, 'now').mockReturnValue(99_000);
    const state = {
      paused: false,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: 1,
      globalDisplayBlackoutFadeOutSeconds: 1,
      visuals: {},
      audioSources: {},
      outputs: {},
      displays: {},
      activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
      audioRendererReady: true,
      readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
      corrections: { displays: {} },
      previews: {},
      audioExtractionFormat: 'm4a',
      controlDisplayPreviewMaxFps: 15,
      performanceMode: false,
    } as DirectorState;
    const streamState = {
      stream: { id: 's', label: 's', sceneOrder: [], scenes: {} },
      playbackStream: { id: 's', label: 's', sceneOrder: [], scenes: {} },
      editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
      validationMessages: [],
      runtime: {
        status: 'running',
        originWallTimeMs: 90_000,
        offsetStreamMs: 1000,
        currentStreamMs: 10_000,
        sceneStates: {
          a: { sceneId: 'a', status: 'ready' },
          b: { sceneId: 'b', status: 'ready' },
        },
      },
    } satisfies StreamEnginePublicState;

    const derived = deriveDirectorStateForStream(state, streamState);

    expect(derived.paused).toBe(true);
    expect(derived.offsetSeconds).toBe(10);
    expect(derived.anchorWallTimeMs).toBe(99_000);
  });

  it('prioritizes the deterministic latest stream layer per display zone by default', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState({
      displayVisualMingle: {
        d1: { mode: 'prioritize-latest', algorithm: 'latest', defaultTransitionMs: 0 },
      },
    });
    const streamState = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
      { runtimeInstanceId: 'inst-2', sceneId: 'b', subCueId: 'vis-b', visualId: 'v2', streamStartMs: 2000 },
    ]);

    const frame = buildStreamDisplayFrames(state, streamState).d1;
    const layers = frame?.zones[0]?.layers ?? [];

    expect(frame?.mode).toBe('prioritize-latest');
    expect(layers).toHaveLength(2);
    expect(layers.filter((layer) => layer.selected).map((layer) => layer.sourceVisualId)).toEqual(['v2']);
  });

  it('keeps simultaneous stream layers when display composition mode is layered', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState({
      displayVisualMingle: {
        d1: { mode: 'layered', algorithm: 'screen', defaultTransitionMs: 0 },
      },
    });
    const streamState = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
      { runtimeInstanceId: 'inst-2', sceneId: 'b', subCueId: 'vis-b', visualId: 'v2', streamStartMs: 2000 },
    ]);

    const frame = buildStreamDisplayFrames(state, streamState).d1;
    const layers = frame?.zones[0]?.layers ?? [];

    expect(frame?.algorithm).toBe('screen');
    expect(layers.map((layer) => [layer.sourceVisualId, layer.selected, layer.blendAlgorithm])).toEqual([
      ['v1', true, 'screen'],
      ['v2', true, 'screen'],
    ]);
  });

  it('does not collapse copied stream instances that share scene, sub-cue, and target', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState({
      displayVisualMingle: {
        d1: { mode: 'layered', algorithm: 'alpha-over', defaultTransitionMs: 0 },
      },
    });
    const streamState = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
      { runtimeInstanceId: 'inst-copy', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
    ]);

    const layers = buildStreamDisplayFrames(state, streamState).d1?.zones[0]?.layers ?? [];

    expect(layers).toHaveLength(2);
    expect(new Set(layers.map((layer) => layer.layerId)).size).toBe(2);
    expect(layers.map((layer) => layer.runtimeInstanceId)).toEqual(['inst-1', 'inst-copy']);
  });

  it('keeps a runtime visual layer id stable when only the projected stream offset jitters', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState();
    const base = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
    ]);
    const jittered = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1007 },
    ]);

    const baseLayer = buildStreamDisplayFrames(state, base).d1?.zones[0]?.layers[0];
    const jitteredLayer = buildStreamDisplayFrames(state, jittered).d1?.zones[0]?.layers[0];

    expect(jitteredLayer?.layerId).toBe(baseLayer?.layerId);
    expect(jitteredLayer?.visual.runtimeOffsetSeconds).toBe(1.007);
  });

  it('keeps orphaned visual layers distinct from relaunched active layers on the same runtime instance', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState({
      displayVisualMingle: {
        d1: { mode: 'layered', algorithm: 'alpha-over', defaultTransitionMs: 0 },
      },
    });
    const streamState = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000 },
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 3000 },
    ]);
    streamState.runtime!.activeVisualSubCues![0]!.orphaned = true;
    streamState.runtime!.activeVisualSubCues![0]!.fadeOutStartedWallTimeMs = 9000;
    streamState.runtime!.activeVisualSubCues![0]!.fadeOutDurationMs = 2000;

    const layers = buildStreamDisplayFrames(state, streamState).d1?.zones[0]?.layers ?? [];

    expect(layers).toHaveLength(2);
    expect(new Set(layers.map((layer) => layer.layerId)).size).toBe(2);
  });

  it('keeps split display zones independent', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const state = streamDisplayFrameDirectorState({
      displays: {
        d1: { id: 'd1', layout: { type: 'split', visualIds: [undefined, undefined] }, fullscreen: false, health: 'ready' },
      },
      displayVisualMingle: {
        d1: { mode: 'prioritize-latest', algorithm: 'latest', defaultTransitionMs: 0 },
      },
    });
    const streamState = streamDisplayFrameState([
      { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 1000, zoneId: 'L' },
      { runtimeInstanceId: 'inst-2', sceneId: 'b', subCueId: 'vis-b', visualId: 'v2', streamStartMs: 2000, zoneId: 'R' },
    ]);

    const frame = buildStreamDisplayFrames(state, streamState).d1;

    expect(frame?.layout.type).toBe('split');
    expect(frame?.zones.map((zone) => [zone.zoneId, zone.layers.filter((layer) => layer.selected).map((layer) => layer.sourceVisualId)])).toEqual([
      ['L', ['v1']],
      ['R', ['v2']],
    ]);
  });

  it('applies orphan fade and prioritize-latest crossfade opacity in render frames', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_250);
    const state = streamDisplayFrameDirectorState({
      displayVisualMingle: {
        d1: { mode: 'prioritize-latest', algorithm: 'crossfade', defaultTransitionMs: 200 },
      },
    });
    const streamState = streamDisplayFrameState(
      [
        { runtimeInstanceId: 'inst-1', sceneId: 'a', subCueId: 'vis-a', visualId: 'v1', streamStartMs: 900 },
        { runtimeInstanceId: 'inst-2', sceneId: 'b', subCueId: 'vis-b', visualId: 'v2', streamStartMs: 1000 },
      ],
      { currentStreamMs: 1100 },
    );
    streamState.runtime!.activeVisualSubCues![0]!.fadeOutStartedWallTimeMs = 1000;
    streamState.runtime!.activeVisualSubCues![0]!.fadeOutDurationMs = 500;

    const layers = buildStreamDisplayFrames(state, streamState).d1?.zones[0]?.layers ?? [];

    expect(layers.map((layer) => [layer.sourceVisualId, layer.selected, Number(layer.opacity.toFixed(2))])).toEqual([
      ['v1', true, 0.25],
      ['v2', true, 0.5],
    ]);
    const derived = deriveDirectorStateForStream(state, streamState);
    const derivedVisuals = Object.values(derived.visuals).filter((visual) => visual.id.startsWith('stream-visual:'));
    expect(derivedVisuals.map((visual) => [visual.label, Number((visual.opacity ?? 0).toFixed(2))])).toEqual([
      ['One', 0.25],
      ['Two', 0.5],
    ]);
  });
});

function streamDisplayFrameDirectorState(overrides: Partial<DirectorState> = {}): DirectorState {
  return {
    paused: true,
    rate: 1,
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    visuals: {
      v1: { id: 'v1', kind: 'file', type: 'video', label: 'One', url: 'file://one.mp4', durationSeconds: 10, ready: true },
      v2: { id: 'v2', kind: 'file', type: 'video', label: 'Two', url: 'file://two.mp4', durationSeconds: 10, ready: true },
    },
    audioSources: {},
    outputs: {},
    displays: {
      d1: { id: 'd1', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
    },
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    audioRendererReady: true,
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
    audioExtractionFormat: 'm4a',
    controlDisplayPreviewMaxFps: 15,
    performanceMode: false,
    ...overrides,
  } as DirectorState;
}

function streamDisplayFrameState(
  cues: Array<{
    runtimeInstanceId: string;
    sceneId: string;
    subCueId: string;
    visualId: string;
    streamStartMs: number;
    zoneId?: 'single' | 'L' | 'R';
  }>,
  runtime: { currentStreamMs?: number } = {},
): StreamEnginePublicState {
  const sceneOrder = Array.from(new Set(cues.map((cue) => cue.sceneId)));
  const timelineInstances = Object.fromEntries(
    cues.map((cue, index) => [
      `timeline-${index + 1}`,
      {
        id: `timeline-${index + 1}`,
        kind: index === 0 ? 'main' : 'parallel',
        status: 'running',
        orderedThreadInstanceIds: [cue.runtimeInstanceId],
        cursorMs: runtime.currentStreamMs ?? 3000,
      },
    ]),
  ) as NonNullable<NonNullable<StreamEnginePublicState['runtime']>['timelineInstances']>;
  const threadInstances = Object.fromEntries(
    cues.map((cue, index) => [
      cue.runtimeInstanceId,
      {
        id: cue.runtimeInstanceId,
        canonicalThreadId: `thread-${cue.sceneId}`,
        timelineId: `timeline-${index + 1}`,
        rootSceneId: cue.sceneId,
        launchSceneId: cue.sceneId,
        launchLocalMs: 0,
        state: 'running',
        timelineStartMs: 0,
      },
    ]),
  ) as NonNullable<NonNullable<StreamEnginePublicState['runtime']>['threadInstances']>;
  return {
    stream: {
      id: 'stream-main',
      label: 'Main',
      sceneOrder,
      scenes: Object.fromEntries(
        sceneOrder.map((sceneId) => [
          sceneId,
          {
            id: sceneId,
            trigger: { type: 'manual' },
            loop: { enabled: false },
            preload: { enabled: false },
            subCueOrder: cues.filter((cue) => cue.sceneId === sceneId).map((cue) => cue.subCueId),
            subCues: {},
          },
        ]),
      ),
    },
    playbackStream: {
      id: 'stream-main',
      label: 'Main',
      sceneOrder,
      scenes: Object.fromEntries(
        sceneOrder.map((sceneId) => [
          sceneId,
          {
            id: sceneId,
            trigger: { type: 'manual' },
            loop: { enabled: false },
            preload: { enabled: false },
            subCueOrder: cues.filter((cue) => cue.sceneId === sceneId).map((cue) => cue.subCueId),
            subCues: {},
          },
        ]),
      ),
    },
    editTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
    playbackTimeline: { revision: 1, status: 'valid', entries: {}, calculatedAtWallTimeMs: 0, issues: [] },
    validationMessages: [],
    runtime: {
      status: 'running',
      originWallTimeMs: 0,
      offsetStreamMs: runtime.currentStreamMs ?? 3000,
      currentStreamMs: runtime.currentStreamMs ?? 3000,
      sceneStates: {},
      timelineOrder: Object.keys(timelineInstances),
      timelineInstances,
      threadInstances,
      activeVisualSubCues: cues.map((cue) => ({
        runtimeInstanceId: cue.runtimeInstanceId,
        sceneId: cue.sceneId,
        subCueId: cue.subCueId,
        visualId: cue.visualId,
        target: { displayId: 'd1', ...(cue.zoneId && cue.zoneId !== 'single' ? { zoneId: cue.zoneId } : {}) },
        streamStartMs: cue.streamStartMs,
        localStartMs: 0,
        playbackRate: 1,
      })),
    },
  } satisfies StreamEnginePublicState;
}
