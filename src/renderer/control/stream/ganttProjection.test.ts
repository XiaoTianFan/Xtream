import { describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../shared/types';
import { deriveStreamGanttProjection } from './ganttProjection';

function scene(id: SceneId, title = id): PersistedSceneConfig {
  return {
    id,
    title,
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: [],
    subCues: {},
  };
}

function stream(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['a', 'b', 'c'],
    scenes: {
      a: scene('a', 'Alpha'),
      b: scene('b', 'Beta'),
      c: scene('c', 'Gamma'),
    },
  };
}

function playbackTimeline(): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      a: { sceneId: 'a', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
      b: { sceneId: 'b', startMs: 1000, durationMs: 2000, endMs: 3000, triggerKnown: true },
      c: { sceneId: 'c', startMs: 0, durationMs: 1500, endMs: 1500, triggerKnown: true },
    },
    expectedDurationMs: 3000,
    mainSegments: [
      { threadId: 'thread:a', rootSceneId: 'a', startMs: 0, durationMs: 1000, endMs: 1000, proportion: 1 / 3 },
      { threadId: 'thread:b', rootSceneId: 'b', startMs: 1000, durationMs: 2000, endMs: 3000, proportion: 2 / 3 },
    ],
    threadPlan: {
      threads: [
        {
          threadId: 'thread:a',
          rootSceneId: 'a',
          rootTriggerType: 'manual',
          sceneIds: ['a'],
          edges: [],
          branches: [{ sceneIds: ['a'], durationMs: 1000 }],
          longestBranchSceneIds: ['a'],
          sceneTimings: { a: { sceneId: 'a', threadLocalStartMs: 0, threadLocalEndMs: 1000 } },
          durationMs: 1000,
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
          branches: [{ sceneIds: ['c'], durationMs: 1500 }],
          longestBranchSceneIds: ['c'],
          sceneTimings: { c: { sceneId: 'c', threadLocalStartMs: 0, threadLocalEndMs: 1500 } },
          durationMs: 1500,
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

function runtime(): NonNullable<StreamEnginePublicState['runtime']> {
  return {
    status: 'running',
    sceneStates: {},
    mainTimelineId: 'timeline:main',
    timelineOrder: ['timeline:parallel', 'timeline:main'],
    timelineInstances: {
      'timeline:main': {
        id: 'timeline:main',
        kind: 'main',
        status: 'running',
        orderedThreadInstanceIds: ['a-inst', 'b-inst'],
        cursorMs: 1500,
        durationMs: 3000,
      },
      'timeline:parallel': {
        id: 'timeline:parallel',
        kind: 'parallel',
        status: 'paused',
        orderedThreadInstanceIds: ['c-copy'],
        cursorMs: 750,
        durationMs: 1500,
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
        state: 'complete',
        timelineStartMs: 0,
        durationMs: 1000,
      },
      'b-inst': {
        id: 'b-inst',
        canonicalThreadId: 'thread:b',
        timelineId: 'timeline:main',
        rootSceneId: 'b',
        launchSceneId: 'b',
        launchLocalMs: 0,
        state: 'running',
        timelineStartMs: 1000,
        durationMs: 2000,
      },
      'c-copy': {
        id: 'c-copy',
        canonicalThreadId: 'thread:c',
        timelineId: 'timeline:parallel',
        rootSceneId: 'c',
        launchSceneId: 'c',
        launchLocalMs: 250,
        state: 'paused',
        timelineStartMs: 0,
        durationMs: 1500,
        copiedFromThreadInstanceId: 'c-original',
      },
    },
  };
}

describe('deriveStreamGanttProjection', () => {
  it('pins the main lane before parallel lanes and keeps parallel launch order', () => {
    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: runtime() });

    expect(projection.lanes.map((lane) => [lane.kind, lane.label])).toEqual([
      ['main', 'Main timeline'],
      ['parallel', 'Parallel 1'],
    ]);
  });

  it('projects thread bars with timeline geometry, color, cursor, and copy marker', () => {
    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: runtime() });
    const main = projection.lanes[0]!;
    const b = main.bars.find((bar) => bar.id === 'b-inst')!;
    const copy = projection.lanes[1]!.bars[0]!;

    expect(main.cursorPercent).toBe(50);
    expect(main.minWidthPx).toBeGreaterThan(main.trackMinWidthPx);
    expect(main.trackMinWidthPx).toBeGreaterThanOrEqual(560);
    expect(b.leftPercent).toBeCloseTo(33.333, 2);
    expect(b.widthPercent).toBeCloseTo(66.667, 2);
    expect(b.cursorPercent).toBe(25);
    expect(b.color?.token).toBe('thread-teal');
    expect(copy.copied).toBe(true);
    expect(copy.launchPercent).toBeCloseTo(16.667, 2);
  });

  it('uses one shared scale across every Gantt timeline lane', () => {
    const r = runtime();
    const copy = r.threadInstances!['c-copy']!;
    copy.canonicalThreadId = 'thread:a';
    copy.rootSceneId = 'a';
    copy.launchSceneId = 'a';
    copy.durationMs = 1000;
    r.timelineInstances!['timeline:parallel']!.durationMs = 1500;

    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: r });
    const main = projection.lanes[0]!;
    const parallel = projection.lanes[1]!;
    const mainA = main.bars.find((bar) => bar.canonicalThreadId === 'thread:a')!;
    const parallelA = parallel.bars.find((bar) => bar.canonicalThreadId === 'thread:a')!;

    expect(main.trackMinWidthPx).toBe(parallel.trackMinWidthPx);
    expect(mainA.widthPercent).toBeCloseTo(parallelA.widthPercent, 3);
    expect(parallel.durationMs).toBe(1500);
    expect(parallel.cursorPercent).toBe(25);
  });

  it('offsets parallel timelines by their main-stream spawn position', () => {
    const r = runtime();
    r.timelineInstances!['timeline:parallel']!.spawnedAtStreamMs = 1500;

    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: r });
    const parallel = projection.lanes[1]!;
    const copy = parallel.bars[0]!;

    expect(copy.leftPercent).toBe(50);
    expect(copy.widthPercent).toBe(50);
    expect(parallel.cursorPercent).toBe(75);
  });

  it('projects the planned main timeline when no runtime exists', () => {
    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: null });

    expect(projection.hasRuntime).toBe(false);
    expect(projection.lanes).toHaveLength(1);
    expect(projection.lanes[0]).toMatchObject({
      id: 'timeline:main',
      kind: 'main',
      status: 'idle',
      cursorMs: 0,
      durationMs: 3000,
    });
    expect(projection.lanes[0]?.bars.map((bar) => [bar.id, bar.title, bar.state])).toEqual([
      ['planned:thread:a', 'Alpha', 'ready'],
      ['planned:thread:b', 'Beta', 'ready'],
    ]);
  });

  it('keeps the planned main timeline visible when runtime only has parallel timelines', () => {
    const r = runtime();
    delete r.timelineInstances?.['timeline:main'];
    r.mainTimelineId = undefined;
    r.timelineOrder = ['timeline:parallel'];
    delete r.threadInstances?.['a-inst'];
    delete r.threadInstances?.['b-inst'];

    const projection = deriveStreamGanttProjection({ stream: stream(), playbackTimeline: playbackTimeline(), runtime: r });

    expect(projection.lanes.map((lane) => [lane.kind, lane.label])).toEqual([
      ['main', 'Main timeline'],
      ['parallel', 'Parallel 1'],
    ]);
  });
});
