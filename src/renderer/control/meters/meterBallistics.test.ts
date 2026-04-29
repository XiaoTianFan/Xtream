import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METER_BALLISTICS,
  METER_BALLISTICS_CEIL_DB,
  METER_BALLISTICS_FLOOR_DB,
  smoothMeterDb,
} from './meterBallistics';

describe('smoothMeterDb', () => {
  it('snaps upward on attack', () => {
    expect(smoothMeterDb(-24, -6, 0.016, DEFAULT_METER_BALLISTICS)).toBe(-6);
    expect(smoothMeterDb(-60, 0, 0, DEFAULT_METER_BALLISTICS)).toBe(0);
  });

  it('releases downward toward a lower target', () => {
    const opts = { ...DEFAULT_METER_BALLISTICS, releaseDbPerSecond: 60 };
    // Large dt is capped to 0.25 s per step
    expect(smoothMeterDb(-6, -60, 1, opts)).toBe(-21);
    expect(smoothMeterDb(-12, -60, 0.1, opts)).toBeCloseTo(-18, 5);
    let x = -6;
    for (let i = 0; i < 16; i += 1) {
      x = smoothMeterDb(x, METER_BALLISTICS_FLOOR_DB, 0.25, opts);
    }
    expect(x).toBe(METER_BALLISTICS_FLOOR_DB);
  });

  it('stops at target when release would pass it', () => {
    const opts = { ...DEFAULT_METER_BALLISTICS, releaseDbPerSecond: 120 };
    expect(smoothMeterDb(-10, -20, 1, opts)).toBe(-20);
  });

  it('clamps to floor and ceil', () => {
    expect(smoothMeterDb(-100, METER_BALLISTICS_FLOOR_DB, 1, DEFAULT_METER_BALLISTICS)).toBe(METER_BALLISTICS_FLOOR_DB);
    expect(smoothMeterDb(3, METER_BALLISTICS_CEIL_DB, 0, DEFAULT_METER_BALLISTICS)).toBe(METER_BALLISTICS_CEIL_DB);
  });

  it('monotonic decay toward floor when target is floor', () => {
    const prev = -6;
    const t1 = smoothMeterDb(prev, METER_BALLISTICS_FLOOR_DB, 0.016, DEFAULT_METER_BALLISTICS);
    expect(t1).toBeLessThan(prev);
    const t2 = smoothMeterDb(t1, METER_BALLISTICS_FLOOR_DB, 0.016, DEFAULT_METER_BALLISTICS);
    expect(t2).toBeLessThanOrEqual(t1);
  });

  it('caps large deltaSeconds to avoid jumps', () => {
    const prev = -6;
    const opts = { ...DEFAULT_METER_BALLISTICS, releaseDbPerSecond: 100 };
    const huge = smoothMeterDb(prev, -60, 10, opts);
    const capped = smoothMeterDb(prev, -60, 0.25, opts);
    expect(huge).toBe(capped);
  });
});
