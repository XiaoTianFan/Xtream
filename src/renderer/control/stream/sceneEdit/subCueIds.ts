import type { SubCueId } from '../../../../shared/types';

export function createNewSubCueId(): SubCueId {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sub-${hex}` as SubCueId;
}
