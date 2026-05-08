import type {
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
} from '../../../../shared/types';
import type { MediaPoolDragPayload } from '../../patch/mediaPool/dragDrop';
import { buildDefaultAudioSubCue, buildDefaultVisualSubCue } from './subCueDefaults';
import { createNewSubCueId } from './subCueIds';

export type AddMediaSubCueFromPoolResult = {
  streamState: StreamEnginePublicState;
  subCueId: SubCueId;
};

export type AddMediaSubCueFromPoolArgs = {
  stream: PersistedStreamConfig;
  sceneId: SceneId;
  directorState: DirectorState;
  payload: MediaPoolDragPayload;
};

export async function addMediaSubCueFromPool({
  stream,
  sceneId,
  directorState,
  payload,
}: AddMediaSubCueFromPoolArgs): Promise<AddMediaSubCueFromPoolResult> {
  const scene = stream.scenes[sceneId];
  if (!scene) {
    throw new Error(`Unknown stream scene: ${sceneId}`);
  }

  const subCueId = createUniqueSubCueId(scene);
  const subCue = createSubCueFromPayload(subCueId, directorState, payload);
  const nextSubCues: PersistedSceneConfig['subCues'] = {
    ...scene.subCues,
    [subCueId]: subCue,
  };
  const nextSubCueOrder = [...scene.subCueOrder, subCueId];
  const streamState = await window.xtream.stream.edit({
    type: 'update-scene',
    sceneId,
    update: {
      subCues: nextSubCues,
      subCueOrder: nextSubCueOrder,
    },
  });
  return { streamState, subCueId };
}

function createUniqueSubCueId(scene: PersistedSceneConfig): SubCueId {
  let id = createNewSubCueId();
  while (scene.subCues[id]) {
    id = createNewSubCueId();
  }
  return id;
}

function createSubCueFromPayload(
  subCueId: SubCueId,
  directorState: DirectorState,
  payload: MediaPoolDragPayload,
): PersistedSubCueConfig {
  if (payload.type === 'audio-source') {
    if (!directorState.audioSources[payload.id]) {
      throw new Error(`Unknown audio source: ${payload.id}`);
    }
    return {
      ...buildDefaultAudioSubCue(subCueId, directorState),
      audioSourceId: payload.id,
    } satisfies PersistedAudioSubCueConfig;
  }

  if (!directorState.visuals[payload.id]) {
    throw new Error(`Unknown visual: ${payload.id}`);
  }
  return {
    ...buildDefaultVisualSubCue(subCueId, directorState),
    visualId: payload.id,
  } satisfies PersistedVisualSubCueConfig;
}
