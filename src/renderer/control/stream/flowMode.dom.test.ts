/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import type { CalculatedStreamTimeline, DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { createStreamFlowMode } from './flowMode';

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(() => Promise.resolve(true)),
}));

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}

function stream(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Show stream',
    sceneOrder: ['scene-a'],
    scenes: {
      'scene-a': {
        id: 'scene-a',
        title: 'Scene A',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false, leadTimeMs: 0 },
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
      'scene-a': { sceneId: 'scene-a', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
    },
    expectedDurationMs: 1000,
    mainSegments: [{ threadId: 'thread:scene-a', rootSceneId: 'scene-a', startMs: 0, durationMs: 1000, endMs: 1000, proportion: 1 }],
    threadPlan: {
      threads: [
        {
          threadId: 'thread:scene-a',
          rootSceneId: 'scene-a',
          rootTriggerType: 'manual',
          sceneIds: ['scene-a'],
          edges: [],
          branches: [{ sceneIds: ['scene-a'], durationMs: 1000 }],
          longestBranchSceneIds: ['scene-a'],
          sceneTimings: { 'scene-a': { sceneId: 'scene-a', threadLocalStartMs: 0, threadLocalEndMs: 1000 } },
          durationMs: 1000,
          temporarilyDisabledSceneIds: [],
        },
      ],
      threadBySceneId: { 'scene-a': 'thread:scene-a' },
      temporarilyDisabledSceneIds: [],
      issues: [],
    },
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function runningStreamPublic(): StreamEnginePublicState {
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
      sceneStates: {
        'scene-a': {
          sceneId: 'scene-a',
          status: 'running',
          scheduledStartMs: 0,
          progress: 0.5,
        },
      },
      currentStreamMs: 500,
      expectedDurationMs: 1000,
      mainTimelineId: 'timeline:main',
      timelineOrder: ['timeline:main'],
      timelineInstances: {
        'timeline:main': {
          id: 'timeline:main',
          kind: 'main',
          status: 'running',
          orderedThreadInstanceIds: ['thread:scene-a:0'],
          cursorMs: 500,
          durationMs: 1000,
        },
      },
      threadInstances: {
        'thread:scene-a:0': {
          id: 'thread:scene-a:0',
          canonicalThreadId: 'thread:scene-a',
          timelineId: 'timeline:main',
          rootSceneId: 'scene-a',
          launchSceneId: 'scene-a',
          launchLocalMs: 0,
          state: 'running',
          timelineStartMs: 0,
          durationMs: 1000,
        },
      },
    },
  } as unknown as StreamEnginePublicState;
}

describe('createStreamFlowMode', () => {
  it('constructs Flow mode while Stream playback is running', async () => {
    const streamState = runningStreamPublic();
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(streamState)),
        transport: vi.fn(() => Promise.resolve(streamState)),
      },
    } as unknown as typeof window.xtream;

    const root = createStreamFlowMode(streamState.stream, {
      playbackFocusSceneId: 'scene-a',
      sceneEditSceneId: 'scene-a',
      currentState: director(),
      streamState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    expect(root.querySelector('.stream-flow-canvas')).not.toBeNull();
    expect(root.querySelectorAll('.stream-flow-card')).toHaveLength(1);
    expect(root.querySelector('.stream-flow-card.status-running')).not.toBeNull();
    expect(root.querySelector('.stream-flow-main-curve-glow.is-running')).not.toBeNull();
  });

  it('dispatches run-from-here from a running Flow card instead of pausing', async () => {
    const streamState = runningStreamPublic();
    const transport = vi.fn(() => Promise.resolve(streamState));
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(streamState)),
        transport,
      },
    } as unknown as typeof window.xtream;

    const root = createStreamFlowMode(streamState.stream, {
      playbackFocusSceneId: 'scene-a',
      sceneEditSceneId: 'scene-a',
      currentState: director(),
      streamState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    root.querySelector<HTMLButtonElement>('button[aria-label="Run from here"]')?.click();

    expect(transport).toHaveBeenCalledWith({ type: 'play', sceneId: 'scene-a', source: 'flow-card' });
    expect(transport).not.toHaveBeenCalledWith({ type: 'pause' });
  });
});
