import { formatTimecode } from '../../../shared/timeline';
import { estimateSceneDurationMs, resolveFollowsSceneId } from '../../../shared/streamSchedule';
import type {
  AudioSourceId,
  CalculatedStreamTimeline,
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
  if (t.type === 'follow-start') {
    const d = t.delayMs ?? 0;
    return d > 0 ? `+${(d / 1000).toFixed(2)}s after start · ${predLabel}` : `With start · ${predLabel}`;
  }
  if (t.type === 'follow-end') {
    const d = t.delayMs ?? 0;
    return d > 0 ? `+${(d / 1000).toFixed(2)}s after end · ${predLabel}` : `After end · ${predLabel}`;
  }
  return 'Trigger';
}

type SceneDurationTimeline = Pick<CalculatedStreamTimeline, 'entries'> | undefined;

export function formatSceneDuration(state: DirectorState | undefined, scene: PersistedSceneConfig, timeline?: SceneDurationTimeline): string {
  if (scene.subCueOrder.length === 0) {
    return '--';
  }
  const timelineEntry = timeline?.entries[scene.id];
  if (timelineEntry) {
    return timelineEntry.durationMs === undefined ? '-- / live' : formatTimecode(timelineEntry.durationMs / 1000);
  }
  if (!state) {
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
    if (runtimeState.status === 'error') {
      return 'error';
    }
    return runtimeState.status;
  }
  return 'ready';
}

/**
 * Stream scene list row: same as formatSceneStateLabel except baseline `ready` (including when
 * runtime is absent) becomes `error` when authoring validators flag the scene, matching
 * StreamEngine.applyAuthoringErrorOverlay.
 */
export function sceneListRowRuntimeStatus(
  runtimeState: SceneRuntimeState | undefined,
  scene: PersistedSceneConfig,
  authoringSceneError: boolean,
): SceneRuntimeState['status'] | 'disabled' {
  if (scene.disabled) {
    return 'disabled';
  }
  const st = runtimeState?.status ?? 'ready';
  if (st === 'error' || (authoringSceneError && st === 'ready')) {
    return 'error';
  }
  return st;
}

export function formatSceneStateLabelForSceneList(
  runtimeState: SceneRuntimeState | undefined,
  scene: PersistedSceneConfig,
  authoringSceneError: boolean,
): string {
  return sceneListRowRuntimeStatus(runtimeState, scene, authoringSceneError);
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
