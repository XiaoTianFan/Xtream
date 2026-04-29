import { describe, expect, it } from 'vitest';
import type { PersistedStreamConfig } from './types';
import {
  buildStreamSchedule,
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

  it('uses duration overrides when media duration is unknown', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'missing-vid',
          targets: [{ displayId: 'd0' }],
          durationOverrideMs: 4000,
        },
      },
    };
    expect(estimateSceneDurationMs(scene, {}, {})).toBe(4000);
  });

  it('treats any unknown contributing sub-cue duration as unknown', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      subCueOrder: ['known', 'unknown'],
      subCues: {
        known: {
          id: 'known',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
        },
        unknown: {
          id: 'unknown',
          kind: 'audio' as const,
          audioSourceId: 'missing-audio',
          outputIds: ['output-main'],
        },
      },
    };
    expect(estimateSceneDurationMs(scene, { vid: 10 }, {})).toBeUndefined();
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

  it('builds an absolute linear schedule for all-manual scenes', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'A'),
      subCueOrder: ['a1'],
      subCues: { a1: { id: 'a1', kind: 'audio' as const, audioSourceId: 'aud', outputIds: ['output-main'] } },
    };
    const s2 = {
      ...createEmptyUserScene('s2', 'B'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }] } },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: { vid: 7 }, audioDurations: { aud: 5 } });
    expect(schedule.status).toBe('valid');
    expect(schedule.entries.s1).toMatchObject({ startMs: 0, endMs: 5000 });
    expect(schedule.entries.s2).toMatchObject({ startMs: 5000, endMs: 12_000 });
    expect(schedule.expectedDurationMs).toBe(12_000);
  });

  it('keeps empty enabled scenes as zero-duration schedule entries', () => {
    const s1 = createEmptyUserScene('s1', 'Empty');
    const s2 = {
      ...createEmptyUserScene('s2', 'After'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }] } },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: { vid: 3 }, audioDurations: {} });
    expect(schedule.status).toBe('valid');
    expect(schedule.entries.s1).toMatchObject({ startMs: 0, durationMs: 0, endMs: 0 });
    expect(schedule.entries.s2).toMatchObject({ startMs: 0, endMs: 3000 });
  });

  it('builds mixed manual and triggered scenes from absolute starts', () => {
    const base = (id: string, durationOverrideMs: number) => ({
      ...createEmptyUserScene(id, id),
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
          durationOverrideMs,
        },
      },
    });
    const s1 = base('s1', 10_000);
    const s2 = { ...base('s2', 4000), trigger: { type: 'time-offset' as const, followsSceneId: 's1', offsetMs: 3000 } };
    const s3 = base('s3', 2000);
    const s4 = { ...base('s4', 1000), trigger: { type: 'follow-end' as const, followsSceneId: 's2' } };
    const stream = streamWithScenes({ s1, s2, s3, s4 }, ['s1', 's2', 's3', 's4']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('valid');
    expect(schedule.entries.s1.startMs).toBe(0);
    expect(schedule.entries.s2.startMs).toBe(3000);
    expect(schedule.entries.s3.startMs).toBe(10_000);
    expect(schedule.entries.s4.startMs).toBe(7000);
    expect(schedule.expectedDurationMs).toBe(12_000);
  });

  it('keeps at-timecode scenes pinned to their absolute start', () => {
    const s1 = createEmptyUserScene('s1', 'Empty');
    const s2 = {
      ...createEmptyUserScene('s2', 'Pinned'),
      trigger: { type: 'at-timecode' as const, timecodeMs: 12_000 },
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
          durationOverrideMs: 1000,
        },
      },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('valid');
    expect(schedule.entries.s1).toMatchObject({ startMs: 0, endMs: 0 });
    expect(schedule.entries.s2).toMatchObject({ startMs: 12_000, endMs: 13_000 });
    expect(schedule.expectedDurationMs).toBe(13_000);
  });

  it('reports disabled predecessor references as scene-specific errors', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'Disabled predecessor'),
      disabled: true,
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }], durationOverrideMs: 1000 } },
    };
    const s2 = {
      ...createEmptyUserScene('s2', 'Follower'),
      trigger: { type: 'follow-end' as const, followsSceneId: 's1' },
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }], durationOverrideMs: 1000 } },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('invalid');
    expect(schedule.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', sceneId: 's2', message: expect.stringContaining('disabled predecessor') }),
    );
  });

  it('reports unknown durations as invalid timeline issues', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'Unknown'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'missing', targets: [{ displayId: 'd0' }] } },
    };
    const stream = streamWithScenes({ s1 }, ['s1']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('invalid');
    expect(schedule.expectedDurationMs).toBeUndefined();
    expect(schedule.issues).toContainEqual(expect.objectContaining({ severity: 'error', sceneId: 's1' }));
  });

  it('reports infinite loops as invalid timeline duration issues', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'Infinite'),
      loop: { enabled: true as const, iterations: { type: 'infinite' as const } },
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }] } },
    };
    const stream = streamWithScenes({ s1 }, ['s1']);
    const schedule = buildStreamSchedule(stream, { visualDurations: { vid: 10 }, audioDurations: {} });
    expect(schedule.status).toBe('invalid');
    expect(schedule.issues).toContainEqual(expect.objectContaining({ severity: 'error', sceneId: 's1' }));
  });

  it('reports follow-end scenes blocked by unknown predecessor ends', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'Unknown predecessor'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'missing', targets: [{ displayId: 'd0' }] } },
    };
    const s2 = {
      ...createEmptyUserScene('s2', 'Follower'),
      trigger: { type: 'follow-end' as const, followsSceneId: 's1' },
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }], durationOverrideMs: 1000 } },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('invalid');
    expect(schedule.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', sceneId: 's2', message: expect.stringContaining('predecessor end') }),
    );
  });

  it('reports manual scenes blocked by unknown preceding ends', () => {
    const s1 = {
      ...createEmptyUserScene('s1', 'Unknown preceding'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'missing', targets: [{ displayId: 'd0' }] } },
    };
    const s2 = {
      ...createEmptyUserScene('s2', 'Manual after unknown'),
      subCueOrder: ['v1'],
      subCues: { v1: { id: 'v1', kind: 'visual' as const, visualId: 'vid', targets: [{ displayId: 'd0' }], durationOverrideMs: 1000 } },
    };
    const stream = streamWithScenes({ s1, s2 }, ['s1', 's2']);
    const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
    expect(schedule.status).toBe('invalid');
    expect(schedule.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', sceneId: 's2', message: expect.stringContaining('preceding scene end') }),
    );
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
