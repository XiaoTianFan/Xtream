import type { ControlProjectUiPatchLayout } from '../../../shared/types';

/** Keeps Patch and Stream workspaces aligned on media-pool column width and bottom/full-width pane height. */

export type HydratedStreamLayoutTwinSlice = { mediaWidthPx?: number; bottomHeightPx?: number };

type WorkspacePaneTwinHandlers = {
  applyStreamTwinFromPatchDimensions: (mediaWidthPx?: number, footerHeightAsBottomPx?: number) => void;
  applyPatchTwinFromStreamDimensions: (mediaWidthPx?: number, bottomHeightPx?: number) => void;
};

let handlers: WorkspacePaneTwinHandlers | undefined;

/** Non-zero while applying one side toward the twin to suppress ping-pong. */
let mirrorDepth = 0;

export function registerWorkspacePaneTwinSync(next: WorkspacePaneTwinHandlers): void {
  handlers = next;
}

function isMirrorBusy(): boolean {
  return mirrorDepth > 0;
}

export function notifyPatchWorkspaceSharedDimsChanged(mediaWidthPx: number | undefined, footerHeightPx: number | undefined): void {
  const h = handlers;
  if (!h || isMirrorBusy()) {
    return;
  }
  mirrorDepth++;
  try {
    h.applyStreamTwinFromPatchDimensions(mediaWidthPx, footerHeightPx);
  } finally {
    mirrorDepth--;
  }
}

export function notifyStreamWorkspaceSharedDimsChanged(mediaWidthPx: number | undefined, bottomHeightPx: number | undefined): void {
  const h = handlers;
  if (!h || isMirrorBusy()) {
    return;
  }
  mirrorDepth++;
  try {
    h.applyPatchTwinFromStreamDimensions(mediaWidthPx, bottomHeightPx);
  } finally {
    mirrorDepth--;
  }
}

/**
 * After hydrating Patch + Stream project UI, resolve a single canonical size for shared panes so an old mismatch
 * in the snapshot does not leave the two workspaces out of sync.
 */
export function reconcileHydratedWorkspacePaneTwin(
  patch?: ControlProjectUiPatchLayout,
  streamLayout?: HydratedStreamLayoutTwinSlice,
): void {
  const h = handlers;
  if (!h) {
    return;
  }
  const media = patch?.mediaWidthPx ?? streamLayout?.mediaWidthPx;
  const bottomTwin = patch?.footerHeightPx ?? streamLayout?.bottomHeightPx;
  if (media === undefined && bottomTwin === undefined) {
    return;
  }
  mirrorDepth++;
  try {
    h.applyPatchTwinFromStreamDimensions(media, bottomTwin);
    h.applyStreamTwinFromPatchDimensions(media, bottomTwin);
  } finally {
    mirrorDepth--;
  }
}
