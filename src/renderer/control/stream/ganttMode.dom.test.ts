/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { createStreamGanttMode, syncStreamGanttRuntimeChrome } from './ganttMode';

function stream(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['a'],
    scenes: {
      a: {
        id: 'a',
        title: 'Alpha',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: [],
        subCues: {},
      },
    },
  };
}

function timeline(): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      a: { sceneId: 'a', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
    },
    expectedDurationMs: 1000,
    mainSegments: [{ threadId: 'thread:a', rootSceneId: 'a', startMs: 0, durationMs: 1000, endMs: 1000, proportion: 1 }],
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
      ],
      threadBySceneId: { a: 'thread:a' },
      temporarilyDisabledSceneIds: [],
      issues: [],
    },
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function publicState(cursorMs = 500): StreamEnginePublicState {
  const s = stream();
  const t = timeline();
  return {
    stream: s,
    playbackStream: s,
    editTimeline: t,
    playbackTimeline: t,
    validationMessages: [],
    runtime: {
      status: 'running',
      sceneStates: {},
      mainTimelineId: 'timeline:main',
      timelineOrder: ['timeline:main'],
      timelineInstances: {
        'timeline:main': {
          id: 'timeline:main',
          kind: 'main',
          status: 'running',
          orderedThreadInstanceIds: ['a-inst'],
          cursorMs,
          durationMs: 1000,
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
          durationMs: 1000,
        },
      },
    },
  };
}

describe('createStreamGanttMode', () => {
  it('renders runtime lanes, thread bars, and cursor position', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });

    expect(root.querySelectorAll('.stream-gantt-lane')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.stream-gantt-lane-header strong')?.textContent).toBe('Main timeline');
    expect(root.querySelector<HTMLElement>('.stream-gantt-bar-title')?.textContent).toBe('Alpha');
    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.getPropertyValue('--stream-gantt-cursor')).toBe('50.000%');
  });

  it('renders an empty state when playback has not created runtime timelines', () => {
    const s = stream();
    const t = timeline();
    const root = createStreamGanttMode(s, {
      streamState: { stream: s, playbackStream: s, editTimeline: t, playbackTimeline: t, validationMessages: [], runtime: null },
    });

    expect(root.querySelector<HTMLElement>('.stream-gantt-empty')?.textContent).toContain('No active Stream timelines');
  });

  it('syncs cursor changes in place', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState(250) });
    syncStreamGanttRuntimeChrome(root, publicState(750));

    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.getPropertyValue('--stream-gantt-cursor')).toBe('75.000%');
  });
});
