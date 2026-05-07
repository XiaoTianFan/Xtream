// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { getDefaultStreamPersistence } from '../../../shared/streamWorkspace';
import type { CalculatedStreamTimeline, StreamEnginePublicState } from '../../../shared/types';
import {
  createGlobalStreamPlayCommand,
  createStreamRailSegmentStyles,
  deriveStreamTransportUiState,
  deriveStreamWorkspaceLiveStateLabel,
  renderStreamHeader,
  syncStreamHeaderRuntime,
} from './streamHeader';

function timeline(
  status: CalculatedStreamTimeline['status'],
  entries: CalculatedStreamTimeline['entries'] = {},
): CalculatedStreamTimeline {
  return {
    revision: 1,
    status,
    entries,
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function addSecondScene(stream: ReturnType<typeof getDefaultStreamPersistence>['stream']): void {
  stream.sceneOrder = ['scene-1', 'scene-2'];
  stream.scenes['scene-2'] = {
    ...structuredClone(stream.scenes['scene-1']),
    id: 'scene-2',
  };
}

const playableTimeline = timeline('valid', {
  'scene-1': { sceneId: 'scene-1', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
  'scene-2': { sceneId: 'scene-2', startMs: 1000, durationMs: 1000, endMs: 2000, triggerKnown: true },
});

describe('deriveStreamWorkspaceLiveStateLabel', () => {
  it('is IDLE before runtime starts', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: null,
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('IDLE');
  });

  it('is RUNNING while running', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'running', sceneStates: {} },
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('RUNNING');
  });

  it('is PRELOADING while preloading', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'preloading', sceneStates: {} },
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('PRELOADING');
  });

  it('is PAUSED when paused', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'paused', sceneStates: {} },
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('PAUSED');
  });

  it('is COMPLETE when complete', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'complete', sceneStates: {} },
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('COMPLETE');
  });

  it('is BLOCKED when timeline is invalid', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'running', sceneStates: {} },
        playbackTimeline: timeline('invalid'),
      }),
    ).toBe('BLOCKED');
  });

  it('is BLOCKED when runtime failed', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'failed', sceneStates: {} },
        playbackTimeline: timeline('valid'),
      }),
    ).toBe('BLOCKED');
  });

  it('prefers BLOCKED over timeline warning issues', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'running', sceneStates: {} },
        playbackTimeline: {
          revision: 1,
          status: 'valid',
          entries: {},
          calculatedAtWallTimeMs: 0,
          issues: [
            { severity: 'warning', message: 'w' },
            { severity: 'error', message: 'e' },
          ],
        },
      }),
    ).toBe('BLOCKED');
  });

  it('is DEGRADED when only warning timeline issues', () => {
    expect(
      deriveStreamWorkspaceLiveStateLabel({
        runtime: { status: 'running', sceneStates: {} },
        playbackTimeline: {
          revision: 1,
          status: 'valid',
          entries: {},
          calculatedAtWallTimeMs: 0,
          issues: [{ severity: 'warning', message: 'w' }],
        },
      }),
    ).toBe('DEGRADED');
  });
});

describe('deriveStreamTransportUiState', () => {
  it('does not disable Stream play based on Patch Director paused state', () => {
    const { stream } = getDefaultStreamPersistence();
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('valid'),
        playbackFocusSceneId: 'scene-1',
        playbackStream: stream,
      }).playDisabled,
    ).toBe(false);
  });

  it('disables Stream play when the playback timeline is invalid', () => {
    const { stream } = getDefaultStreamPersistence();
    const state = deriveStreamTransportUiState({
      runtime: null,
      playbackTimeline: timeline('invalid'),
      playbackFocusSceneId: 'scene-1',
      playbackStream: stream,
    });

    expect(state.playDisabled).toBe(true);
    expect(state.playDisabledReason).toContain('timeline');
  });

  it('keeps pause pause-only', () => {
    const { stream } = getDefaultStreamPersistence();
    const pausedRuntime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
    };
    expect(
      deriveStreamTransportUiState({
        runtime: pausedRuntime,
        playbackTimeline: timeline('valid'),
        playbackFocusSceneId: 'scene-1',
        playbackStream: stream,
      }).pauseDisabled,
    ).toBe(true);
  });

  it('disables Stream play while Patch transport is active', () => {
    const { stream } = getDefaultStreamPersistence();
    const state = deriveStreamTransportUiState({
      runtime: null,
      playbackTimeline: timeline('valid'),
      playbackFocusSceneId: 'scene-1',
      playbackStream: stream,
      isPatchTransportPlaying: true,
    });

    expect(state.playDisabled).toBe(true);
    expect(state.playDisabledReason).toContain('Patch');
  });
});

describe('syncStreamHeaderRuntime', () => {
  it('refreshes transport disabled states during runtime-only updates', () => {
    const { stream } = getDefaultStreamPersistence();
    const headerEl = document.createElement('header');
    const runningRuntime: StreamEnginePublicState['runtime'] = {
      status: 'running',
      sceneStates: {},
      originWallTimeMs: 0,
      offsetStreamMs: 0,
    };

    renderStreamHeader({
      headerEl,
      stream,
      playbackStream: stream,
      runtime: runningRuntime,
      playbackTimeline: playableTimeline,
      validationMessages: [],
      currentState: undefined,
      sceneEditSceneId: 'scene-1',
      playbackFocusSceneId: 'scene-1',
      headerEditField: undefined,
      options: {
        showActions: {
          saveShow: vi.fn(),
          saveShowAs: vi.fn(),
          openShow: vi.fn(),
          createShow: vi.fn(),
        },
      } as never,
      setHeaderEditField: vi.fn(),
      updateSelectedScene: vi.fn(),
      setPlaybackFocusSceneId: vi.fn(),
      refreshChrome: vi.fn(),
      requestRender: vi.fn(),
    });

    const back = headerEl.querySelector<HTMLButtonElement>('[data-stream-transport-action="back"]')!;
    const pause = headerEl.querySelector<HTMLButtonElement>('[data-stream-transport-action="pause"]')!;
    expect(back.disabled).toBe(true);
    expect(pause.disabled).toBe(false);

    syncStreamHeaderRuntime(
      headerEl,
      { status: 'paused', sceneStates: {}, currentStreamMs: 1000 },
      stream,
      playableTimeline,
      'scene-1',
      undefined,
    );

    expect(back.disabled).toBe(false);
    expect(pause.disabled).toBe(true);
    expect(headerEl.querySelector<HTMLElement>('[data-stream-live-state="true"]')?.textContent).toBe('PAUSED');
  });
});

describe('createGlobalStreamPlayCommand', () => {
  it('resumes a paused stream when selection has not changed', () => {
    const { stream } = getDefaultStreamPersistence();
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, playbackFocusSceneId: 'scene-1' })).toEqual({
      type: 'play',
      source: 'global',
    });
  });

  it('plays a new selected scene while paused in selection-aware mode', () => {
    const { stream } = getDefaultStreamPersistence();
    addSecondScene(stream);
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, playbackFocusSceneId: 'scene-2' })).toEqual({
      type: 'play',
      sceneId: 'scene-2',
      source: 'global',
    });
  });

  it('preserves paused cursor when configured even if selection changed', () => {
    const { stream } = getDefaultStreamPersistence();
    addSecondScene(stream);
    stream.playbackSettings = {
      ...stream.playbackSettings!,
      pausedPlayBehavior: 'preserve-paused-cursor',
    };
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, playbackFocusSceneId: 'scene-2' })).toEqual({
      type: 'play',
      source: 'global',
    });
  });

  it('does not send an unpromoted selected scene id in degraded authoring state', () => {
    const { stream: playbackStream } = getDefaultStreamPersistence();

    expect(
      createGlobalStreamPlayCommand({
        runtime: null,
        playbackStream,
        playbackTimeline: playableTimeline,
        playbackFocusSceneId: 'scene-2',
      }),
    ).toEqual({ type: 'play', source: 'global' });
  });

  it('targets playback focus scene id when starting play while not paused', () => {
    const { stream } = getDefaultStreamPersistence();
    addSecondScene(stream);
    expect(
      createGlobalStreamPlayCommand({
        runtime: { status: 'running', sceneStates: {}, originWallTimeMs: 0, offsetStreamMs: 0 },
        playbackStream: stream,
        playbackTimeline: playableTimeline,
        playbackFocusSceneId: 'scene-2',
      }),
    ).toEqual({ type: 'play', sceneId: 'scene-2', source: 'global' });
  });
});

describe('createStreamRailSegmentStyles', () => {
  it('falls back to playback timeline segments before a runtime exists', () => {
    const styles = createStreamRailSegmentStyles({
      playbackTimeline: {
        ...playableTimeline,
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
          ],
          threadBySceneId: { a: 'thread:a', b: 'thread:b' },
          temporarilyDisabledSceneIds: [],
          issues: [],
        },
      },
      runtime: null,
    });

    expect(styles?.background).toContain('0.000% 33.333%');
    expect(styles?.background).toContain('33.333% 100.000%');
    expect(styles?.foreground).toContain('#a6b8a2');
    expect(styles?.foreground).toContain('#86bfcb');
  });

  it('builds segmented rail gradients from latest runtime main order proportions', () => {
    const playbackTimeline: CalculatedStreamTimeline = {
      ...playableTimeline,
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
        ],
        threadBySceneId: { a: 'thread:a', b: 'thread:b' },
        temporarilyDisabledSceneIds: [],
        issues: [],
      },
    };
    const styles = createStreamRailSegmentStyles({
      playbackTimeline,
      runtime: {
        status: 'running',
        sceneStates: {},
        mainTimelineId: 'main',
        timelineInstances: {
          main: {
            id: 'main',
            kind: 'main',
            status: 'running',
            orderedThreadInstanceIds: ['b-inst', 'a-inst'],
            cursorMs: 0,
            durationMs: 3000,
          },
        },
        threadInstances: {
          'b-inst': {
            id: 'b-inst',
            canonicalThreadId: 'thread:b',
            timelineId: 'main',
            rootSceneId: 'b',
            launchSceneId: 'b',
            launchLocalMs: 0,
            state: 'running',
            timelineStartMs: 0,
            durationMs: 2000,
          },
          'a-inst': {
            id: 'a-inst',
            canonicalThreadId: 'thread:a',
            timelineId: 'main',
            rootSceneId: 'a',
            launchSceneId: 'a',
            launchLocalMs: 0,
            state: 'ready',
            timelineStartMs: 2000,
            durationMs: 1000,
          },
        },
      },
    });

    expect(styles?.background).toContain('0.000% 66.667%');
    expect(styles?.background).toContain('66.667% 100.000%');
    expect(styles?.foreground).toContain('#86bfcb');
    expect(styles?.foreground).toContain('#a6b8a2');
  });
});
