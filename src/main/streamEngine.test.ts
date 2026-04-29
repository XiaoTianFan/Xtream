import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Director } from './director';
import { StreamEngine } from './streamEngine';
import { getDefaultStreamPersistence } from '../shared/streamWorkspace';
import type { DirectorState } from '../shared/types';

function createDirector(state: Partial<DirectorState> = {}): Director {
  return {
    isPatchTransportPlaying: () => false,
    getState: () => ({
      rate: 1,
      visuals: {},
      audioSources: {},
      outputs: { 'output-main': { id: 'output-main', sources: [] } },
      displays: { d1: { id: 'd1', layout: { type: 'single' } } },
      ...state,
    }),
    updateGlobalState: vi.fn(),
  } as unknown as Director;
}

describe('StreamEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies manual go to the first enabled scene', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    const state = engine.applyTransport({ type: 'go' });
    expect(state.runtime?.status).toBe('running');
    expect(state.runtime?.cursorSceneId).toBe('scene-1');
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(engine.isStreamPlaybackActive()).toBe(true);
  });

  it('does not start when Patch transport is playing', () => {
    const director = { isPatchTransportPlaying: () => true } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    const state = engine.applyTransport({ type: 'go' });
    expect(state.runtime).toBeNull();
  });

  it('back-to-first skips a disabled leading scene', () => {
    const director = createDirector();
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    engine.applyTransport({ type: 'go' });
    engine.applyEdit({
      type: 'create-scene',
      afterSceneId: 'scene-1',
    });
    engine.applyEdit({
      type: 'update-scene',
      sceneId: 'scene-1',
      update: { disabled: true },
    });
    const afterBack = engine.applyTransport({ type: 'back-to-first' });
    const order = afterBack.stream.sceneOrder;
    expect(afterBack.runtime?.status).toBe('idle');
    expect(afterBack.runtime?.cursorSceneId).toBe(order[1]);
    expect(afterBack.runtime?.sceneStates[order[1]]?.status).toBe('ready-to-start');
    expect(engine.isStreamPlaybackActive()).toBe(false);
  });

  it('jump-next completes current scene and runs the next', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    const afterCreate = engine.applyEdit({ type: 'create-scene' });
    const second = afterCreate.stream.sceneOrder[1];
    engine.applyEdit({
      type: 'update-scene',
      sceneId: second,
      update: {
        subCueOrder: ['vis'],
        subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
      },
    });
    engine.applyTransport({ type: 'go' });
    const afterJump = engine.applyTransport({ type: 'jump-next' });
    const order = afterJump.stream.sceneOrder;
    expect(afterJump.runtime?.cursorSceneId).toBe(order[1]);
    expect(afterJump.runtime?.sceneStates[order[0]]?.status).toBe('complete');
  });

  it('uses Director media durations for expected duration', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
      audioSources: { a1: { id: 'a1', durationSeconds: 2 } } as DirectorState['audioSources'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis-1'];
    stream.scenes['scene-1'].subCues = {
      'vis-1': { id: 'vis-1', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    const state = engine.applyTransport({ type: 'go' });
    expect(state.runtime?.expectedDurationMs).toBe(5000);
  });

  it('surfaces timeline calculation errors in validation state', () => {
    const director = createDirector({
      visuals: { live: { id: 'live', label: 'Live camera', kind: 'live', type: 'video', ready: true } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'live', targets: [{ displayId: 'd1' }] },
    };

    engine.loadFromShow({ stream });

    expect(engine.getPublicState().validationMessages).toContainEqual(expect.stringContaining('Stream timeline'));
    expect(engine.getPublicState().validationMessages).toContainEqual(expect.stringContaining('no calculable duration'));
  });

  it('runs simultaneous, follow-end, time-offset, and at-timecode scenes from the schedule', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5'];
    stream.scenes = Object.fromEntries(
      stream.sceneOrder.map((id) => [
        id,
        {
          id,
          title: id,
          trigger: { type: 'manual' },
          loop: { enabled: false },
          preload: { enabled: false },
          subCueOrder: ['vis'],
          subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
        },
      ]),
    ) as typeof stream.scenes;
    stream.scenes['scene-2'].trigger = { type: 'simultaneous-start', followsSceneId: 'scene-1' };
    stream.scenes['scene-3'].trigger = { type: 'follow-end', followsSceneId: 'scene-1' };
    stream.scenes['scene-4'].trigger = { type: 'time-offset', followsSceneId: 'scene-1', offsetMs: 2000 };
    stream.scenes['scene-5'].trigger = { type: 'at-timecode', timecodeMs: 7000 };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'go', sceneId: 'scene-1' });

    expect(state.runtime?.sceneStates['scene-1']?.scheduledStartMs).toBe(0);
    expect(state.runtime?.sceneStates['scene-2']?.scheduledStartMs).toBe(0);
    expect(state.runtime?.sceneStates['scene-3']?.scheduledStartMs).toBe(5000);
    expect(state.runtime?.sceneStates['scene-4']?.scheduledStartMs).toBe(2000);
    expect(state.runtime?.sceneStates['scene-5']?.scheduledStartMs).toBe(7000);
    expect(state.runtime?.expectedDurationMs).toBe(12_000);
  });

  it('plays a selected sequential scene from its absolute scheduled start', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 60 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'manual' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'go', sceneId: 'scene-2' });

    expect(state.runtime?.currentStreamMs).toBe(60_000);
    expect(state.runtime?.offsetStreamMs).toBe(60_000);
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('running');
  });

  it('plays a selected overlapping offset scene without dropping earlier active scenes', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 60 }, v2: { id: 'v2', durationSeconds: 10 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'time-offset', followsSceneId: 'scene-1', offsetMs: 30_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'go', sceneId: 'scene-2' });

    expect(state.runtime?.currentStreamMs).toBe(30_000);
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('running');
    expect(state.runtime?.activeVisualSubCues?.map((cue) => cue.sceneId).sort()).toEqual(['scene-1', 'scene-2']);
  });

  it('keeps idle jump-next as navigation without starting playback', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'manual' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'back-to-first' });

    const state = engine.applyTransport({ type: 'jump-next' });

    expect(state.runtime?.status).toBe('idle');
    expect(state.runtime?.cursorSceneId).toBe('scene-2');
    expect(state.runtime?.currentStreamMs).toBe(5000);
    expect(engine.isStreamPlaybackActive()).toBe(false);
  });

  it('seek recomputes running and completed scene states', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    engine.loadFromShow({ stream });
    engine.applyEdit({
      type: 'update-scene',
      sceneId: 'scene-1',
      update: {
        subCueOrder: ['vis'],
        subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
      },
    });
    const afterCreate = engine.applyEdit({ type: 'create-scene' });
    const second = afterCreate.stream.sceneOrder[1];
    engine.applyEdit({
      type: 'update-scene',
      sceneId: second,
      update: {
        trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
        subCueOrder: ['vis'],
        subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
      },
    });
    engine.applyTransport({ type: 'go' });

    const afterSeek = engine.applyTransport({ type: 'seek', timeMs: 6000 });

    expect(afterSeek.runtime?.currentStreamMs).toBe(6000);
    expect(afterSeek.runtime?.sceneStates['scene-1']?.status).toBe('complete');
    expect(afterSeek.runtime?.sceneStates[second]?.status).toBe('running');
  });

  it('marks at-timecode scenes before a seek target as skipped', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 20_000 },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'at-timecode', timecodeMs: 7000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'go', sceneId: 'scene-1' });

    const afterSeek = engine.applyTransport({ type: 'seek', timeMs: 8000 });

    expect(afterSeek.runtime?.sceneStates['scene-2']?.status).toBe('skipped');
  });

  it('pauses and resumes while preserving the stream clock position', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      rate: 2,
      visuals: { v1: { id: 'v1', durationSeconds: 10 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'go' });
    vi.setSystemTime(2_500);

    const paused = engine.applyTransport({ type: 'pause' });
    vi.setSystemTime(8_000);
    const stillPaused = engine.getPublicState();
    const resumed = engine.applyTransport({ type: 'resume' });

    expect(paused.runtime?.pausedAtStreamMs).toBe(3000);
    expect(stillPaused.runtime?.currentStreamMs).toBe(3000);
    expect(resumed.runtime?.offsetStreamMs).toBe(3000);
  });

  it('does not toggle pause into resume when already paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 10 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'go' });
    vi.setSystemTime(2_000);
    engine.applyTransport({ type: 'pause' });
    vi.setSystemTime(4_000);

    const state = engine.applyTransport({ type: 'pause' });

    expect(state.runtime?.status).toBe('paused');
    expect(state.runtime?.currentStreamMs).toBe(1000);
    expect(state.runtime?.pausedAtStreamMs).toBe(1000);
  });

  it('projects active audio and visual sub-cues for renderers', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
      audioSources: { a1: { id: 'a1', durationSeconds: 5 } } as DirectorState['audioSources'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis', 'aud'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], playbackRate: 1.5 },
      aud: { id: 'aud', kind: 'audio', audioSourceId: 'a1', outputIds: ['output-main'], levelDb: -6, playbackRate: 0.5 },
    };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'go' });

    expect(state.runtime?.activeVisualSubCues).toMatchObject([{ sceneId: 'scene-1', subCueId: 'vis', playbackRate: 1.5 }]);
    expect(state.runtime?.activeAudioSubCues).toMatchObject([{ sceneId: 'scene-1', subCueId: 'aud', outputId: 'output-main', levelDb: -6 }]);
  });
});
