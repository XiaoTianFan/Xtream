import { describe, expect, it } from 'vitest';
import type { Director } from './director';
import { StreamEngine } from './streamEngine';
import { getDefaultStreamPersistence } from '../shared/streamWorkspace';

describe('StreamEngine', () => {
  it('applies manual go to the first enabled scene', () => {
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
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
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
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
    expect(afterBack.runtime?.sceneStates[order[1]]?.status).toBe('ready');
    expect(engine.isStreamPlaybackActive()).toBe(false);
  });

  it('jump-next completes current scene and runs the next', () => {
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    engine.applyEdit({ type: 'create-scene' });
    engine.applyTransport({ type: 'go' });
    const afterJump = engine.applyTransport({ type: 'jump-next' });
    const order = afterJump.stream.sceneOrder;
    expect(afterJump.runtime?.cursorSceneId).toBe(order[1]);
    expect(afterJump.runtime?.sceneStates[order[0]]?.status).toBe('complete');
  });

  it('uses Director media durations for expected duration', () => {
    const director = {
      isPatchTransportPlaying: () => false,
      getState: () => ({
        visuals: { v1: { id: 'v1', durationSeconds: 5 } },
        audioSources: { a1: { id: 'a1', durationSeconds: 2 } },
        outputs: { 'output-main': { id: 'output-main' } },
        displays: { d1: { id: 'd1', layout: { type: 'single' } } },
      }),
    } as unknown as Director;
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
});
