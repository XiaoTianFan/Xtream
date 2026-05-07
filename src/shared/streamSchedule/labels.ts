import type {
  PersistedAudioSubCueConfig,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SubCueId,
} from '../types';
import type { ValidateStreamContentContext } from './types';

/** Operator-facing scene label: titled scenes use quotes; otherwise cue number in stream order. */
export function scenePrimaryLabel(stream: PersistedStreamConfig, sceneId: SceneId): string {
  const scene = stream.scenes[sceneId];
  const t = scene?.title?.trim();
  if (t) {
    return `Scene "${t}"`;
  }
  const n = stream.sceneOrder.indexOf(sceneId);
  if (n >= 0) {
    return `Scene ${n + 1}`;
  }
  return `Scene ${sceneId}`;
}

export function subCueOrdinalKind(
  stream: PersistedStreamConfig,
  sceneId: SceneId,
  subCueId: SubCueId,
  kind: 'audio' | 'visual' | 'control',
): string {
  const scene = stream.scenes[sceneId];
  const idx = scene?.subCueOrder.indexOf(subCueId) ?? -1;
  const ord = idx >= 0 ? idx + 1 : 0;
  const kindWord = kind === 'audio' ? 'audio' : kind === 'visual' ? 'visual' : 'control';
  return ord > 0 ? `${kindWord} sub-cue no.${ord}` : `${kindWord} sub-cue`;
}

export function audioSubCueValidationLabel(
  sub: PersistedAudioSubCueConfig,
  context: Pick<ValidateStreamContentContext, 'audioSourceLabels'>,
): string {
  const name = context.audioSourceLabels?.get(sub.audioSourceId) ?? sub.audioSourceId;
  return `Audio | ${name}`;
}

export function visualSubCueValidationLabel(
  sub: PersistedVisualSubCueConfig,
  context: Pick<ValidateStreamContentContext, 'visualLabels'>,
): string {
  const name = context.visualLabels?.get(sub.visualId) ?? sub.visualId;
  return `Visual | ${name}`;
}

export function computeSceneNumbers(sceneOrder: SceneId[]): Record<SceneId, number> {
  const map: Record<SceneId, number> = {};
  sceneOrder.forEach((id, index) => {
    map[id] = index + 1;
  });
  return map;
}
