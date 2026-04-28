import type {
  AudioSourceId,
  DisplayZoneId,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SceneTrigger,
  VisualId,
  VirtualOutputId,
} from './types';
import { PATCH_COMPAT_SCENE_ID } from './streamWorkspace';

export type ValidateStreamContentContext = {
  visuals?: ReadonlySet<VisualId>;
  audioSources?: ReadonlySet<AudioSourceId>;
  outputs?: ReadonlySet<VirtualOutputId>;
  displayZones?: ReadonlyMap<string, ReadonlySet<DisplayZoneId>>;
  audioSourceLabels?: ReadonlyMap<AudioSourceId, string>;
  visualLabels?: ReadonlyMap<VisualId, string>;
};

function sceneContentLabel(scene: PersistedSceneConfig, sceneId: SceneId): string {
  const t = scene.title?.trim();
  return t ? `"${t}"` : sceneId;
}

function audioSubCueValidationLabel(
  sub: PersistedAudioSubCueConfig,
  context: Pick<ValidateStreamContentContext, 'audioSourceLabels'>,
): string {
  const name = context.audioSourceLabels?.get(sub.audioSourceId) ?? sub.audioSourceId;
  return `Audio | ${name}`;
}

function visualSubCueValidationLabel(
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

/** Resolve implicit followsSceneId: previous row in sceneOrder when omitted. */
export function resolveFollowsSceneId(stream: PersistedStreamConfig, sceneId: SceneId, trigger: SceneTrigger): SceneId | undefined {
  if (trigger.type === 'manual' || trigger.type === 'at-timecode') {
    return undefined;
  }
  if (trigger.followsSceneId) {
    return trigger.followsSceneId;
  }
  const idx = stream.sceneOrder.indexOf(sceneId);
  if (idx <= 0) {
    return undefined;
  }
  return stream.sceneOrder[idx - 1];
}

export function validateStreamStructure(stream: PersistedStreamConfig): string[] {
  const messages: string[] = [];
  const seen = new Set<SceneId>();
  for (const id of stream.sceneOrder) {
    if (seen.has(id)) {
      messages.push(`Duplicate scene id in sceneOrder: ${id}`);
    }
    seen.add(id);
    if (!stream.scenes[id]) {
      messages.push(`sceneOrder references missing scene: ${id}`);
    }
  }
  for (const id of Object.keys(stream.scenes)) {
    if (!seen.has(id)) {
      messages.push(`Scene ${id} is not listed in sceneOrder`);
    }
    if (stream.scenes[id].id !== id) {
      messages.push(`Scene record id mismatch for ${id}`);
    }
  }
  return messages;
}

/** Directed edges: follower -> predecessor (follower waits on predecessor). */
export function buildTriggerDependencyEdges(stream: PersistedStreamConfig): Array<{ from: SceneId; to: SceneId }> {
  const edges: Array<{ from: SceneId; to: SceneId }> = [];
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene || scene.disabled) {
      continue;
    }
    const pred = resolveFollowsSceneId(stream, sceneId, scene.trigger);
    if (pred) {
      edges.push({ from: sceneId, to: pred });
    }
  }
  return edges;
}

export function hasTriggerCycle(stream: PersistedStreamConfig): boolean {
  const edges = buildTriggerDependencyEdges(stream);
  const adj = new Map<SceneId, SceneId[]>();
  for (const { from, to } of edges) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const visiting = new Set<SceneId>();
  const visited = new Set<SceneId>();

  function dfs(node: SceneId): boolean {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const id of stream.sceneOrder) {
    if (dfs(id)) {
      return true;
    }
  }
  return false;
}

export function validateTriggerReferences(stream: PersistedStreamConfig): string[] {
  const messages: string[] = [];
  const ids = new Set(stream.sceneOrder);
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const pred = resolveFollowsSceneId(stream, sceneId, scene.trigger);
    if (pred && !ids.has(pred)) {
      messages.push(`Scene ${sceneId} references missing predecessor ${pred}`);
    }
    if (scene.trigger.type === 'time-offset' && scene.trigger.offsetMs < 0) {
      messages.push(`Scene ${sceneId} has negative time offset`);
    }
    if (scene.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < 0) {
      messages.push(`Scene ${sceneId} has negative timecode`);
    }
  }
  if (hasTriggerCycle(stream)) {
    messages.push('Trigger dependency graph contains a cycle');
  }
  return messages;
}

export function validateStreamContent(stream: PersistedStreamConfig, context: ValidateStreamContentContext = {}): string[] {
  const messages: string[] = [];
  if (stream.sceneOrder.length === 0) {
    messages.push('Stream must contain at least one scene');
  }

  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    if (scene.loop.enabled) {
      const start = scene.loop.range?.startMs;
      const end = scene.loop.range?.endMs;
      if (start !== undefined && start < 0) {
        messages.push(`Scene ${sceneId} has negative loop start`);
      }
      if (end !== undefined && end < 0) {
        messages.push(`Scene ${sceneId} has negative loop end`);
      }
      if (start !== undefined && end !== undefined && end <= start) {
        messages.push(`Scene ${sceneId} has invalid loop range`);
      }
      if (scene.loop.iterations.type === 'count' && scene.loop.iterations.count <= 0) {
        messages.push(`Scene ${sceneId} has non-positive loop count`);
      }
    }
    if (scene.preload.leadTimeMs !== undefined && scene.preload.leadTimeMs < 0) {
      messages.push(`Scene ${sceneId} has negative preload lead time`);
    }

    const seenSubCues = new Set<string>();
    for (const subCueId of scene.subCueOrder) {
      if (seenSubCues.has(subCueId)) {
        messages.push(`Scene ${sceneId} has duplicate sub-cue id in order: ${subCueId}`);
      }
      seenSubCues.add(subCueId);
      const subCue = scene.subCues[subCueId];
      if (!subCue) {
        messages.push(`Scene ${sceneId} references missing sub-cue: ${subCueId}`);
        continue;
      }
      if (subCue.id !== subCueId) {
        messages.push(`Scene ${sceneId} sub-cue record id mismatch for ${subCueId}`);
      }
      if ('startOffsetMs' in subCue && subCue.startOffsetMs !== undefined && subCue.startOffsetMs < 0) {
        messages.push(`Scene ${sceneId} sub-cue ${subCueId} has negative start offset`);
      }
      if ('durationOverrideMs' in subCue && subCue.durationOverrideMs !== undefined && subCue.durationOverrideMs < 0) {
        messages.push(`Scene ${sceneId} sub-cue ${subCueId} has negative duration override`);
      }
      if ('playbackRate' in subCue && subCue.playbackRate !== undefined && subCue.playbackRate <= 0) {
        messages.push(`Scene ${sceneId} sub-cue ${subCueId} has non-positive playback rate`);
      }
      if (subCue.kind === 'audio') {
        if (context.audioSources && !context.audioSources.has(subCue.audioSourceId)) {
          messages.push(`Scene ${sceneId} audio sub-cue ${subCueId} references missing audio source ${subCue.audioSourceId}`);
        }
        if (sceneId !== PATCH_COMPAT_SCENE_ID && subCue.outputIds.length === 0) {
          messages.push(
            `Scene ${sceneContentLabel(scene, sceneId)}: audio sub-cue "${audioSubCueValidationLabel(subCue, context)}" has no output targets`,
          );
        }
        for (const outputId of subCue.outputIds) {
          if (context.outputs && !context.outputs.has(outputId)) {
            messages.push(`Scene ${sceneId} audio sub-cue ${subCueId} references missing output ${outputId}`);
          }
        }
      } else if (subCue.kind === 'visual') {
        if (context.visuals && !context.visuals.has(subCue.visualId)) {
          messages.push(`Scene ${sceneId} visual sub-cue ${subCueId} references missing visual ${subCue.visualId}`);
        }
        if (sceneId !== PATCH_COMPAT_SCENE_ID && subCue.targets.length === 0) {
          messages.push(
            `Scene ${sceneContentLabel(scene, sceneId)}: visual sub-cue "${visualSubCueValidationLabel(subCue, context)}" has no display targets`,
          );
        }
        for (const target of subCue.targets) {
          const zone = target.zoneId ?? 'single';
          const available = context.displayZones?.get(target.displayId);
          if (context.displayZones && !available) {
            messages.push(`Scene ${sceneId} visual sub-cue ${subCueId} references missing display ${target.displayId}`);
          } else if (available && !available.has(zone)) {
            messages.push(`Scene ${sceneId} visual sub-cue ${subCueId} references missing display zone ${target.displayId}:${zone}`);
          }
        }
      } else if (subCue.kind === 'control') {
        const action = subCue.action;
        if ('sceneId' in action && !stream.scenes[action.sceneId]) {
          messages.push(`Scene ${sceneId} control sub-cue ${subCueId} references missing scene ${action.sceneId}`);
        }
        if ('subCueRef' in action) {
          const refScene = stream.scenes[action.subCueRef.sceneId];
          if (!refScene) {
            messages.push(`Scene ${sceneId} control sub-cue ${subCueId} references missing scene ${action.subCueRef.sceneId}`);
          } else if (!refScene.subCues[action.subCueRef.subCueId]) {
            messages.push(`Scene ${sceneId} control sub-cue ${subCueId} references missing sub-cue ${action.subCueRef.subCueId}`);
          }
        }
      }
    }
    for (const subCueId of Object.keys(scene.subCues)) {
      if (!seenSubCues.has(subCueId)) {
        messages.push(`Scene ${sceneId} sub-cue ${subCueId} is not listed in subCueOrder`);
      }
    }
  }

  return messages;
}

function subCueEffectiveDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  let base: number | undefined;
  if (sub.kind === 'visual') {
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const d = visualDurations[sub.visualId];
    if (d === undefined) {
      return undefined;
    }
    base = (d * 1000) / rate;
  } else if (sub.kind === 'audio') {
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const d = audioDurations[sub.audioSourceId];
    if (d === undefined) {
      return undefined;
    }
    base = (d * 1000) / rate;
  } else {
    return 0;
  }
  if (sub.durationOverrideMs !== undefined) {
    base = Math.min(base, sub.durationOverrideMs);
  }
  return (sub.startOffsetMs ?? 0) + base;
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
  if (scene.loop.enabled) {
    if (scene.loop.iterations.type === 'infinite') {
      return undefined;
    }
    const inner = unknown ? undefined : max;
    if (inner === undefined) {
      return undefined;
    }
    return inner * scene.loop.iterations.count;
  }
  if (unknown && max === 0) {
    return undefined;
  }
  return max;
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
