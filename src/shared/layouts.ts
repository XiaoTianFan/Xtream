import type { DisplayWindowState, LayoutProfile, SlotId } from './types';

export const DEFAULT_SLOT_IDS = ['A', 'B'] as const;

export function createSingleLayout(slot: SlotId): LayoutProfile {
  return { type: 'single', slot };
}

export function createSplitLayout(leftSlot: SlotId, rightSlot: SlotId): LayoutProfile {
  return { type: 'split', slots: [leftSlot, rightSlot] };
}

export function describeLayout(layout: LayoutProfile): string {
  if (layout.type === 'single') {
    return `single: ${layout.slot}`;
  }

  return `split: ${layout.slots.join(' + ')}`;
}

export function getLayoutSlots(layout: LayoutProfile): SlotId[] {
  return layout.type === 'single' ? [layout.slot] : [...layout.slots];
}

export function getActiveDisplays(displays: Record<string, DisplayWindowState>): DisplayWindowState[] {
  return Object.values(displays)
    .filter((display) => display.health !== 'closed')
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getMode1TargetLayout(): LayoutProfile {
  return createSplitLayout(DEFAULT_SLOT_IDS[0], DEFAULT_SLOT_IDS[1]);
}

export function getMode2TargetLayouts(): [LayoutProfile, LayoutProfile] {
  return [createSingleLayout(DEFAULT_SLOT_IDS[0]), createSingleLayout(DEFAULT_SLOT_IDS[1])];
}

export function getMode3TargetLayouts(): [LayoutProfile, LayoutProfile] {
  return getMode2TargetLayouts();
}
