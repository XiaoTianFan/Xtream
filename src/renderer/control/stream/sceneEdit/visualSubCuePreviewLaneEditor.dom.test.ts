/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedAudioSubCueConfig, PersistedVisualSubCueConfig, VisualState, VisualSubCuePreviewPosition } from '../../../../shared/types';
import { buildVisualSubCuePreviewPayload, createVisualSubCuePreviewLaneEditor } from './visualSubCuePreviewLaneEditor';
import { clearVisualPreviewSnapshotCache, loadVisualPreviewSnapshots } from './visualPreviewSnapshots';

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  document.body.innerHTML = '';
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  window.xtream = {
    visualRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn() },
  } as unknown as typeof window.xtream;
});

afterEach(() => {
  clearVisualPreviewSnapshotCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('visualSubCuePreviewLaneEditor', () => {
  it('builds display-window preview payloads for assigned targets', () => {
    const payload = buildVisualSubCuePreviewPayload(
      visualSubCue({ playbackRate: 2, targets: [{ displayId: 'display-a' }, { displayId: 'display-b', zoneId: 'R' }] }),
      directorState(),
      'preview-a',
      1250,
    );

    expect(payload).toMatchObject({
      previewId: 'preview-a',
      visualId: 'vid',
      targets: [{ displayId: 'display-a' }, { displayId: 'display-b', zoneId: 'R' }],
      playTimeMs: 5000,
      playbackRate: 2,
      startedAtLocalMs: 1250,
    });
  });

  it('shows video playback controls and maps Play times to loop policy', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });

    expect(editor.textContent).toContain('Play times');
    expect(editor.textContent).toContain('Infinite Loop');
    expect(editor.textContent).toContain('Playback Rate');
    expect(editor.textContent).not.toContain('Duration');

    const playTimes = editor.querySelector<HTMLInputElement>('.stream-draggable-number input');
    playTimes!.value = '4';
    playTimes!.dispatchEvent(new Event('change'));

    const loop = editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-loop');
    loop!.click();

    expect(patches).toEqual([
      { loop: { enabled: true, iterations: { type: 'count', count: 4 } } },
      { loop: { enabled: true, iterations: { type: 'infinite' } } },
    ]);
    expect(playTimes!.disabled).toBe(true);
  });

  it('switches image visuals to Duration and Infinite Render controls', () => {
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ visualId: 'img', durationOverrideMs: 3000 }),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });

    expect(editor.textContent).toContain('Duration');
    expect(editor.textContent).toContain('Infinite Render');
    expect(editor.textContent).not.toContain('Freeze Frame');
    expect(editor.textContent).not.toContain('Rate');
  });

  it('does not patch persisted state until a fade drag commits', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const stage = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 4, clientY: 12 }));
    stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 160, clientY: 12 }));

    expect(patches).toEqual([]);

    stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 160, clientY: 12 }));

    expect(patches).toHaveLength(1);
    expect(patches[0].fadeIn?.durationMs).toBe(2500);
  });

  it('drops a freeze marker from pin mode and commits one patch', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const pin = editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-freeze-pin')!;
    const stage = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    pin.click();
    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 320, clientY: 96 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 320, clientY: 96 }));

    expect(patches).toEqual([{ freezeFrameMs: 5000 }]);
  });

  it('shows the timing link button when an eligible embedded audio sub-cue is provided', () => {
    const toggle = vi.fn();
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ withEmbeddedAudio: true }),
      patchSubCue: vi.fn(),
      timingLink: {
        audioSubCue: audioSubCue(),
        linked: false,
        onToggle: toggle,
      },
    });

    const button = editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-timing-link');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    button?.click();

    expect(toggle).toHaveBeenCalledWith(true);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('removes a freeze marker from the marker context menu', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ freezeFrameMs: 5000 }),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const stage = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    stage.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 96 }));
    document.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-menu .context-menu-item')?.click();

    expect(patches).toEqual([{ freezeFrameMs: undefined }]);
  });

  it('contains lane interactions so they do not bubble to parent redraw handlers', () => {
    const parentPointerDown = vi.fn();
    const parentClick = vi.fn();
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);
    editor.parentElement?.addEventListener('pointerdown', parentPointerDown);
    editor.parentElement?.addEventListener('click', parentClick);

    editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-transport')?.click();

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('renders a visual fade curve and cycles its curve on double click', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ fadeIn: { durationMs: 2500, curve: 'linear' } }),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const stage = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    const path = editor.querySelector<SVGPathElement>('.stream-visual-preview-lane-fade-curve path');
    expect(path?.getAttribute('d')).toContain('L');

    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 40, clientY: 12 }));

    expect(patches).toEqual([{ fadeIn: { durationMs: 2500, curve: 'equal-power' } }]);
  });

  it('drags video lane edges to commit a selected source range', () => {
    const patches: Array<Partial<PersistedVisualSubCueConfig>> = [];
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const stage = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 96 }));
    stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 128, clientY: 96 }));
    expect(patches).toEqual([]);
    stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 128, clientY: 96 }));

    expect(patches).toEqual([{ sourceStartMs: 2000, sourceEndMs: undefined }]);
  });

  it('renders the full-range right edge inside the lane and fade handles above range edges', () => {
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ fadeIn: { durationMs: 0, curve: 'linear' }, fadeOut: { durationMs: 0, curve: 'linear' } }),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);
    const fadeIn = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-fade.in');
    const fadeOut = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-fade.out');
    const rightEdge = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-range-edge.end');
    expect(fadeIn?.style.left).toBe('0px');
    expect(fadeIn?.style.width).toBe('0px');
    expect(rightEdge?.style.left).toBe('638px');
    expect(fadeOut?.style.left).toBe('638px');
    expect(fadeOut?.style.width).toBe('0px');

    const overlayChildren = [...editor.querySelector<HTMLElement>('.stream-visual-preview-lane-overlay')!.children];
    const rightEdgeIndex = overlayChildren.findIndex((child) => child.classList.contains('stream-visual-preview-lane-range-edge') && child.classList.contains('end'));
    const fadeOutIndex = overlayChildren.findIndex((child) => child.classList.contains('stream-visual-preview-lane-fade') && child.classList.contains('out'));
    expect(fadeOutIndex).toBeGreaterThan(rightEdgeIndex);
  });

  it('keeps fade handles inside the rendered source range when the range reaches the far right', () => {
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({
        sourceStartMs: 9999,
        fadeIn: { durationMs: 5000, curve: 'linear' },
        fadeOut: { durationMs: 5000, curve: 'linear' },
      }),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    const range = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-range');
    const leftEdge = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-range-edge.start');
    const rightEdge = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-range-edge.end');
    const fadeIn = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-fade.in');
    const fadeOut = editor.querySelector<HTMLElement>('.stream-visual-preview-lane-fade.out');

    expect(range?.style.left).toBe('638px');
    expect(range?.style.width).toBe('0px');
    expect(leftEdge?.style.left).toBe('638px');
    expect(rightEdge?.style.left).toBe('638px');
    expect(fadeIn?.style.left).toBe('638px');
    expect(fadeIn?.style.width).toBe('0px');
    expect(fadeOut?.style.left).toBe('638px');
    expect(fadeOut?.style.width).toBe('0px');
  });

  it('sends transient preview commands and stops on cleanup', async () => {
    vi.useFakeTimers();
    const preview = vi.fn(async (command) => ({
      previewId: command.type === 'play-visual-subcue-preview' ? command.payload.previewId : command.previewId,
      targetDisplayIds: ['display-a'],
      deliveredDisplayIds: ['display-a'],
      missingDisplayIds: [],
    }));
    window.xtream = {
      visualRuntime: { preview, onSubCuePreviewPosition: vi.fn() },
    } as unknown as typeof window.xtream;
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-transport')!.click();
    editor.remove();
    vi.advanceTimersByTime(250);
    await Promise.resolve();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-visual-subcue-preview' }));
    expect(preview).toHaveBeenCalledWith({ type: 'stop-visual-subcue-preview', previewId: 'visual-subcue-preview:sub-v' });
  });

  it('starts and stops the linked embedded audio preview with visual preview playback', async () => {
    vi.useFakeTimers();
    const visualPreview = vi.fn(async (command) => ({
      previewId: command.type === 'play-visual-subcue-preview' ? command.payload.previewId : command.previewId,
      targetDisplayIds: ['display-a'],
      deliveredDisplayIds: ['display-a'],
      missingDisplayIds: [],
    }));
    const audioPreview = vi.fn();
    window.xtream = {
      visualRuntime: { preview: visualPreview, onSubCuePreviewPosition: vi.fn() },
      audioRuntime: { preview: audioPreview, onSubCuePreviewPosition: vi.fn() },
    } as unknown as typeof window.xtream;
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ withEmbeddedAudio: true }),
      patchSubCue: vi.fn(),
      timingLink: {
        audioSubCue: audioSubCue(),
        linked: true,
        onToggle: vi.fn(),
      },
    });
    document.body.append(editor);

    editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-transport')!.click();
    editor.remove();
    vi.advanceTimersByTime(250);
    await Promise.resolve();

    expect(visualPreview).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-visual-subcue-preview' }));
    expect(audioPreview).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-audio-subcue-preview' }));
    expect(audioPreview).toHaveBeenCalledWith({ type: 'stop-audio-subcue-preview', previewId: 'subcue-preview:sub-a' });
  });

  it('surfaces missing display dispatch failures in the lane status', async () => {
    const preview = vi.fn(async (command) => ({
      previewId: command.type === 'play-visual-subcue-preview' ? command.payload.previewId : command.previewId,
      targetDisplayIds: ['display-a'],
      deliveredDisplayIds: [],
      missingDisplayIds: ['display-a'],
    }));
    window.xtream = {
      visualRuntime: { preview, onSubCuePreviewPosition: vi.fn(), onSubCuePreviewSnapshot: vi.fn() },
    } as unknown as typeof window.xtream;
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    editor.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-transport')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(editor.querySelector<HTMLElement>('.stream-visual-preview-lane-status')?.textContent).toContain('Assigned display window is not open');
  });

  it('uses the first assigned display as the preview playhead authority', () => {
    let positionCallback: ((position: VisualSubCuePreviewPosition) => void) | undefined;
    window.xtream = {
      visualRuntime: {
        preview: vi.fn(),
        onSubCuePreviewPosition: vi.fn((callback) => {
          positionCallback = callback;
          return vi.fn();
        }),
        onSubCuePreviewSnapshot: vi.fn(),
      },
    } as unknown as typeof window.xtream;
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ targets: [{ displayId: 'display-a' }, { displayId: 'display-b' }] }),
      currentState: directorState({ noVideoUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    positionCallback?.({ previewId: 'visual-subcue-preview:sub-v', displayId: 'display-b', localTimeMs: 8000, playing: false, paused: true });
    positionCallback?.({ previewId: 'visual-subcue-preview:sub-v', displayId: 'display-a', localTimeMs: 2000, playing: false, paused: true });

    expect(editor.querySelector<HTMLElement>('.stream-visual-preview-lane-playhead')?.style.left).toBe('128px');
  });

  it('hydrates live lane snapshots from display preview reports', async () => {
    let snapshotCallback: ((report: { visualId: string; dataUrl: string; timeMs?: number }) => void) | undefined;
    window.xtream = {
      visualRuntime: {
        preview: vi.fn(),
        onSubCuePreviewPosition: vi.fn(),
        onSubCuePreviewSnapshot: vi.fn((callback) => {
          snapshotCallback = callback;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.xtream;
    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue({ visualId: 'live' }),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    snapshotCallback?.({ visualId: 'live', dataUrl: 'data:image/jpeg;base64,live', timeMs: 1200 });
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }

    expect(editor.querySelector<HTMLElement>('.stream-visual-preview-lane-tile')?.className).toContain('ready');
  });

  it('hydrates reopened preview lanes from cached snapshots without showing loading status', async () => {
    const state = directorState();
    const captureVideoSnapshots = vi.fn(async (_visual: VisualState, sampleTimes: readonly number[]) =>
      sampleTimes.map((timeMs) => ({ timeMs, dataUrl: `data:image/jpeg;base64,${timeMs}`, state: 'ready' as const })),
    );
    await loadVisualPreviewSnapshots(state.visuals.vid, { sampleCount: 12, captureVideoSnapshots });

    const editor = createVisualSubCuePreviewLaneEditor({
      sub: visualSubCue(),
      currentState: state,
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    expect(editor.querySelector<HTMLElement>('.stream-visual-preview-lane-tile')?.className).toContain('ready');
    expect(editor.querySelector<HTMLElement>('.stream-visual-preview-lane-status')?.hidden).toBe(true);
    expect(captureVideoSnapshots).toHaveBeenCalledTimes(1);
  });
});

function visualSubCue(overrides: Partial<PersistedVisualSubCueConfig> = {}): PersistedVisualSubCueConfig {
  return {
    id: 'sub-v',
    kind: 'visual',
    visualId: 'vid',
    targets: [{ displayId: 'display-a' }],
    playbackRate: 1,
    ...overrides,
  };
}

function audioSubCue(overrides: Partial<PersistedAudioSubCueConfig> = {}): PersistedAudioSubCueConfig {
  return {
    id: 'sub-a',
    kind: 'audio',
    audioSourceId: 'audio-source-embedded-vid',
    outputIds: ['output-a'],
    playbackRate: 1,
    ...overrides,
  };
}

function directorState(options: { noVideoUrl?: boolean; withEmbeddedAudio?: boolean } = {}): DirectorState {
  return {
    visuals: {
      vid: {
        id: 'vid',
        kind: 'file',
        type: 'video',
        label: 'Clip',
        url: options.noVideoUrl ? undefined : 'file://clip.mp4',
        durationSeconds: 10,
        ready: true,
      } as VisualState,
      img: {
        id: 'img',
        kind: 'file',
        type: 'image',
        label: 'Still',
        url: 'file://still.png',
        ready: true,
      } as VisualState,
      live: {
        id: 'live',
        kind: 'live',
        type: 'video',
        label: 'Live',
        capture: { source: 'webcam', deviceId: 'camera-a', revision: 1 },
        ready: true,
      } as VisualState,
    },
    displays: {
      'display-a': { id: 'display-a', fullscreen: false, layout: { type: 'single' }, health: 'ready' },
      'display-b': { id: 'display-b', fullscreen: false, layout: { type: 'split', visualIds: [undefined, undefined] }, health: 'ready' },
    },
    outputs: options.withEmbeddedAudio
      ? {
          'output-a': { id: 'output-a', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
        }
      : {},
    audioSources: options.withEmbeddedAudio
      ? {
          'audio-source-embedded-vid': {
            id: 'audio-source-embedded-vid',
            type: 'embedded-visual',
            visualId: 'vid',
            label: 'Clip audio',
            extractionMode: 'representation',
            ready: true,
            playbackRate: 1,
          },
        }
      : {},
  } as unknown as DirectorState;
}
