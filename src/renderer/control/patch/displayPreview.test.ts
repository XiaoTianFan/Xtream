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
import { createDisplayPreview, getDisplayPreviewZoneEntries, syncPreviewElements } from './displayPreview';

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

function basePreviewState(): DirectorState {
  return {
    paused: true,
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    rate: 1,
    loop: { enabled: false, startSeconds: 0 },
    performanceMode: false,
    controlDisplayPreviewMaxFps: 15,
    globalDisplayBlackout: false,
    globalDisplayBlackoutFadeOutSeconds: 1,
    visuals: {
      'visual-1': {
        id: 'visual-1',
        kind: 'file',
        type: 'image',
        label: 'Logo',
        url: 'file://logo.png',
        durationSeconds: 10,
        ready: true,
      },
      'visual-2': {
        id: 'visual-2',
        kind: 'file',
        type: 'video',
        label: 'Loop',
        url: 'file://loop.mp4',
        durationSeconds: 10,
        ready: true,
      },
    },
    audioSources: {},
    outputs: {},
    displays: {},
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

describe('display preview zones', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('projects stable zone entries for single and split layouts', () => {
    expect(getDisplayPreviewZoneEntries({ type: 'single' })).toEqual([{ zoneId: 'single', visualId: undefined }]);
    expect(getDisplayPreviewZoneEntries({ type: 'single', visualId: 'visual-1' })).toEqual([{ zoneId: 'single', visualId: 'visual-1' }]);
    expect(getDisplayPreviewZoneEntries({ type: 'split', visualIds: ['visual-1', undefined] })).toEqual([
      { zoneId: 'L', visualId: 'visual-1' },
      { zoneId: 'R', visualId: undefined },
    ]);
  });

  it('renders one drop pane for an empty single display', () => {
    const preview = createDisplayPreview(
      { id: 'd1', layout: { type: 'single' }, fullscreen: false, health: 'ready' },
      basePreviewState(),
    );

    const panes = preview.querySelectorAll<HTMLElement>('.display-preview-pane');
    expect(panes).toHaveLength(1);
    expect(panes[0].dataset.displayZone).toBe('single');
    expect(panes[0].dataset.visualId).toBeUndefined();
    expect(panes[0].querySelector('.preview-empty')?.textContent).toContain('No visual selected');
  });

  it('renders one assigned pane for an assigned single display', () => {
    const preview = createDisplayPreview(
      { id: 'd1', layout: { type: 'single', visualId: 'visual-1' }, fullscreen: false, health: 'ready' },
      basePreviewState(),
    );

    const panes = preview.querySelectorAll<HTMLElement>('.display-preview-pane');
    expect(panes).toHaveLength(1);
    expect(panes[0].dataset.displayZone).toBe('single');
    expect(panes[0].dataset.visualId).toBe('visual-1');
    expect(panes[0].querySelector('img')?.getAttribute('src')).toBe('file://logo.png');
  });

  it('renders both panes for an empty split display', () => {
    const preview = createDisplayPreview(
      { id: 'd1', layout: { type: 'split', visualIds: [undefined, undefined] }, fullscreen: false, health: 'ready' },
      basePreviewState(),
    );

    const panes = [...preview.querySelectorAll<HTMLElement>('.display-preview-pane')];
    expect(panes.map((pane) => pane.dataset.displayZone)).toEqual(['L', 'R']);
    expect(panes.map((pane) => pane.dataset.visualId)).toEqual([undefined, undefined]);
  });

  it('renders one-sided and fully assigned split displays with stable zones', () => {
    const oneSided = createDisplayPreview(
      { id: 'd1', layout: { type: 'split', visualIds: ['visual-1', undefined] }, fullscreen: false, health: 'ready' },
      basePreviewState(),
    );
    expect([...oneSided.querySelectorAll<HTMLElement>('.display-preview-pane')].map((pane) => [pane.dataset.displayZone, pane.dataset.visualId])).toEqual([
      ['L', 'visual-1'],
      ['R', undefined],
    ]);

    const full = createDisplayPreview(
      { id: 'd1', layout: { type: 'split', visualIds: ['visual-1', 'visual-2'] }, fullscreen: false, health: 'ready' },
      basePreviewState(),
    );
    expect([...full.querySelectorAll<HTMLElement>('.display-preview-pane')].map((pane) => [pane.dataset.displayZone, pane.dataset.visualId])).toEqual([
      ['L', 'visual-1'],
      ['R', 'visual-2'],
    ]);
    expect(full.querySelector('video[data-preview-video="true"]')).toBeTruthy();
  });
});
