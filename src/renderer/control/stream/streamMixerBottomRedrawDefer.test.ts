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
        panelStub,
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
        panelStub,
      ),
    ).toBe(false);
  });

  it('defers mixer subtree rebuild while interaction guard reports active', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', panelStub, activeAlways, panelStub)).toBe(true);
  });

  it('does not defer mixer when interaction inactive', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', panelStub, inactiveAlways, panelStub)).toBe(false);
  });

  it('does not defer mixer when stream output panel ref is missing', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', undefined, activeAlways, panelStub)).toBe(false);
  });

  it('defers scene-edit subtree rebuild while scene-edit bottom panel is interacted with', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'scene', panelStub, activeAlways, panelStub)).toBe(true);
  });

  it('does not defer scene-edit when interaction is inactive', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'scene', panelStub, inactiveAlways, panelStub)).toBe(false);
  });

  it('does not defer scene-edit when scene-edit bottom panel ref is missing', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'scene', panelStub, activeAlways, undefined)).toBe(false);
  });

  it('does not defer on other tabs even with active panels', () => {
    expect(shouldDeferStreamMixerBottomPaneRedraw(undefined, 'mixer', undefined, activeAlways, undefined)).toBe(false);
  });
});
