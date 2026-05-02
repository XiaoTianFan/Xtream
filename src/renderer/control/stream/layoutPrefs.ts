import type { StreamSurfaceRefs } from './streamTypes';
import { notifyStreamWorkspaceSharedDimsChanged } from '../shared/workspacePaneTwinSync';

export const STREAM_LAYOUT_PREF_KEY = 'xtream.control.stream.layout.v1';

/** Matches `.stream-middle` first-column minimum in control.css */
export const STREAM_MEDIA_COL_MIN_PX = 260;
/** Matches `.stream-middle` third-column minimum — list/flow must keep this much width. */
export const STREAM_WORKSPACE_COL_MIN_PX = 200;
const STREAM_MIDDLE_SPLITTER_PX = 4;

export type StreamLayoutPrefs = {
  mediaWidthPx?: number;
  bottomHeightPx?: number;
  assetPreviewHeightPx?: number;
};

export function clampStreamLayout(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Largest media column width that still leaves `STREAM_WORKSPACE_COL_MIN_PX` for list/flow (horizontal layout). */
export function maxStreamMediaWidthForRoot(rootWidthPx: number): number {
  return Math.max(STREAM_MEDIA_COL_MIN_PX, rootWidthPx - STREAM_MIDDLE_SPLITTER_PX - STREAM_WORKSPACE_COL_MIN_PX);
}

export function clampStreamMediaWidthToRoot(rootWidthPx: number, requestedPx: number): number {
  return clampStreamLayout(requestedPx, STREAM_MEDIA_COL_MIN_PX, maxStreamMediaWidthForRoot(rootWidthPx));
}

export function readStreamLayoutPrefs(): StreamLayoutPrefs {
  try {
    return JSON.parse(localStorage.getItem(STREAM_LAYOUT_PREF_KEY) ?? '{}') as StreamLayoutPrefs;
  } catch {
    return {};
  }
}

/** Merge stream-stored layout from Patch twin dimensions (no notify toward Patch). */
export function mergeStoredStreamLayoutTwinFromPatch(mediaWidthPx?: number, footerHeightAsBottomPx?: number): StreamLayoutPrefs {
  const prefs = { ...readStreamLayoutPrefs() };
  if (mediaWidthPx !== undefined) {
    prefs.mediaWidthPx = mediaWidthPx;
  }
  if (footerHeightAsBottomPx !== undefined) {
    prefs.bottomHeightPx = footerHeightAsBottomPx;
  }
  setStreamLayoutPrefsInStorage(prefs);
  return prefs;
}

export function setStreamLayoutPrefsInStorage(prefs: StreamLayoutPrefs): void {
  localStorage.setItem(STREAM_LAYOUT_PREF_KEY, JSON.stringify(prefs));
}

export function mergeStreamLayoutFromSnapshot(snapshot: StreamLayoutPrefs): void {
  if (!snapshot || Object.keys(snapshot).length === 0) {
    return;
  }
  try {
    const merged = {
      ...(JSON.parse(localStorage.getItem(STREAM_LAYOUT_PREF_KEY) ?? '{}') as Record<string, unknown>),
      ...snapshot,
    };
    localStorage.setItem(STREAM_LAYOUT_PREF_KEY, JSON.stringify(merged));
  } catch {
    localStorage.setItem(STREAM_LAYOUT_PREF_KEY, JSON.stringify(snapshot));
  }
}

export function setSeparatorAriaValue(el: HTMLElement, orientation: 'horizontal' | 'vertical', min: number, max: number, value: number): void {
  el.setAttribute('aria-orientation', orientation);
  el.setAttribute('aria-valuemin', String(Math.round(min)));
  el.setAttribute('aria-valuemax', String(Math.round(max)));
  el.setAttribute('aria-valuenow', String(Math.round(value)));
}

function readMediaWidthPxFromRoot(root: HTMLElement): number {
  const raw =
    root.style.getPropertyValue('--stream-media-width').trim() ||
    getComputedStyle(root).getPropertyValue('--stream-media-width').trim();
  if (!raw) {
    return 21 * 16;
  }
  if (raw.endsWith('px')) {
    return parseFloat(raw);
  }
  if (raw.endsWith('rem')) {
    const rem = parseFloat(raw);
    const docRem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return rem * docRem;
  }
  return 21 * 16;
}

/** Caps `--stream-media-width` so the list/flow column cannot be squeezed to zero after resize or stale prefs. */
export function reconcileStreamMediaWidthToRoot(refs: StreamSurfaceRefs): void {
  const root = refs.root;
  if (!root) {
    return;
  }
  const rootWidth = root.getBoundingClientRect().width;
  if (rootWidth <= 0) {
    return;
  }
  const current = readMediaWidthPxFromRoot(root);
  if (!Number.isFinite(current)) {
    return;
  }
  const capped = clampStreamMediaWidthToRoot(rootWidth, current);
  root.style.setProperty('--stream-media-width', `${capped}px`);
}

export function applyStreamLayoutPrefs(refs: StreamSurfaceRefs, prefs: StreamLayoutPrefs): void {
  const root = refs.root;
  if (!root) {
    return;
  }
  if (prefs.mediaWidthPx !== undefined) {
    const w = root.getBoundingClientRect().width;
    const target = w > 0 ? clampStreamMediaWidthToRoot(w, prefs.mediaWidthPx) : prefs.mediaWidthPx;
    root.style.setProperty('--stream-media-width', `${target}px`);
  }
  if (prefs.bottomHeightPx !== undefined) {
    root.style.setProperty('--stream-bottom-height', `${prefs.bottomHeightPx}px`);
  }
}

export function syncStreamSplitterAria(refs: StreamSurfaceRefs): void {
  reconcileStreamMediaWidthToRoot(refs);
  const root = refs.root;
  const media = refs.media;
  const middleSplitter = refs.streamMiddleSplitter;
  if (root && media && middleSplitter) {
    const min = STREAM_MEDIA_COL_MIN_PX;
    const max = maxStreamMediaWidthForRoot(root.getBoundingClientRect().width);
    setSeparatorAriaValue(middleSplitter, 'vertical', min, max, clampStreamLayout(media.getBoundingClientRect().width, min, max));
  }
  const bottom = refs.bottom;
  const bottomSplitter = refs.streamBottomSplitter;
  if (root && bottom && bottomSplitter) {
    const min = 220;
    const max = Math.max(260, root.getBoundingClientRect().height - 280);
    setSeparatorAriaValue(bottomSplitter, 'horizontal', min, max, clampStreamLayout(bottom.getBoundingClientRect().height, min, max));
  }
}

function installSplitter(handle: HTMLElement, axis: 'x' | 'y', onDelta: (delta: number) => void): void {
  let start = 0;
  handle.addEventListener('pointerdown', (event) => {
    start = axis === 'x' ? event.clientX : event.clientY;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }
    const current = axis === 'x' ? event.clientX : event.clientY;
    onDelta(current - start);
    start = current;
  });
  const finish = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (axis === 'x' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowRight' ? step : -step);
    }
    if (axis === 'y' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowDown' ? step : -step);
    }
  });
}

export type StreamLayoutController = {
  savePrefs: (update: StreamLayoutPrefs) => void;
  installSplitters: (requireRef: (name: string) => HTMLElement) => void;
  syncSplitterAria: () => void;
};

export function createStreamLayoutController(refs: StreamSurfaceRefs): StreamLayoutController {
  function savePrefs(update: StreamLayoutPrefs): void {
    const prefs = { ...readStreamLayoutPrefs(), ...update };
    setStreamLayoutPrefsInStorage(prefs);
    applyStreamLayoutPrefs(refs, prefs);
    syncStreamSplitterAria(refs);
    notifyStreamWorkspaceSharedDimsChanged(prefs.mediaWidthPx, prefs.bottomHeightPx);
  }

  function installSplitters(requireRef: (name: string) => HTMLElement): void {
    installSplitter(requireRef('streamMiddleSplitter'), 'x', (delta) => {
      const media = requireRef('media');
      const root = requireRef('root');
      const w = root.getBoundingClientRect().width;
      const maxM = maxStreamMediaWidthForRoot(w);
      const width = clampStreamLayout(media.getBoundingClientRect().width + delta, STREAM_MEDIA_COL_MIN_PX, maxM);
      savePrefs({ mediaWidthPx: width });
    });
    installSplitter(requireRef('streamBottomSplitter'), 'y', (delta) => {
      const bottom = requireRef('bottom');
      const root = requireRef('root');
      const height = clampStreamLayout(bottom.getBoundingClientRect().height - delta, 220, Math.max(260, root.getBoundingClientRect().height - 280));
      savePrefs({ bottomHeightPx: height });
    });
    syncStreamSplitterAria(refs);
  }

  return {
    savePrefs,
    installSplitters,
    syncSplitterAria: () => syncStreamSplitterAria(refs),
  };
}
