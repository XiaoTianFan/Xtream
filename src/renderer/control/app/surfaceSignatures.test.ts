import { describe, expect, it } from 'vitest';
import type { DirectorState } from '../../../shared/types';
import { createSurfaceStateSignature } from './surfaceSignatures';

function director(overrides: Partial<DirectorState> = {}): DirectorState {
  return {
    paused: true,
    rate: 1,
    audioExtractionFormat: 'm4a',
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    controlDisplayPreviewMaxFps: 15,
    performanceMode: false,
    visuals: {},
    audioSources: {},
    outputs: {
      main: {
        id: 'main',
        label: 'Main',
        sources: [],
        busLevelDb: 0,
        ready: true,
        physicalRoutingAvailable: true,
      },
    },
    displays: {
      displayA: {
        id: 'displayA',
        label: 'Display A',
        fullscreen: false,
        layout: { type: 'single', visualId: undefined },
        health: 'ready',
        lastDriftSeconds: 0,
        lastFrameRateFps: 60,
        lastPresentedFrameRateFps: 30,
        lastDroppedVideoFrames: 0,
        lastTotalVideoFrames: 120,
        lastMaxVideoFrameGapMs: 20,
        lastMediaSeekCount: 0,
      },
    },
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    audioRendererReady: true,
    readiness: { ready: true, checkedAtWallTimeMs: 1000, issues: [] },
    corrections: { displays: {} },
    previews: {},
    ...overrides,
  };
}

describe('createSurfaceStateSignature', () => {
  it('ignores live display telemetry and readiness timestamps', () => {
    const base = director();
    const next = structuredClone(base);
    next.readiness.checkedAtWallTimeMs = 2000;
    next.displays.displayA.lastDriftSeconds = 0.125;
    next.displays.displayA.lastFrameRateFps = 58.2;
    next.displays.displayA.lastPresentedFrameRateFps = 29.9;
    next.displays.displayA.lastDroppedVideoFrames = 4;
    next.displays.displayA.lastTotalVideoFrames = 240;
    next.displays.displayA.lastMaxVideoFrameGapMs = 44;
    next.displays.displayA.lastMediaSeekCount = 3;

    expect(createSurfaceStateSignature('config', next)).toBe(createSurfaceStateSignature('config', base));
  });

  it('changes for stable config fields used by the Config surface', () => {
    const base = director();
    const changed = structuredClone(base);
    changed.displayVisualMingle = {
      displayA: { mode: 'layered', algorithm: 'screen', defaultTransitionMs: 250 },
    };
    changed.displays.displayA.layout = { type: 'split', visualIds: [undefined, undefined] };
    changed.displays.displayA.health = 'degraded';

    expect(createSurfaceStateSignature('config', changed)).not.toBe(createSurfaceStateSignature('config', base));
  });
});
