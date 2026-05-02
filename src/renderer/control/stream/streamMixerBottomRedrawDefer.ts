import type { BottomTab, DetailPane } from './streamTypes';

/**
 * Mirrors `renderBottomPaneIfNeeded` in streamSurface: skip rebuilding bottom DOM during active
 * interactions to avoid destroying/recreating form controls mid-gesture.
 *
 * - Mixer tab: deferred while a fader/drag gesture is active in the output panel.
 * - Scene-edit tab: deferred while a pointer gesture or focused form control is active in the
 *   bottom pane, so toggling the Loop button or editing a numeric field doesn't redraw the form.
 *
 * Never deferred when a detail overlay is opening (detail pane swaps the bottom for the overlay
 * strip — the opener runs in the click phase while the interaction-lock clears only on
 * `setTimeout(0)` after pointerup).
 */
export function shouldDeferStreamMixerBottomPaneRedraw(
  detailPane: DetailPane | undefined,
  bottomTab: BottomTab,
  streamOutputPanel: HTMLElement | undefined,
  isPanelInteractionActive: (panel: HTMLElement) => boolean,
  sceneEditBottomPanel?: HTMLElement,
): boolean {
  if (detailPane) {
    return false;
  }
  if (bottomTab === 'mixer' && streamOutputPanel) {
    return isPanelInteractionActive(streamOutputPanel);
  }
  if (bottomTab === 'scene' && sceneEditBottomPanel) {
    return isPanelInteractionActive(sceneEditBottomPanel);
  }
  return false;
}
