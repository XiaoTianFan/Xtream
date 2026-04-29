import { describe, expect, it } from 'vitest';
import { shouldDeferStreamMixerBottomPaneRedraw } from './streamMixerBottomRedrawDefer';

describe('shouldDeferStreamMixerBottomPaneRedraw', () => {
  const activeAlways = (_panel: HTMLElement) => true;
  const inactiveAlways = (_panel: HTMLElement) => false;
  /** Safe stand-in — only passed to stubs that ignore the element shape. */
  const panelStub = {} as HTMLElement;

  it('does not defer when a detail pane is opening (mixer strip opens overlay while lock still considers panel active)', () => {
    expect(
      shouldDeferStreamMixerBottomPaneRedraw(
        { type: 'output', id: 'out-1', returnTab: 'mixer' },
        'mixer',
        panelStub,
        activeAlways,
      ),
    ).toBe(false);
  });

  it('still does not defer for non-output overlays on mixer tab', () => {
    expect(
      shouldDeferStreamMixerBottomPaneRedraw(
        { type: 'visual', id: 'v1', returnTab: 'mixer' },
        'mixer',
        panelStub,
        activeAlways,
      ),
    ).toBe(false);
  });

  it('defers mixer subtree rebuild while interaction guard reports active', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', panelStub, activeAlways)).toBe(true);
  });

  it('does not defer when interaction inactive', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', panelStub, inactiveAlways)).toBe(false);
  });

  it('does not defer outside mixer tab', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'scene', panelStub, activeAlways)).toBe(false);
  });

  it('does not defer when stream output panel ref is missing', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', undefined, activeAlways)).toBe(false);
  });
});
