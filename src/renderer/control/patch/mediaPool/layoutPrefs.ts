import type { VisualPoolLayout } from './types';

const VISUAL_POOL_LAYOUT_STORAGE_KEY = 'xtream.visualPoolLayout';

export function readStoredVisualPoolLayout(): VisualPoolLayout {
  try {
    const v = localStorage.getItem(VISUAL_POOL_LAYOUT_STORAGE_KEY);
    if (v === 'grid' || v === 'list') {
      return v;
    }
  } catch {
    /* ignore */
  }
  return 'list';
}

export function persistVisualPoolLayout(layout: VisualPoolLayout): void {
  try {
    localStorage.setItem(VISUAL_POOL_LAYOUT_STORAGE_KEY, layout);
  } catch {
    /* ignore */
  }
}
