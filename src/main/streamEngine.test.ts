import { describe, expect, it } from 'vitest';
import type { Director } from './director';
import { StreamEngine } from './streamEngine';
import { getDefaultStreamPersistence, STREAM_MAIN_ID } from '../shared/streamWorkspace';

describe('StreamEngine', () => {
  it('applies manual go to the first enabled scene', () => {
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
    const engine = new StreamEngine(director);
    const { streams, activeStreamId } = getDefaultStreamPersistence();
    engine.loadFromShow({ streams, activeStreamId });
    const state = engine.applyTransport({ type: 'go', streamId: STREAM_MAIN_ID });
    expect(state.runtime?.status).toBe('running');
    expect(state.runtime?.cursorSceneId).toBe('scene-1');
    expect(state.runtime?.sceneStates['scene-1']?.status).toBe('running');
    expect(engine.isStreamPlaybackActive()).toBe(true);
  });

  it('does not start when Patch transport is playing', () => {
    const director = { isPatchTransportPlaying: () => true } as unknown as Director;
    const engine = new StreamEngine(director);
    const { streams, activeStreamId } = getDefaultStreamPersistence();
    engine.loadFromShow({ streams, activeStreamId });
    const state = engine.applyTransport({ type: 'go', streamId: STREAM_MAIN_ID });
    expect(state.runtime).toBeNull();
  });

  it('back-to-first skips a disabled leading scene', () => {
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    engine.applyTransport({ type: 'go', streamId: STREAM_MAIN_ID });
    engine.applyEdit({
      type: 'create-scene',
      streamId: STREAM_MAIN_ID,
      afterSceneId: 'scene-1',
    });
    engine.applyEdit({
      type: 'update-scene',
      streamId: STREAM_MAIN_ID,
      sceneId: 'scene-1',
      update: { disabled: true },
    });
    const afterBack = engine.applyTransport({ type: 'back-to-first', streamId: STREAM_MAIN_ID });
    const order = afterBack.streams[STREAM_MAIN_ID]!.sceneOrder;
    expect(afterBack.runtime?.cursorSceneId).toBe(order[1]);
  });

  it('jump-next completes current scene and runs the next', () => {
    const director = { isPatchTransportPlaying: () => false } as unknown as Director;
    const engine = new StreamEngine(director);
    engine.loadFromShow(getDefaultStreamPersistence());
    engine.applyEdit({ type: 'create-scene', streamId: STREAM_MAIN_ID });
    engine.applyTransport({ type: 'go', streamId: STREAM_MAIN_ID });
    const afterJump = engine.applyTransport({ type: 'jump-next', streamId: STREAM_MAIN_ID });
    const order = afterJump.streams[STREAM_MAIN_ID]!.sceneOrder;
    expect(afterJump.runtime?.cursorSceneId).toBe(order[1]);
    expect(afterJump.runtime?.sceneStates[order[0]]?.status).toBe('complete');
  });
});
