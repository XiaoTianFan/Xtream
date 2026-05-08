import { describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../shared/types';
import { deriveOutputBusGanttProjection } from './outputBusGanttProjection';

function scene(id: SceneId, title = id, subCueOrder: string[] = [], subCues: PersistedSceneConfig['subCues'] = {}): PersistedSceneConfig {
  return {
    id,
    title,
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder,
    subCues,
  };
}

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {},
    audioSources: {
      a1: { id: 'a1', label: 'Kick', type: 'audio', ready: true, durationSeconds: 4 },
      a2: { id: 'a2', label: 'Pad', type: 'audio', ready: true, durationSeconds: 2 },
      live: { id: 'live', label: 'Live', type: 'audio', ready: true },
    },
    outputs: {},
    displays: {},
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}

function stream(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['a', 'b', 'c'],
    scenes: {
      a: scene('a', 'Alpha', ['aud-a', 'aud-other'], {
        'aud-a': { id: 'aud-a', kind: 'audio', audioSourceId: 'a1', outputIds: ['out-main'], startOffsetMs: 250, levelDb: -6 },
        'aud-other': { id: 'aud-other', kind: 'audio', audioSourceId: 'a2', outputIds: ['out-other'] },
      }),
      b: scene('b', 'Beta', ['aud-b'], {
        'aud-b': { id: 'aud-b', kind: 'audio', audioSourceId: 'a2', outputIds: ['out-main', 'out-other'], durationOverrideMs: 1000, levelDb: -3, muted: true },
      }),
      c: scene('c', 'Gamma', ['aud-c'], {
        'aud-c': { id: 'aud-c', kind: 'audio', audioSourceId: 'live', outputIds: ['out-main'], solo: true },
      }),
    },
  };
}

function timeline(): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      a: { sceneId: 'a', startMs: 0, durationMs: 5000, endMs: 5000, triggerKnown: true },
      b: { sceneId: 'b', startMs: 5000, durationMs: 2000, endMs: 7000, triggerKnown: true },
      c: { sceneId: 'c', startMs: 0, durationMs: 3000, endMs: 3000, triggerKnown: true },
    },
    expectedDurationMs: 7000,
    mainSegments: [
      { threadId: 'thread:a', rootSceneId: 'a', startMs: 0, durationMs: 5000, endMs: 5000, proportion: 5 / 7 },
      { threadId: 'thread:b', rootSceneId: 'b', startMs: 5000, durationMs: 2000, endMs: 7000, proportion: 2 / 7 },
    ],
    threadPlan: {
      threads: [
        {
          threadId: 'thread:a',
          rootSceneId: 'a',
          rootTriggerType: 'manual',
          sceneIds: ['a'],
          edges: [],
          branches: [{ sceneIds: ['a'], durationMs: 5000 }],
          longestBranchSceneIds: ['a'],
          sceneTimings: { a: { sceneId: 'a', threadLocalStartMs: 0, threadLocalEndMs: 5000 } },
          durationMs: 5000,
          temporarilyDisabledSceneIds: [],
        },
        {
          threadId: 'thread:b',
          rootSceneId: 'b',
          rootTriggerType: 'manual',
          sceneIds: ['b'],
          edges: [],
          branches: [{ sceneIds: ['b'], durationMs: 2000 }],
          longestBranchSceneIds: ['b'],
          sceneTimings: { b: { sceneId: 'b', threadLocalStartMs: 0, threadLocalEndMs: 2000 } },
          durationMs: 2000,
          temporarilyDisabledSceneIds: [],
        },
        {
          threadId: 'thread:c',
          rootSceneId: 'c',
          rootTriggerType: 'at-timecode',
          sceneIds: ['c'],
          edges: [],
          branches: [{ sceneIds: ['c'], durationMs: 3000 }],
          longestBranchSceneIds: ['c'],
          sceneTimings: { c: { sceneId: 'c', threadLocalStartMs: 0, threadLocalEndMs: 3000 } },
          durationMs: 3000,
          temporarilyDisabledSceneIds: [],
        },
      ],
      threadBySceneId: { a: 'thread:a', b: 'thread:b', c: 'thread:c' },
      temporarilyDisabledSceneIds: [],
      issues: [],
    },
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function publicState(runtime: StreamEnginePublicState['runtime'] = null): StreamEnginePublicState {
  const s = stream();
  const t = timeline();
  return {
    stream: s,
    playbackStream: s,
    editTimeline: t,
    playbackTimeline: t,
    validationMessages: [],
    runtime,
  };
}

function runtime(): NonNullable<StreamEnginePublicState['runtime']> {
  return {
    status: 'running',
    currentStreamMs: 1250,
    sceneStates: {},
    mainTimelineId: 'timeline:main',
    timelineOrder: ['timeline:main', 'timeline:parallel'],
    timelineInstances: {
      'timeline:main': {
        id: 'timeline:main',
        kind: 'main',
        status: 'running',
        orderedThreadInstanceIds: ['a-inst', 'b-inst'],
        cursorMs: 1250,
        durationMs: 7000,
      },
      'timeline:parallel': {
        id: 'timeline:parallel',
        kind: 'parallel',
        status: 'running',
        orderedThreadInstanceIds: ['c-copy'],
        cursorMs: 500,
        durationMs: 3000,
        spawnedAtStreamMs: 3000,
      },
    },
    threadInstances: {
      'a-inst': {
        id: 'a-inst',
        canonicalThreadId: 'thread:a',
        timelineId: 'timeline:main',
        rootSceneId: 'a',
        launchSceneId: 'a',
        launchLocalMs: 0,
        state: 'running',
        timelineStartMs: 0,
        durationMs: 5000,
      },
      'b-inst': {
        id: 'b-inst',
        canonicalThreadId: 'thread:b',
        timelineId: 'timeline:main',
        rootSceneId: 'b',
        launchSceneId: 'b',
        launchLocalMs: 0,
        state: 'ready',
        timelineStartMs: 5000,
        durationMs: 2000,
      },
      'c-copy': {
        id: 'c-copy',
        canonicalThreadId: 'thread:c',
        timelineId: 'timeline:parallel',
        rootSceneId: 'c',
        launchSceneId: 'c',
        launchLocalMs: 0,
        state: 'running',
        timelineStartMs: 0,
        durationMs: 3000,
        copiedFromThreadInstanceId: 'c-original',
      },
    },
    activeAudioSubCues: [
      {
        runtimeInstanceId: 'a-inst',
        sceneId: 'a',
        subCueId: 'aud-a',
        audioSourceId: 'a1',
        outputId: 'out-main',
        streamStartMs: 0,
        localStartMs: 250,
        localEndMs: 4000,
        levelDb: -6,
        playbackRate: 1,
      },
    ],
  };
}

describe('deriveOutputBusGanttProjection', () => {
  it('filters planned audio rows to the selected output bus', () => {
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(), directorState: director(), outputId: 'out-main' });

    expect(projection.status).toBe('ready');
    expect(projection.rows.map((row) => [row.sceneLabel, row.audioLabel, row.startMs, row.durationMs])).toEqual([
      ['Alpha', 'Kick', 250, 4000],
      ['Beta', 'Pad', 5000, 1000],
    ]);
    expect(projection.rows.some((row) => row.subCueId === 'aud-other')).toBe(false);
  });

  it('projects expanded finite pass and inner-loop audio durations in planned rows', () => {
    const s = stream();
    const sub = s.scenes.a.subCues['aud-a'];
    if (sub?.kind === 'audio') {
      sub.pass = { iterations: { type: 'count', count: 2 } };
      sub.innerLoop = {
        enabled: true,
        range: { startMs: 1000, endMs: 2000 },
        iterations: { type: 'count', count: 1 },
      };
    }
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(null), directorState: director(), outputId: 'out-main' });
    const patchedProjection = deriveOutputBusGanttProjection({
      streamState: { ...publicState(null), stream: s, playbackStream: s },
      directorState: director(),
      outputId: 'out-main',
    });

    expect(projection.rows.find((row) => row.subCueId === 'aud-a')?.durationMs).toBe(4000);
    expect(patchedProjection.rows.find((row) => row.subCueId === 'aud-a')?.durationMs).toBe(10_000);
  });

  it('uses source labels, time labels, and level state metadata', () => {
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(), directorState: director(), outputId: 'out-main' });
    const beta = projection.rows.find((row) => row.sceneId === 'b')!;

    expect(beta.audioLabel).toBe('Pad');
    expect(beta.timeLabel).toBe('00:05.000 - 00:06.000');
    expect(beta.metaLabel).toContain('-3 dB');
    expect(beta.muted).toBe(true);
  });

  it('highlights active runtime rows with cursor progress', () => {
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(runtime()), directorState: director(), outputId: 'out-main' });
    const alpha = projection.rows.find((row) => row.sceneId === 'a')!;

    expect(alpha.live).toBe(true);
    expect(alpha.cursorPercent).toBe(25);
    expect(projection.cursorPercent).toBeCloseTo(20.833, 2);
  });

  it('aligns copied parallel rows on the shared stream scale', () => {
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(runtime()), directorState: director(), outputId: 'out-main' });
    const copy = projection.rows.find((row) => row.sceneId === 'c')!;

    expect(copy.copied).toBe(true);
    expect(copy.timelineLabel).toBe('Parallel 1');
    expect(copy.durationMs).toBeUndefined();
    expect(copy.leftPercent).toBeCloseTo(50, 2);
    expect(copy.widthPercent).toBeGreaterThan(0);
  });

  it('returns an empty state when no audio cues route to the bus', () => {
    const projection = deriveOutputBusGanttProjection({ streamState: publicState(), directorState: director(), outputId: 'missing-output' });

    expect(projection.status).toBe('empty');
    expect(projection.rows).toEqual([]);
  });
});
