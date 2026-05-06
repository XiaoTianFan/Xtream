import { describe, expect, it } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import { getLaunchPresentationBlockReason } from './launchPresentationReady';

function readyDirector(overrides: Partial<DirectorState> = {}): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    audioRendererReady: true,
    audioExtractionFormat: 'wav',
    ...overrides,
  } as DirectorState;
}

describe('getLaunchPresentationBlockReason', () => {
  it('does not block show opening on pool previews', () => {
    const state = readyDirector({
      visuals: {
        visual: {
          id: 'visual',
          label: 'Visual',
          kind: 'file',
          type: 'video',
          url: 'file:///visual.mp4',
          ready: true,
          durationSeconds: 10,
        },
      },
      previews: {},
    });

    expect(getLaunchPresentationBlockReason(state, 'stream')).toBeNull();
  });

  it('still blocks on active display layout previews', () => {
    const state = readyDirector({
      visuals: {
        visual: {
          id: 'visual',
          label: 'Visual',
          kind: 'file',
          type: 'image',
          url: 'file:///visual.png',
          ready: true,
        },
      },
      displays: {
        display: {
          id: 'display',
          label: 'Display',
          fullscreen: false,
          health: 'ready',
          layout: { type: 'single', visualId: 'visual' },
        },
      },
      previews: {},
    });

    expect(getLaunchPresentationBlockReason(state, 'stream')).toBe('preview_not_settled:display:display:visual:missing');
  });
});
