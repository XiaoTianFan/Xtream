import { describe, expect, it } from 'vitest';
import { applyLoop, getDirectorSeconds } from './timeline';

describe('timeline helpers', () => {
  it('wraps seconds inside enabled loop boundaries', () => {
    expect(applyLoop(8, { enabled: true, startSeconds: 2, endSeconds: 5 })).toBe(2);
    expect(applyLoop(3, { enabled: true, startSeconds: 2, endSeconds: 5 })).toBe(3);
  });

  it('computes loop-aware director seconds from anchor wall time', () => {
    expect(
      getDirectorSeconds(
        {
          paused: false,
          offsetSeconds: 4,
          anchorWallTimeMs: 1000,
          rate: 1,
          loop: { enabled: true, startSeconds: 2, endSeconds: 5 },
        },
        3500,
      ),
    ).toBe(3.5);
  });
});
