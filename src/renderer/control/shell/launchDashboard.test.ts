/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, ShowConfigOperationResult } from '../../../shared/types';

vi.mock('./elements', () => ({
  elements: {
    appFrame: document.createElement('div'),
    patchSurface: document.createElement('section'),
    surfacePanel: document.createElement('section'),
    launchDashboard: document.createElement('section'),
    launchLoadingOverlay: document.createElement('div'),
    launchOpenDefaultButton: document.createElement('button'),
    launchRecentList: document.createElement('div'),
  },
}));

vi.mock('./launchPresentationReady', () => ({
  waitForLaunchPresentationReady: vi.fn(() => new Promise<void>(() => undefined)),
}));

vi.mock('../patch/visualPoolThumbnailCache', () => ({
  clearLiveVisualPoolThumbnailCache: vi.fn(),
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

function result(): ShowConfigOperationResult {
  return {
    state: director(),
    filePath: 'F:/Shows/show.xtream-show.json',
    issues: [],
  };
}

describe('createLaunchDashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals the workspace after hydration even if presentation readiness is still pending', async () => {
    const { elements } = await import('./elements');
    const { createLaunchDashboardController } = await import('./launchDashboard');
    const renderState = vi.fn();
    const setShowStatus = vi.fn();
    const hydrateAfterShowLoaded = vi.fn(() => Promise.resolve());
    const controller = createLaunchDashboardController({
      renderState,
      setShowStatus,
      clearSelection: vi.fn(),
      hydrateAfterShowLoaded,
      getActiveSurface: () => 'stream',
    });

    controller.show();
    const done = controller.complete(result(), 'Opened show config: F:/Shows/show.xtream-show.json');
    await vi.runAllTimersAsync();
    await done;

    expect(renderState).toHaveBeenCalledTimes(2);
    expect(hydrateAfterShowLoaded).toHaveBeenCalledTimes(1);
    expect(elements.launchDashboard.hidden).toBe(true);
    expect(elements.appFrame.classList.contains('launch-blocked')).toBe(false);
    expect(elements.launchLoadingOverlay.getAttribute('aria-hidden')).toBe('true');
    expect(setShowStatus).toHaveBeenCalledWith('Opened show config: F:/Shows/show.xtream-show.json', []);
  });

  it('keeps the dashboard open while persisted UI hydration is still pending', async () => {
    const { elements } = await import('./elements');
    const { createLaunchDashboardController } = await import('./launchDashboard');
    const controller = createLaunchDashboardController({
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      clearSelection: vi.fn(),
      hydrateAfterShowLoaded: vi.fn(() => new Promise<void>(() => undefined)),
      getActiveSurface: () => 'stream',
    });

    controller.show();
    void controller.complete(result(), 'Opened show config: F:/Shows/show.xtream-show.json');
    await Promise.resolve();

    expect(elements.launchDashboard.hidden).toBe(false);
    expect(elements.appFrame.classList.contains('launch-blocked')).toBe(true);
    expect(elements.launchLoadingOverlay.getAttribute('aria-hidden')).toBe('false');
  });

  it('hides the dashboard when loading is cleared after a hydration failure', async () => {
    const { elements } = await import('./elements');
    const { createLaunchDashboardController } = await import('./launchDashboard');
    const controller = createLaunchDashboardController({
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      clearSelection: vi.fn(),
      hydrateAfterShowLoaded: vi.fn(() => Promise.reject(new Error('hydrate failed'))),
      getActiveSurface: () => 'stream',
    });

    controller.show();
    await expect(controller.complete(result(), 'Opened show config: F:/Shows/show.xtream-show.json')).rejects.toThrow('hydrate failed');

    expect(elements.launchDashboard.hidden).toBe(true);
    expect(elements.appFrame.classList.contains('launch-blocked')).toBe(false);
    expect(elements.launchLoadingOverlay.getAttribute('aria-hidden')).toBe('true');
  });
});
