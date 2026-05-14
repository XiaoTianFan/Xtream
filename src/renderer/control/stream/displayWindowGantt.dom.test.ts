/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../shared/types';
import { createDisplayWindowGantt, syncDisplayWindowGanttRuntimeChrome } from './displayWindowGantt';

function pxValue(value: string | undefined): number {
  return Number((value ?? '').replace('px', ''));
}

function setBodyViewport(root: HTMLElement, width: number): void {
  const body = root.querySelector<HTMLElement>('.stream-display-gantt-body')!;
  Object.defineProperty(body, 'clientWidth', { value: width, configurable: true });
  body.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 180,
      width,
      height: 180,
      toJSON: () => ({}),
    }) as DOMRect;
}

function wheel(options: { ctrlKey?: boolean; deltaY: number; clientX: number }): WheelEvent {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
  Object.defineProperties(event, {
    ctrlKey: { value: options.ctrlKey ?? false },
    deltaY: { value: options.deltaY },
    clientX: { value: options.clientX },
  });
  return event;
}

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

function director(): DirectorState {
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
    },
    audioSources: {},
    outputs: {},
    displays: {
      d1: { id: 'd1', label: 'Display', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
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
  } as DirectorState;
}

function stream(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['a'],
    scenes: {
      a: scene('a', 'Alpha', ['base', 'cover'], {
        base: { id: 'base', kind: 'visual', visualId: 'v1', targets: [{ displayId: 'd1' }], durationOverrideMs: 4000 },
        cover: { id: 'cover', kind: 'visual', visualId: 'v2', targets: [{ displayId: 'd1' }], startOffsetMs: 1000, durationOverrideMs: 2000 },
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
    },
    expectedDurationMs: 5000,
    mainSegments: [{ threadId: 'thread:a', rootSceneId: 'a', startMs: 0, durationMs: 5000, endMs: 5000, proportion: 1 }],
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
      ],
      threadBySceneId: { a: 'thread:a' },
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

function runningState(cursorMs: number): StreamEnginePublicState {
  return publicState({
    status: 'running',
    currentStreamMs: cursorMs,
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
        durationMs: 5000,
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
    },
    activeVisualSubCues: [
      {
        runtimeInstanceId: 'a-inst',
        sceneId: 'a',
        subCueId: 'base',
        visualId: 'v1',
        target: { displayId: 'd1' },
        streamStartMs: 0,
        localStartMs: 0,
        localEndMs: 4000,
        playbackRate: 1,
      },
    ],
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createDisplayWindowGantt', () => {
  it('renders visual rows with dim bars and bright render segments', () => {
    const root = createDisplayWindowGantt('d1', { streamState: publicState(), directorState: director() });

    expect(root.querySelector<HTMLButtonElement>('.stream-display-gantt-fit-button')?.title).toBe('Fit to content');
    expect(root.querySelectorAll('.stream-display-gantt-row')).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-row-header strong')?.textContent).toBe('Alpha');
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-row-visual')?.textContent).toBe('Backdrop');
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-bar')?.style.left).toBe('0.000%');
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-bar')?.style.width).toBe('100.000%');
    expect(root.querySelectorAll('.stream-display-gantt-render-segment')).toHaveLength(3);
    const baseSegments = root.querySelectorAll<HTMLElement>('.stream-display-gantt-bar[data-sub-cue-id="base"] .stream-display-gantt-render-segment');
    expect([...baseSegments].map((segment) => [segment.style.left, segment.style.width])).toEqual([
      ['0.000%', '25.000%'],
      ['75.000%', '25.000%'],
    ]);
  });

  it('renders an empty state for displays without visual sub-cues', () => {
    const root = createDisplayWindowGantt('missing-display', { streamState: publicState(), directorState: director() });

    expect(root.querySelector('.stream-display-gantt-row')).toBeNull();
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-empty')?.textContent).toContain('No visual cues');
  });

  it('zooms and fits the compact display track', () => {
    const root = createDisplayWindowGantt('d1', { streamState: publicState(), directorState: director() });
    setBodyViewport(root, 360);
    const body = root.querySelector<HTMLElement>('.stream-display-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-display-gantt-track')!;
    const before = pxValue(track.style.minWidth);

    body.dispatchEvent(wheel({ ctrlKey: true, deltaY: -100, clientX: 200 }));
    expect(pxValue(track.style.minWidth)).toBeGreaterThan(before);

    root.querySelector<HTMLButtonElement>('.stream-display-gantt-fit-button')?.click();
    expect(body.scrollLeft).toBe(0);
  });

  it('syncs live runtime state without replacing the root element', () => {
    const root = createDisplayWindowGantt('d1', { streamState: publicState(), directorState: director() });
    const originalRoot = root;

    syncDisplayWindowGanttRuntimeChrome(root, { streamState: runningState(1250), directorState: director() });

    expect(root).toBe(originalRoot);
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-row')?.classList.contains('is-live')).toBe(true);
    expect(root.querySelector<HTMLElement>('.stream-display-gantt-bar')?.style.getPropertyValue('--stream-display-gantt-bar-cursor')).toBe('31.250%');
  });
});
