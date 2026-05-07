/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { createStreamGanttMode, syncStreamGanttRuntimeChrome } from './ganttMode';

function pxValue(value: string | undefined): number {
  return Number((value ?? '').replace('px', ''));
}

function setBodyViewport(root: HTMLElement, width: number): void {
  const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;
  Object.defineProperty(body, 'clientWidth', { value: width, configurable: true });
  body.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 240,
      width,
      height: 240,
      toJSON: () => ({}),
    }) as DOMRect;
}

function createWheelEvent(options: { ctrlKey?: boolean; deltaY: number; clientX: number }): WheelEvent {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
  Object.defineProperties(event, {
    ctrlKey: { value: options.ctrlKey ?? false },
    deltaY: { value: options.deltaY },
    clientX: { value: options.clientX },
  });
  return event;
}

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
    expect(root.querySelector<HTMLElement>('.stream-gantt-lane')?.style.minWidth).toMatch(/\d+px/);
    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.minWidth).toMatch(/\d+px/);
  });

  it('renders a fit to content button', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });

    expect(root.querySelector<HTMLButtonElement>('.stream-gantt-fit-button')?.title).toBe('Fit to content');
  });

  it('renders an empty state when playback has not created runtime timelines', () => {
    const s = stream();
    const t = timeline();
    const root = createStreamGanttMode(s, {
      streamState: { stream: s, playbackStream: s, editTimeline: t, playbackTimeline: t, validationMessages: [], runtime: null },
    });

    expect(root.querySelector<HTMLElement>('.stream-gantt-empty')?.textContent).toContain('No active Stream timelines');
  });

  it('zooms the Gantt track with ctrl wheel', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });
    setBodyViewport(root, 800);
    const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-gantt-track')!;
    const before = pxValue(track.style.minWidth);

    body.dispatchEvent(createWheelEvent({ ctrlKey: true, deltaY: -100, clientX: 200 }));

    expect(pxValue(track.style.minWidth)).toBeGreaterThan(before);
  });

  it('does not zoom the Gantt track for plain wheel scrolling', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });
    setBodyViewport(root, 800);
    const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-gantt-track')!;
    const before = track.style.minWidth;

    body.dispatchEvent(createWheelEvent({ deltaY: -100, clientX: 200 }));

    expect(track.style.minWidth).toBe(before);
  });

  it('fits the longest Gantt track to the visible body width', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });
    setBodyViewport(root, 470);
    const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;
    body.scrollLeft = 120;

    root.querySelector<HTMLButtonElement>('.stream-gantt-fit-button')?.click();

    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.minWidth).toBe('280px');
    expect(body.scrollLeft).toBe(0);
  });

  it('limits ctrl wheel zoom-out at the fit-to-content width', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState() });
    setBodyViewport(root, 470);
    const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;

    for (let i = 0; i < 12; i += 1) {
      body.dispatchEvent(createWheelEvent({ ctrlKey: true, deltaY: 100, clientX: 200 }));
    }

    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.minWidth).toBe('280px');
  });

  it('syncs cursor changes in place', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState(250) });
    syncStreamGanttRuntimeChrome(root, publicState(750));

    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.getPropertyValue('--stream-gantt-cursor')).toBe('75.000%');
  });

  it('preserves zoom when runtime chrome sync rerenders the Gantt lanes', () => {
    const root = createStreamGanttMode(stream(), { streamState: publicState(250) });
    setBodyViewport(root, 800);
    const body = root.querySelector<HTMLElement>('.stream-gantt-body')!;
    body.dispatchEvent(createWheelEvent({ ctrlKey: true, deltaY: -100, clientX: 200 }));
    const zoomedWidth = root.querySelector<HTMLElement>('.stream-gantt-track')?.style.minWidth;

    syncStreamGanttRuntimeChrome(root, publicState(750));

    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.minWidth).toBe(zoomedWidth);
    expect(root.querySelector<HTMLElement>('.stream-gantt-track')?.style.getPropertyValue('--stream-gantt-cursor')).toBe('75.000%');
  });
});
