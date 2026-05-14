/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalculatedStreamTimeline, DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../../shared/types';
import { createSceneEditPane } from './sceneEditPane';
import { createSceneMiniGantt } from './sceneMiniGantt';

function pxValue(value: string | undefined): number {
  return Number((value ?? '').replace('px', ''));
}

function setBodyViewport(root: HTMLElement, width: number): void {
  const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body')!;
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

function fieldControl(root: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const field = [...root.querySelectorAll<HTMLElement>('.detail-field, .mapping-field')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  const control = field?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  expect(control).not.toBeNull();
  return control!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.xtream = {
    stream: { edit: vi.fn(async () => streamPublic(stream(scene()))) },
    visualRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn(), onSubCuePreviewSnapshot: vi.fn() },
    audioRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn() },
  } as unknown as typeof window.xtream;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('createSceneMiniGantt', () => {
  it('renders scene-local sub-cue rows, blocks, and always-visible playback controls', () => {
    const root = createSceneMiniGantt({
      scene: scene(),
      currentState: director(),
      removeSubCue: vi.fn(),
      requestRender: vi.fn(),
    });

    expect(root.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-fit-button')?.title).toBe('Fit to content');
    expect(root.querySelectorAll('.stream-scene-mini-gantt-row')).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('.stream-scene-mini-gantt-row-header strong')?.textContent).toBe('Visual | Clip');
    expect(root.querySelector<HTMLElement>('.stream-scene-mini-gantt-bar')?.style.left).toBe('0.000%');
    expect(root.querySelector<HTMLElement>('.stream-scene-mini-gantt-bar')?.style.width).toBe('50.000%');

    expect(root.textContent).not.toContain('Scene Timeline');
    expect(root.querySelector<HTMLButtonElement>('.stream-subcue-toggle')?.textContent).toBe('Preload');
    expect(fieldControl(root, 'Loop iterations').disabled).toBe(false);
    expect((fieldControl(root, 'Loop iterations') as HTMLInputElement).value).toBe('1');
    expect((fieldControl(root, 'Loop iterations') as HTMLInputElement).min).toBe('1');
    expect(root.querySelector<HTMLInputElement>('.stream-scene-loop-range-input[placeholder="start"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('.stream-scene-loop-range-input[placeholder="end"]')?.disabled).toBe(true);
    expect(fieldControl(root, 'Lead time').disabled).toBe(true);
  });

  it('uses the compact infinity-number control for scene loop iterations', () => {
    const requestRender = vi.fn();
    const root = createSceneMiniGantt({
      scene: scene(),
      currentState: director(),
      removeSubCue: vi.fn(),
      requestRender,
    });

    const loopInput = fieldControl(root, 'Loop iterations') as HTMLInputElement;
    loopInput.value = '0';
    loopInput.dispatchEvent(new Event('change'));

    expect(loopInput.value).toBe('1');
    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { loop: { enabled: false } },
    });

    vi.mocked(window.xtream.stream.edit).mockClear();
    loopInput.value = '3';
    loopInput.dispatchEvent(new Event('change'));

    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { loop: { enabled: true, iterations: { type: 'count', count: 3 } } },
    });

    vi.mocked(window.xtream.stream.edit).mockClear();
    root.querySelector<HTMLButtonElement>('[aria-label="Loop iterations infinity"]')?.click();

    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { loop: { enabled: true, iterations: { type: 'infinite' } } },
    });
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Loop iterations infinity"]')?.classList.contains('active')).toBe(true);
    expect(loopInput.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('.stream-scene-loop-range-input[placeholder="start"]')?.disabled).toBe(false);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('toggles preload locally without requesting a scene edit redraw', () => {
    const requestRender = vi.fn();
    const root = createSceneMiniGantt({
      scene: scene(),
      currentState: director(),
      removeSubCue: vi.fn(),
      requestRender,
    });

    const preload = root.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-preload-field .stream-subcue-toggle')!;
    const lead = fieldControl(root, 'Lead time') as HTMLInputElement;
    expect(preload.classList.contains('active')).toBe(false);
    expect(lead.disabled).toBe(true);

    preload.click();

    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { preload: { enabled: true, leadTimeMs: undefined } },
    });
    expect(preload.classList.contains('active')).toBe(true);
    expect(preload.getAttribute('aria-pressed')).toBe('true');
    expect(lead.disabled).toBe(false);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('renders compact loop range and preload lead controls', () => {
    const root = createSceneMiniGantt({
      scene: scene({
        loop: { enabled: true, iterations: { type: 'count', count: 2 }, range: { startMs: 250, endMs: 1250 } },
        preload: { enabled: true, leadTimeMs: 300 },
      }),
      currentState: director(),
      removeSubCue: vi.fn(),
      requestRender: vi.fn(),
    });

    const range = root.querySelector<HTMLElement>('.stream-scene-loop-range');
    const start = root.querySelector<HTMLInputElement>('.stream-scene-loop-range-input[placeholder="start"]')!;
    const end = root.querySelector<HTMLInputElement>('.stream-scene-loop-range-input[placeholder="end"]')!;
    expect(range?.querySelector<HTMLElement>('.stream-scene-loop-range-label')?.textContent).toBe('Loop range');
    expect(start.value).toBe('250');
    expect(end.value).toBe('1250');
    expect(start.disabled).toBe(false);
    expect(end.disabled).toBe(false);

    start.value = '500';
    start.dispatchEvent(new Event('change'));
    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { loop: { enabled: true, iterations: { type: 'count', count: 2 }, range: { startMs: 500, endMs: 1250 } } },
    });

    vi.mocked(window.xtream.stream.edit).mockClear();
    end.value = '';
    end.dispatchEvent(new Event('change'));
    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { loop: { enabled: true, iterations: { type: 'count', count: 2 }, range: { startMs: 500 } } },
    });

    vi.mocked(window.xtream.stream.edit).mockClear();
    const lead = fieldControl(root, 'Lead time') as HTMLInputElement;
    expect(root.querySelector<HTMLElement>('.stream-draggable-number-grip')?.textContent).toBe('Lead time');
    expect(lead.value).toBe('300');
    lead.value = '450';
    lead.dispatchEvent(new Event('change'));
    expect(window.xtream.stream.edit).toHaveBeenCalledWith({
      type: 'update-scene',
      sceneId: 'scene-a',
      update: { preload: { enabled: true, leadTimeMs: 450 } },
    });
  });

  it('zooms and fits the scene mini-Gantt track', () => {
    const root = createSceneMiniGantt({
      scene: scene(),
      currentState: director(),
      removeSubCue: vi.fn(),
      requestRender: vi.fn(),
    });
    setBodyViewport(root, 360);
    const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body')!;
    const track = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-track')!;
    const before = pxValue(track.style.minWidth);

    body.dispatchEvent(wheel({ ctrlKey: true, deltaY: -100, clientX: 200 }));
    expect(pxValue(track.style.minWidth)).toBeGreaterThan(before);

    root.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-fit-button')?.click();
    expect(body.scrollLeft).toBe(0);
  });

  it('removes a right-clicked mini-Gantt block through the scene edit patch path', async () => {
    const sc = scene({ linked: true });
    const st = stream(sc);
    const requestRender = vi.fn();
    const pane = createSceneEditPane({
      stream: st,
      scene: sc,
      currentState: director(),
      streamPublic: streamPublic(st),
      isSceneRunning: false,
      sceneEditSelection: { kind: 'scene' },
      setSceneEditSelection: vi.fn(),
      duplicateScene: vi.fn(),
      removeScene: vi.fn(),
      getDirectorState: () => director(),
      renderDirectorState: vi.fn(),
      requestRender,
    });
    document.body.append(pane);

    const audioBar = pane.querySelector<HTMLElement>('.stream-scene-mini-gantt-bar[data-sub-cue-id="sub-a"]')!;
    audioBar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 32, clientY: 44 }));
    document.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-menu .context-menu-item')?.click();
    await Promise.resolve();

    const edit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    expect(edit).toMatchObject({ type: 'update-scene', sceneId: 'scene-a' });
    const update = edit?.type === 'update-scene' ? edit.update : undefined;
    expect(update?.subCueOrder).toEqual(['sub-v']);
    expect(update?.subCues?.['sub-v']).toMatchObject({ linkedTimingSubCueId: undefined });
    expect(requestRender).toHaveBeenCalled();
  });

  it('keeps read-only mini-Gantt zoom controls available but disables remove while locked', () => {
    const sc = scene();
    const st = stream(sc);
    const pane = createSceneEditPane({
      stream: st,
      scene: sc,
      currentState: director(),
      streamPublic: streamPublic(st),
      isSceneRunning: true,
      sceneEditSelection: { kind: 'scene' },
      setSceneEditSelection: vi.fn(),
      duplicateScene: vi.fn(),
      removeScene: vi.fn(),
      getDirectorState: () => director(),
      renderDirectorState: vi.fn(),
      requestRender: vi.fn(),
    });
    document.body.append(pane);

    expect(pane.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-fit-button')?.disabled).toBe(false);
    const audioBar = pane.querySelector<HTMLElement>('.stream-scene-mini-gantt-bar[data-sub-cue-id="sub-a"]')!;
    audioBar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 32, clientY: 44 }));
    const remove = document.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-menu .context-menu-item');

    expect(remove?.disabled).toBe(true);
    remove?.click();
    expect(window.xtream.stream.edit).not.toHaveBeenCalled();
  });
});

function scene(options: { linked?: boolean; loop?: PersistedSceneConfig['loop']; preload?: PersistedSceneConfig['preload'] } = {}): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Scene',
    trigger: { type: 'manual' },
    loop: options.loop ?? { enabled: false },
    preload: options.preload ?? { enabled: false },
    subCueOrder: ['sub-v', 'sub-a'],
    subCues: {
      'sub-v': {
        id: 'sub-v',
        kind: 'visual',
        visualId: 'vid',
        targets: [{ displayId: 'display-a' }],
        durationOverrideMs: 5000,
        linkedTimingSubCueId: options.linked ? 'sub-a' : undefined,
      },
      'sub-a': {
        id: 'sub-a',
        kind: 'audio',
        audioSourceId: 'aud',
        outputIds: ['output-a'],
        startOffsetMs: 1000,
        linkedTimingSubCueId: options.linked ? 'sub-v' : undefined,
      },
    },
  };
}

function stream(sceneConfig: PersistedSceneConfig): PersistedStreamConfig {
  return {
    id: 'stream-main',
    label: 'Main',
    sceneOrder: [sceneConfig.id],
    scenes: { [sceneConfig.id]: sceneConfig },
  };
}

function streamPublic(st: PersistedStreamConfig): StreamEnginePublicState {
  return {
    stream: st,
    playbackStream: st,
    editTimeline: timeline(),
    playbackTimeline: timeline(),
    validationMessages: [],
    runtime: null,
  };
}

function timeline(): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      'scene-a': { sceneId: 'scene-a' as SceneId, startMs: 0, durationMs: 6000, endMs: 6000, triggerKnown: true },
    },
    expectedDurationMs: 6000,
    calculatedAtWallTimeMs: 0,
    issues: [],
    mainSegments: [],
    threadPlan: { threads: [], threadBySceneId: {}, temporarilyDisabledSceneIds: [], issues: [] },
  };
}

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {
      vid: { id: 'vid', kind: 'file', type: 'video', label: 'Clip', url: 'file://clip.mp4', durationSeconds: 10, ready: true },
    },
    displays: {
      'display-a': { id: 'display-a', fullscreen: false, layout: { type: 'single' }, health: 'ready' },
    },
    outputs: {
      'output-a': { id: 'output-a', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
    },
    audioSources: {
      aud: { id: 'aud', label: 'Kick', type: 'audio', ready: true, durationSeconds: 4 },
    },
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}
