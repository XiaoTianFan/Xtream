import { describe, expect, it } from 'vitest';
import { GRATICULE_LABELS_MAX, GRATICULE_LABELS_MIN, labelCountFromHeight } from './graticuleLayout';

describe('graticuleLayout', () => {
  it('clamps label count from height and pitch', () => {
    expect(labelCountFromHeight(0)).toBe(GRATICULE_LABELS_MIN);
    expect(labelCountFromHeight(500)).toBe(GRATICULE_LABELS_MAX);
    expect(labelCountFromHeight(100, { minPitchPx: 12 })).toBe(8);
    expect(labelCountFromHeight(24, { minPitchPx: 12 })).toBe(2);
  });
});
