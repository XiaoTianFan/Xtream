/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedAudioSubCueConfig } from '../../../../shared/types';
import { buildAudioSubCuePreviewPayload, createAudioSubCueWaveformEditor } from './audioSubCueWaveformEditor';

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  window.xtream = {
    audioRuntime: { preview: vi.fn() },
  } as unknown as typeof window.xtream;
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
});

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

function directorState(options: { noUrl?: boolean } = {}): DirectorState {
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
    outputs: {
      'out-a': { id: 'out-a', label: 'A', sources: [], busLevelDb: 0, pan: 0, ready: true, physicalRoutingAvailable: true, fallbackReason: 'none' },
      'out-b': { id: 'out-b', label: 'B', sources: [], busLevelDb: -6, pan: -0.25, sinkId: 'sink-b', ready: true, physicalRoutingAvailable: true, fallbackReason: 'none' },
    },
    visuals: {},
  } as unknown as DirectorState;
}
