import { describe, expect, it } from 'vitest';
import type { PersistedStreamConfig } from './types';
import {
  computeSceneNumbers,
  estimateLinearManualStreamDurationMs,
  estimateSceneDurationMs,
  hasTriggerCycle,
  resolveFollowsSceneId,
  validateStreamContent,
  validateTriggerReferences,
} from './streamSchedule';
import { createEmptyUserScene, PATCH_COMPAT_SCENE_ID, STREAM_MAIN_ID } from './streamWorkspace';

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

  it('includes sub-cue start offsets in scene duration estimates', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
          startOffsetMs: 2500,
          playbackRate: 1,
        },
      },
    };
    expect(estimateSceneDurationMs(scene, { vid: 10 }, {})).toBe(12_500);
  });

  it('treats infinitely-looped scenes as indefinite even when media duration is known', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      loop: { enabled: true as const, iterations: { type: 'infinite' as const } },
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
    expect(estimateSceneDurationMs(scene, { vid: 10 }, {})).toBeUndefined();
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

  it('allows empty audio output and visual targets on patch compatibility scene only', () => {
    const patchScene = {
      ...createEmptyUserScene(PATCH_COMPAT_SCENE_ID, 'Patch compat'),
      subCueOrder: ['a1', 'v1'],
      subCues: {
        a1: { id: 'a1', kind: 'audio' as const, audioSourceId: 'aud', outputIds: [] },
        v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [] },
      },
    };
    const stream = streamWithScenes({ [PATCH_COMPAT_SCENE_ID]: patchScene }, [PATCH_COMPAT_SCENE_ID]);
    const ctx = {
      audioSources: new Set(['aud']),
      visuals: new Set(['vid']),
      audioSourceLabels: new Map([['aud', 'Room tone']] as const),
      visualLabels: new Map([['vid', 'Wide']] as const),
    };
    const msgs = validateStreamContent(stream, ctx);
    expect(msgs.some((m) => m.includes('no output targets'))).toBe(false);
    expect(msgs.some((m) => m.includes('no display targets'))).toBe(false);
  });

  it('still requires output targets and display targets on user scenes', () => {
    const scene = {
      ...createEmptyUserScene('scene-user', 'User'),
      subCueOrder: ['a1', 'v1'],
      subCues: {
        a1: { id: 'a1', kind: 'audio' as const, audioSourceId: 'aud', outputIds: [] },
        v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [] },
      },
    };
    const stream = streamWithScenes({ 'scene-user': scene }, ['scene-user']);
    const ctx = {
      audioSources: new Set(['aud']),
      visuals: new Set(['vid']),
    };
    const msgs = validateStreamContent(stream, ctx);
    expect(msgs.some((m) => m.includes('no output targets'))).toBe(true);
    expect(msgs.some((m) => m.includes('no display targets'))).toBe(true);
  });

  it('uses scene title and media labels in empty-target messages when context provides maps', () => {
    const scene = {
      ...createEmptyUserScene('scene-0a75149089ac', 'Opening'),
      subCueOrder: ['sub-4935d0668cca'],
      subCues: {
        'sub-4935d0668cca': {
          id: 'sub-4935d0668cca',
          kind: 'audio' as const,
          audioSourceId: 'src-1',
          outputIds: [],
        },
      },
    };
    const stream = streamWithScenes({ 'scene-0a75149089ac': scene }, ['scene-0a75149089ac']);
    const msgs = validateStreamContent(stream, {
      audioSources: new Set(['src-1']),
      audioSourceLabels: new Map([['src-1', 'Room tone']] as const),
    });
    const line = msgs.find((m) => m.includes('no output targets'));
    expect(line).toBeDefined();
    expect(line).toContain('Scene "Opening"');
    expect(line).toContain('Audio | Room tone');
    expect(line).not.toContain('sub-4935d0668cca');
    expect(line).not.toContain('scene-0a75149089ac');
  });
});
