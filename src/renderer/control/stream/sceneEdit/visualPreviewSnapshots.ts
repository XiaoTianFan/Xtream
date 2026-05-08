import type { LiveVisualState, VisualState } from '../../../../shared/types';

export type VisualPreviewSnapshotState = 'ready' | 'pending' | 'error' | 'placeholder';

export type VisualPreviewSnapshot = {
  timeMs: number;
  dataUrl?: string;
  state: VisualPreviewSnapshotState;
  error?: string;
};

export type VisualPreviewSnapshotLoadOptions = {
  sampleCount?: number;
  width?: number;
  height?: number;
  seekTimeoutMs?: number;
  captureVideoSnapshots?: (
    visual: VisualState,
    sampleTimesMs: readonly number[],
    options: Required<Pick<VisualPreviewSnapshotLoadOptions, 'width' | 'height' | 'seekTimeoutMs'>>,
  ) => Promise<VisualPreviewSnapshot[]>;
  captureImageSnapshot?: (
    visual: VisualState,
    options: Required<Pick<VisualPreviewSnapshotLoadOptions, 'width' | 'height' | 'seekTimeoutMs'>>,
  ) => Promise<string>;
};

const DEFAULT_SAMPLE_COUNT = 12;
const DEFAULT_SNAPSHOT_WIDTH = 160;
const DEFAULT_SNAPSHOT_HEIGHT = 90;
const DEFAULT_SEEK_TIMEOUT_MS = 2500;
const MAX_CACHE_ENTRIES = 80;

type VisualPreviewSnapshotCacheEntry = {
  promise: Promise<VisualPreviewSnapshot[]>;
  value?: VisualPreviewSnapshot[];
};

const snapshotCache = new Map<string, VisualPreviewSnapshotCacheEntry>();
const liveSnapshotCache = new Map<string, VisualPreviewSnapshot>();

export function clearVisualPreviewSnapshotCache(): void {
  snapshotCache.clear();
  liveSnapshotCache.clear();
}

export function createVisualPreviewSnapshotCacheKey(
  visual: VisualState,
  options: Pick<VisualPreviewSnapshotLoadOptions, 'sampleCount' | 'width' | 'height'> = {},
): string {
  const sampleCount = normalizeSampleCount(options.sampleCount);
  const width = normalizePositiveInteger(options.width, DEFAULT_SNAPSHOT_WIDTH);
  const height = normalizePositiveInteger(options.height, DEFAULT_SNAPSHOT_HEIGHT);
  const durationMs = visual.durationSeconds !== undefined ? Math.round(visual.durationSeconds * 1000) : '';
  const sourceRevision = visual.kind === 'live' ? liveVisualRevision(visual) : `${visual.url ?? ''}:${visual.fileSizeBytes ?? ''}`;
  return [
    visual.id,
    visual.kind,
    visual.type,
    sourceRevision,
    durationMs,
    visual.width ?? '',
    visual.height ?? '',
    sampleCount,
    width,
    height,
  ].join('|');
}

export function calculateVisualPreviewSampleTimes(durationMs: number | undefined, sampleCount = DEFAULT_SAMPLE_COUNT): number[] {
  const count = normalizeSampleCount(sampleCount);
  if (!Number.isFinite(durationMs) || durationMs === undefined || durationMs <= 0) {
    return Array.from({ length: count }, () => 0);
  }
  return Array.from({ length: count }, (_value, index) => {
    const centeredMs = ((index + 0.5) * durationMs) / count;
    return Math.max(0, Math.min(Math.max(0, durationMs - 1), Math.round(centeredMs)));
  });
}

export function createPlaceholderVisualPreviewSnapshots(
  durationMs: number | undefined,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  state: Extract<VisualPreviewSnapshotState, 'pending' | 'placeholder'> = 'placeholder',
): VisualPreviewSnapshot[] {
  return calculateVisualPreviewSampleTimes(durationMs, sampleCount).map((timeMs) => ({ timeMs, state }));
}

export function getCachedVisualPreviewSnapshots(
  visual: VisualState | undefined,
  options: Pick<VisualPreviewSnapshotLoadOptions, 'sampleCount' | 'width' | 'height'> = {},
): VisualPreviewSnapshot[] | undefined {
  if (!visual) {
    return undefined;
  }
  if (visual.kind === 'live') {
    const cached = liveSnapshotCache.get(createLiveSnapshotKey(visual));
    if (cached) {
      return calculateVisualPreviewSampleTimes(undefined, options.sampleCount).map((timeMs) => ({ ...cached, timeMs }));
    }
  }
  const cacheKey = createVisualPreviewSnapshotCacheKey(visual, options);
  const entry = snapshotCache.get(cacheKey);
  if (!entry?.value) {
    return undefined;
  }
  touchSnapshotCacheEntry(cacheKey, entry);
  return entry.value;
}

export function setLiveVisualPreviewSnapshot(visual: LiveVisualState, dataUrl: string, timeMs = 0): void {
  liveSnapshotCache.set(createLiveSnapshotKey(visual), { timeMs, dataUrl, state: 'ready' });
  for (const key of [...snapshotCache.keys()]) {
    if (key.startsWith(`${visual.id}|live|`)) {
      snapshotCache.delete(key);
    }
  }
}

export async function loadVisualPreviewSnapshots(
  visual: VisualState | undefined,
  options: VisualPreviewSnapshotLoadOptions = {},
): Promise<VisualPreviewSnapshot[]> {
  if (!visual) {
    return createPlaceholderVisualPreviewSnapshots(undefined, options.sampleCount, 'placeholder');
  }
  const cacheKey = createVisualPreviewSnapshotCacheKey(visual, options);
  const cached = snapshotCache.get(cacheKey);
  if (cached) {
    touchSnapshotCacheEntry(cacheKey, cached);
    return cached.promise;
  }
  const entry: VisualPreviewSnapshotCacheEntry = {
    promise: loadVisualPreviewSnapshotsUncached(visual, options)
      .catch((error: unknown) => {
        snapshotCache.delete(cacheKey);
        return errorSnapshots(visual, options, error);
      })
      .then((snapshots) => {
        entry.value = snapshots;
        return snapshots;
      }),
  };
  rememberSnapshotCacheEntry(cacheKey, entry);
  return entry.promise;
}

async function loadVisualPreviewSnapshotsUncached(
  visual: VisualState,
  options: VisualPreviewSnapshotLoadOptions,
): Promise<VisualPreviewSnapshot[]> {
  const sampleCount = normalizeSampleCount(options.sampleCount);
  const captureOptions = {
    width: normalizePositiveInteger(options.width, DEFAULT_SNAPSHOT_WIDTH),
    height: normalizePositiveInteger(options.height, DEFAULT_SNAPSHOT_HEIGHT),
    seekTimeoutMs: normalizePositiveInteger(options.seekTimeoutMs, DEFAULT_SEEK_TIMEOUT_MS),
  };
  const durationMs = visual.durationSeconds !== undefined ? visual.durationSeconds * 1000 : undefined;
  const sampleTimesMs = calculateVisualPreviewSampleTimes(durationMs, sampleCount);

  if (visual.kind === 'live') {
    const cached = liveSnapshotCache.get(createLiveSnapshotKey(visual));
    if (cached) {
      return sampleTimesMs.map((timeMs) => ({ ...cached, timeMs }));
    }
    return createPlaceholderVisualPreviewSnapshots(durationMs, sampleCount, 'placeholder');
  }

  if (visual.type === 'image') {
    if (!visual.url) {
      return errorSnapshots(visual, options, 'Image visual has no URL.');
    }
    const dataUrl = options.captureImageSnapshot
      ? await options.captureImageSnapshot(visual, captureOptions)
      : await captureImageSnapshot(visual, captureOptions);
    return sampleTimesMs.map((timeMs) => ({ timeMs, dataUrl, state: 'ready' }));
  }

  if (!visual.url) {
    return errorSnapshots(visual, options, 'Video visual has no URL.');
  }
  const capture = options.captureVideoSnapshots ?? captureVideoSnapshots;
  return capture(visual, sampleTimesMs, captureOptions);
}

async function captureImageSnapshot(
  visual: VisualState,
  options: Required<Pick<VisualPreviewSnapshotLoadOptions, 'width' | 'height' | 'seekTimeoutMs'>>,
): Promise<string> {
  const url = visual.kind === 'file' ? visual.url : undefined;
  if (!url) {
    throw new Error('Image visual has no URL.');
  }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await waitForImage(image, url, options.seekTimeoutMs);
  return drawMediaElementToDataUrl(image, options.width, options.height);
}

async function captureVideoSnapshots(
  visual: VisualState,
  sampleTimesMs: readonly number[],
  options: Required<Pick<VisualPreviewSnapshotLoadOptions, 'width' | 'height' | 'seekTimeoutMs'>>,
): Promise<VisualPreviewSnapshot[]> {
  const url = visual.kind === 'file' ? visual.url : undefined;
  if (!url) {
    throw new Error('Video visual has no URL.');
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;
  try {
    await waitForVideoMetadata(video, options.seekTimeoutMs);
    const snapshots: VisualPreviewSnapshot[] = [];
    for (const timeMs of sampleTimesMs) {
      try {
        await seekVideo(video, timeMs / 1000, options.seekTimeoutMs);
        snapshots.push({ timeMs, dataUrl: drawMediaElementToDataUrl(video, options.width, options.height), state: 'ready' });
      } catch (error: unknown) {
        snapshots.push({ timeMs, state: 'error', error: errorMessage(error) });
      }
    }
    return snapshots;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function drawMediaElementToDataUrl(
  element: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering is unavailable.');
  }
  context.drawImage(element, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function waitForImage(image: HTMLImageElement, url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = installTimeout(timeoutMs, () => finish(() => reject(new Error('Image snapshot timed out.'))));
    const finish = (callback: () => void): void => {
      cleanup();
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      callback();
    };
    const onLoad = (): void => finish(resolve);
    const onError = (): void => finish(() => reject(new Error('Image failed to load.')));
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    image.src = url;
  });
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return waitForMediaEvent(video, ['loadedmetadata'], timeoutMs, 'Video metadata timed out.');
}

function seekVideo(video: HTMLVideoElement, seconds: number, timeoutMs: number): Promise<void> {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
  const wait = waitForMediaEvent(video, ['seeked', 'canplay'], timeoutMs, 'Video seek timed out.');
  video.currentTime = duration === undefined ? Math.max(0, seconds) : Math.max(0, Math.min(Math.max(0, duration - 0.001), seconds));
  return wait;
}

function waitForMediaEvent(
  target: HTMLMediaElement,
  eventNames: readonly string[],
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanupTimeout = installTimeout(timeoutMs, () => finish(() => reject(new Error(timeoutMessage))));
    const finish = (callback: () => void): void => {
      cleanupTimeout();
      for (const eventName of eventNames) {
        target.removeEventListener(eventName, onReady);
      }
      target.removeEventListener('error', onError);
      callback();
    };
    const onReady = (): void => finish(resolve);
    const onError = (): void => finish(() => reject(new Error(target.error?.message ?? 'Media failed to load.')));
    for (const eventName of eventNames) {
      target.addEventListener(eventName, onReady, { once: true });
    }
    target.addEventListener('error', onError, { once: true });
  });
}

function installTimeout(timeoutMs: number, callback: () => void): () => void {
  const timer = window.setTimeout(callback, timeoutMs);
  return () => window.clearTimeout(timer);
}

function errorSnapshots(
  visual: VisualState | undefined,
  options: Pick<VisualPreviewSnapshotLoadOptions, 'sampleCount'>,
  error: unknown,
): VisualPreviewSnapshot[] {
  const durationMs = visual?.durationSeconds !== undefined ? visual.durationSeconds * 1000 : undefined;
  return calculateVisualPreviewSampleTimes(durationMs, options.sampleCount).map((timeMs) => ({
    timeMs,
    state: 'error',
    error: errorMessage(error),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function touchSnapshotCacheEntry(key: string, entry: VisualPreviewSnapshotCacheEntry): void {
  snapshotCache.delete(key);
  snapshotCache.set(key, entry);
}

function rememberSnapshotCacheEntry(key: string, entry: VisualPreviewSnapshotCacheEntry): void {
  if (snapshotCache.size >= MAX_CACHE_ENTRIES && !snapshotCache.has(key)) {
    const oldest = snapshotCache.keys().next().value as string | undefined;
    if (oldest) {
      snapshotCache.delete(oldest);
    }
  }
  snapshotCache.set(key, entry);
}

function normalizeSampleCount(sampleCount: number | undefined): number {
  return Math.max(1, Math.min(32, normalizePositiveInteger(sampleCount, DEFAULT_SAMPLE_COUNT)));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function createLiveSnapshotKey(visual: LiveVisualState): string {
  return `${visual.id}:${liveVisualRevision(visual)}`;
}

function liveVisualRevision(visual: LiveVisualState): string {
  const capture = visual.capture;
  if (capture.source === 'webcam') {
    return `${capture.source}:${capture.revision ?? ''}:${capture.deviceId ?? ''}:${capture.groupId ?? ''}:${capture.label ?? ''}`;
  }
  if (capture.source === 'window') {
    return `${capture.source}:${capture.revision ?? ''}:${capture.sourceId ?? ''}:${capture.appName ?? ''}:${capture.windowName ?? ''}:${capture.label ?? ''}`;
  }
  const crop = capture.source === 'screen-region' ? `${capture.crop.x},${capture.crop.y},${capture.crop.width},${capture.crop.height}` : '';
  return `${capture.source}:${capture.revision ?? ''}:${capture.sourceId ?? ''}:${capture.displayId ?? ''}:${capture.label ?? ''}:${crop}`;
}
