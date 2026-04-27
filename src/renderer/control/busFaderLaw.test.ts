import { describe, expect, it } from 'vitest';
import {
  busDbToFaderSliderValue,
  busDbToNorm,
  busNormToDb,
  BUS_FADER_DB_MAX,
  BUS_FADER_DB_MIN,
  faderMaxSteps,
  faderSliderValueToBusDb,
  quantizeBusFaderDb,
} from './busFaderLaw';

describe('busFaderLaw', () => {
  it('maps endpoints to min/max dB', () => {
    expect(busNormToDb(0)).toBe(BUS_FADER_DB_MIN);
    expect(busNormToDb(1)).toBe(BUS_FADER_DB_MAX);
  });

  it('inverts dB to norm and back', () => {
    for (const db of [-50, -20, -6, 0, 6, 12]) {
      const n = busDbToNorm(db);
      expect(busNormToDb(n)).toBeCloseTo(db, 5);
    }
  });

  it('keeps the inverse within bounds', () => {
    expect(busDbToNorm(-200)).toBe(0);
    expect(busDbToNorm(200)).toBe(1);
  });

  it('round-trips the integer slider with small error', () => {
    const v = 5000;
    const db = faderSliderValueToBusDb(v);
    const v2 = busDbToFaderSliderValue(db);
    expect(Math.abs(v2 - v)).toBeLessThanOrEqual(1);
  });

  it('gives a finer dB/px in the top half of travel (taper < 1)', () => {
    const range = BUS_FADER_DB_MAX - BUS_FADER_DB_MIN;
    const linearMid = BUS_FADER_DB_MIN + 0.5 * range;
    // p^0.55 at 0.5: more than half the dB range is traversed in the first half of travel
    expect(busNormToDb(0.5)).toBeGreaterThan(linearMid);
  });

  it('uses the declared step count for the fader', () => {
    expect(faderMaxSteps()).toBe(10_000);
  });

  it('quantizes bus dB to 0.1 steps and clamps', () => {
    expect(quantizeBusFaderDb(-3.34)).toBe(-3.3);
    expect(quantizeBusFaderDb(6.05)).toBe(6.1);
    expect(quantizeBusFaderDb(12.4)).toBe(BUS_FADER_DB_MAX);
    expect(quantizeBusFaderDb(-61)).toBe(BUS_FADER_DB_MIN);
    expect(quantizeBusFaderDb(Number.NaN)).toBe(BUS_FADER_DB_MIN);
  });
});
