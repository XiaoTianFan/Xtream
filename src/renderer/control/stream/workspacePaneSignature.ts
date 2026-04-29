import type {
  AudioSourceId,
  DirectorState,
  PersistedStreamConfig,
  SceneId,
  VisualId,
} from '../../../shared/types';
import type { StreamMode } from './streamTypes';

function collectStreamReferencedMediaIds(stream: PersistedStreamConfig): { visuals: VisualId[]; audio: AudioSourceId[] } {
  const visualSet = new Set<VisualId>();
  const audioSet = new Set<AudioSourceId>();
  for (const sid of stream.sceneOrder) {
    const scene = stream.scenes[sid];
    if (!scene) {
      continue;
    }
    for (const scid of scene.subCueOrder) {
      const cue = scene.subCues[scid];
      if (!cue) {
        continue;
      }
      if (cue.kind === 'visual') {
        visualSet.add(cue.visualId);
      } else if (cue.kind === 'audio') {
        audioSet.add(cue.audioSourceId);
      }
    }
  }
  return {
    visuals: [...visualSet].sort((a, b) => a.localeCompare(b)),
    audio: [...audioSet].sort((a, b) => a.localeCompare(b)),
  };
}

function mediaDigestForWorkspace(director: DirectorState, stream: PersistedStreamConfig): unknown {
  const { visuals: visualIds, audio: audioIds } = collectStreamReferencedMediaIds(stream);
  return {
    visuals: visualIds.map((id) => {
      const v = director.visuals[id];
      return v
        ? {
            id: v.id,
            label: v.label,
            durationSeconds: v.durationSeconds,
            type: v.type,
            kind: v.kind,
            ready: v.ready,
          }
        : { id, missing: true };
    }),
    audioSources: audioIds.map((id) => {
      const a = director.audioSources[id];
      return a
        ? {
            id: a.id,
            label: a.label,
            durationSeconds: a.durationSeconds,
            type: a.type,
            ready: a.ready,
          }
        : { id, missing: true };
    }),
  };
}

export type StreamWorkspacePaneSignatureInput = {
  mode: StreamMode;
  stream: PersistedStreamConfig;
  expandedListSceneIds: Iterable<SceneId>;
  directorState: DirectorState;
};

/** Stable when playback/runtime or unrelated director assets change; changes when stream structure, list expansion, or stream-referenced media labels/durations change. */
export function createStreamWorkspacePaneSignature(input: StreamWorkspacePaneSignatureInput): string {
  const expanded = [...input.expandedListSceneIds].filter((id) => input.stream.scenes[id]).sort((a, b) => a.localeCompare(b));
  return JSON.stringify({
    mode: input.mode,
    stream: input.stream,
    expandedListSceneIds: expanded,
    media: mediaDigestForWorkspace(input.directorState, input.stream),
  });
}
