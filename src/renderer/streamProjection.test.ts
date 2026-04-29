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
            levelDb: -6,
            playbackRate: 1.5,
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
            playbackRate: 0.5,
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
    expect(derived.audioSources[audioId]).toMatchObject({ playbackRate: 0.75, runtimeOffsetSeconds: 2.5, runtimeLoop: { enabled: true, endSeconds: 12 } });
    expect(derived.displays.d1.layout).toMatchObject({ type: 'single' });
    const visualId = derived.displays.d1.layout.type === 'single' ? derived.displays.d1.layout.visualId ?? '' : '';
    expect(derived.visuals[visualId]).toMatchObject({ playbackRate: 1, runtimeOffsetSeconds: 3, runtimeLoop: { enabled: true, endSeconds: 10 } });
    expect(derived.activeTimeline.durationSeconds).toBe(20);
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
});
