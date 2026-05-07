import type { AudioSourceState, DirectorState, VisualState } from '../../../../shared/types';

export type PoolSort = 'label' | 'duration' | 'status';

export function getFilteredVisuals(visuals: VisualState[], query: string, sort: PoolSort): VisualState[] {
  return visuals.filter((visual) => matchesPoolQuery(visual, query)).sort((left, right) => comparePoolItems(left, right, sort));
}

export function getFilteredAudioSources(
  sources: AudioSourceState[],
  state: DirectorState,
  query: string,
  sort: PoolSort,
): AudioSourceState[] {
  return sources
    .filter((source) => {
      const haystack =
        source.type === 'external-file'
          ? `${source.label} ${source.path ?? ''}`
          : `${source.label} ${state.visuals[source.visualId]?.label ?? source.visualId}`;
      return matchesQuery(haystack, query);
    })
    .sort((left, right) => comparePoolItems(left, right, sort));
}

export function matchesPoolQuery(item: VisualState | AudioSourceState, query: string): boolean {
  const haystack = 'path' in item ? `${item.label} ${item.path ?? ''} ${item.type}` : `${item.label} ${item.type}`;
  return matchesQuery(haystack, query);
}

export function matchesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

export function comparePoolItems<T extends { label: string; ready: boolean; durationSeconds?: number }>(
  left: T,
  right: T,
  sort: PoolSort,
): number {
  if (sort === 'duration') {
    return (left.durationSeconds ?? Number.POSITIVE_INFINITY) - (right.durationSeconds ?? Number.POSITIVE_INFINITY);
  }
  if (sort === 'status') {
    return Number(right.ready) - Number(left.ready) || left.label.localeCompare(right.label);
  }
  return left.label.localeCompare(right.label);
}
