import type { DisplayWindowState } from './types';

/** OS window / document title for a display projector window (label or internal id). */
export function formatDisplayWindowTitle(state: Pick<DisplayWindowState, 'id' | 'label'>): string {
  const trimmed = state.label?.trim();
  const name = trimmed ? trimmed : state.id;
  return `Xtream Display — ${name}`;
}
