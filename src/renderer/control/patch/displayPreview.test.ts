/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState } from '../../../shared/types';

vi.mock('../media/mediaSync', () => ({
  createPlaybackSyncKey: vi.fn(() => 'sync-key'),
  syncTimedMediaElement: vi.fn(),
}));

import { syncTimedMediaElement } from '../media/mediaSync';
import { syncPreviewElements } from './displayPreview';

function stateWithRuntimeVisual(): DirectorState {
  return {
    paused: true,
    anchorWallTimeMs: 0,
    offsetSeconds: 35,
    rate: 1,
    loop: { enabled: false, startSeconds: 0 },
    performanceMode: false,
    controlDisplayPreviewMaxFps: 15,
    globalDisplayBlackout: false,
    globalDisplayBlackoutFadeOutSeconds: 1,
    visuals: {
      'stream-visual:scene-b:visual:d1:single:instance-b': {
        id: 'stream-visual:scene-b:visual:d1:single:instance-b',
        kind: 'file',
        type: 'video',
        label: 'Scene B visual',
        url: 'file://scene-b.mp4',
        durationSeconds: 10,
        playbackRate: 1,
        ready: true,
        runtimeOffsetSeconds: 30,
        runtimeLoop: { enabled: false, startSeconds: 0 },
      },
    },
    audioSources: {},
    outputs: {},
    displays: {
      d1: {
        id: 'd1',
        layout: { type: 'single', visualId: 'stream-visual:scene-b:visual:d1:single:instance-b' },
        fullscreen: false,
        health: 'ready',
      },
    },
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } as unknown as DirectorState;
}

function readyPreviewVideo(visualId: string, duration = 10): HTMLVideoElement {
  const video = document.createElement('video');
  video.dataset.previewVideo = 'true';
  video.dataset.visualId = visualId;
  Object.defineProperty(video, 'readyState', {
    configurable: true,
    value: HTMLMediaElement.HAVE_METADATA,
  });
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: duration,
  });
  document.body.append(video);
  return video;
}

describe('display preview sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it('syncs projected stream visuals from cue-local time instead of absolute stream time', () => {
    const state = stateWithRuntimeVisual();
    const visualId = state.displays.d1.layout.type === 'single' ? state.displays.d1.layout.visualId! : '';
    const video = readyPreviewVideo(visualId);

    syncPreviewElements(state);

    expect(syncTimedMediaElement).toHaveBeenCalledWith(video, 5, false, 'sync-key', 0.75);
  });

  it('uses cue-local time for display preview progress edges', () => {
    const state = stateWithRuntimeVisual();
    const preview = document.createElement('div');
    preview.dataset.displayPreview = 'd1';
    document.body.append(preview);

    syncPreviewElements(state);

    const edge = preview.querySelector<HTMLElement>('.display-preview-progress-edge');
    expect(edge?.style.getPropertyValue('--display-preview-progress')).toBe('50%');
  });
});
