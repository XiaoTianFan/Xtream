import type { BottomTab, DetailPane } from './streamTypes';

/**
 * Mirrors `renderBottomPaneIfNeeded` in streamSurface: skip rebuilding mixer bottom DOM during
 * fader/drag gestures, but never skip opening a detail overlay (detail pane swaps the bottom for
 * the overlay strip — opener runs in the click phase while interaction-lock is still cleared only on `setTimeout(0)` after pointerup).
 */
export function shouldDeferStreamMixerBottomPaneRedraw(
  detailPane: DetailPane | undefined,
  bottomTab: BottomTab,
  streamOutputPanel: HTMLElement | undefined,
  isPanelInteractionActive: (panel: HTMLElement) => boolean,
): boolean {
  if (detailPane) {
    return false;
  }
  if (bottomTab !== 'mixer' || !streamOutputPanel) {
    return false;
  }
  return isPanelInteractionActive(streamOutputPanel);
}
