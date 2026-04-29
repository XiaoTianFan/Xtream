import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Director } from './director';
import { StreamEngine } from './streamEngine';
import { getDefaultStreamPersistence } from '../shared/streamWorkspace';
import type { DirectorState, SceneId } from '../shared/types';

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

  it('applies play to the first enabled scene', () => {
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
    const state = engine.applyTransport({ type: 'play' });
    expect(state.runtime?.status).toBe('running');
    expect(state.runtime?.cursorSceneId).toBe('scene-1');
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(engine.isStreamPlaybackActive()).toBe(true);
  });

  it('does not start when Patch transport is playing', () => {
    const director = { isPatchTransportPlaying: () => true } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    const state = engine.applyTransport({ type: 'play' });
    expect(state.runtime).toBeNull();
  });

  it('allows Stream pause even if Patch transport becomes active unexpectedly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let patchPlaying = false;
    const director = {
      ...createDirector({
        visuals: { v1: { id: 'v1', durationSeconds: 10 } } as DirectorState['visuals'],
      }),
      isPatchTransportPlaying: () => patchPlaying,
    } as unknown as Director;
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play' });
    vi.setSystemTime(2_000);

    patchPlaying = true;
    const state = engine.applyTransport({ type: 'pause' });

    expect(state.runtime?.status).toBe('paused');
    expect(state.runtime?.currentStreamMs).toBe(1000);
  });

  it('allows Stream seek when Stream already owns active playback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    let patchPlaying = false;
    const director = {
      ...createDirector({
        visuals: { v1: { id: 'v1', durationSeconds: 10 } } as DirectorState['visuals'],
      }),
      isPatchTransportPlaying: () => patchPlaying,
    } as unknown as Director;
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play' });

    patchPlaying = true;
    const state = engine.applyTransport({ type: 'seek', timeMs: 7000 });

    expect(state.runtime?.currentStreamMs).toBe(7000);
    expect(state.runtime?.offsetStreamMs).toBe(7000);
    vi.useRealTimers();
  });

  it('back-to-first skips a disabled leading scene', () => {
    const director = createDirector();
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    engine.applyTransport({ type: 'play' });
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
    expect(afterBack.runtime?.sceneStates[order[1]]?.status).toBe('ready');
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
    engine.applyTransport({ type: 'play' });
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
    const state = engine.applyTransport({ type: 'play' });
    expect(state.runtime?.expectedDurationMs).toBe(5000);
  });

  it('seeking into a scene loop pass reactivates sub-cues at the loop phase', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 120 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].loop = {
      enabled: true,
      range: { startMs: 0, endMs: 5000 },
      iterations: { type: 'count', count: 2 },
    };
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    const state = engine.applyTransport({ type: 'seek', timeMs: 6000 });

    expect(state.runtime?.expectedDurationMs).toBe(10_000);
    expect(state.runtime?.currentStreamMs).toBe(6000);
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('ready');

    const playing = engine.applyTransport({ type: 'play' });
    expect(playing.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(playing.runtime?.activeVisualSubCues).toMatchObject([{ streamStartMs: 5000, localStartMs: 0 }]);
  });

  it('seeking into a sub-cue loop keeps the shorter cue active', () => {
    const director = createDirector({
      visuals: {
        long: { id: 'long', durationSeconds: 120 },
        short: { id: 'short', durationSeconds: 60 },
      } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['long', 'short'];
    stream.scenes['scene-1'].subCues = {
      long: { id: 'long', kind: 'visual', visualId: 'long', targets: [{ displayId: 'd1' }] },
      short: {
        id: 'short',
        kind: 'visual',
        visualId: 'short',
        targets: [{ displayId: 'd1' }],
        loop: { enabled: true, iterations: { type: 'count', count: 3 } },
      },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play' });
    const state = engine.applyTransport({ type: 'seek', timeMs: 150_000 });

    expect(state.runtime?.expectedDurationMs).toBe(180_000);
    expect(state.runtime?.activeVisualSubCues?.map((cue) => cue.visualId)).toEqual(['short']);
    expect(state.runtime?.activeVisualSubCues?.[0]?.mediaLoop).toMatchObject({ enabled: true, startSeconds: 0, endSeconds: 60 });
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

  it('recalculates invalid timelines when media durations arrive after load', () => {
    const state: Partial<DirectorState> = {
      visuals: { v1: { id: 'v1', type: 'video', ready: false } } as DirectorState['visuals'],
    };
    const director = createDirector(state);
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    expect(engine.getPublicState().playbackTimeline.status).toBe('invalid');

    state.visuals = { v1: { id: 'v1', type: 'video', durationSeconds: 313.324, ready: true } } as DirectorState['visuals'];
    const refreshed = engine.refreshMediaDurations();

    expect(refreshed.playbackTimeline.status).toBe('valid');
    expect(refreshed.playbackTimeline.expectedDurationMs).toBe(313_324);
    expect(refreshed.validationMessages).not.toContainEqual(expect.stringContaining('no calculable duration'));
  });

  it('keeps the last valid playback stream and timeline when an edit timeline becomes invalid', () => {
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

    const invalid = engine.applyEdit({
      type: 'update-subcue',
      sceneId: 'scene-1',
      subCueId: 'vis',
      update: { visualId: 'missing-visual' },
    });

    expect(invalid.editTimeline.status).toBe('invalid');
    expect(invalid.playbackTimeline.status).toBe('valid');
    expect(invalid.stream.scenes['scene-1'].subCues.vis).toMatchObject({ visualId: 'missing-visual' });
    expect(invalid.playbackStream.scenes['scene-1'].subCues.vis).toMatchObject({ visualId: 'v1' });

    const playing = engine.applyTransport({ type: 'play' });
    expect(playing.runtime?.status).toBe('running');
    expect(playing.runtime?.activeVisualSubCues).toMatchObject([{ visualId: 'v1' }]);
  });

  it('keeps running playback on the last valid stream when an edit timeline becomes invalid', () => {
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
    engine.applyTransport({ type: 'play' });

    const invalid = engine.applyEdit({
      type: 'update-subcue',
      sceneId: 'scene-1',
      subCueId: 'vis',
      update: { visualId: 'missing-visual' },
    });

    expect(invalid.editTimeline.status).toBe('invalid');
    expect(invalid.playbackTimeline.status).toBe('valid');
    expect(invalid.runtime?.status).toBe('running');
    expect(invalid.runtime?.activeVisualSubCues).toMatchObject([{ visualId: 'v1' }]);
  });

  it('promotes a valid edit timeline and recomputes runtime from the existing cursor', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 }, v2: { id: 'v2', durationSeconds: 8 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play' });
    engine.applyTransport({ type: 'seek', timeMs: 3000 });

    const promoted = engine.applyEdit({
      type: 'update-subcue',
      sceneId: 'scene-1',
      subCueId: 'vis',
      update: { visualId: 'v2' },
    });

    expect(promoted.editTimeline.status).toBe('valid');
    expect(promoted.playbackTimeline.expectedDurationMs).toBe(8000);
    expect(promoted.playbackStream.scenes['scene-1'].subCues.vis).toMatchObject({ visualId: 'v2' });
    expect(promoted.runtime?.currentStreamMs).toBeGreaterThanOrEqual(3000);
    expect(promoted.runtime?.currentStreamMs).toBeLessThan(3050);
    expect(promoted.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(promoted.runtime?.activeVisualSubCues).toMatchObject([{ visualId: 'v2' }]);
  });

  it('runs follow-start, follow-end, delayed follow-start, and at-timecode scenes from the schedule', () => {
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
    stream.scenes['scene-2'].trigger = { type: 'follow-start', followsSceneId: 'scene-1' };
    stream.scenes['scene-3'].trigger = { type: 'follow-end', followsSceneId: 'scene-1' };
    stream.scenes['scene-4'].trigger = { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 2000 };
    stream.scenes['scene-5'].trigger = { type: 'at-timecode', timecodeMs: 7000 };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-1' });

    expect(state.runtime?.sceneStates['scene-1']?.scheduledStartMs).toBe(0);
    expect(state.runtime?.sceneStates['scene-2']?.scheduledStartMs).toBe(0);
    expect(state.runtime?.sceneStates['scene-3']?.scheduledStartMs).toBe(5000);
    expect(state.runtime?.sceneStates['scene-4']?.scheduledStartMs).toBe(2000);
    expect(state.runtime?.sceneStates['scene-5']?.scheduledStartMs).toBe(7000);
    expect(state.runtime?.expectedDurationMs).toBe(12_000);
  });

  it('plays a selected sequential scene from its absolute scheduled start', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
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

    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-2' });

    expect(state.runtime?.currentStreamMs).toBe(60_000);
    expect(state.runtime?.offsetStreamMs).toBe(60_000);
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('running');
    vi.useRealTimers();
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
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 30_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-2' });

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

  it('uses the focused scene as idle jump-next reference before any runtime exists', () => {
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3', 'scene-4'];
    for (const id of stream.sceneOrder) {
      stream.scenes[id] = {
        id,
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: ['vis'],
        subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
      };
    }
    engine.loadFromShow({ stream });

    const state = engine.applyTransport({ type: 'jump-next', referenceSceneId: 'scene-3' });

    expect(state.runtime?.status).toBe('idle');
    expect(state.runtime?.cursorSceneId).toBe('scene-4');
    expect(state.runtime?.currentStreamMs).toBe(15_000);
    expect(engine.isStreamPlaybackActive()).toBe(false);
  });

  it('paused jump-next uses the latest scheduled paused scene and stays paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 60 }, v2: { id: 'v2', durationSeconds: 20 }, v3: { id: 'v3', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 30_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'at-timecode', timecodeMs: 45_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v3', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.setSystemTime(36_000);
    engine.applyTransport({ type: 'pause' });

    const afterJump = engine.applyTransport({ type: 'jump-next', referenceSceneId: 'scene-1' });

    expect(afterJump.runtime?.status).toBe('paused');
    expect(afterJump.runtime?.cursorSceneId).toBe('scene-3');
    expect(afterJump.runtime?.currentStreamMs).toBe(45_000);
    expect(afterJump.runtime?.sceneStates['scene-2']?.status).toBe('complete');
  });

  it('after an overlay scene ends, cursor advances to the next scene order row instead of regressing to the base loop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const director = createDirector({
      visuals: {
        v1: { id: 'v1', durationSeconds: 60 },
        v2: { id: 'v2', durationSeconds: 3 },
      } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 5000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'manual' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.advanceTimersByTime(9000);
    const state = engine.getPublicState();
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['scene-3']?.status).toBe('ready');
    expect(state.runtime?.cursorSceneId).toBe('scene-3');
    vi.useRealTimers();
  });

  it('when overlay ends and follow-end starts the next scene same tick, cursor stays on the new runner not the base', () => {
    vi.useFakeTimers();
    vi.setSystemTime(200_000);
    const director = createDirector({
      visuals: {
        v1: { id: 'v1', durationSeconds: 60 },
        v2: { id: 'v2', durationSeconds: 3 },
        v3: { id: 'v3', durationSeconds: 5 },
      } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 5000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'follow-end', followsSceneId: 'scene-2' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v3', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.advanceTimersByTime(9000);
    const state = engine.getPublicState();
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['scene-3']?.status).toBe('running');
    expect(state.runtime?.cursorSceneId).toBe('scene-3');
    vi.useRealTimers();
  });

  it('when overlay is the last scene, cursor falls back to the still-running base after overlay ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(300_000);
    const director = createDirector({
      visuals: {
        v1: { id: 'v1', durationSeconds: 60 },
        v2: { id: 'v2', durationSeconds: 3 },
      } as DirectorState['visuals'],
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
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 5000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.advanceTimersByTime(9000);
    const state = engine.getPublicState();
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(state.runtime?.cursorSceneId).toBe('scene-1');
    vi.useRealTimers();
  });

  it('anti-regression skips disabled scenes when advancing after overlay ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(400_000);
    const director = createDirector({
      visuals: {
        v1: { id: 'v1', durationSeconds: 60 },
        v2: { id: 'v2', durationSeconds: 3 },
      } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3', 'scene-4'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 5000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'manual' },
      disabled: true,
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: [],
      subCues: {},
    };
    stream.scenes['scene-4'] = {
      id: 'scene-4',
      trigger: { type: 'manual' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.advanceTimersByTime(9000);
    const state = engine.getPublicState();
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(state.runtime?.cursorSceneId).toBe('scene-4');
    vi.useRealTimers();
  });

  it('running jump-next uses the latest scheduled running scene and keeps playback running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 60 }, v2: { id: 'v2', durationSeconds: 20 }, v3: { id: 'v3', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-start', followsSceneId: 'scene-1', delayMs: 30_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'at-timecode', timecodeMs: 45_000 },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v3', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });
    vi.setSystemTime(36_000);

    const afterJump = engine.applyTransport({ type: 'jump-next', referenceSceneId: 'scene-1' });

    expect(afterJump.runtime?.status).toBe('running');
    expect(afterJump.runtime?.cursorSceneId).toBe('scene-3');
    expect(afterJump.runtime?.currentStreamMs).toBe(45_000);
    expect(afterJump.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(engine.isStreamPlaybackActive()).toBe(true);
  });

  it('does not reset back-to-first while running', () => {
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
    engine.applyTransport({ type: 'play' });
    vi.setSystemTime(2_000);

    const afterBack = engine.applyTransport({ type: 'back-to-first' });

    expect(afterBack.runtime?.status).toBe('running');
    expect(afterBack.runtime?.currentStreamMs).toBe(1000);
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
    engine.applyTransport({ type: 'play' });

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
    engine.applyTransport({ type: 'play', sceneId: 'scene-1' });

    const afterSeek = engine.applyTransport({ type: 'seek', timeMs: 8000 });

    expect(afterSeek.runtime?.sceneStates['scene-2']?.status).toBe('skipped');
  });

  it('pauses and resumes through play while preserving the stream clock position', () => {
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
    engine.applyTransport({ type: 'play' });
    vi.setSystemTime(2_500);

    const paused = engine.applyTransport({ type: 'pause' });
    vi.setSystemTime(8_000);
    const stillPaused = engine.getPublicState();
    const resumed = engine.applyTransport({ type: 'play' });

    expect(paused.runtime?.pausedAtStreamMs).toBe(3000);
    expect(stillPaused.runtime?.currentStreamMs).toBe(3000);
    expect(resumed.runtime?.offsetStreamMs).toBe(3000);
  });

  it('selection-aware global play starts a newly selected scene while paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
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
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(2_000);
    const paused = engine.applyTransport({ type: 'pause' });

    const resumed = engine.applyTransport({ type: 'play', sceneId: 'scene-2', source: 'global' });

    expect(paused.runtime?.pausedCursorMs).toBe(1000);
    expect(paused.runtime?.selectedSceneIdAtPause).toBe('scene-1');
    expect(resumed.runtime?.status).toBe('running');
    expect(resumed.runtime?.currentStreamMs).toBe(5000);
    expect(resumed.runtime?.cursorSceneId).toBe('scene-2');
  });

  it('preserve-paused-cursor global play ignores a changed selection while paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.playbackSettings = {
      pausedPlayBehavior: 'preserve-paused-cursor',
      runningEditOrphanPolicy: 'fade-out',
      runningEditOrphanFadeOutMs: 500,
    };
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
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(2_000);
    engine.applyTransport({ type: 'pause' });

    const resumed = engine.applyTransport({ type: 'play', sceneId: 'scene-2', source: 'global' });

    expect(resumed.runtime?.status).toBe('running');
    expect(resumed.runtime?.currentStreamMs).toBe(1000);
    expect(resumed.runtime?.offsetStreamMs).toBe(1000);
  });

  it('scene-row play while running starts the interacted scene without seeking the stream cursor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 10 }, v2: { id: 'v2', durationSeconds: 3 } } as DirectorState['visuals'],
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
      trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(2_000);

    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-2', source: 'scene-row' });

    expect(state.runtime?.currentStreamMs).toBe(1000);
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-2']?.startedAtStreamMs).toBe(1000);
    expect(state.runtime?.activeVisualSubCues?.map((cue) => cue.visualId).sort()).toEqual(['v1', 'v2']);
  });

  it('dispatches a zero-duration manual control scene before completing it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 10 } } as DirectorState['visuals'],
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
      subCueOrder: ['ctl'],
      subCues: {
        ctl: { id: 'ctl', kind: 'control', action: { type: 'stop-scene', sceneId: 'scene-1', fadeOutMs: 1000 } },
      },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(2_000);

    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-2', source: 'scene-row' });

    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('complete');
    expect(state.runtime?.activeVisualSubCues).toEqual([
      expect.objectContaining({ sceneId: 'scene-1', visualId: 'v1', orphaned: true, fadeOutDurationMs: 1000 }),
    ]);
  });

  it('play-scene control restarts a completed scene from its beginning', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 2 } } as DirectorState['visuals'],
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
      trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['ctl'],
      subCues: {
        ctl: { id: 'ctl', kind: 'control', action: { type: 'play-scene', sceneId: 'scene-1' } },
      },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });

    const state = engine.applyTransport({ type: 'seek', timeMs: 2000 });

    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-1']?.startedAtStreamMs).toBe(2000);
    expect(state.runtime?.activeVisualSubCues).toMatchObject([{ sceneId: 'scene-1', streamStartMs: 2000 }]);
  });

  it('global control cues pass directional fade overrides to Director', () => {
    const director = createDirector();
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['mute', 'unmute', 'blackout', 'restore'];
    stream.scenes['scene-1'].subCues = {
      mute: { id: 'mute', kind: 'control', action: { type: 'set-global-audio-muted', muted: true, fadeOutMs: 500 } },
      unmute: { id: 'unmute', kind: 'control', action: { type: 'set-global-audio-muted', muted: false, fadeInMs: 750 } },
      blackout: { id: 'blackout', kind: 'control', action: { type: 'set-global-display-blackout', blackout: true, fadeOutMs: 250 } },
      restore: { id: 'restore', kind: 'control', action: { type: 'set-global-display-blackout', blackout: false, fadeInMs: 125 } },
    };
    engine.loadFromShow({ stream });

    engine.applyTransport({ type: 'play' });

    expect(director.updateGlobalState).toHaveBeenCalledWith({
      globalAudioMuted: true,
      globalAudioMuteFadeOverrideSeconds: 0.5,
    });
    expect(director.updateGlobalState).toHaveBeenCalledWith({
      globalAudioMuted: false,
      globalAudioMuteFadeOverrideSeconds: 0.75,
    });
    expect(director.updateGlobalState).toHaveBeenCalledWith({
      globalDisplayBlackout: true,
      globalDisplayBlackoutFadeOverrideSeconds: 0.25,
    });
    expect(director.updateGlobalState).toHaveBeenCalledWith({
      globalDisplayBlackout: false,
      globalDisplayBlackoutFadeOverrideSeconds: 0.125,
    });
  });

  it('global control cues keep fadeMs as a backward-compatible fallback', () => {
    const director = createDirector();
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].subCueOrder = ['mute'];
    stream.scenes['scene-1'].subCues = {
      mute: { id: 'mute', kind: 'control', action: { type: 'set-global-audio-muted', muted: true, fadeMs: 500 } },
    };
    engine.loadFromShow({ stream });

    engine.applyTransport({ type: 'play' });

    expect(director.updateGlobalState).toHaveBeenCalledWith({
      globalAudioMuted: true,
      globalAudioMuteFadeOverrideSeconds: 0.5,
    });
  });

  it('keeps removed running content as a fade-out orphan after valid edit promotion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 10 }, v2: { id: 'v2', durationSeconds: 10 } } as DirectorState['visuals'],
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
      trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(2_000);

    const promoted = engine.applyEdit({
      type: 'update-scene',
      sceneId: 'scene-1',
      update: { subCueOrder: [], subCues: {} },
    });

    expect(promoted.runtime?.status).toBe('running');
    expect(promoted.runtime?.activeVisualSubCues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ visualId: 'v1', orphaned: true, fadeOutDurationMs: 500 }),
        expect.objectContaining({ visualId: 'v2' }),
      ]),
    );
  });

  it('lets removed running content finish naturally with the let-finish orphan policy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 2 }, v2: { id: 'v2', durationSeconds: 10 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.playbackSettings = {
      pausedPlayBehavior: 'selection-aware',
      runningEditOrphanPolicy: 'let-finish',
      runningEditOrphanFadeOutMs: 500,
    };
    stream.sceneOrder = ['scene-1', 'scene-2'];
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(1_500);

    const promoted = engine.applyEdit({
      type: 'update-scene',
      sceneId: 'scene-1',
      update: { subCueOrder: [], subCues: {} },
    });

    expect(promoted.runtime?.activeVisualSubCues).toEqual(
      expect.arrayContaining([expect.objectContaining({ visualId: 'v1', orphaned: true, fadeOutDurationMs: undefined })]),
    );

    vi.setSystemTime(3_100);
    const afterNaturalEnd = engine.applyTransport({ type: 'seek', timeMs: 2100 });

    expect(afterNaturalEnd.runtime?.activeVisualSubCues?.some((cue) => cue.visualId === 'v1')).toBe(false);
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
    engine.applyTransport({ type: 'play' });
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

    const state = engine.applyTransport({ type: 'play' });

    expect(state.runtime?.activeVisualSubCues).toMatchObject([{ sceneId: 'scene-1', subCueId: 'vis', playbackRate: 1.5 }]);
    expect(state.runtime?.activeAudioSubCues).toMatchObject([{ sceneId: 'scene-1', subCueId: 'aud', outputId: 'output-main', levelDb: -6 }]);
  });

  it('follow-end tracks a manual predecessor’s actual end when that predecessor is started before its stacked schedule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const director = createDirector({
      visuals: {
        vx: { id: 'vx', durationSeconds: 10 },
        va: { id: 'va', durationSeconds: 2 },
        vb: { id: 'vb', durationSeconds: 2 },
      } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    const base = (id: SceneId, vid: string) => ({
      id,
      trigger: { type: 'manual' as const },
      loop: { enabled: false as const },
      preload: { enabled: false as const },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual' as const, visualId: vid, targets: [{ displayId: 'd1' }] } },
    });
    stream.sceneOrder = ['sx', 'sa', 'sb'];
    stream.scenes = {
      sx: { ...base('sx', 'vx') },
      sa: { ...base('sa', 'va') },
      sb: {
        id: 'sb',
        trigger: { type: 'follow-end', followsSceneId: 'sa' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: ['vis'],
        subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'vb', targets: [{ displayId: 'd1' }] } },
      },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'sx', source: 'global' });
    vi.setSystemTime(11_000);
    engine.applyTransport({ type: 'play', sceneId: 'sa', source: 'scene-row' });
    vi.setSystemTime(13_100);
    engine.applyTransport({ type: 'back-to-first' });
    const state = engine.getPublicState();
    expect(state.runtime?.sceneStates['sa']?.status).toBe('complete');
    expect(state.runtime?.sceneStates['sb']?.status).toBe('running');
    expect(state.runtime?.sceneStates['sb']?.scheduledStartMs).toBe(3000);
  });

  it('scene-row run from here on a stacked manual does not complete earlier manuals or auto-start the next', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 5 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes = Object.fromEntries(
      ['scene-1', 'scene-2', 'scene-3'].map((id) => [
        id,
        {
          id,
          title: id,
          trigger: { type: 'manual' as const },
          loop: { enabled: false },
          preload: { enabled: false },
          subCueOrder: ['vis'],
          subCues: { vis: { id: 'vis', kind: 'visual' as const, visualId: 'v1', targets: [{ displayId: 'd1' }] } },
        },
      ]),
    ) as typeof stream.scenes;
    engine.loadFromShow({ stream });
    const state = engine.applyTransport({ type: 'play', sceneId: 'scene-2', source: 'scene-row' });
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('ready');
    expect(state.runtime?.sceneStates['scene-2']?.status).toBe('running');
    expect(state.runtime?.sceneStates['scene-3']?.status).toBe('ready');
  });

  it('holds stream timecode when an auto chain finishes and only manual-gated scenes remain', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const director = createDirector({
      visuals: { v1: { id: 'v1', durationSeconds: 2 }, v2: { id: 'v2', durationSeconds: 2 } } as DirectorState['visuals'],
    });
    const engine = new StreamEngine(director);
    const { stream } = getDefaultStreamPersistence();
    stream.sceneOrder = ['scene-1', 'scene-2', 'scene-3'];
    stream.scenes['scene-1'].trigger = { type: 'manual' };
    stream.scenes['scene-1'].subCueOrder = ['vis'];
    stream.scenes['scene-1'].subCues = {
      vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] },
    };
    stream.scenes['scene-2'] = {
      id: 'scene-2',
      trigger: { type: 'follow-end', followsSceneId: 'scene-1' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }] } },
    };
    stream.scenes['scene-3'] = {
      id: 'scene-3',
      trigger: { type: 'manual' },
      loop: { enabled: false },
      preload: { enabled: false },
      subCueOrder: ['vis'],
      subCues: { vis: { id: 'vis', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }] } },
    };
    engine.loadFromShow({ stream });
    engine.applyTransport({ type: 'play', sceneId: 'scene-1', source: 'global' });
    vi.setSystemTime(12_000);
    engine.applyTransport({ type: 'back-to-first' });
    vi.setSystemTime(14_000);
    engine.applyTransport({ type: 'back-to-first' });
    let st = engine.getPublicState().runtime;
    expect(st?.sceneStates['scene-2']?.status).toBe('complete');
    expect(st?.sceneStates['scene-3']?.status).toBe('ready');
    expect(st?.currentStreamMs).toBe(4000);
    expect(st?.originWallTimeMs).toBeUndefined();
    vi.setSystemTime(200_000);
    engine.applyTransport({ type: 'back-to-first' });
    st = engine.getPublicState().runtime;
    expect(st?.currentStreamMs).toBe(4000);
  });
});
