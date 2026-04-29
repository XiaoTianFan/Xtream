import type { DirectorState, DisplayWindowState } from '../../../shared/types';

/**
 * Display fields used for Stream surface shell `createRenderSignature` only.
 * Excludes telemetry (`last*` FPS/frames/seeks/drift etc.) updated every drift/report tick.
 */
export function snapshotDisplaysForStreamSignature(displays: DirectorState['displays']): unknown {
  const ids = Object.keys(displays).sort((a, b) => a.localeCompare(b));
  return ids.map((id) => stableDisplayProjection(displays[id]));
}

function stableDisplayProjection(display: DisplayWindowState): unknown {
  return {
    id: display.id,
    label: display.label,
    bounds: display.bounds,
    displayId: display.displayId,
    fullscreen: display.fullscreen,
    alwaysOnTop: display.alwaysOnTop,
    layout: display.layout,
    health: display.health,
    degradationReason: display.degradationReason,
  };
}
