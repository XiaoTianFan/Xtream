import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioSourceState, DirectorState } from '../../../../shared/types';
import {
  clearAudioWaveformPeakCache,
  createAudioWaveformCacheKey,
  downsampleAudioPeaks,
  loadAudioWaveformPeaks,
  resolveAudioWaveformUrl,
} from './audioWaveformPeaks';

describe('audioWaveformPeaks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downsamples multiple channels into peak buckets', () => {
    const buckets = downsampleAudioPeaks(
      [
        Float32Array.from([-1, -0.5, 0.25, 1]),
        Float32Array.from([0.5, 0.25, -0.25, -0.75]),
      ],
      2,
    );
    expect(buckets).toMatchObject([
      { min: -1, max: 0.5 },
      { min: -0.75, max: 1 },
    ]);
    expect(buckets[0].rms).toBeGreaterThan(0);
  });

  it('resolves external and embedded waveform URLs', () => {
    const state = directorState();
    expect(resolveAudioWaveformUrl(state.audioSources.external, state)).toBe('file://external.wav');
    expect(resolveAudioWaveformUrl(state.audioSources.embeddedFile, state)).toBe('file://extracted.wav');
    expect(resolveAudioWaveformUrl(state.audioSources.embeddedRepresentation, state)).toBe('file://visual.mp4');
    expect(resolveAudioWaveformUrl(state.audioSources.embeddedPending, state)).toBeUndefined();
  });

  it('builds cache keys from source identity and media metadata', () => {
    const state = directorState();
    const key = createAudioWaveformCacheKey(state.audioSources.external, state);
    expect(key).toContain('external');
    expect(key).toContain('file://external.wav');
    expect(key).toContain('1234');
  });

  it('loads and caches decoded waveform peaks', async () => {
    clearAudioWaveformPeakCache();
    const state = directorState();
    const fetchImpl = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    const decodeImpl = vi.fn(async () => ({
      sampleRate: 4,
      channelData: [Float32Array.from([-1, -0.5, 0.5, 1])],
    }));

    const first = await loadAudioWaveformPeaks(state.audioSources.external, state, { bucketCount: 2, fetchImpl, decodeImpl });
    const second = await loadAudioWaveformPeaks(state.audioSources.external, state, { bucketCount: 2, fetchImpl, decodeImpl });

    expect(first).toBe(second);
    expect(first).toMatchObject({ durationMs: 1000, channelCount: 1 });
    expect(first?.buckets).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(decodeImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the preload file reader when fetch cannot read a file URL', async () => {
    clearAudioWaveformPeakCache();
    const state = directorState();
    const readFileBuffer = vi.fn(async () => new ArrayBuffer(8));
    vi.stubGlobal('window', {
      xtream: {
        audioSources: { readFileBuffer },
      },
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error('file fetch blocked');
    });
    const decodeImpl = vi.fn(async () => ({
      sampleRate: 2,
      channelData: [Float32Array.from([-0.5, 0.5])],
    }));

    const peaks = await loadAudioWaveformPeaks(state.audioSources.external, state, { bucketCount: 1, fetchImpl, decodeImpl });

    expect(peaks).toMatchObject({ durationMs: 1000, channelCount: 1 });
    expect(readFileBuffer).toHaveBeenCalledWith('file://external.wav');
    expect(decodeImpl).toHaveBeenCalledTimes(1);
  });
});

function directorState(): DirectorState {
  const external: AudioSourceState = {
    id: 'external',
    type: 'external-file',
    label: 'External',
    url: 'file://external.wav',
    durationSeconds: 10,
    fileSizeBytes: 1234,
    ready: true,
  };
  const embeddedFile: AudioSourceState = {
    id: 'embeddedFile',
    type: 'embedded-visual',
    label: 'Embedded file',
    visualId: 'visual',
    extractionMode: 'file',
    extractionStatus: 'ready',
    extractedUrl: 'file://extracted.wav',
    ready: true,
  };
  const embeddedRepresentation: AudioSourceState = {
    id: 'embeddedRepresentation',
    type: 'embedded-visual',
    label: 'Embedded representation',
    visualId: 'visual',
    extractionMode: 'representation',
    ready: true,
  };
  const embeddedPending: AudioSourceState = {
    id: 'embeddedPending',
    type: 'embedded-visual',
    label: 'Embedded pending',
    visualId: 'visual',
    extractionMode: 'file',
    extractionStatus: 'pending',
    ready: false,
  };
  return {
    visuals: {
      visual: { id: 'visual', kind: 'file', type: 'video', label: 'Visual', url: 'file://visual.mp4', ready: true },
    },
    audioSources: { external, embeddedFile, embeddedRepresentation, embeddedPending },
  } as unknown as DirectorState;
}
