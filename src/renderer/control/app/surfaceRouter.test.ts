/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import { createSurfaceRouter } from './surfaceRouter';

vi.mock('../shell/elements', () => ({
  elements: {
    appFrame: document.createElement('div'),
    patchSurface: document.createElement('section'),
    surfacePanel: document.createElement('section'),
    patchRailButton: document.createElement('button'),
    streamRailButton: document.createElement('button'),
    performanceRailButton: document.createElement('button'),
    configRailButton: document.createElement('button'),
  },
}));

function director(): DirectorState {
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
  } as unknown as DirectorState;
}

describe('createSurfaceRouter', () => {
  let state: DirectorState | undefined;

  beforeEach(() => {
    state = director();
  });

  it('renders immediately when persisted active surface is applied after state exists', () => {
    const patchRender = vi.fn();
    const streamRender = vi.fn();
    const streamMount = vi.fn();
    const router = createSurfaceRouter({
      getCurrentState: () => state,
      surfaces: [
        { id: 'patch', render: patchRender },
        { id: 'stream', mount: streamMount, render: streamRender, createRenderSignature: () => 'stream' },
      ],
    });

    router.render(state!);
    router.setPersistedActiveSurface('stream');

    expect(streamMount).toHaveBeenCalledTimes(1);
    expect(streamRender).toHaveBeenCalledTimes(1);
  });
});
