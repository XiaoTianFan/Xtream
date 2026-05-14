import type { PersistedSceneConfig, SubCueId } from '../../../../shared/types';
import { clearTimingLinksForRemovedSubCue } from '../../../../shared/subCueTimingLink';

export function createRemoveSubCuePatch(scene: PersistedSceneConfig, subCueId: SubCueId): Pick<PersistedSceneConfig, 'subCueOrder' | 'subCues'> {
  return {
    subCueOrder: scene.subCueOrder.filter((sid) => sid !== subCueId),
    subCues: clearTimingLinksForRemovedSubCue(scene, subCueId),
  };
}
