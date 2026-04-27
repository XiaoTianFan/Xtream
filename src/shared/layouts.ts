import type { DisplayWindowState, VisualId, VisualLayoutProfile } from './types';

export function createSingleLayout(visualId?: VisualId): VisualLayoutProfile {
  return { type: 'single', visualId };
}

export function createSplitLayout(leftVisualId?: VisualId, rightVisualId?: VisualId): VisualLayoutProfile {
  return { type: 'split', visualIds: [leftVisualId, rightVisualId] };
}

export function describeLayout(layout: VisualLayoutProfile): string {
  if (layout.type === 'single') {
    return `single: ${layout.visualId ?? 'none'}`;
  }

  return `split: ${layout.visualIds.map((visualId) => visualId ?? 'none').join(' + ')}`;
}

export function getLayoutVisualIds(layout: VisualLayoutProfile): VisualId[] {
  return layout.type === 'single' ? (layout.visualId ? [layout.visualId] : []) : layout.visualIds.filter(Boolean) as VisualId[];
}

export function getActiveDisplays(displays: Record<string, DisplayWindowState>): DisplayWindowState[] {
  return Object.values(displays)
    .filter((display) => display.health !== 'closed')
    .sort((left, right) => left.id.localeCompare(right.id));
}
