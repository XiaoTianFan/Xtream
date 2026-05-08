import type { AudioSourceState, DirectorState } from '../../../../shared/types';

export type AudioWaveformBucket = {
  min: number;
  max: number;
  rms?: number;
};

export type AudioWaveformPeaks = {
  durationMs: number;
  channelCount: number;
  buckets: AudioWaveformBucket[];
};

export type DecodedAudioWaveform = {
  sampleRate: number;
  channelData: Float32Array[];
};

export type AudioWaveformLoadOptions = {
  bucketCount?: number;
  fetchImpl?: (url: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  decodeImpl?: (buffer: ArrayBuffer) => Promise<DecodedAudioWaveform>;
};

const DEFAULT_BUCKET_COUNT = 4096;
const MAX_CACHE_ENTRIES = 80;

type AudioWaveformCacheEntry = {
  promise: Promise<AudioWaveformPeaks>;
  value?: AudioWaveformPeaks;
};

const waveformCache = new Map<string, AudioWaveformCacheEntry>();

export function clearAudioWaveformPeakCache(): void {
  waveformCache.clear();
}

export function resolveAudioWaveformUrl(source: AudioSourceState | undefined, state: DirectorState): string | undefined {
  if (!source) {
    return undefined;
  }
  if (source.type === 'external-file') {
    return source.url;
  }
  if (source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl) {
    return source.extractedUrl;
  }
  if (source.extractionMode === 'file') {
    return undefined;
  }
  return state.visuals[source.visualId]?.url;
}

export function createAudioWaveformCacheKey(source: AudioSourceState, state: DirectorState): string {
  const url = resolveAudioWaveformUrl(source, state) ?? '';
  const extraction =
    source.type === 'embedded-visual'
      ? `${source.extractionMode}:${source.extractionStatus ?? ''}:${source.extractedFormat ?? ''}`
      : 'external';
  return [
    source.id,
    url,
    source.durationSeconds ?? '',
    source.fileSizeBytes ?? '',
    source.channelCount ?? '',
    source.channelMode ?? '',
    extraction,
  ].join('|');
}

export function getCachedAudioWaveformPeaks(
  source: AudioSourceState | undefined,
  state: DirectorState,
  options: Pick<AudioWaveformLoadOptions, 'bucketCount'> = {},
): AudioWaveformPeaks | undefined {
  if (!source || !resolveAudioWaveformUrl(source, state)) {
    return undefined;
  }
  const cacheKey = createAudioWaveformLoadCacheKey(source, state, options);
  const entry = waveformCache.get(cacheKey);
  if (!entry?.value) {
    return undefined;
  }
  touchAudioWaveformCacheEntry(cacheKey, entry);
  return entry.value;
}

export function downsampleAudioPeaks(channelData: readonly ArrayLike<number>[], bucketCount = DEFAULT_BUCKET_COUNT): AudioWaveformBucket[] {
  const channels = channelData.filter((channel) => channel.length > 0);
  if (channels.length === 0 || bucketCount <= 0) {
    return [];
  }
  const sampleCount = Math.max(...channels.map((channel) => channel.length));
  const bucketTotal = Math.min(bucketCount, sampleCount);
  const buckets: AudioWaveformBucket[] = [];
  for (let bucketIndex = 0; bucketIndex < bucketTotal; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * sampleCount) / bucketTotal);
    const end = Math.max(start + 1, Math.floor(((bucketIndex + 1) * sampleCount) / bucketTotal));
    let min = 1;
    let max = -1;
    let squareSum = 0;
    let counted = 0;
    for (const channel of channels) {
      const channelEnd = Math.min(end, channel.length);
      for (let i = start; i < channelEnd; i += 1) {
        const sample = Math.max(-1, Math.min(1, Number(channel[i]) || 0));
        min = Math.min(min, sample);
        max = Math.max(max, sample);
        squareSum += sample * sample;
        counted += 1;
      }
    }
    buckets.push({
      min: counted > 0 ? min : 0,
      max: counted > 0 ? max : 0,
      rms: counted > 0 ? Math.sqrt(squareSum / counted) : 0,
    });
  }
  return buckets;
}

export async function decodeAudioWaveform(buffer: ArrayBuffer): Promise<DecodedAudioWaveform> {
  const AudioContextCtor = window.AudioContext;
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channelData: Float32Array[] = [];
    for (let i = 0; i < decoded.numberOfChannels; i += 1) {
      channelData.push(decoded.getChannelData(i).slice());
    }
    return {
      sampleRate: decoded.sampleRate,
      channelData,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function loadAudioWaveformPeaks(
  source: AudioSourceState | undefined,
  state: DirectorState,
  options: AudioWaveformLoadOptions = {},
): Promise<AudioWaveformPeaks | undefined> {
  if (!source) {
    return undefined;
  }
  const url = resolveAudioWaveformUrl(source, state);
  if (!url) {
    return undefined;
  }
  const cacheKey = createAudioWaveformLoadCacheKey(source, state, options);
  const existing = waveformCache.get(cacheKey);
  if (existing) {
    touchAudioWaveformCacheEntry(cacheKey, existing);
    return existing.promise;
  }
  const load = async (): Promise<AudioWaveformPeaks> => {
    const buffer = await loadAudioWaveformBuffer(url, options.fetchImpl);
    const decodeImpl = options.decodeImpl ?? decodeAudioWaveform;
    const decoded = await decodeImpl(buffer);
    const sampleCount = decoded.channelData[0]?.length ?? 0;
    return {
      durationMs: sampleCount > 0 && decoded.sampleRate > 0 ? (sampleCount / decoded.sampleRate) * 1000 : (source.durationSeconds ?? 0) * 1000,
      channelCount: decoded.channelData.length || source.channelCount || 1,
      buckets: downsampleAudioPeaks(decoded.channelData, options.bucketCount ?? DEFAULT_BUCKET_COUNT),
    };
  };
  const entry: AudioWaveformCacheEntry = {
    promise: Promise.resolve().then(load).then((value) => {
      entry.value = value;
      return value;
    }).catch((error) => {
      waveformCache.delete(cacheKey);
      throw error;
    }),
  };
  rememberAudioWaveformCacheEntry(cacheKey, entry);
  return entry.promise;
}

function createAudioWaveformLoadCacheKey(
  source: AudioSourceState,
  state: DirectorState,
  options: Pick<AudioWaveformLoadOptions, 'bucketCount'>,
): string {
  return `${createAudioWaveformCacheKey(source, state)}|buckets:${options.bucketCount ?? DEFAULT_BUCKET_COUNT}`;
}

function touchAudioWaveformCacheEntry(cacheKey: string, entry: AudioWaveformCacheEntry): void {
  waveformCache.delete(cacheKey);
  waveformCache.set(cacheKey, entry);
}

function rememberAudioWaveformCacheEntry(cacheKey: string, entry: AudioWaveformCacheEntry): void {
  if (waveformCache.size >= MAX_CACHE_ENTRIES && !waveformCache.has(cacheKey)) {
    const oldest = waveformCache.keys().next().value as string | undefined;
    if (oldest) {
      waveformCache.delete(oldest);
    }
  }
  waveformCache.set(cacheKey, entry);
}

async function loadAudioWaveformBuffer(
  url: string,
  fetchImpl?: (url: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>,
): Promise<ArrayBuffer> {
  try {
    const response = await (fetchImpl ?? window.fetch.bind(window))(url);
    return response.arrayBuffer();
  } catch (error) {
    if (!url.startsWith('file:') || !window.xtream.audioSources.readFileBuffer) {
      throw error;
    }
    const buffer = await window.xtream.audioSources.readFileBuffer(url);
    if (!buffer) {
      throw error;
    }
    return buffer;
  }
}
