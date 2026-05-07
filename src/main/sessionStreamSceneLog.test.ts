import { describe, expect, it } from 'vitest';
import { StreamSceneStateTransitionLogger } from './sessionStreamSceneLog';
import type { StreamEnginePublicState } from '../shared/types';
import { getDefaultStreamPersistence } from '../shared/streamWorkspace';

function publicState(status: 'ready' | 'running' | 'complete', currentStreamMs = 0): StreamEnginePublicState {
  const { stream } = getDefaultStreamPersistence();
  stream.scenes['scene-1'].title = 'Opening cue';
  return {
    stream,
    playbackStream: stream,
    validationMessages: [],
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
    runtime: {
      status: status === 'complete' ? 'complete' : 'running',
      startedWallTimeMs: 10,
      currentStreamMs,
      sceneStates: {
        'scene-1': {
          sceneId: 'scene-1',
          status,
          scheduledStartMs: 0,
          startedAtStreamMs: status === 'ready' ? undefined : 0,
          endedAtStreamMs: status === 'complete' ? currentStreamMs : undefined,
        },
      },
    },
  };
}

describe('StreamSceneStateTransitionLogger', () => {
  it('emits initial scene status rows and then only status transitions', () => {
    const logger = new StreamSceneStateTransitionLogger();

    const initial = logger.collect(publicState('ready'));
    expect(initial).toHaveLength(1);
    expect(initial[0].checkpoint).toBe('stream_scene_state_transition');
    expect(initial[0].extra).toMatchObject({
      sceneId: 'scene-1',
      sceneTitle: 'Opening cue',
      fromStatus: undefined,
      toStatus: 'ready',
      initial: true,
    });

    expect(logger.collect(publicState('ready', 500))).toEqual([]);

    const running = logger.collect(publicState('running', 1000));
    expect(running).toHaveLength(1);
    expect(running[0].extra).toMatchObject({
      fromStatus: 'ready',
      toStatus: 'running',
      currentStreamMs: 1000,
      timelineTimecode: '00:01.000',
      initial: false,
    });
  });

  it('resets after runtime clears', () => {
    const logger = new StreamSceneStateTransitionLogger();
    expect(logger.collect(publicState('running'))).toHaveLength(1);

    const cleared = publicState('running');
    cleared.runtime = null;
    expect(logger.collect(cleared)).toEqual([]);

    const restarted = logger.collect(publicState('running'));
    expect(restarted).toHaveLength(1);
    expect(restarted[0].extra?.initial).toBe(true);
  });
});
