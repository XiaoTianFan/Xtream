/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(async () => true),
}));

import { getDefaultStreamPersistence } from '../../../shared/streamWorkspace';
import type { CalculatedStreamTimeline, StreamEnginePublicState } from '../../../shared/types';
import { createStreamListMode } from './listMode';
import { createSceneEditPane } from './sceneEdit/sceneEditPane';
import { createStreamSceneForm } from './sceneEdit/sceneForm';

function threadTimeline(): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      'scene-1': { sceneId: 'scene-1', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
    },
    expectedDurationMs: 1000,
    calculatedAtWallTimeMs: 0,
    issues: [],
    mainSegments: [{ threadId: 'thread:scene-1', rootSceneId: 'scene-1', startMs: 0, durationMs: 1000, endMs: 1000, proportion: 1 }],
    threadPlan: {
      threads: [
        {
          threadId: 'thread:scene-1',
          rootSceneId: 'scene-1',
          rootTriggerType: 'manual',
          sceneIds: ['scene-1'],
          edges: [],
          branches: [{ sceneIds: ['scene-1'], durationMs: 1000 }],
          longestBranchSceneIds: ['scene-1'],
          sceneTimings: { 'scene-1': { sceneId: 'scene-1', threadLocalStartMs: 0, threadLocalEndMs: 1000 } },
          durationMs: 1000,
          temporarilyDisabledSceneIds: [],
        },
      ],
      threadBySceneId: { 'scene-1': 'thread:scene-1' },
      temporarilyDisabledSceneIds: [],
      issues: [],
    },
  };
}

describe('Stream thread color UI', () => {
  it('applies thread variables to list rows and progress bars', () => {
    const { stream } = getDefaultStreamPersistence();
    const streamState: StreamEnginePublicState = {
      stream,
      playbackStream: stream,
      editTimeline: threadTimeline(),
      playbackTimeline: threadTimeline(),
      validationMessages: [],
      runtime: {
        status: 'running',
        sceneStates: {
          'scene-1': { sceneId: 'scene-1', status: 'running', scheduledStartMs: 0, progress: 0.5 },
        },
      },
    };

    const root = createStreamListMode(stream, {
      streamState,
      playbackFocusSceneId: 'scene-1',
      sceneEditSceneId: 'scene-1',
      getListDragSceneId: () => undefined,
      expandedListSceneIds: new Set(),
      currentState: undefined,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      setListDragSceneId: vi.fn(),
      toggleExpandedScene: vi.fn(),
      applySceneReorder: vi.fn(),
      addMediaPoolItemToScene: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
    });

    const wrap = root.querySelector<HTMLElement>('.stream-scene-row-wrap[data-scene-id="scene-1"]');
    const bar = root.querySelector<HTMLElement>('.stream-scene-row-progress');
    expect(wrap?.classList.contains('stream-scene-row-wrap--threaded')).toBe(true);
    expect(wrap?.dataset.threadColor).toBe('thread-sage');
    expect(wrap?.style.getPropertyValue('--stream-thread-dim')).toBe('rgb(127 146 125 / 0.20)');
    expect(bar?.style.getPropertyValue('--stream-row-progress-color')).toBe('#a6b8a2');
  });

  it('applies the selected thread shade to Scene Edit', () => {
    const { stream } = getDefaultStreamPersistence();
    const streamPublic: StreamEnginePublicState = {
      stream,
      playbackStream: stream,
      editTimeline: threadTimeline(),
      playbackTimeline: threadTimeline(),
      validationMessages: [],
      runtime: null,
    };

    const pane = createSceneEditPane({
      stream,
      scene: stream.scenes['scene-1'],
      currentState: undefined as unknown as Parameters<typeof createSceneEditPane>[0]['currentState'],
      streamPublic,
      isSceneRunning: false,
      sceneEditSelection: { kind: 'scene' },
      setSceneEditSelection: vi.fn(),
      duplicateScene: vi.fn(),
      removeScene: vi.fn(),
      getDirectorState: () => undefined,
      renderDirectorState: vi.fn(),
      requestRender: vi.fn(),
    });

    expect(pane.classList.contains('stream-scene-edit--threaded')).toBe(true);
    expect(pane.dataset.threadColor).toBe('thread-sage');
    expect(pane.style.getPropertyValue('--stream-thread-dim')).toBe('rgb(127 146 125 / 0.20)');
  });

  it('shows the main-timeline stability reminder for at-timecode scenes', () => {
    const { stream } = getDefaultStreamPersistence();
    stream.scenes['scene-1'].trigger = { type: 'at-timecode', timecodeMs: 5000 };

    const form = createStreamSceneForm({
      stream,
      scene: stream.scenes['scene-1'],
      duplicateScene: vi.fn(),
      removeScene: vi.fn(),
    });

    const reminder = form.querySelector<HTMLElement>('.stream-at-timecode-reminder');
    expect(reminder?.textContent).toContain('follows the Stream main timeline');
    expect(reminder?.textContent).toContain('external timecode source');
  });
});
