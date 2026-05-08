import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveVisualState, VisualState } from '../../../../shared/types';
import {
  calculateVisualPreviewSampleTimes,
  clearVisualPreviewSnapshotCache,
  createPlaceholderVisualPreviewSnapshots,
  createVisualPreviewSnapshotCacheKey,
  getCachedVisualPreviewSnapshots,
  loadVisualPreviewSnapshots,
  setLiveVisualPreviewSnapshot,
} from './visualPreviewSnapshots';

describe('visualPreviewSnapshots', () => {
  afterEach(() => {
    clearVisualPreviewSnapshotCache();
  });

  it('samples finite media at stable segment centers', () => {
    expect(calculateVisualPreviewSampleTimes(8000, 4)).toEqual([1000, 3000, 5000, 7000]);
    expect(calculateVisualPreviewSampleTimes(undefined, 3)).toEqual([0, 0, 0]);
  });

  it('builds cache keys from media identity, source revision, dimensions, and request shape', () => {
    const first = createVisualPreviewSnapshotCacheKey(videoVisual({ fileSizeBytes: 100 }), { sampleCount: 8, width: 120, height: 80 });
    const second = createVisualPreviewSnapshotCacheKey(videoVisual({ fileSizeBytes: 200 }), { sampleCount: 8, width: 120, height: 80 });
    const third = createVisualPreviewSnapshotCacheKey(videoVisual({ fileSizeBytes: 100 }), { sampleCount: 12, width: 120, height: 80 });

    expect(first).toContain('vid');
    expect(first).toContain('file://clip.mp4');
    expect(second).not.toBe(first);
    expect(third).not.toBe(first);
  });

  it('loads and caches video snapshots with calculated sample times', async () => {
    const captureVideoSnapshots = vi.fn(async (_visual: VisualState, sampleTimes: readonly number[]) =>
      sampleTimes.map((timeMs) => ({ timeMs, dataUrl: `data:image/jpeg;base64,${timeMs}`, state: 'ready' as const })),
    );
    const visual = videoVisual({ durationSeconds: 4 });

    expect(getCachedVisualPreviewSnapshots(visual, { sampleCount: 4 })).toBeUndefined();

    const first = await loadVisualPreviewSnapshots(visual, { sampleCount: 4, captureVideoSnapshots });
    const second = await loadVisualPreviewSnapshots(visual, { sampleCount: 4, captureVideoSnapshots });

    expect(first).toBe(second);
    expect(getCachedVisualPreviewSnapshots(visual, { sampleCount: 4 })).toBe(first);
    expect(first.map((snapshot) => snapshot.timeMs)).toEqual([500, 1500, 2500, 3500]);
    expect(captureVideoSnapshots).toHaveBeenCalledTimes(1);
  });

  it('repeats an image still across the lane', async () => {
    const captureImageSnapshot = vi.fn(async () => 'data:image/jpeg;base64,still');

    const snapshots = await loadVisualPreviewSnapshots(imageVisual(), { sampleCount: 3, captureImageSnapshot });

    expect(snapshots).toEqual([
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,still', state: 'ready' },
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,still', state: 'ready' },
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,still', state: 'ready' },
    ]);
  });

  it('returns live placeholders until a cached live snapshot is available', async () => {
    const live = liveVisual();
    await expect(loadVisualPreviewSnapshots(live, { sampleCount: 2 })).resolves.toEqual(createPlaceholderVisualPreviewSnapshots(undefined, 2));

    setLiveVisualPreviewSnapshot(live, 'data:image/jpeg;base64,live');

    expect(getCachedVisualPreviewSnapshots(live, { sampleCount: 2 })).toEqual([
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,live', state: 'ready' },
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,live', state: 'ready' },
    ]);

    await expect(loadVisualPreviewSnapshots(live, { sampleCount: 2 })).resolves.toEqual([
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,live', state: 'ready' },
      { timeMs: 0, dataUrl: 'data:image/jpeg;base64,live', state: 'ready' },
    ]);
  });

  it('surfaces snapshot errors as per-tile error states', async () => {
    const captureVideoSnapshots = vi.fn(async () => {
      throw new Error('decode failed');
    });

    const snapshots = await loadVisualPreviewSnapshots(videoVisual(), { sampleCount: 2, captureVideoSnapshots });

    expect(snapshots).toEqual([
      { timeMs: 1250, state: 'error', error: 'decode failed' },
      { timeMs: 3750, state: 'error', error: 'decode failed' },
    ]);
  });
});

function videoVisual(overrides: Partial<VisualState> = {}): VisualState {
  return {
    id: 'vid',
    kind: 'file',
    type: 'video',
    label: 'Clip',
    url: 'file://clip.mp4',
    durationSeconds: 5,
    ready: true,
    ...overrides,
  } as VisualState;
}

function imageVisual(): VisualState {
  return {
    id: 'img',
    kind: 'file',
    type: 'image',
    label: 'Still',
    url: 'file://still.png',
    ready: true,
  };
}

function liveVisual(): LiveVisualState {
  return {
    id: 'live',
    kind: 'live',
    type: 'video',
    label: 'Live',
    capture: { source: 'webcam', deviceId: 'camera-a', revision: 2 },
    ready: true,
  };
}
