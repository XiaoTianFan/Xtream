/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedAudioSubCueConfig } from '../../../../shared/types';
import { buildAudioSubCuePreviewPayload, createAudioSubCueWaveformEditor } from './audioSubCueWaveformEditor';

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  window.xtream = {
    audioRuntime: { preview: vi.fn(), onSubCuePreviewPosition: vi.fn() },
  } as unknown as typeof window.xtream;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('audioSubCueWaveformEditor', () => {
  it('builds preview payloads for the selected output bus', () => {
    const state = directorState();
    const payload = buildAudioSubCuePreviewPayload(audioSubCue(), state, 'preview-a');

    expect(payload).toMatchObject({
      previewId: 'preview-a',
      audioSourceId: 'aud',
      url: 'file://audio.wav',
      outputId: 'out-b',
      sourceStartMs: 1000,
      sourceEndMs: 9000,
      pitchShiftSemitones: 3,
    });
  });

  it('patches the infinite loop policy from the waveform control row', () => {
    const patches: Array<Partial<PersistedAudioSubCueConfig>> = [];
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ loop: { enabled: false } }),
      currentState: directorState({ noUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);

    const loop = editor.querySelector('.stream-audio-waveform-loop') as HTMLButtonElement;
    loop.click();

    expect(patches).toEqual([{ loop: { enabled: true, iterations: { type: 'infinite' } } }]);
  });

  it('uses icon transport controls with accessible labels', () => {
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue(),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });

    const transports = [...editor.querySelectorAll<HTMLButtonElement>('.stream-audio-waveform-transport')];

    expect(transports.map((button) => button.getAttribute('aria-label'))).toEqual(['Play preview', 'Pause preview']);
    expect(transports.every((button) => button.querySelector('svg'))).toBe(true);
  });

  it('maps Play times to fixed-count looping and keeps Infinite Loop exclusive', () => {
    const patches: Array<Partial<PersistedAudioSubCueConfig>> = [];
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ loop: { enabled: false } }),
      currentState: directorState({ noUrl: true }),
      patchSubCue: (patch) => patches.push(patch),
    });

    const playTimes = editor.querySelector<HTMLInputElement>('.stream-draggable-number .label-input');
    expect(playTimes).not.toBeNull();
    playTimes!.value = '3';
    playTimes!.dispatchEvent(new Event('change'));

    const loop = editor.querySelector('.stream-audio-waveform-loop') as HTMLButtonElement;
    expect(loop.textContent).toContain('Infinite Loop');
    loop.click();

    expect(patches).toEqual([
      { loop: { enabled: true, iterations: { type: 'count', count: 3 } } },
      { loop: { enabled: true, iterations: { type: 'infinite' } } },
    ]);
    expect(loop.classList.contains('active')).toBe(true);
    expect(playTimes!.disabled).toBe(true);
  });

  it('stops preview UI state after fixed-count play times finish', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    window.xtream = {
      audioRuntime: { preview, onSubCuePreviewPosition: vi.fn() },
    } as unknown as typeof window.xtream;
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ sourceStartMs: 0, sourceEndMs: 1000, loop: { enabled: true, iterations: { type: 'count', count: 2 } } }),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });

    const [play, pause] = [...editor.querySelectorAll<HTMLButtonElement>('.stream-audio-waveform-transport')];
    play.click();
    vi.advanceTimersByTime(2000);
    pause.click();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-audio-subcue-preview' }));
    expect(preview).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pause-audio-subcue-preview' }));
  });

  it('keeps preview UI state alive for infinite loops', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    window.xtream = {
      audioRuntime: { preview, onSubCuePreviewPosition: vi.fn() },
    } as unknown as typeof window.xtream;
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ sourceStartMs: 0, sourceEndMs: 1000, loop: { enabled: true, iterations: { type: 'infinite' } } }),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });

    const [play, pause] = [...editor.querySelectorAll<HTMLButtonElement>('.stream-audio-waveform-transport')];
    play.click();
    vi.advanceTimersByTime(10000);
    pause.click();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause-audio-subcue-preview' }));
  });

  it('does not patch persisted stream state until a waveform drag commits', () => {
    const patches: Array<Partial<PersistedAudioSubCueConfig>> = [];
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue(),
      currentState: directorState(),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const canvas = editor.querySelector('canvas') as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 260, clientY: 90 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 80 }));

    expect(patches).toEqual([]);

    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 300, clientY: 80 }));

    expect(patches).toHaveLength(1);
    expect(patches[0].levelAutomation?.length).toBeGreaterThan(0);
  });

  it('writes automation drawing into fixed time buckets', () => {
    const patches: Array<Partial<PersistedAudioSubCueConfig>> = [];
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue(),
      currentState: directorState(),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);
    const canvas = editor.querySelector('canvas') as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 164, right: 640, bottom: 164, x: 0, y: 0, toJSON: () => ({}) });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 260, clientY: 90 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 261, clientY: 80 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 261, clientY: 80 }));

    expect(patches).toHaveLength(1);
    const points = patches[0].levelAutomation ?? [];
    expect(points).toHaveLength(1);
    expect(points[0].timeMs % 100).toBe(0);
  });

  it('clears active automation from the waveform clear button', () => {
    const patches: Array<Partial<PersistedAudioSubCueConfig>> = [];
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ levelAutomation: [{ timeMs: 0, value: -6 }], panAutomation: [{ timeMs: 0, value: 0.5 }] }),
      currentState: directorState(),
      patchSubCue: (patch) => patches.push(patch),
    });
    document.body.append(editor);

    const clear = editor.querySelector<HTMLButtonElement>('.stream-audio-waveform-clear-automation');
    expect(clear?.getAttribute('aria-label')).toBe('Clear automation');
    clear?.click();

    expect(patches).toEqual([{ levelAutomation: undefined }]);
  });

  it('repaints the waveform canvas with the active theme palette after theme changes', () => {
    const canvas = installCanvasContextRecorder();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue(),
      currentState: directorState({ noUrl: true }),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    expect(canvas.fillStyles[0]).toBe('rgba(11, 18, 27, 0.74)');
    canvas.fillStyles.length = 0;

    document.documentElement.setAttribute('data-theme', 'light');
    window.dispatchEvent(new CustomEvent('xtream-theme-change', { detail: { theme: 'light' } }));

    expect(canvas.fillStyles[0]).toBe('rgba(227, 224, 219, 0.92)');
  });

  it('disables preview transport when no output bus can be selected', () => {
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ outputIds: [] }),
      currentState: directorState({ noOutputs: true }),
      patchSubCue: vi.fn(),
    });

    const play = editor.querySelector('.stream-audio-waveform-transport') as HTMLButtonElement;

    expect(play.disabled).toBe(true);
  });

  it('stops transient preview playback when the editor is removed', async () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    window.xtream = {
      audioRuntime: { preview },
    } as unknown as typeof window.xtream;
    const editor = createAudioSubCueWaveformEditor({
      sub: audioSubCue({ durationOverrideMs: 5000 }),
      currentState: directorState(),
      patchSubCue: vi.fn(),
    });
    document.body.append(editor);

    const play = editor.querySelector('.stream-audio-waveform-transport') as HTMLButtonElement;
    play.click();
    editor.remove();
    vi.advanceTimersByTime(250);
    await Promise.resolve();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-audio-subcue-preview' }));
    expect(preview).toHaveBeenCalledWith({ type: 'stop-audio-subcue-preview', previewId: 'subcue-preview:sub-a' });
  });
});

function installCanvasContextRecorder(): { fillStyles: string[] } {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    fill: vi.fn(),
    set fillStyle(value: string) {
      fillStyles.push(String(value));
    },
    get fillStyle() {
      return fillStyles[fillStyles.length - 1] ?? '';
    },
    set strokeStyle(value: string) {
      strokeStyles.push(String(value));
    },
    get strokeStyle() {
      return strokeStyles[strokeStyles.length - 1] ?? '';
    },
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  return { fillStyles };
}

function audioSubCue(overrides: Partial<PersistedAudioSubCueConfig> = {}): PersistedAudioSubCueConfig {
  return {
    id: 'sub-a',
    kind: 'audio',
    audioSourceId: 'aud',
    outputIds: ['out-b'],
    sourceStartMs: 1000,
    sourceEndMs: 9000,
    levelDb: -3,
    pan: 0.2,
    playbackRate: 1.25,
    pitchShiftSemitones: 3,
    ...overrides,
  };
}

function directorState(options: { noUrl?: boolean; noOutputs?: boolean } = {}): DirectorState {
  return {
    audioSources: {
      aud: {
        id: 'aud',
        label: 'Audio',
        type: 'external-file',
        url: options.noUrl ? undefined : 'file://audio.wav',
        durationSeconds: 10,
        playbackRate: 1,
        levelDb: -1,
        ready: true,
      },
    },
    outputs: options.noOutputs
      ? {}
      : {
          'out-a': { id: 'out-a', label: 'A', sources: [], busLevelDb: 0, pan: 0, ready: true, physicalRoutingAvailable: true, fallbackReason: 'none' },
          'out-b': { id: 'out-b', label: 'B', sources: [], busLevelDb: -6, pan: -0.25, sinkId: 'sink-b', ready: true, physicalRoutingAvailable: true, fallbackReason: 'none' },
        },
    visuals: {},
  } as unknown as DirectorState;
}
