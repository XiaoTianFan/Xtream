import type { VisualState } from '../../../shared/types';

const thumbDataUrlByKey = new Map<string, string>();
const MAX_CACHE_ENTRIES = 180;

export function visualPoolThumbCacheKey(visual: VisualState): string {
  if (visual.kind === 'live') {
    return `live:${visual.id}`;
  }
  return `file:${visual.id}:${visual.type}:${visual.url ?? ''}`;
}

export function getVisualPoolThumbDataUrl(visual: VisualState): string | undefined {
  return thumbDataUrlByKey.get(visualPoolThumbCacheKey(visual));
}

export function setVisualPoolThumbDataUrl(visual: VisualState, dataUrl: string): void {
  const key = visualPoolThumbCacheKey(visual);
  if (thumbDataUrlByKey.size >= MAX_CACHE_ENTRIES && !thumbDataUrlByKey.has(key)) {
    const oldest = thumbDataUrlByKey.keys().next().value as string | undefined;
    if (oldest) {
      thumbDataUrlByKey.delete(oldest);
    }
  }
  thumbDataUrlByKey.set(key, dataUrl);
}
