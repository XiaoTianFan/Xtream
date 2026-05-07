import type { AudioSourceId, PersistedSceneConfig, PersistedStreamConfig, VisualId } from '../types';
import { resolveLoopTiming } from '../streamLoopTiming';
import { getAudioSubCueBaseDurationMs } from '../audioSubCueAutomation';

function subCueBaseDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  let base: number | undefined;
  if (sub.kind === 'visual') {
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const d = visualDurations[sub.visualId];
    if (d === undefined && sub.durationOverrideMs === undefined) {
      return undefined;
    }
    base = d === undefined ? sub.durationOverrideMs : (d * 1000) / rate;
  } else if (sub.kind === 'audio') {
    const d = audioDurations[sub.audioSourceId];
    base = getAudioSubCueBaseDurationMs(sub, d);
    if (base === undefined) {
      return undefined;
    }
  } else {
    return 0;
  }
  if (base === undefined) {
    return undefined;
  }
  if (sub.durationOverrideMs !== undefined) {
    base = Math.min(base, sub.durationOverrideMs);
  }
  return base;
}

function subCueEffectiveDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  const base = subCueBaseDurationMs(sub, visualDurations, audioDurations);
  if (base === undefined) {
    return undefined;
  }
  const loopTiming = sub.kind === 'control' ? resolveLoopTiming(undefined, base) : resolveLoopTiming(sub.loop, base);
  return loopTiming.totalDurationMs === undefined ? undefined : (sub.startOffsetMs ?? 0) + loopTiming.totalDurationMs;
}

/** Longest sub-cue effective duration; undefined if any contributing sub-cue duration is unknown. */
export function estimateSceneDurationMs(
  scene: PersistedSceneConfig,
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  if (scene.disabled) {
    return 0;
  }
  let max = 0;
  let unknown = false;
  for (const id of scene.subCueOrder) {
    const sub = scene.subCues[id];
    if (!sub) {
      continue;
    }
    const eff = subCueEffectiveDurationMs(sub, visualDurations, audioDurations);
    if (eff === undefined) {
      unknown = true;
      continue;
    }
    max = Math.max(max, eff);
  }
  if (unknown) {
    return undefined;
  }
  const sceneTiming = resolveLoopTiming(scene.loop, max);
  return sceneTiming.totalDurationMs;
}

/**
 * For streams where every scene is manual and non-overlapping, sum scene durations.
 * Returns undefined if any scene duration is unknown or triggers create overlap (not handled in v1 skeleton).
 */
export function estimateLinearManualStreamDurationMs(
  stream: PersistedStreamConfig,
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  let total = 0;
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene || scene.disabled) {
      continue;
    }
    if (scene.trigger.type !== 'manual') {
      return undefined;
    }
    const d = estimateSceneDurationMs(scene, visualDurations, audioDurations);
    if (d === undefined) {
      return undefined;
    }
    total += d;
  }
  return total;
}
