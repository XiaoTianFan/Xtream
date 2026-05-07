/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../shared/types';
import { createOutputBusGantt, syncOutputBusGanttRuntimeChrome } from './outputBusGantt';

function pxValue(value: string | undefined): number {
  return Number((value ?? '').replace('px', ''));
}

function setBodyViewport(root: HTMLElement, width: number): void {
  const body = root.querySelector<HTMLElement>('.stream-output-gantt-body')!;
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
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {},
    audioSources: {
      a1: { id: 'a1', label: 'Kick', type: 'audio', ready: true, durationSeconds: 4 },
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
    sceneOrder: ['a'],
    scenes: {
      a: scene('a', 'Alpha', ['aud'], {
        aud: { id: 'aud', kind: 'audio', audioSourceId: 'a1', outputIds: ['out-main'], startOffsetMs: 250, levelDb: -6 },
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
    activeAudioSubCues: [
      {
        runtimeInstanceId: 'a-inst',
        sceneId: 'a',
        subCueId: 'aud',
        audioSourceId: 'a1',
        outputId: 'out-main',
        streamStartMs: 0,
        localStartMs: 250,
        localEndMs: 4000,
        levelDb: -6,
        playbackRate: 1,
      },
    ],
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createOutputBusGantt', () => {
  it('renders compact bus rows and positioned bars', () => {
    const root = createOutputBusGantt('out-main', { streamState: publicState(), directorState: director() });

    expect(root.querySelector<HTMLButtonElement>('.stream-output-gantt-fit-button')?.title).toBe('Fit to content');
    expect(root.querySelectorAll('.stream-output-gantt-row')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-row-header strong')?.textContent).toBe('Alpha');
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-row-audio')?.textContent).toBe('Kick');
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-bar')?.style.left).toBe('5.882%');
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-bar')?.style.width).toBe('94.118%');
  });

  it('renders an empty state for buses without routed audio sub-cues', () => {
    const root = createOutputBusGantt('out-missing', { streamState: publicState(), directorState: director() });

    expect(root.querySelector('.stream-output-gantt-row')).toBeNull();
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-empty')?.textContent).toContain('No routed audio');
  });

  it('zooms and fits the compact track', () => {
    const root = createOutputBusGantt('out-main', { streamState: publicState(), directorState: director() });
    setBodyViewport(root, 360);
    const body = root.querySelector<HTMLElement>('.stream-output-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-output-gantt-track')!;
    const before = pxValue(track.style.minWidth);

    body.dispatchEvent(wheel({ ctrlKey: true, deltaY: -100, clientX: 200 }));
    expect(pxValue(track.style.minWidth)).toBeGreaterThan(before);

    root.querySelector<HTMLButtonElement>('.stream-output-gantt-fit-button')?.click();
    expect(body.scrollLeft).toBe(0);
  });

  it('defaults to fitting the full bus clip range and caps zoom-out there', () => {
    const root = createOutputBusGantt('out-main', { streamState: publicState(), directorState: director() });
    setBodyViewport(root, 360);
    syncOutputBusGanttRuntimeChrome(root, { streamState: publicState(), directorState: director() });
    const body = root.querySelector<HTMLElement>('.stream-output-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-output-gantt-track')!;

    expect(track.style.minWidth).toBe('232px');

    body.dispatchEvent(wheel({ ctrlKey: true, deltaY: 100, clientX: 200 }));

    expect(track.style.minWidth).toBe('232px');
  });

  it('syncs live runtime state without replacing the root element', () => {
    const root = createOutputBusGantt('out-main', { streamState: publicState(), directorState: director() });
    const originalRoot = root;

    syncOutputBusGanttRuntimeChrome(root, { streamState: runningState(1250), directorState: director() });

    expect(root).toBe(originalRoot);
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-row')?.classList.contains('is-live')).toBe(true);
    expect(root.querySelector<HTMLElement>('.stream-output-gantt-bar')?.style.getPropertyValue('--stream-output-gantt-bar-cursor')).toBe('25.000%');
  });
});
