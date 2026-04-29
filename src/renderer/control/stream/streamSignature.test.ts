import { describe, expect, it } from 'vitest';
import type { DisplayWindowId, DisplayWindowState } from '../../../shared/types';
import { snapshotDisplaysForStreamSignature } from './streamSignature';

describe('snapshotDisplaysForStreamSignature', () => {
  it('matches when only display telemetry fields differ', () => {
    const baseDisplay: DisplayWindowState = {
      id: 'display-0' as DisplayWindowId,
      fullscreen: false,
      layout: { type: 'single', visualId: undefined },
      health: 'ready',
    };
    const a = snapshotDisplaysForStreamSignature({ 'display-0': { ...baseDisplay } });
    const b = snapshotDisplaysForStreamSignature({
      'display-0': {
        ...baseDisplay,
        lastDriftSeconds: 0.02,
        lastPresentedFrameRateFps: 59.8,
        lastFrameRateFps: 60,
        lastDroppedVideoFrames: 3,
        lastTotalVideoFrames: 10000,
        lastMaxVideoFrameGapMs: 12,
        lastMediaSeekCount: 1,
      },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes when stable fields change', () => {
    const d0: DisplayWindowState = {
      id: 'display-0' as DisplayWindowId,
      fullscreen: false,
      layout: { type: 'single', visualId: undefined },
      health: 'ready',
    };
    const d1: DisplayWindowState = {
      ...d0,
      fullscreen: true,
    };
    expect(JSON.stringify(snapshotDisplaysForStreamSignature({ 'display-0': d0 }))).not.toBe(
      JSON.stringify(snapshotDisplaysForStreamSignature({ 'display-0': d1 })),
    );
  });
});
