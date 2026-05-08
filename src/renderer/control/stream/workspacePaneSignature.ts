import type {
  AudioSourceId,
  CalculatedStreamTimeline,
  DirectorState,
  PersistedSceneConfig,
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
            playbackRate: v.playbackRate,
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
            playbackRate: a.playbackRate,
            type: a.type,
            ready: a.ready,
          }
        : { id, missing: true };
    }),
  };
}

function streamDigestForWorkspace(stream: PersistedStreamConfig): PersistedStreamConfig {
  const { flowViewport: _flowViewport, scenes, ...rest } = stream;
  return {
    ...rest,
    scenes: Object.fromEntries(
      Object.entries(scenes).map(([id, scene]) => {
        const { flow: _flow, ...sceneWithoutFlow } = scene as PersistedSceneConfig;
        return [id, sceneWithoutFlow];
      }),
    ) as PersistedStreamConfig['scenes'],
  };
}

function timelineDigestForWorkspace(timeline: CalculatedStreamTimeline | undefined): unknown {
  if (!timeline) {
    return undefined;
  }
  return {
    status: timeline.status,
    entries: Object.entries(timeline.entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sceneId, entry]) => ({
        sceneId,
        durationMs: entry.durationMs,
        startMs: entry.startMs,
        endMs: entry.endMs,
        triggerKnown: entry.triggerKnown,
      })),
    mainSegments: timeline.mainSegments?.map((segment) => ({
      threadId: segment.threadId,
      rootSceneId: segment.rootSceneId,
      startMs: segment.startMs,
      durationMs: segment.durationMs,
      endMs: segment.endMs,
    })),
    threads: timeline.threadPlan?.threads.map((thread) => ({
      threadId: thread.threadId,
      rootSceneId: thread.rootSceneId,
      rootTriggerType: thread.rootTriggerType,
      detachedReason: thread.detachedReason,
      durationMs: thread.durationMs,
      sceneIds: thread.sceneIds,
    })),
    temporarilyDisabledSceneIds: timeline.threadPlan?.temporarilyDisabledSceneIds,
  };
}

export type StreamWorkspacePaneSignatureInput = {
  mode: StreamMode;
  stream: PersistedStreamConfig;
  expandedListSceneIds: Iterable<SceneId>;
  directorState: DirectorState;
  validationMessages?: unknown;
  playbackTimelineStatus?: string;
  timeline?: CalculatedStreamTimeline;
};

/** Stable when playback/runtime or unrelated director assets change; changes when stream structure, list expansion, stream-referenced media labels/durations, or validation messages change. */
export function createStreamWorkspacePaneSignature(input: StreamWorkspacePaneSignatureInput): string {
  const expanded = [...input.expandedListSceneIds].filter((id) => input.stream.scenes[id]).sort((a, b) => a.localeCompare(b));
  return JSON.stringify({
    mode: input.mode,
    stream: streamDigestForWorkspace(input.stream),
    expandedListSceneIds: expanded,
    media: mediaDigestForWorkspace(input.directorState, input.stream),
    timeline: timelineDigestForWorkspace(input.timeline) ?? input.playbackTimelineStatus,
    validationMessages: input.validationMessages,
  });
}
