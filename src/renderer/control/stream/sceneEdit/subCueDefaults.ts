import { PATCH_COMPAT_SCENE_ID } from '../../../../shared/streamWorkspace';
import type {
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedControlSubCueConfig,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SubCueId,
} from '../../../../shared/types';
/** Default visual mingle for new display targets uses full single zone per display entry. */

export function buildDefaultAudioSubCue(
  id: SubCueId,
  state: DirectorState,
): PersistedAudioSubCueConfig {
  const outputIds = Object.keys(state.outputs);
  const firstOutput = outputIds[0] ?? '';
  const firstAudio =
    Object.values(state.audioSources).find((a) => a.id)?.id ?? Object.keys(state.audioSources)[0] ?? '';

  return {
    id,
    kind: 'audio',
    audioSourceId: firstAudio,
    outputIds: firstOutput ? [firstOutput] : [],
    playbackRate: 1,
  };
}

export function buildDefaultVisualSubCue(id: SubCueId, state: DirectorState): PersistedVisualSubCueConfig {
  const firstVisual = Object.keys(state.visuals)[0];
  const targets =
    Object.values(state.displays).length > 0
      ? Object.values(state.displays).map((d) => ({
          displayId: d.id,
          zoneId: d.layout.type === 'split' ? ('L' as const) : undefined,
        }))
      : [];

  return {
    id,
    kind: 'visual',
    visualId: firstVisual ?? '',
    targets,
    playbackRate: 1,
  };
}

export function buildDefaultControlSubCue(stream: PersistedStreamConfig, sceneId: SceneId, id: SubCueId): PersistedControlSubCueConfig {
  const fallbackScene =
    stream.sceneOrder.find((sid) => sid !== PATCH_COMPAT_SCENE_ID && sid !== sceneId && stream.scenes[sid]) ?? stream.sceneOrder.find((sid) => sid !== sceneId && stream.scenes[sid]);

  const targetSceneOrSelf = fallbackScene ?? stream.sceneOrder.find((sid) => stream.scenes[sid]);

  const actionScene = targetSceneOrSelf ?? sceneId;

  return {
    id,
    kind: 'control',
    action: { type: 'stop-scene', sceneId: actionScene },
  };
}
