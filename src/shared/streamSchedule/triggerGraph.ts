import type { PersistedStreamConfig, SceneId, SceneTrigger } from '../types';

/** Resolve implicit followsSceneId: previous row in sceneOrder when omitted. */
export function resolveFollowsSceneId(
  stream: PersistedStreamConfig,
  sceneId: SceneId,
  trigger: SceneTrigger,
): SceneId | undefined {
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
