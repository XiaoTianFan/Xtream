import type {
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedSubCueConfig,
  PersistedVisualSubCueConfig,
  SubCueId,
} from './types';

type LinkedTimingField =
  | 'sourceStartMs'
  | 'sourceEndMs'
  | 'durationOverrideMs'
  | 'fadeIn'
  | 'fadeOut'
  | 'loop'
  | 'pass'
  | 'innerLoop'
  | 'playbackRate'
  | 'startOffsetMs';

const LINKED_TIMING_FIELDS: LinkedTimingField[] = [
  'sourceStartMs',
  'sourceEndMs',
  'durationOverrideMs',
  'fadeIn',
  'fadeOut',
  'loop',
  'pass',
  'innerLoop',
  'playbackRate',
  'startOffsetMs',
];

type AudioTimingPatch = Partial<Pick<PersistedAudioSubCueConfig, LinkedTimingField>>;
type VisualTimingPatch = Partial<Pick<PersistedVisualSubCueConfig, LinkedTimingField>>;

export type TimingLinkPair = {
  visualSubCueId: SubCueId;
  audioSubCueId: SubCueId;
};

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function pickLinkedTimingFields<T extends Partial<PersistedSubCueConfig>>(update: T): Partial<T> {
  const picked: Partial<T> = {};
  for (const field of LINKED_TIMING_FIELDS) {
    if (hasOwn(update, field)) {
      (picked as Record<string, unknown>)[field] = (update as Record<string, unknown>)[field];
    }
  }
  return picked;
}

export function hasLinkedTimingFields(update: Partial<PersistedSubCueConfig>): boolean {
  return LINKED_TIMING_FIELDS.some((field) => hasOwn(update, field));
}

export function copyVisualTimingToAudio(sub: PersistedVisualSubCueConfig): AudioTimingPatch {
  return pickLinkedTimingFields(sub) as AudioTimingPatch;
}

export function copyAudioTimingToVisual(sub: PersistedAudioSubCueConfig): VisualTimingPatch {
  return pickLinkedTimingFields(sub) as VisualTimingPatch;
}

export function visualTimingPatchToAudio(update: Partial<PersistedVisualSubCueConfig>): AudioTimingPatch {
  return pickLinkedTimingFields(update) as AudioTimingPatch;
}

export function audioTimingPatchToVisual(update: Partial<PersistedAudioSubCueConfig>): VisualTimingPatch {
  return pickLinkedTimingFields(update) as VisualTimingPatch;
}

export function findEligibleEmbeddedAudioTimingSubCueId(
  scene: PersistedSceneConfig,
  state: DirectorState,
  visualSubCueId: SubCueId,
): SubCueId | undefined {
  const visualSub = scene.subCues[visualSubCueId];
  if (!visualSub || visualSub.kind !== 'visual') {
    return undefined;
  }
  const visual = state.visuals[visualSub.visualId];
  if (!visual || visual.kind !== 'file' || visual.type !== 'video') {
    return undefined;
  }

  const matches = scene.subCueOrder.filter((sid) => {
    const sub = scene.subCues[sid];
    if (!sub || sub.kind !== 'audio') {
      return false;
    }
    const source = state.audioSources[sub.audioSourceId];
    return source?.type === 'embedded-visual' && source.visualId === visualSub.visualId;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function getActiveTimingLinkPair(
  scene: PersistedSceneConfig,
  state: DirectorState,
  subCueId: SubCueId,
): TimingLinkPair | undefined {
  const sub = scene.subCues[subCueId];
  if (!sub || (sub.kind !== 'visual' && sub.kind !== 'audio') || !sub.linkedTimingSubCueId) {
    return undefined;
  }

  const other = scene.subCues[sub.linkedTimingSubCueId];
  if (!other || (other.kind !== 'visual' && other.kind !== 'audio') || other.linkedTimingSubCueId !== subCueId) {
    return undefined;
  }

  const visualSubCueId = sub.kind === 'visual' ? subCueId : sub.linkedTimingSubCueId;
  const audioSubCueId = sub.kind === 'audio' ? subCueId : sub.linkedTimingSubCueId;
  const eligibleAudioSubCueId = findEligibleEmbeddedAudioTimingSubCueId(scene, state, visualSubCueId);
  return eligibleAudioSubCueId === audioSubCueId ? { visualSubCueId, audioSubCueId } : undefined;
}

export function clearTimingLinksForRemovedSubCue(scene: PersistedSceneConfig, removedSubCueId: SubCueId): PersistedSceneConfig['subCues'] {
  const next: PersistedSceneConfig['subCues'] = {};
  for (const [sid, sub] of Object.entries(scene.subCues) as Array<[SubCueId, PersistedSubCueConfig]>) {
    if (sid === removedSubCueId) {
      continue;
    }
    if ((sub.kind === 'audio' || sub.kind === 'visual') && sub.linkedTimingSubCueId === removedSubCueId) {
      next[sid] = { ...sub, linkedTimingSubCueId: undefined } as PersistedSubCueConfig;
    } else {
      next[sid] = sub;
    }
  }
  return next;
}

export function normalizeSceneTimingLinks(scene: PersistedSceneConfig): void {
  for (const [sid, sub] of Object.entries(scene.subCues) as Array<[SubCueId, PersistedSubCueConfig]>) {
    if (sub.kind !== 'audio' && sub.kind !== 'visual') {
      continue;
    }
    const linkedId = sub.linkedTimingSubCueId;
    if (!linkedId) {
      continue;
    }
    const other = scene.subCues[linkedId];
    if (!other || (other.kind !== 'audio' && other.kind !== 'visual') || other.linkedTimingSubCueId !== sid || other.kind === sub.kind) {
      sub.linkedTimingSubCueId = undefined;
    }
  }
}
