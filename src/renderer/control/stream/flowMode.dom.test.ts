/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { buildStreamSchedule } from '../../../shared/streamSchedule';
import type { CalculatedStreamTimeline, DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { writeMediaPoolDragPayload } from '../patch/mediaPool/dragDrop';
import { createStreamFlowMode, syncStreamFlowModeRuntimeChrome } from './flowMode';

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(() => Promise.resolve(true)),
}));

function createDataTransferStub(options: { protectReads?: boolean } = {}): DataTransfer & { allowReads: () => void } {
  const store = new Map<string, string>();
  let protectedReads = options.protectReads === true;
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => (protectedReads ? '' : store.get(type) ?? ''),
    allowReads: () => {
      protectedReads = false;
    },
  } as unknown as DataTransfer & { allowReads: () => void };
}

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: null });
  return event;
}

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

function infiniteAuthoringTimeline(): CalculatedStreamTimeline {
  const base = timeline();
  return {
    ...base,
    entries: {
      'scene-a': { sceneId: 'scene-a', startMs: undefined, durationMs: undefined, endMs: undefined, triggerKnown: false },
    },
    expectedDurationMs: 0,
    mainSegments: [],
    threadPlan: {
      ...base.threadPlan!,
      threads: base.threadPlan!.threads.map((thread) => ({
        ...thread,
        detachedReason: 'infinite-loop' as const,
        durationMs: undefined,
        branches: thread.branches.map((branch) => ({ ...branch, durationMs: undefined })),
        sceneTimings: { 'scene-a': { sceneId: 'scene-a', threadLocalStartMs: 0, threadLocalEndMs: undefined } },
      })),
    },
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

function parallelOnlyStreamPublic(): StreamEnginePublicState {
  const base = runningStreamPublic();
  return {
    ...base,
    runtime: {
      ...base.runtime!,
      mainTimelineId: undefined,
      offsetStreamMs: 0,
      currentStreamMs: 500,
      timelineOrder: ['timeline:parallel'],
      timelineInstances: {
        'timeline:parallel': {
          id: 'timeline:parallel',
          kind: 'parallel',
          status: 'running',
          orderedThreadInstanceIds: ['thread:scene-a:parallel'],
          cursorMs: 500,
          spawnedAtStreamMs: 0,
          offsetMs: 0,
          originWallTimeMs: 0,
        },
      },
      threadInstances: {
        'thread:scene-a:parallel': {
          id: 'thread:scene-a:parallel',
          canonicalThreadId: 'thread:scene-a',
          timelineId: 'timeline:parallel',
          rootSceneId: 'scene-a',
          launchSceneId: 'scene-a',
          launchLocalMs: 0,
          state: 'running',
          timelineStartMs: 0,
        },
      },
    },
  };
}

function streamPublicWithFlow(flow: { x: number; y: number; width: number; height: number }): StreamEnginePublicState {
  const base = runningStreamPublic();
  return {
    ...base,
    stream: {
      ...base.stream,
      scenes: {
        ...base.stream.scenes,
        'scene-a': {
          ...base.stream.scenes['scene-a']!,
          flow,
        },
      },
    },
  };
}

function threadedStream(flow?: {
  root?: { x: number; y: number; width: number; height: number };
  child?: { x: number; y: number; width: number; height: number };
}): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Threaded stream',
    sceneOrder: ['root', 'child'],
    scenes: {
      root: {
        id: 'root',
        title: 'Root',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: [],
        subCues: {},
        flow: flow?.root,
      },
      child: {
        id: 'child',
        title: 'Child',
        trigger: { type: 'follow-end', followsSceneId: 'root' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: [],
        subCues: {},
        flow: flow?.child,
      },
    },
  };
}

function publicForStream(s: PersistedStreamConfig): StreamEnginePublicState {
  const schedule = buildStreamSchedule(s, { visualDurations: {}, audioDurations: {} });
  const t: CalculatedStreamTimeline = {
    ...schedule,
    revision: 1,
    calculatedAtWallTimeMs: 0,
  };
  return {
    stream: s,
    playbackStream: s,
    editTimeline: t,
    playbackTimeline: t,
    validationMessages: [],
    runtime: null,
  };
}

function wrapperRect(root: HTMLElement, sceneId: string): { x: number; y: number; width: number; height: number } {
  const wrapper = root.querySelector<HTMLElement>(`.stream-flow-card-node[data-scene-id="${sceneId}"]`)!;
  return {
    x: Number.parseInt(wrapper.style.left, 10),
    y: Number.parseInt(wrapper.style.top, 10),
    width: Number.parseInt(wrapper.style.width, 10),
    height: Number.parseInt(wrapper.style.height, 10),
  };
}

function installPointerCapturePolyfill(): void {
  HTMLElement.prototype.setPointerCapture ??= vi.fn();
  HTMLElement.prototype.releasePointerCapture ??= vi.fn();
  HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => true);
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
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    expect(root.querySelector('.stream-flow-canvas')).not.toBeNull();
    expect(root.querySelectorAll('.stream-flow-card')).toHaveLength(1);
    expect(root.querySelector('.stream-flow-card.status-running')).not.toBeNull();
    expect(root.querySelector('.stream-flow-main-curve-glow.is-running')).not.toBeNull();
  });

  it('renders authoring edit-timeline duration labels while playback timeline still has the previous finite duration', async () => {
    const base = runningStreamPublic();
    const s: PersistedStreamConfig = {
      ...base.stream,
      scenes: {
        ...base.stream.scenes,
        'scene-a': {
          ...base.stream.scenes['scene-a']!,
          subCueOrder: ['vis'],
          subCues: {
            vis: { id: 'vis', kind: 'visual', visualId: 'vid', targets: [{ displayId: 'd1' }] },
          },
        },
      },
    };
    const streamState = {
      ...base,
      stream: s,
      editTimeline: infiniteAuthoringTimeline(),
      playbackTimeline: timeline(),
    };

    const root = createStreamFlowMode(streamState.stream, {
      playbackFocusSceneId: 'scene-a',
      sceneEditSceneId: 'scene-a',
      currentState: {
        ...director(),
        visuals: { vid: { id: 'vid', kind: 'file', type: 'video', durationSeconds: 1, ready: true } },
      } as never,
      streamState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    expect(root.textContent).toContain('-- / live');
    expect(root.textContent).not.toContain('00:01.000');
  });

  it('routes media-pool drops from Flow cards to the Stream context callback', async () => {
    const streamState = runningStreamPublic();
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(streamState)),
        transport: vi.fn(() => Promise.resolve(streamState)),
      },
    } as unknown as typeof window.xtream;
    const addMediaPoolItemToScene = vi.fn();
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
      addMediaPoolItemToScene,
    });
    document.body.append(root);
    await Promise.resolve();
    const card = root.querySelector<HTMLElement>('.stream-flow-card')!;
    const dataTransfer = createDataTransferStub();
    writeMediaPoolDragPayload(dataTransfer, { type: 'visual', id: 'visual-a' });

    card.dispatchEvent(createDragEvent('dragover', dataTransfer));
    card.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(addMediaPoolItemToScene).toHaveBeenCalledWith('scene-a', { type: 'visual', id: 'visual-a' });
  });

  it('accepts Flow card media dragover from custom MIME markers before payload reads are available', async () => {
    const streamState = runningStreamPublic();
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(streamState)),
        transport: vi.fn(() => Promise.resolve(streamState)),
      },
    } as unknown as typeof window.xtream;
    const addMediaPoolItemToScene = vi.fn();
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
      addMediaPoolItemToScene,
    });
    document.body.append(root);
    await Promise.resolve();
    const card = root.querySelector<HTMLElement>('.stream-flow-card')!;
    const dataTransfer = createDataTransferStub({ protectReads: true });
    writeMediaPoolDragPayload(dataTransfer, { type: 'audio-source', id: 'audio-a' });

    card.dispatchEvent(createDragEvent('dragover', dataTransfer));

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(card.classList.contains('media-drop-over')).toBe(true);
    expect(addMediaPoolItemToScene).not.toHaveBeenCalled();

    dataTransfer.allowReads();
    card.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(addMediaPoolItemToScene).toHaveBeenCalledWith('scene-a', { type: 'audio-source', id: 'audio-a' });
  });

  it('does not accept text/plain fallback payloads as Flow card media drops', async () => {
    const streamState = runningStreamPublic();
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(streamState)),
        transport: vi.fn(() => Promise.resolve(streamState)),
      },
    } as unknown as typeof window.xtream;
    const addMediaPoolItemToScene = vi.fn();
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
      addMediaPoolItemToScene,
    });
    document.body.append(root);
    await Promise.resolve();
    const card = root.querySelector<HTMLElement>('.stream-flow-card')!;
    const dataTransfer = createDataTransferStub();
    dataTransfer.setData('text/plain', 'audio-source:audio-a');

    card.dispatchEvent(createDragEvent('dragover', dataTransfer));
    card.dispatchEvent(createDragEvent('drop', dataTransfer));

    expect(dataTransfer.dropEffect).toBe('none');
    expect(card.classList.contains('media-drop-over')).toBe(false);
    expect(addMediaPoolItemToScene).not.toHaveBeenCalled();
  });

  it('keeps the main curve cursor fixed when runtime only has a parallel timeline', async () => {
    const streamState = parallelOnlyStreamPublic();
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
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    const glow = root.querySelector<SVGPathElement>('.stream-flow-main-curve-glow')!;
    expect(glow.classList.contains('is-running')).toBe(false);
    expect(glow.style.getPropertyValue('--stream-flow-main-progress')).toBe('0');

    syncStreamFlowModeRuntimeChrome(
      root,
      {
        ...streamState,
        runtime: {
          ...streamState.runtime!,
          status: 'paused',
          pausedAtStreamMs: 900,
          pausedCursorMs: 900,
          offsetStreamMs: 900,
          currentStreamMs: 900,
          timelineInstances: {
            'timeline:parallel': {
              ...streamState.runtime!.timelineInstances!['timeline:parallel']!,
              status: 'paused',
              cursorMs: 900,
              offsetMs: 900,
              pausedAtMs: 900,
              originWallTimeMs: undefined,
            },
          },
        },
      },
      director(),
      'scene-a',
      'scene-a',
    );

    const syncedGlow = root.querySelector<SVGPathElement>('.stream-flow-main-curve-glow')!;
    expect(syncedGlow.classList.contains('is-running')).toBe(false);
    expect(syncedGlow.style.getPropertyValue('--stream-flow-main-progress')).toBe('0');
  });

  it('renders fit and reset toolbar actions without zoom in/out buttons', async () => {
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
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Fit to content"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')).not.toBeNull();
  });

  it('updates the dotted main timeline while a scene card is dragged', async () => {
    installPointerCapturePolyfill();
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
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();
    const card = root.querySelector<HTMLElement>('.stream-flow-card')!;
    const before = root.querySelector<SVGPathElement>('.stream-flow-main-curve')?.getAttribute('d');

    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 90, clientY: 35 }));

    expect(root.querySelector<SVGPathElement>('.stream-flow-main-curve')?.getAttribute('d')).not.toBe(before);
  });

  it('keeps dropped card geometry through stale runtime sync until persisted flow catches up', async () => {
    installPointerCapturePolyfill();
    const staleState = runningStreamPublic();
    const edit = vi.fn(() => Promise.resolve(staleState));
    window.xtream = {
      stream: {
        edit,
        transport: vi.fn(() => Promise.resolve(staleState)),
      },
    } as unknown as typeof window.xtream;
    const root = createStreamFlowMode(staleState.stream, {
      playbackFocusSceneId: 'scene-a',
      sceneEditSceneId: 'scene-a',
      currentState: director(),
      streamState: staleState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();
    const card = root.querySelector<HTMLElement>('.stream-flow-card')!;
    const wrapper = root.querySelector<HTMLElement>('.stream-flow-card-node')!;

    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 90, clientY: 35 }));
    card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 90, clientY: 35 }));
    const droppedLeft = wrapper.style.left;
    const droppedTop = wrapper.style.top;

    syncStreamFlowModeRuntimeChrome(root, staleState, director(), 'scene-a', 'scene-a');

    expect(wrapper.style.left).toBe(droppedLeft);
    expect(wrapper.style.top).toBe(droppedTop);

    syncStreamFlowModeRuntimeChrome(
      root,
      streamPublicWithFlow({ x: Number.parseInt(droppedLeft, 10), y: Number.parseInt(droppedTop, 10), width: 214, height: 136 }),
      director(),
      'scene-a',
      'scene-a',
    );

    expect(wrapper.style.left).toBe(droppedLeft);
    expect(wrapper.style.top).toBe(droppedTop);
  });

  it('keeps branch curves aligned to a dragged root after syncing persisted layout and then dragging a child', async () => {
    installPointerCapturePolyfill();
    const initialState = publicForStream(threadedStream());
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(initialState)),
        transport: vi.fn(() => Promise.resolve(initialState)),
      },
    } as unknown as typeof window.xtream;
    const root = createStreamFlowMode(initialState.stream, {
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      currentState: director(),
      streamState: initialState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    const rootCard = root.querySelector<HTMLElement>('.stream-flow-card-node[data-scene-id="root"] .stream-flow-card')!;
    rootCard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    rootCard.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 90, clientY: 10 }));
    rootCard.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 90, clientY: 10 }));

    const persistedState = publicForStream(threadedStream({ root: wrapperRect(root, 'root'), child: wrapperRect(root, 'child') }));
    syncStreamFlowModeRuntimeChrome(root, persistedState, director(), undefined, undefined);

    const rootAfterSync = wrapperRect(root, 'root');
    const expectedLinkStart = `M ${rootAfterSync.x + rootAfterSync.width} ${rootAfterSync.y + rootAfterSync.height / 2}`;
    const childCard = root.querySelector<HTMLElement>('.stream-flow-card-node[data-scene-id="child"] .stream-flow-card')!;
    childCard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: 20, clientY: 10 }));
    childCard.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 60, clientY: 10 }));

    expect(root.querySelector<SVGPathElement>('.stream-flow-trigger-link')?.getAttribute('d')).toContain(expectedLinkStart);
  });

  it('starts card drag from the synced wrapper position instead of snapping back to the original projection', async () => {
    installPointerCapturePolyfill();
    const initialState = publicForStream(threadedStream());
    window.xtream = {
      stream: {
        edit: vi.fn(() => Promise.resolve(initialState)),
        transport: vi.fn(() => Promise.resolve(initialState)),
      },
    } as unknown as typeof window.xtream;
    const root = createStreamFlowMode(initialState.stream, {
      playbackFocusSceneId: undefined,
      sceneEditSceneId: undefined,
      currentState: director(),
      streamState: initialState,
      setSceneEditFocus: vi.fn(),
      setPlaybackAndEditFocus: vi.fn(),
      setBottomTab: vi.fn(),
      clearDetailPane: vi.fn(),
      requestRender: vi.fn(),
      refreshSceneSelectionUi: vi.fn(),
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    const syncedState = publicForStream(threadedStream({ child: { x: 800, y: 300, width: 214, height: 136 } }));
    syncStreamFlowModeRuntimeChrome(root, syncedState, director(), undefined, undefined);
    const childWrapper = root.querySelector<HTMLElement>('.stream-flow-card-node[data-scene-id="child"]')!;
    const childCard = childWrapper.querySelector<HTMLElement>('.stream-flow-card')!;

    childCard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 805, clientY: 305 }));
    childCard.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 806, clientY: 305 }));

    expect(childWrapper.style.left).toBe('801px');
    expect(childWrapper.style.top).toBe('300px');
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
      addMediaPoolItemToScene: vi.fn(),
    });
    document.body.append(root);
    await Promise.resolve();

    root.querySelector<HTMLButtonElement>('button[aria-label="Run from here"]')?.click();

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ type: 'play', sceneId: 'scene-a', source: 'flow-card' }));
    expect(transport).not.toHaveBeenCalledWith({ type: 'pause' });
  });
});
