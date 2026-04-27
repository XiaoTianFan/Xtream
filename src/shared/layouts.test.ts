import { describe, expect, it } from 'vitest';
import { createSingleLayout, createSplitLayout, describeLayout, getActiveDisplays, getLayoutVisualIds } from './layouts';

describe('layout helpers', () => {
  it('describes single and split layouts for UI diagnostics', () => {
    expect(describeLayout({ type: 'single', visualId: 'visual-a' })).toBe('single: visual-a');
    expect(describeLayout({ type: 'split', visualIds: ['visual-a', 'visual-b'] })).toBe('split: visual-a + visual-b');
  });

  it('returns active displays sorted by registry id', () => {
    const active = getActiveDisplays({
      'display-2': {
        id: 'display-2',
        fullscreen: false,
        layout: { type: 'single', visualId: 'visual-b' },
        health: 'ready',
      },
      'display-0': {
        id: 'display-0',
        fullscreen: false,
        layout: { type: 'single', visualId: 'visual-a' },
        health: 'ready',
      },
      'display-1': {
        id: 'display-1',
        fullscreen: false,
        layout: { type: 'split', visualIds: ['visual-a', 'visual-b'] },
        health: 'closed',
      },
    });

    expect(active.map((display) => display.id)).toEqual(['display-0', 'display-2']);
  });

  it('creates visual layouts and returns mapped visual ids', () => {
    expect(createSingleLayout('visual-a')).toEqual({ type: 'single', visualId: 'visual-a' });
    const split = createSplitLayout('visual-a', 'visual-b');
    expect(split).toEqual({ type: 'split', visualIds: ['visual-a', 'visual-b'] });
    expect(getLayoutVisualIds(split)).toEqual(['visual-a', 'visual-b']);
  });
});
