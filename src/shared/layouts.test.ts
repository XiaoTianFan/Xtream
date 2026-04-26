import { describe, expect, it } from 'vitest';
import {
  describeLayout,
  getActiveDisplays,
  getLayoutSlots,
  getMode1TargetLayout,
  getMode2TargetLayouts,
  getMode3TargetLayouts,
} from './layouts';

describe('layout helpers', () => {
  it('describes single and split layouts for UI diagnostics', () => {
    expect(describeLayout({ type: 'single', slot: 'A' })).toBe('single: A');
    expect(describeLayout({ type: 'split', slots: ['A', 'B'] })).toBe('split: A + B');
  });

  it('returns active displays sorted by registry id', () => {
    const active = getActiveDisplays({
      'display-2': {
        id: 'display-2',
        fullscreen: false,
        layout: { type: 'single', slot: 'B' },
        health: 'ready',
      },
      'display-0': {
        id: 'display-0',
        fullscreen: false,
        layout: { type: 'single', slot: 'A' },
        health: 'ready',
      },
      'display-1': {
        id: 'display-1',
        fullscreen: false,
        layout: { type: 'split', slots: ['A', 'B'] },
        health: 'closed',
      },
    });

    expect(active.map((display) => display.id)).toEqual(['display-0', 'display-2']);
  });

  it('defines mode 1 as a split A/B layout', () => {
    const layout = getMode1TargetLayout();

    expect(layout).toEqual({ type: 'split', slots: ['A', 'B'] });
    expect(getLayoutSlots(layout)).toEqual(['A', 'B']);
  });

  it('defines mode 2 as two single-slot display layouts', () => {
    expect(getMode2TargetLayouts()).toEqual([
      { type: 'single', slot: 'A' },
      { type: 'single', slot: 'B' },
    ]);
  });

  it('defines mode 3 with the same display layouts as mode 2', () => {
    expect(getMode3TargetLayouts()).toEqual(getMode2TargetLayouts());
  });
});
