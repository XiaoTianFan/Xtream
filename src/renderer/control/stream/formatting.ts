import { formatTimecode } from '../../../shared/timeline';
import { estimateSceneDurationMs, resolveFollowsSceneId } from '../../../shared/streamSchedule';
import type {
  AudioSourceId,
  DirectorState,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  SceneRuntimeState,
  VisualId,
} from '../../../shared/types';

export function formatTriggerSummary(stream: PersistedStreamConfig, scene: PersistedSceneConfig): string {
  const t = scene.trigger;
  if (t.type === 'manual') {
    return 'Manual';
  }
  if (t.type === 'at-timecode') {
    return `At ${formatTimecode(t.timecodeMs / 1000)}`;
  }
  const pred = resolveFollowsSceneId(stream, scene.id, t);
  const predLabel = pred ? stream.scenes[pred]?.title ?? pred : 'previous';
  if (t.type === 'time-offset') {
    return `+${(t.offsetMs / 1000).toFixed(2)}s · ${predLabel}`;
  }
  if (t.type === 'simultaneous-start') {
    return `With start · ${predLabel}`;
  }
  if (t.type === 'follow-end') {
    return `After end · ${predLabel}`;
  }
  return 'Trigger';
}

export function formatSceneDuration(state: DirectorState | undefined, scene: PersistedSceneConfig): string {
  if (!state || scene.subCueOrder.length === 0) {
    return '--';
  }
  const durationMs = estimateSceneDurationMs(scene, getVisualDurationMap(state), getAudioDurationMap(state));
  return durationMs === undefined ? '-- / live' : formatTimecode(durationMs / 1000);
}

export function getSubCueDurationSeconds(state: DirectorState | undefined, sub: PersistedSubCueConfig | undefined): number | undefined {
  if (!sub || !state) {
    return undefined;
  }
  if (sub.kind === 'visual') {
    return state.visuals[sub.visualId]?.durationSeconds;
  }
  if (sub.kind === 'audio') {
    return state.audioSources[sub.audioSourceId]?.durationSeconds;
  }
  return 0;
}

export function formatSubCueLabel(state: DirectorState | undefined, sub: PersistedSubCueConfig): string {
  if (sub.kind === 'visual') {
    return `Visual | ${state?.visuals[sub.visualId]?.label ?? sub.visualId}`;
  }
  if (sub.kind === 'audio') {
    return `Audio | ${state?.audioSources[sub.audioSourceId]?.label ?? sub.audioSourceId}`;
  }
  return `Control | ${sub.action.type}`;
}

export function formatSceneStateLabel(runtimeState: SceneRuntimeState | undefined, scene: PersistedSceneConfig): string {
  if (scene.disabled) {
    return 'disabled';
  }
  if (runtimeState?.status) {
    return runtimeState.status;
  }
  return 'ready';
}

function getVisualDurationMap(state: DirectorState): Record<VisualId, number> {
  return Object.fromEntries(
    Object.values(state.visuals).flatMap((visual) => (visual.durationSeconds !== undefined ? [[visual.id, visual.durationSeconds]] : [])),
  );
}

function getAudioDurationMap(state: DirectorState): Record<AudioSourceId, number> {
  return Object.fromEntries(
    Object.values(state.audioSources).flatMap((source) => (source.durationSeconds !== undefined ? [[source.id, source.durationSeconds]] : [])),
  );
}
