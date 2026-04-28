import { describe, expect, it } from 'vitest';
import type { PersistedStreamConfig } from './types';
import {
  computeSceneNumbers,
  estimateLinearManualStreamDurationMs,
  estimateSceneDurationMs,
  hasTriggerCycle,
  resolveFollowsSceneId,
  validateTriggerReferences,
} from './streamSchedule';
import { createEmptyUserScene, STREAM_MAIN_ID } from './streamWorkspace';

function streamWithScenes(scenes: PersistedStreamConfig['scenes'], order: string[]): PersistedStreamConfig {
  return {
    id: STREAM_MAIN_ID,
    label: 'Test',
    sceneOrder: order,
    scenes,
  };
}

describe('streamSchedule', () => {
  it('computes cue numbers from scene order', () => {
    expect(computeSceneNumbers(['a', 'b'])).toEqual({ a: 1, b: 2 });
  });

  it('resolves implicit followsSceneId to the previous row', () => {
    const stream = streamWithScenes(
      {
        a: createEmptyUserScene('a', 'A'),
        b: { ...createEmptyUserScene('b', 'B'), trigger: { type: 'follow-end' } },
      },
      ['a', 'b'],
    );
    expect(resolveFollowsSceneId(stream, 'b', stream.scenes.b.trigger)).toBe('a');
  });

  it('detects trigger dependency cycles', () => {
    const stream = streamWithScenes(
      {
        a: { ...createEmptyUserScene('a', 'A'), trigger: { type: 'follow-end', followsSceneId: 'b' } },
        b: { ...createEmptyUserScene('b', 'B'), trigger: { type: 'follow-end', followsSceneId: 'a' } },
      },
      ['a', 'b'],
    );
    expect(hasTriggerCycle(stream)).toBe(true);
    expect(validateTriggerReferences(stream).some((m) => m.includes('cycle'))).toBe(true);
  });

  it('estimates scene duration from sub-cue media when durations are known', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
          playbackRate: 1,
        },
      },
    };
    expect(estimateSceneDurationMs(scene, { vid: 10 }, {})).toBe(10_000);
  });

  it('sums manual scenes for linear stream duration estimate', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'A'),
      subCueOrder: ['a1'],
      subCues: {
        a1: {
          id: 'a1',
          kind: 'audio' as const,
          audioSourceId: 'aud',
          outputIds: ['output-main'],
          playbackRate: 1,
        },
      },
    };
    const s2 = { ...createEmptyUserScene('s2', 'B'), subCueOrder: [], subCues: {} };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    expect(estimateLinearManualStreamDurationMs(stream, {}, { aud: 5 })).toBe(5000);
  });
});
