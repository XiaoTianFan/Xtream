import type {
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  StreamCanonicalThreadPlan,
  StreamThreadBranch,
  StreamThreadEdge,
  StreamThreadPlan,
  StreamTimelineIssue,
} from './types';
import { resolveFollowsSceneId } from './streamSchedule';

type SceneDurationMap = Record<SceneId, number | undefined>;

function threadIdForRoot(rootSceneId: SceneId): string {
  return `thread:${rootSceneId}`;
}

function isAutoTrigger(
  scene: PersistedSceneConfig,
): scene is PersistedSceneConfig & { trigger: { type: 'follow-start' | 'follow-end'; followsSceneId?: SceneId; delayMs?: number } } {
  return scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end';
}

function isOperationRoot(scene: PersistedSceneConfig): scene is PersistedSceneConfig & { trigger: { type: 'manual' } | { type: 'at-timecode'; timecodeMs: number } } {
  return scene.trigger.type === 'manual' || scene.trigger.type === 'at-timecode';
}

function pushIssueOnce(issues: StreamTimelineIssue[], seen: Set<string>, issue: StreamTimelineIssue): void {
  const key = `${issue.severity}:${issue.sceneId ?? ''}:${issue.subCueId ?? ''}:${issue.message}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  issues.push(issue);
}

function collectAutoChildren(stream: PersistedStreamConfig): Map<SceneId, SceneId[]> {
  const children = new Map<SceneId, SceneId[]>();
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene || !isAutoTrigger(scene)) {
      continue;
    }
    const predecessorSceneId = resolveFollowsSceneId(stream, sceneId, scene.trigger);
    if (!predecessorSceneId) {
      continue;
    }
    const bucket = children.get(predecessorSceneId) ?? [];
    bucket.push(sceneId);
    children.set(predecessorSceneId, bucket);
  }
  return children;
}

function markBrokenBranch(sceneId: SceneId, childrenByPredecessor: Map<SceneId, SceneId[]>, out: Set<SceneId>): void {
  if (out.has(sceneId)) {
    return;
  }
  out.add(sceneId);
  for (const childId of childrenByPredecessor.get(sceneId) ?? []) {
    markBrokenBranch(childId, childrenByPredecessor, out);
  }
}

function resolveOwnerRoot(
  stream: PersistedStreamConfig,
  sceneId: SceneId,
  options: { allowStartingDisabled?: boolean } = {},
): { rootSceneId?: SceneId; brokenSceneIds?: SceneId[]; issue: StreamTimelineIssue } | { rootSceneId: SceneId; brokenSceneIds?: undefined; issue?: undefined } {
  const visited: SceneId[] = [];
  let currentId: SceneId | undefined = sceneId;

  while (currentId) {
    if (visited.includes(currentId)) {
      return {
        brokenSceneIds: [...visited, currentId],
        issue: {
          severity: 'error',
          sceneId,
          message: `Scene ${sceneId} is in an auto-trigger cycle.`,
        },
      };
    }
    visited.push(currentId);

    const scene = stream.scenes[currentId];
    const isStartingScene = currentId === sceneId;
    if (!scene || (scene.disabled && !(options.allowStartingDisabled && isStartingScene))) {
      return {
        brokenSceneIds: visited,
        issue: {
          severity: 'error',
          sceneId,
          message: `Scene ${sceneId} references a missing or disabled predecessor${currentId ? `: ${currentId}` : '.'}`,
        },
      };
    }
    if (isOperationRoot(scene)) {
      return { rootSceneId: currentId };
    }
    if (!isAutoTrigger(scene)) {
      return {
        brokenSceneIds: visited,
        issue: {
          severity: 'error',
          sceneId,
          message: `Scene ${sceneId} has an unsupported trigger in the Stream thread graph.`,
        },
      };
    }

    const predecessorSceneId = resolveFollowsSceneId(stream, currentId, scene.trigger);
    if (!predecessorSceneId) {
      return {
        brokenSceneIds: visited,
        issue: {
          severity: 'error',
          sceneId,
          message: `Scene ${sceneId} references a missing or disabled predecessor.`,
        },
      };
    }
    const predecessor = stream.scenes[predecessorSceneId];
    if (!predecessor || predecessor.disabled) {
      return {
        brokenSceneIds: visited,
        issue: {
          severity: 'error',
          sceneId,
          message: `Scene ${sceneId} references a missing or disabled predecessor: ${predecessorSceneId}`,
        },
      };
    }
    currentId = predecessorSceneId;
  }

  return {
    brokenSceneIds: visited,
    issue: {
      severity: 'error',
      sceneId,
      message: `Scene ${sceneId} could not be assigned to a Stream thread.`,
    },
  };
}

function computeSceneTimings(
  stream: PersistedStreamConfig,
  rootSceneId: SceneId,
  edgesByPredecessor: Map<SceneId, StreamThreadEdge[]>,
  durations: SceneDurationMap,
  nonRunnable: Set<SceneId>,
): Record<SceneId, { sceneId: SceneId; threadLocalStartMs?: number; threadLocalEndMs?: number }> {
  const timings: Record<SceneId, { sceneId: SceneId; threadLocalStartMs?: number; threadLocalEndMs?: number }> = {};

  function visit(sceneId: SceneId, startMs: number): void {
    if (nonRunnable.has(sceneId)) {
      return;
    }
    const existing = timings[sceneId];
    if (existing?.threadLocalStartMs !== undefined && existing.threadLocalStartMs <= startMs) {
      return;
    }
    const durationMs = durations[sceneId];
    timings[sceneId] = {
      sceneId,
      threadLocalStartMs: startMs,
      threadLocalEndMs: durationMs === undefined ? undefined : startMs + durationMs,
    };

    for (const edge of edgesByPredecessor.get(sceneId) ?? []) {
      const predecessorTiming = timings[sceneId];
      let childStartMs: number | undefined;
      if (edge.triggerType === 'follow-start') {
        childStartMs = startMs + edge.delayMs;
      } else {
        childStartMs = predecessorTiming.threadLocalEndMs === undefined ? undefined : predecessorTiming.threadLocalEndMs + edge.delayMs;
      }
      if (childStartMs !== undefined && stream.scenes[edge.followerSceneId]) {
        visit(edge.followerSceneId, childStartMs);
      }
    }
  }

  visit(rootSceneId, 0);
  return timings;
}

function enumerateBranches(
  rootSceneId: SceneId,
  edgesByPredecessor: Map<SceneId, StreamThreadEdge[]>,
  timings: Record<SceneId, { sceneId: SceneId; threadLocalStartMs?: number; threadLocalEndMs?: number }>,
): StreamThreadBranch[] {
  const branches: StreamThreadBranch[] = [];

  function pathDuration(path: SceneId[]): number | undefined {
    let max = 0;
    for (const sceneId of path) {
      const endMs = timings[sceneId]?.threadLocalEndMs;
      if (endMs === undefined) {
        return undefined;
      }
      max = Math.max(max, endMs);
    }
    return max;
  }

  function walk(sceneId: SceneId, path: SceneId[]): void {
    const nextEdges = (edgesByPredecessor.get(sceneId) ?? []).filter((edge) => timings[edge.followerSceneId]?.threadLocalStartMs !== undefined);
    if (nextEdges.length === 0) {
      branches.push({ sceneIds: path, durationMs: pathDuration(path) });
      return;
    }
    for (const edge of nextEdges) {
      walk(edge.followerSceneId, [...path, edge.followerSceneId]);
    }
  }

  walk(rootSceneId, [rootSceneId]);
  return branches;
}

export function deriveStreamThreadPlan(stream: PersistedStreamConfig, durations: SceneDurationMap): StreamThreadPlan {
  const issues: StreamTimelineIssue[] = [];
  const seenIssues = new Set<string>();
  const childrenByPredecessor = collectAutoChildren(stream);
  const temporarilyDisabled = new Set<SceneId>();
  const ownedByRoot = new Map<SceneId, Set<SceneId>>();

  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const disabledAutoFollower = scene.disabled && isAutoTrigger(scene);
    if (isOperationRoot(scene)) {
      if (scene.disabled) {
        continue;
      }
      const bucket = ownedByRoot.get(sceneId) ?? new Set<SceneId>();
      bucket.add(sceneId);
      ownedByRoot.set(sceneId, bucket);
      continue;
    }
    if (!isAutoTrigger(scene)) {
      continue;
    }
    const resolved = resolveOwnerRoot(stream, sceneId, { allowStartingDisabled: disabledAutoFollower });
    if (resolved.brokenSceneIds) {
      pushIssueOnce(issues, seenIssues, resolved.issue);
      for (const brokenId of resolved.brokenSceneIds) {
        markBrokenBranch(brokenId, childrenByPredecessor, temporarilyDisabled);
      }
      continue;
    }
    const rootSceneId = resolved.rootSceneId;
    if (!rootSceneId) {
      continue;
    }
    const bucket = ownedByRoot.get(rootSceneId) ?? new Set<SceneId>([rootSceneId]);
    bucket.add(sceneId);
    ownedByRoot.set(rootSceneId, bucket);
  }

  const threads: StreamCanonicalThreadPlan[] = [];
  const threadBySceneId: Record<SceneId, string> = {};

  for (const rootSceneId of stream.sceneOrder) {
    const root = stream.scenes[rootSceneId];
    const owned = ownedByRoot.get(rootSceneId);
    if (!root || root.disabled || !owned || !isOperationRoot(root)) {
      continue;
    }

    const sceneIds = stream.sceneOrder.filter((id) => owned.has(id));
    const edges = sceneIds
      .map((sceneId) => {
        const scene = stream.scenes[sceneId];
        if (!scene || !isAutoTrigger(scene) || temporarilyDisabled.has(sceneId)) {
          return undefined;
        }
        const predecessorSceneId = resolveFollowsSceneId(stream, sceneId, scene.trigger);
        if (!predecessorSceneId || !owned.has(predecessorSceneId)) {
          return undefined;
        }
        return {
          predecessorSceneId,
          followerSceneId: sceneId,
          triggerType: scene.trigger.type,
          delayMs: scene.trigger.delayMs ?? 0,
        } satisfies StreamThreadEdge;
      })
      .filter(Boolean) as StreamThreadEdge[];
    const edgesByPredecessor = new Map<SceneId, StreamThreadEdge[]>();
    for (const edge of edges) {
      const bucket = edgesByPredecessor.get(edge.predecessorSceneId) ?? [];
      bucket.push(edge);
      edgesByPredecessor.set(edge.predecessorSceneId, bucket);
    }

    const disabledInThread = new Set(sceneIds.filter((id) => temporarilyDisabled.has(id)));
    const nonRunnableInThread = new Set(sceneIds.filter((id) => temporarilyDisabled.has(id) || stream.scenes[id]?.disabled));
    const sceneTimings = computeSceneTimings(stream, rootSceneId, edgesByPredecessor, durations, nonRunnableInThread);
    const branches = enumerateBranches(rootSceneId, edgesByPredecessor, sceneTimings);
    const knownBranchDurations = branches.map((branch) => branch.durationMs).filter((duration): duration is number => duration !== undefined);
    const durationMs = knownBranchDurations.length === branches.length ? Math.max(0, ...knownBranchDurations) : undefined;
    const longestBranch =
      branches.reduce<StreamThreadBranch | undefined>((best, branch) => {
        if (!best) {
          return branch;
        }
        if (branch.durationMs === undefined) {
          return best;
        }
        if (best.durationMs === undefined || branch.durationMs > best.durationMs) {
          return branch;
        }
        return best;
      }, undefined)?.sceneIds ?? [rootSceneId];
    const threadId = threadIdForRoot(rootSceneId);

    for (const sceneId of sceneIds) {
      threadBySceneId[sceneId] = threadId;
    }

    threads.push({
      threadId,
      rootSceneId,
      rootTriggerType: root.trigger.type,
      sceneIds,
      edges,
      branches,
      longestBranchSceneIds: longestBranch,
      sceneTimings,
      durationMs,
      temporarilyDisabledSceneIds: [...disabledInThread],
    });
  }

  return {
    threads,
    threadBySceneId,
    temporarilyDisabledSceneIds: [...temporarilyDisabled],
    issues,
  };
}
