import { describe, expect, it } from 'vitest';
import type {
  CalculatedStreamTimeline,
  DirectorState,
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
} from '../../../shared/types';
import { deriveDisplayWindowGanttProjection } from './displayWindowGanttProjection';

function scene(id: SceneId, title: string, subCueOrder: string[] = [], subCues: PersistedSceneConfig['subCues'] = {}): PersistedSceneConfig {
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

function director(overrides: Partial<DirectorState> = {}): DirectorState {
  return {
    rate: 1,
    paused: true,
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    performanceMode: false,
    loop: { enabled: false, startSeconds: 0 },
    visuals: {
      v1: { id: 'v1', kind: 'file', type: 'video', label: 'Backdrop', durationSeconds: 10, ready: true },
      v2: { id: 'v2', kind: 'file', type: 'video', label: 'Overlay', durationSeconds: 10, ready: true },
      img: { id: 'img', kind: 'file', type: 'image', label: 'Still', ready: true },
    },
    audioSources: {},
    outputs: {},
    displays: {
      d1: { id: 'd1', label: 'Main Display', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
      d2: { id: 'd2', label: 'Aux Display', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
    },
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    audioRendererReady: true,
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
    audioExtractionFormat: 'm4a',
    controlDisplayPreviewMaxFps: 15,
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    ...overrides,
  } as DirectorState;
}

function streamWithScene(subCues: PersistedSceneConfig['subCues'], subCueOrder = Object.keys(subCues)): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['a'],
    scenes: {
      a: scene('a', 'Alpha', subCueOrder, subCues),
    },
  };
}

function timelineForStream(stream: PersistedStreamConfig): CalculatedStreamTimeline {
  const sceneIds = stream.sceneOrder;
  const entries = Object.fromEntries(sceneIds.map((sceneId) => [sceneId, { sceneId, startMs: 0, durationMs: 5000, endMs: 5000, triggerKnown: true }]));
  return {
    revision: 1,
    status: 'valid',
    entries,
    expectedDurationMs: 5000,
    mainSegments: [{ threadId: `thread:${sceneIds[0]}`, rootSceneId: sceneIds[0]!, startMs: 0, durationMs: 5000, endMs: 5000, proportion: 1 }],
    threadPlan: {
      threads: [
        {
          threadId: `thread:${sceneIds[0]}`,
          rootSceneId: sceneIds[0]!,
          rootTriggerType: 'manual',
          sceneIds,
          edges: [],
          branches: [{ sceneIds, durationMs: 5000 }],
          longestBranchSceneIds: sceneIds,
          sceneTimings: Object.fromEntries(sceneIds.map((sceneId) => [sceneId, { sceneId, threadLocalStartMs: 0, threadLocalEndMs: 5000 }])),
          durationMs: 5000,
          temporarilyDisabledSceneIds: [],
        },
      ],
      threadBySceneId: Object.fromEntries(sceneIds.map((sceneId) => [sceneId, `thread:${sceneIds[0]}`])),
      temporarilyDisabledSceneIds: [],
      issues: [],
    },
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function publicState(stream: PersistedStreamConfig, runtime: StreamEnginePublicState['runtime'] = null): StreamEnginePublicState {
  const timeline = timelineForStream(stream);
  return {
    stream,
    playbackStream: stream,
    editTimeline: timeline,
    playbackTimeline: timeline,
    validationMessages: [],
    runtime,
  };
}

function segmentPairs(row: { renderSegments: Array<{ startMs: number; endMs: number }> } | undefined): number[][] {
  return row?.renderSegments.map((segment) => [segment.startMs, segment.endMs]) ?? [];
}

describe('deriveDisplayWindowGanttProjection', () => {
  it('filters rows to one display and keeps display zones independent', () => {
    const s = streamWithScene({
      single: { id: 'single', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 4000 },
      left: { id: 'left', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1', zoneId: 'L' }], durationOverrideMs: 1000 },
      other: { id: 'other', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd2' }], durationOverrideMs: 1000 },
    });

    const projection = deriveDisplayWindowGanttProjection({ streamState: publicState(s), directorState: director(), displayId: 'd1' });

    expect(projection.status).toBe('ready');
    expect(projection.rows.map((row) => [row.subCueId, row.zoneId])).toEqual([
      ['single', 'single'],
      ['left', 'L'],
    ]);
  });

  it('dims overwritten portions in prioritize-latest mode and restores the earlier visual after overlap', () => {
    const s = streamWithScene({
      base: { id: 'base', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], startOffsetMs: 0, durationOverrideMs: 4000 },
      cover: { id: 'cover', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], startOffsetMs: 1000, durationOverrideMs: 2000 },
    });

    const projection = deriveDisplayWindowGanttProjection({ streamState: publicState(s), directorState: director(), displayId: 'd1' });

    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'base'))).toEqual([
      [0, 1000],
      [3000, 4000],
    ]);
    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'cover'))).toEqual([[1000, 3000]]);
  });

  it('keeps every overlapping visual bright in layered mode', () => {
    const s = streamWithScene({
      base: { id: 'base', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 4000 },
      cover: { id: 'cover', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], startOffsetMs: 1000, durationOverrideMs: 2000 },
    });

    const projection = deriveDisplayWindowGanttProjection({
      streamState: publicState(s),
      directorState: director({ displayVisualMingle: { d1: { mode: 'layered', algorithm: 'screen', defaultTransitionMs: 0 } } }),
      displayId: 'd1',
    });

    expect(projection.mingleMode).toBe('layered');
    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'base'))).toEqual([[0, 4000]]);
    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'cover'))).toEqual([[1000, 3000]]);
  });

  it('keeps the previous and latest visuals bright during transition windows', () => {
    const s = streamWithScene({
      base: { id: 'base', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 4000 },
      cover: { id: 'cover', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], startOffsetMs: 1000, durationOverrideMs: 2000 },
    });

    const projection = deriveDisplayWindowGanttProjection({
      streamState: publicState(s),
      directorState: director({ displayVisualMingle: { d1: { mode: 'prioritize-latest', algorithm: 'crossfade', defaultTransitionMs: 500 } } }),
      displayId: 'd1',
    });

    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'base'))).toEqual([
      [0, 1500],
      [3000, 4000],
    ]);
    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'cover'))).toEqual([[1000, 3000]]);
  });

  it('shows an unbounded earlier visual rendering again after a finite cover ends', () => {
    const s = streamWithScene({
      base: { id: 'base', kind: 'visual', visualId: 'img', targets: [{ displayId: 'd1' }] },
      cover: { id: 'cover', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], startOffsetMs: 1000, durationOverrideMs: 2000 },
    });

    const projection = deriveDisplayWindowGanttProjection({ streamState: publicState(s), directorState: director(), displayId: 'd1' });

    expect(projection.scaleDurationMs).toBe(10_000);
    expect(projection.rows.find((row) => row.subCueId === 'base')?.durationMs).toBeUndefined();
    expect(segmentPairs(projection.rows.find((row) => row.subCueId === 'base'))).toEqual([
      [0, 1000],
      [3000, 10000],
    ]);
  });

  it('includes runtime parallel copies and falls back to the planned main timeline when runtime has no main', () => {
    const s: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['a', 'c'],
      scenes: {
        a: scene('a', 'Alpha', ['vis-a'], {
          'vis-a': { id: 'vis-a', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 1000 },
        }),
        c: scene('c', 'Gamma', ['vis-c'], {
          'vis-c': { id: 'vis-c', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], durationOverrideMs: 1000 },
        }),
      },
    };
    const timeline = timelineForStream(s);
    timeline.threadPlan!.threads[0] = {
      ...timeline.threadPlan!.threads[0]!,
      sceneIds: ['a'],
      branches: [{ sceneIds: ['a'], durationMs: 1000 }],
      longestBranchSceneIds: ['a'],
      sceneTimings: { a: { sceneId: 'a', threadLocalStartMs: 0, threadLocalEndMs: 1000 } },
      durationMs: 1000,
    };
    timeline.threadPlan!.threads.push({
      threadId: 'thread:c',
      rootSceneId: 'c',
      rootTriggerType: 'manual',
      sceneIds: ['c'],
      edges: [],
      branches: [{ sceneIds: ['c'], durationMs: 1000 }],
      longestBranchSceneIds: ['c'],
      sceneTimings: { c: { sceneId: 'c', threadLocalStartMs: 0, threadLocalEndMs: 1000 } },
      durationMs: 1000,
      temporarilyDisabledSceneIds: [],
    });
    timeline.threadPlan!.threadBySceneId = { a: 'thread:a', c: 'thread:c' };
    const streamState: StreamEnginePublicState = {
      stream: s,
      playbackStream: s,
      editTimeline: timeline,
      playbackTimeline: timeline,
      validationMessages: [],
      runtime: {
        status: 'running',
        currentStreamMs: 3500,
        sceneStates: {},
        timelineOrder: ['parallel'],
        timelineInstances: {
          parallel: {
            id: 'parallel',
            kind: 'parallel',
            status: 'running',
            orderedThreadInstanceIds: ['c-copy'],
            cursorMs: 500,
            spawnedAtStreamMs: 3000,
          },
        },
        threadInstances: {
          'c-copy': {
            id: 'c-copy',
            canonicalThreadId: 'thread:c',
            timelineId: 'parallel',
            rootSceneId: 'c',
            launchSceneId: 'c',
            launchLocalMs: 0,
            state: 'running',
            timelineStartMs: 0,
            copiedFromThreadInstanceId: 'c-original',
          },
        },
        activeVisualSubCues: [
          {
            runtimeInstanceId: 'c-copy',
            sceneId: 'c',
            subCueId: 'vis-c',
            visualId: 'v2',
            target: { displayId: 'd1' },
            streamStartMs: 3000,
            localStartMs: 0,
            localEndMs: 1000,
            playbackRate: 1,
          },
        ],
      },
    };

    const projection = deriveDisplayWindowGanttProjection({ streamState, directorState: director(), displayId: 'd1' });

    expect(projection.rows.map((row) => row.subCueId)).toEqual(['vis-a', 'vis-c']);
    expect(projection.rows.find((row) => row.subCueId === 'vis-c')).toMatchObject({
      copied: true,
      live: true,
      timelineLabel: 'Parallel 1',
      startMs: 3000,
    });
  });
});
