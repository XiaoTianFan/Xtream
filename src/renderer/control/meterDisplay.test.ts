import { describe, expect, it } from 'vitest';
import {
  METER_DISPLAY_CEIL_DB,
  METER_DISPLAY_FLOOR_DB,
  meterDbToVisualU,
  meterLevelPercent,
  meterScaleLabelTopPercent,
  meterVisualUToDb,
  meterWidth,
} from './audioRuntime';

describe('meter -60 dB to 0 dB display (option A)', () => {
  it('maps floor to 0% and 0 dB to 100%', () => {
    expect(meterLevelPercent(-60)).toBe(0);
    expect(meterLevelPercent(0)).toBe(100);
  });

  it('maps the midpoint in dB to 50% fill', () => {
    expect(meterLevelPercent(-30)).toBe(50);
  });

  it('saturates at full bar for 0 dB and above (clip region)', () => {
    expect(meterLevelPercent(0.1)).toBe(100);
    expect(meterLevelPercent(6)).toBe(100);
  });

  it('agrees with meterWidth as a string percent', () => {
    expect(meterWidth(-12)).toBe('80%');
    expect(meterWidth(undefined)).toBe('0%');
  });

  it('places -60-0 dB graticule linearly: 0 dB at top, -60 dB at bottom', () => {
    expect(meterScaleLabelTopPercent(0)).toBe('0%');
    expect(meterScaleLabelTopPercent(-6)).toBe('10%');
    expect(meterScaleLabelTopPercent(-12)).toBe('20%');
    expect(meterScaleLabelTopPercent(-24)).toBe('40%');
    expect(meterScaleLabelTopPercent(-36)).toBe('60%');
    expect(meterScaleLabelTopPercent(-60)).toBe('100%');
  });

  it('meterDbToVisualU and meterVisualUToDb are inverse on the span', () => {
    expect(meterDbToVisualU(0)).toBe(0);
    expect(meterDbToVisualU(-60)).toBe(1);
    expect(meterVisualUToDb(0)).toBe(0);
    expect(meterVisualUToDb(1)).toBe(-60);
    expect(meterVisualUToDb(meterDbToVisualU(-18))).toBeCloseTo(-18, 6);
  });
});

describe('METER_DISPLAY_* constants', () => {
  it('exposes a 60 dB span', () => {
    expect(METER_DISPLAY_CEIL_DB - METER_DISPLAY_FLOOR_DB).toBe(60);
  });
});
