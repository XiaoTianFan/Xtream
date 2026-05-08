/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalculatedStreamTimeline,
  DirectorState,
  PersistedSceneConfig,
  PersistedStreamConfig,
  StreamEnginePublicState,
  SubCueInnerLoopPolicy,
} from '../../../../shared/types';
import { createSceneEditPane } from './sceneEditPane';

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  document.body.innerHTML = '';
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  window.xtream = {
    stream: { edit: vi.fn(async () => streamPublic(stream(scene()))) },
    visualRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn(), onSubCuePreviewSnapshot: vi.fn() },
    audioRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn() },
  } as unknown as typeof window.xtream;
});

describe('scene edit timing links', () => {
  it('shows the visual timing link toggle only for exactly one eligible embedded audio sub-cue', () => {
    const pane = paneFor(scene(), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });
    expect(pane.querySelector('.stream-visual-preview-lane-timing-link')).not.toBeNull();

    const ambiguous = scene();
    ambiguous.subCueOrder.push('sub-a-2');
    ambiguous.subCues['sub-a-2'] = { ...ambiguous.subCues['sub-a'], id: 'sub-a-2' };
    const hidden = paneFor(ambiguous, { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });
    expect(hidden.querySelector('.stream-visual-preview-lane-timing-link')).toBeNull();
  });

  it('toggles on a symmetric link and copies visual timing to audio', () => {
    const pane = paneFor(scene({ visualTiming: true }), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });

    pane.querySelector<HTMLButtonElement>('.stream-visual-preview-lane-timing-link')?.click();

    const edit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    expect(edit).toMatchObject({ type: 'update-scene', sceneId: 'scene-a' });
    const subCues = edit?.type === 'update-scene' ? edit.update.subCues : undefined;
    expect(subCues?.['sub-v']).toMatchObject({ linkedTimingSubCueId: 'sub-a' });
    expect(subCues?.['sub-a']).toMatchObject({
      linkedTimingSubCueId: 'sub-v',
      sourceStartMs: 1000,
      sourceEndMs: 8000,
      startOffsetMs: 250,
      playbackRate: 1.5,
    });
  });

  it('mirrors linked visual timing edits but leaves freeze frame visual-only', () => {
    const pane = paneFor(scene({ linked: true }), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });

    changeNumber(pane, 'Delay Start', '600');

    const timingEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    const subCues = timingEdit?.type === 'update-scene' ? timingEdit.update.subCues : undefined;
    expect(subCues?.['sub-v']).toMatchObject({ startOffsetMs: 600 });
    expect(subCues?.['sub-a']).toMatchObject({ startOffsetMs: 600 });

    changeNumber(pane, 'Freeze Frame', '3000');

    const freezeEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    expect(freezeEdit).toMatchObject({
      type: 'update-subcue',
      sceneId: 'scene-a',
      subCueId: 'sub-v',
      update: { freezeFrameMs: 3000 },
    });
  });

  it('mirrors linked audio timing edits but leaves pitch audio-only', () => {
    const pane = paneFor(scene({ linked: true }), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-a' });

    changeNumber(pane, 'Delay Start', '900');

    const timingEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    const subCues = timingEdit?.type === 'update-scene' ? timingEdit.update.subCues : undefined;
    expect(subCues?.['sub-a']).toMatchObject({ startOffsetMs: 900 });
    expect(subCues?.['sub-v']).toMatchObject({ startOffsetMs: 900 });

    changeNumber(pane, 'Pitch', '4');

    const pitchEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    expect(pitchEdit).toMatchObject({
      type: 'update-subcue',
      sceneId: 'scene-a',
      subCueId: 'sub-a',
      update: { pitchShiftSemitones: 4 },
    });
  });

  it('mirrors linked visual pass and inner-loop infinity edits with normalized interlocks', () => {
    const pane = paneFor(scene({ linked: true }), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });

    pane.querySelector<HTMLInputElement>('[aria-label="Pass time"]')!.value = '4';
    pane.querySelector<HTMLInputElement>('[aria-label="Pass time"]')!.dispatchEvent(new Event('change'));
    pane.querySelector<HTMLButtonElement>('[aria-label="Loop time infinity"]')!.click();

    const timingEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    const subCues = timingEdit?.type === 'update-scene' ? timingEdit.update.subCues : undefined;
    const expected = {
      pass: { iterations: { type: 'count', count: 1 } },
      innerLoop: {
        enabled: true,
        range: { startMs: 0, endMs: 10000 },
        iterations: { type: 'infinite' },
      },
    };
    expect(subCues?.['sub-v']).toMatchObject(expected);
    expect(subCues?.['sub-a']).toMatchObject(expected);
  });

  it('mirrors linked visual loop-handle range edits', () => {
    const pane = paneFor(scene({
      linked: true,
      innerLoop: { enabled: true, range: { startMs: 2000, endMs: 4000 }, iterations: { type: 'count', count: 1 } },
    }), { kind: 'subcue', sceneId: 'scene-a', subCueId: 'sub-v' });
    document.body.append(pane);
    const stage = pane.querySelector<HTMLElement>('.stream-visual-preview-lane-stage')!;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 128, clientY: 150 }));
    stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 192, clientY: 150 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 192, clientY: 150 }));

    const timingEdit = vi.mocked(window.xtream.stream.edit).mock.calls.at(-1)?.[0];
    const subCues = timingEdit?.type === 'update-scene' ? timingEdit.update.subCues : undefined;
    const expected = {
      innerLoop: {
        enabled: true,
        range: { startMs: 3000, endMs: 4000 },
        iterations: { type: 'count', count: 1 },
      },
    };
    expect(subCues?.['sub-a']).toMatchObject(expected);
    expect(subCues?.['sub-v']).toMatchObject(expected);
  });
});

function changeNumber(root: HTMLElement, label: string, value: string): void {
  const field = [...root.querySelectorAll<HTMLElement>('.stream-draggable-number')].find((candidate) => candidate.textContent?.includes(label));
  const input = field?.querySelector<HTMLInputElement>('input');
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('change'));
}

function paneFor(scene: PersistedSceneConfig, selection: { kind: 'scene' } | { kind: 'subcue'; sceneId: string; subCueId: string }): HTMLElement {
  const st = stream(scene);
  return createSceneEditPane({
    stream: st,
    scene,
    currentState: directorState(),
    streamPublic: streamPublic(st),
    isSceneRunning: false,
    sceneEditSelection: selection,
    setSceneEditSelection: vi.fn(),
    duplicateScene: vi.fn(),
    removeScene: vi.fn(),
    getDirectorState: () => directorState(),
    renderDirectorState: vi.fn(),
    requestRender: vi.fn(),
  });
}

function scene(options: { linked?: boolean; visualTiming?: boolean; innerLoop?: SubCueInnerLoopPolicy } = {}): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Scene',
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: ['sub-v', 'sub-a'],
    subCues: {
      'sub-v': {
        id: 'sub-v',
        kind: 'visual',
        visualId: 'vid',
        targets: [{ displayId: 'display-a' }],
        playbackRate: options.visualTiming ? 1.5 : 1,
        sourceStartMs: options.visualTiming ? 1000 : undefined,
        sourceEndMs: options.visualTiming ? 8000 : undefined,
        innerLoop: options.innerLoop,
        startOffsetMs: options.visualTiming ? 250 : undefined,
        linkedTimingSubCueId: options.linked ? 'sub-a' : undefined,
      },
      'sub-a': {
        id: 'sub-a',
        kind: 'audio',
        audioSourceId: 'audio-source-embedded-vid',
        outputIds: ['output-a'],
        playbackRate: 1,
        pitchShiftSemitones: 0,
        innerLoop: options.innerLoop,
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
      'scene-a': { sceneId: 'scene-a', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
    },
    expectedDurationMs: 1000,
    calculatedAtWallTimeMs: 0,
    issues: [],
    mainSegments: [],
    threadPlan: { threads: [], threadBySceneId: {}, temporarilyDisabledSceneIds: [], issues: [] },
  };
}

function directorState(): DirectorState {
  return {
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
      'audio-source-embedded-vid': {
        id: 'audio-source-embedded-vid',
        type: 'embedded-visual',
        visualId: 'vid',
        label: 'Clip audio',
        extractionMode: 'representation',
        ready: true,
        playbackRate: 1,
      },
    },
  } as unknown as DirectorState;
}
