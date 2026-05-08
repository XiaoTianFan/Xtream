import type { AudioSourceId, PersistedSceneConfig, PersistedStreamConfig, VisualId } from '../types';
import { resolveLoopTiming } from '../streamLoopTiming';
import { resolveSubCuePassLoopTiming } from '../subCuePassLoopTiming';
import { getAudioSubCueBaseDurationMs, type AudioSubCueMediaInfo } from '../audioSubCueAutomation';
import { getVisualSubCueBaseDurationMs, type VisualSubCueMediaInfo } from '../visualSubCueTiming';

export type StreamDurationClassification = 'finite' | 'indefinite-loop' | 'unknown-error';

export type SceneDurationEstimate = {
  classification: StreamDurationClassification;
  durationMs?: number;
};

function isInfiniteLoop(policy: PersistedSceneConfig['loop'] | undefined): boolean {
  return Boolean(policy?.enabled && policy.iterations.type === 'infinite');
}

function subCueBaseDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
  visualMedia: Record<VisualId, VisualSubCueMediaInfo> = {},
  audioMedia: Record<AudioSourceId, AudioSubCueMediaInfo> = {},
): number | undefined {
  let base: number | undefined;
  if (sub.kind === 'visual') {
    base = getVisualSubCueBaseDurationMs(sub, visualMedia[sub.visualId], visualDurations[sub.visualId]);
  } else if (sub.kind === 'audio') {
    const source = audioMedia[sub.audioSourceId];
    const d = source?.durationSeconds ?? audioDurations[sub.audioSourceId];
    base = getAudioSubCueBaseDurationMs(sub, d, source?.playbackRate);
    if (base === undefined) {
      return undefined;
    }
  } else {
    return 0;
  }
  if (base === undefined) {
    return undefined;
  }
  if (sub.kind !== 'visual' && sub.durationOverrideMs !== undefined) {
    base = Math.min(base, sub.durationOverrideMs);
  }
  return base;
}

function classifySubCueEffectiveDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
  visualMedia: Record<VisualId, VisualSubCueMediaInfo> = {},
  audioMedia: Record<AudioSourceId, AudioSubCueMediaInfo> = {},
): SceneDurationEstimate {
  const base = subCueBaseDurationMs(sub, visualDurations, audioDurations, visualMedia, audioMedia);
  if (base === undefined) {
    return { classification: 'unknown-error' };
  }
  if (sub.kind === 'control') {
    const loopTiming = resolveLoopTiming(undefined, base);
    return loopTiming.totalDurationMs === undefined
      ? { classification: 'unknown-error' }
      : { classification: 'finite', durationMs: (sub.startOffsetMs ?? 0) + loopTiming.totalDurationMs };
  }
  const timing = resolveSubCuePassLoopTiming({
    pass: sub.pass,
    innerLoop: sub.innerLoop,
    legacyLoop: sub.loop,
    baseDurationMs: base,
  });
  return timing.totalDurationMs === undefined
    ? { classification: 'indefinite-loop' }
    : { classification: 'finite', durationMs: (sub.startOffsetMs ?? 0) + timing.totalDurationMs };
}

/** Classifies scene duration without turning infinite loops into timeline errors. */
export function classifySceneDurationMs(
  scene: PersistedSceneConfig,
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
  visualMedia: Record<VisualId, VisualSubCueMediaInfo> = {},
  audioMedia: Record<AudioSourceId, AudioSubCueMediaInfo> = {},
): SceneDurationEstimate {
  if (scene.disabled) {
    return { classification: 'finite', durationMs: 0 };
  }
  let max = 0;
  let hasIndefiniteLoop = false;
  for (const id of scene.subCueOrder) {
    const sub = scene.subCues[id];
    if (!sub) {
      continue;
    }
    const eff = classifySubCueEffectiveDurationMs(sub, visualDurations, audioDurations, visualMedia, audioMedia);
    if (eff.classification === 'unknown-error') {
      return { classification: 'unknown-error' };
    }
    if (eff.classification === 'indefinite-loop') {
      hasIndefiniteLoop = true;
      continue;
    }
    max = Math.max(max, eff.durationMs ?? 0);
  }
  if (hasIndefiniteLoop || isInfiniteLoop(scene.loop)) {
    return { classification: 'indefinite-loop' };
  }
  const sceneTiming = resolveLoopTiming(scene.loop, max);
  return sceneTiming.totalDurationMs === undefined
    ? { classification: 'unknown-error' }
    : { classification: 'finite', durationMs: sceneTiming.totalDurationMs };
}

/** Longest sub-cue effective duration; undefined if any contributing sub-cue duration is unknown. */
export function estimateSceneDurationMs(
  scene: PersistedSceneConfig,
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
  visualMedia: Record<VisualId, VisualSubCueMediaInfo> = {},
  audioMedia: Record<AudioSourceId, AudioSubCueMediaInfo> = {},
): number | undefined {
  const classified = classifySceneDurationMs(scene, visualDurations, audioDurations, visualMedia, audioMedia);
  return classified.classification === 'finite' ? classified.durationMs : undefined;
}

/**
 * For streams where every scene is manual and non-overlapping, sum scene durations.
 * Returns undefined if any scene duration is unknown or triggers create overlap (not handled in v1 skeleton).
 */
export function estimateLinearManualStreamDurationMs(
  stream: PersistedStreamConfig,
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
  visualMedia: Record<VisualId, VisualSubCueMediaInfo> = {},
  audioMedia: Record<AudioSourceId, AudioSubCueMediaInfo> = {},
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
    const d = estimateSceneDurationMs(scene, visualDurations, audioDurations, visualMedia, audioMedia);
    if (d === undefined) {
      return undefined;
    }
    total += d;
  }
  return total;
}
