import { formatTimecode } from '../../../shared/timeline';
import { resolveFollowsSceneId } from '../../../shared/streamSchedule';
import { deriveStreamThreadColorMaps, type StreamThreadColor } from '../../../shared/streamThreadColors';
import type {
  CalculatedStreamTimeline,
  DirectorState,
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  SceneRuntimeState,
  StreamCanonicalThreadPlan,
  StreamThreadBranch,
  StreamThreadEdge,
  StreamMainTimelineSegment,
  StreamThreadId,
} from '../../../shared/types';
import { formatSceneDuration } from './formatting';

export type FlowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FlowPoint = {
  x: number;
  y: number;
};

export type FlowSceneNode = {
  sceneId: SceneId;
  sceneNumber: number;
  title: string;
  rect: FlowRect;
  usesDefaultRect: boolean;
  status: SceneRuntimeState['status'] | 'disabled' | 'ready';
  progress?: number;
  durationLabel: string;
  threadId?: StreamThreadId;
  rootSceneId?: SceneId;
  rootTriggerType?: 'manual' | 'at-timecode';
  threadColor?: StreamThreadColor;
  temporarilyDisabled: boolean;
  authoringError: boolean;
  visualPreviewIds: string[];
  audioCount: number;
  controlCount: number;
};

export type FlowLinkProjection = {
  id: string;
  predecessorSceneId: SceneId;
  followerSceneId: SceneId;
  triggerType: 'follow-start' | 'follow-end';
  delayMs: number;
  color?: StreamThreadColor;
};

export type FlowWarningStub = {
  id: string;
  sceneId: SceneId;
  label: string;
  rect: FlowRect;
};

export type FlowMainCurve = {
  points: FlowPoint[];
  progress: number;
};

export type FlowProjection = {
  nodes: FlowSceneNode[];
  nodesBySceneId: Record<SceneId, FlowSceneNode>;
  links: FlowLinkProjection[];
  warningStubs: FlowWarningStub[];
  mainCurve: FlowMainCurve;
  bounds: FlowRect;
};

const CARD_WIDTH = 214;
const CARD_HEIGHT = 136;
const THREAD_GAP_X = 300;
const SCENE_GAP_X = 250;
const CARD_GAP_X = SCENE_GAP_X - CARD_WIDTH;
const THREAD_CARD_GAP_X = THREAD_GAP_X - CARD_WIDTH;
const BRANCH_GAP_Y = 178;
const MAIN_BASELINE_Y = 230;
const SIDE_THREAD_Y = 34;
const ORPHAN_BASELINE_Y = 470;

type FlowLayoutThread = Pick<
  StreamCanonicalThreadPlan,
  'threadId' | 'rootSceneId' | 'rootTriggerType' | 'sceneIds' | 'edges' | 'branches' | 'longestBranchSceneIds' | 'sceneTimings' | 'durationMs'
>;

function defaultRect(width = CARD_WIDTH, height = CARD_HEIGHT): FlowRect {
  return { x: 32, y: MAIN_BASELINE_Y, width, height };
}

function isFollowTrigger(scene: PersistedSceneConfig): scene is PersistedSceneConfig & {
  trigger: { type: 'follow-start' | 'follow-end'; followsSceneId?: SceneId; delayMs?: number };
} {
  return scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end';
}

function segmentOrder(timeline: CalculatedStreamTimeline | undefined): StreamMainTimelineSegment[] {
  return [...(timeline?.mainSegments ?? [])].sort((a, b) => a.startMs - b.startMs);
}

function operationRootTriggerType(scene: PersistedSceneConfig): 'manual' | 'at-timecode' | undefined {
  if (scene.trigger.type === 'manual' || scene.trigger.type === 'at-timecode') {
    return scene.trigger.type;
  }
  return undefined;
}

function resolveAuthoringRootSceneId(stream: PersistedStreamConfig, sceneId: SceneId): SceneId | undefined {
  const visited: SceneId[] = [];
  let currentId: SceneId | undefined = sceneId;

  while (currentId) {
    if (visited.includes(currentId)) {
      return undefined;
    }
    visited.push(currentId);

    const scene = stream.scenes[currentId];
    if (!scene) {
      return undefined;
    }
    if (operationRootTriggerType(scene)) {
      return currentId;
    }
    if (!isFollowTrigger(scene)) {
      return undefined;
    }
    currentId = resolveFollowsSceneId(stream, currentId, scene.trigger);
  }

  return undefined;
}

function branchDurationForLayout(runtimeThread: StreamCanonicalThreadPlan | undefined, path: SceneId[]): number | undefined {
  const key = path.join('|');
  const runtimeBranch = runtimeThread?.branches.find((branch) => branch.sceneIds.join('|') === key);
  if (runtimeBranch?.durationMs !== undefined) {
    return runtimeBranch.durationMs;
  }

  let maxEnd = 0;
  for (const sceneId of path) {
    const endMs = runtimeThread?.sceneTimings[sceneId]?.threadLocalEndMs;
    if (endMs === undefined) {
      return runtimeThread ? 0 : path.length * 1000;
    }
    maxEnd = Math.max(maxEnd, endMs);
  }
  return maxEnd;
}

function enumerateLayoutBranches(rootSceneId: SceneId, edges: StreamThreadEdge[], runtimeThread: StreamCanonicalThreadPlan | undefined): StreamThreadBranch[] {
  const childrenByPredecessor = new Map<SceneId, StreamThreadEdge[]>();
  for (const edge of edges) {
    const bucket = childrenByPredecessor.get(edge.predecessorSceneId) ?? [];
    bucket.push(edge);
    childrenByPredecessor.set(edge.predecessorSceneId, bucket);
  }

  const branches: StreamThreadBranch[] = [];
  const walk = (sceneId: SceneId, path: SceneId[]) => {
    const nextEdges = (childrenByPredecessor.get(sceneId) ?? []).filter((edge) => !path.includes(edge.followerSceneId));
    if (nextEdges.length === 0) {
      branches.push({ sceneIds: path, durationMs: branchDurationForLayout(runtimeThread, path) });
      return;
    }
    for (const edge of nextEdges) {
      walk(edge.followerSceneId, [...path, edge.followerSceneId]);
    }
  };

  walk(rootSceneId, [rootSceneId]);
  return branches.length > 0 ? branches : [{ sceneIds: [rootSceneId], durationMs: branchDurationForLayout(runtimeThread, [rootSceneId]) }];
}

function compareLayoutBranchLength(left: StreamThreadBranch, right: StreamThreadBranch): number {
  if (left.durationMs !== undefined && right.durationMs !== undefined && left.durationMs !== right.durationMs) {
    return left.durationMs - right.durationMs;
  }
  if (left.durationMs !== undefined && right.durationMs === undefined) {
    return 1;
  }
  if (left.durationMs === undefined && right.durationMs !== undefined) {
    return -1;
  }
  return left.sceneIds.length - right.sceneIds.length;
}

function longestLayoutBranchSceneIds(branches: StreamThreadBranch[], fallbackRootSceneId: SceneId): SceneId[] {
  return (
    branches.reduce<StreamThreadBranch | undefined>((best, branch) => {
      if (!best) {
        return branch;
      }
      return compareLayoutBranchLength(branch, best) > 0 ? branch : best;
    }, undefined)?.sceneIds ?? [fallbackRootSceneId]
  );
}

function createAuthoringLayoutThreads(stream: PersistedStreamConfig, timeline: CalculatedStreamTimeline | undefined): FlowLayoutThread[] {
  const runtimeByRoot = new Map((timeline?.threadPlan?.threads ?? []).map((thread) => [thread.rootSceneId, thread]));
  const ownedByRoot = new Map<SceneId, Set<SceneId>>();

  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const rootSceneId = resolveAuthoringRootSceneId(stream, sceneId);
    if (!rootSceneId) {
      continue;
    }
    const bucket = ownedByRoot.get(rootSceneId) ?? new Set<SceneId>();
    bucket.add(sceneId);
    ownedByRoot.set(rootSceneId, bucket);
  }

  const threads: FlowLayoutThread[] = [];
  for (const rootSceneId of stream.sceneOrder) {
    const root = stream.scenes[rootSceneId];
    const rootTriggerType = root ? operationRootTriggerType(root) : undefined;
    const owned = ownedByRoot.get(rootSceneId);
    if (!root || !rootTriggerType || !owned) {
      continue;
    }

    const sceneIds = stream.sceneOrder.filter((id) => owned.has(id));
    const edges = sceneIds
      .map((sceneId) => {
        const scene = stream.scenes[sceneId];
        if (!scene || !isFollowTrigger(scene)) {
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
    const runtimeThread = runtimeByRoot.get(rootSceneId);
    const branches = enumerateLayoutBranches(rootSceneId, edges, runtimeThread);

    threads.push({
      threadId: runtimeThread?.threadId ?? (`thread:${rootSceneId}` as StreamThreadId),
      rootSceneId,
      rootTriggerType,
      sceneIds,
      edges,
      branches,
      longestBranchSceneIds: longestLayoutBranchSceneIds(branches, rootSceneId),
      sceneTimings: runtimeThread?.sceneTimings ?? {},
      durationMs: runtimeThread?.durationMs,
    });
  }

  return threads;
}

function branchIndexForScene(thread: FlowLayoutThread, sceneId: SceneId): number {
  const sceneTiming = thread.sceneTimings[sceneId];
  const sceneStartMs = sceneTiming?.threadLocalStartMs;
  const candidates = thread.branches
    .map((branch, index) => ({ branch, index, depth: branch.sceneIds.indexOf(sceneId) }))
    .filter((candidate) => candidate.depth >= 0);
  if (candidates.length === 0) {
    return 0;
  }
  if (
    candidates.length > 1 &&
    candidates.every((candidate) => candidate.depth === candidates[0].depth) &&
    candidates.every((candidate) => {
      const candidatePrefix = candidate.branch.sceneIds.slice(0, candidate.depth + 1).join('|');
      const firstPrefix = candidates[0].branch.sceneIds.slice(0, candidates[0].depth + 1).join('|');
      return candidatePrefix === firstPrefix;
    })
  ) {
    return 0;
  }
  const nonSharedCandidates = candidates.filter((candidate) => candidate.depth > 0);
  const candidatePool = nonSharedCandidates.length > 0 ? nonSharedCandidates : candidates;
  const timed = candidatePool.find((candidate) => {
    const predecessorId = candidate.branch.sceneIds[candidate.depth - 1];
    if (!predecessorId || sceneStartMs === undefined) {
      return false;
    }
    const predecessorEndMs = thread.sceneTimings[predecessorId]?.threadLocalEndMs;
    return predecessorEndMs === undefined || sceneStartMs >= predecessorEndMs;
  });
  return branchLaneOffset(thread, (timed ?? candidatePool[0] ?? candidates[0]).index);
}

function longestBranchIndexForThread(thread: FlowLayoutThread): number {
  const longestBranchKey = thread.longestBranchSceneIds.join('|');
  return Math.max(
    0,
    thread.branches.findIndex((branch) => branch.sceneIds.join('|') === longestBranchKey),
  );
}

function branchLaneOffset(thread: FlowLayoutThread, branchIndex: number): number {
  const longestBranchIndex = longestBranchIndexForThread(thread);
  if (branchIndex === longestBranchIndex) {
    return 0;
  }
  const sideBranches = thread.branches
    .map((branch, index) => ({ branch, index }))
    .filter((candidate) => candidate.index !== longestBranchIndex)
    .sort((a, b) => {
      const durationA = a.branch.durationMs ?? 0;
      const durationB = b.branch.durationMs ?? 0;
      return durationB - durationA || a.index - b.index;
    });
  const rank = sideBranches.findIndex((candidate) => candidate.index === branchIndex);
  if (rank < 0) {
    return 0;
  }
  const distance = Math.floor(rank / 2) + 1;
  return rank % 2 === 0 ? -distance : distance;
}

function branchDepthForScene(thread: FlowLayoutThread, sceneId: SceneId): number {
  const branch = thread.branches.find((candidate) => candidate.sceneIds.includes(sceneId));
  const idx = branch?.sceneIds.indexOf(sceneId) ?? -1;
  return idx >= 0 ? idx : Math.max(0, thread.sceneIds.indexOf(sceneId));
}

function sceneFlowWidth(stream: PersistedStreamConfig, sceneId: SceneId): number {
  const width = stream.scenes[sceneId]?.flow?.width;
  return width !== undefined && Number.isFinite(width) ? Math.max(170, width) : CARD_WIDTH;
}

function createThreadSceneLocalX(stream: PersistedStreamConfig, thread: FlowLayoutThread): Map<SceneId, number> {
  const localX = new Map<SceneId, number>();
  for (const branch of thread.branches.length > 0 ? thread.branches : [{ sceneIds: thread.sceneIds }]) {
    for (const [index, sceneId] of branch.sceneIds.entries()) {
      const previousSceneId = branch.sceneIds[index - 1];
      const x = previousSceneId === undefined ? 0 : (localX.get(previousSceneId) ?? 0) + sceneFlowWidth(stream, previousSceneId) + CARD_GAP_X;
      localX.set(sceneId, Math.max(localX.get(sceneId) ?? 0, x));
    }
  }
  for (const [index, sceneId] of thread.sceneIds.entries()) {
    if (!localX.has(sceneId)) {
      const previousSceneId = thread.sceneIds[index - 1];
      localX.set(sceneId, previousSceneId === undefined ? 0 : (localX.get(previousSceneId) ?? 0) + sceneFlowWidth(stream, previousSceneId) + CARD_GAP_X);
    }
  }
  return localX;
}

function threadFlowWidth(stream: PersistedStreamConfig, thread: FlowLayoutThread): number {
  const localX = createThreadSceneLocalX(stream, thread);
  return Math.max(
    CARD_WIDTH,
    ...thread.sceneIds.map((sceneId) => (localX.get(sceneId) ?? 0) + sceneFlowWidth(stream, sceneId)),
  );
}

function rectKey(rect: FlowRect): string {
  return `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
}

function shouldUseDefaultRectForDuplicateFlow(scene: PersistedSceneConfig, duplicateFlowKeys: ReadonlySet<string>): boolean {
  if (!scene.flow || !isFollowTrigger(scene)) {
    return false;
  }
  return duplicateFlowKeys.has(rectKey(scene.flow));
}

function duplicateAutoFollowFlowKeys(stream: PersistedStreamConfig): Set<string> {
  const counts = new Map<string, number>();
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene?.flow || !isFollowTrigger(scene)) {
      continue;
    }
    const key = rectKey(scene.flow);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function calculateDefaultRects(stream: PersistedStreamConfig, timeline: CalculatedStreamTimeline | undefined): Record<SceneId, FlowRect> {
  const rects: Record<SceneId, FlowRect> = {};
  const orderedThreads = createAuthoringLayoutThreads(stream, timeline);
  const mainSegments = segmentOrder(timeline);
  const mainDurationMs = mainSegments.at(-1)?.endMs ?? 0;
  const mainThreadBaseX = new Map<StreamThreadId, number>();
  let nextMainThreadX = 56;
  for (const thread of orderedThreads.filter((candidate) => candidate.rootTriggerType === 'manual')) {
    mainThreadBaseX.set(thread.threadId, nextMainThreadX);
    nextMainThreadX += threadFlowWidth(stream, thread) + THREAD_CARD_GAP_X;
  }
  let nextFallbackX = 56;
  for (const thread of orderedThreads) {
    const localX = createThreadSceneLocalX(stream, thread);
    let baseX: number;
    let baseY: number;
    if (thread.rootTriggerType === 'manual') {
      baseX = mainThreadBaseX.get(thread.threadId) ?? 56;
      baseY = MAIN_BASELINE_Y;
    } else if (thread.rootTriggerType === 'at-timecode') {
      const root = stream.scenes[thread.rootSceneId];
      const ratio =
        root?.trigger.type === 'at-timecode' && mainDurationMs > 0 ? Math.max(0, Math.min(1, root.trigger.timecodeMs / mainDurationMs)) : 0;
      baseX = 56 + ratio * Math.max(THREAD_GAP_X, Math.max(0, nextMainThreadX - 56 - CARD_WIDTH));
      baseY = SIDE_THREAD_Y;
    } else {
      baseX = nextFallbackX;
      baseY = ORPHAN_BASELINE_Y;
      nextFallbackX += threadFlowWidth(stream, thread) + THREAD_CARD_GAP_X;
    }
    const branchCount = Math.max(1, thread.branches.length);
    for (const sceneId of thread.sceneIds) {
      const depth = branchDepthForScene(thread, sceneId);
      const branchIndex = branchIndexForScene(thread, sceneId);
      const yOffset = branchIndex * BRANCH_GAP_Y;
      rects[sceneId] = {
        x: baseX + (localX.get(sceneId) ?? depth * SCENE_GAP_X),
        y: baseY + yOffset + (branchCount === 1 ? 0 : 22),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      };
    }
  }

  stream.sceneOrder.forEach((sceneId, index) => {
    if (!rects[sceneId]) {
      rects[sceneId] = {
        x: 56 + index * SCENE_GAP_X,
        y: ORPHAN_BASELINE_Y + BRANCH_GAP_Y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      };
    }
  });

  return rects;
}

function sceneRuntimeStatus(scene: PersistedSceneConfig, runtimeState: SceneRuntimeState | undefined, temporarilyDisabled: boolean): FlowSceneNode['status'] {
  if (scene.disabled || temporarilyDisabled) {
    return 'disabled';
  }
  return runtimeState?.status ?? 'ready';
}

function scenePreviewIds(scene: PersistedSceneConfig): string[] {
  return scene.subCueOrder.flatMap((subCueId) => {
    const cue = scene.subCues[subCueId];
    return cue?.kind === 'visual' ? [cue.visualId] : [];
  });
}

function countSubCues(scene: PersistedSceneConfig, kind: 'audio' | 'control'): number {
  return scene.subCueOrder.reduce((count, subCueId) => (scene.subCues[subCueId]?.kind === kind ? count + 1 : count), 0);
}

function calculateBounds(rects: FlowRect[]): FlowRect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 900, height: 520 };
  }
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createMainCurve(
  stream: PersistedStreamConfig,
  timeline: CalculatedStreamTimeline | undefined,
  nodesBySceneId: Record<SceneId, FlowSceneNode>,
  runtimeCursorMs: number | undefined,
): FlowMainCurve {
  const points: FlowPoint[] = [];
  const threadById = new Map((timeline?.threadPlan?.threads ?? []).map((thread) => [thread.threadId, thread]));
  for (const segment of segmentOrder(timeline)) {
    const thread = threadById.get(segment.threadId);
    for (const sceneId of thread?.longestBranchSceneIds ?? [segment.rootSceneId]) {
      if (!stream.scenes[sceneId]) {
        continue;
      }
      const node = nodesBySceneId[sceneId];
      if (node) {
        points.push({ x: node.rect.x + node.rect.width / 2, y: node.rect.y + node.rect.height / 2 });
      }
    }
  }
  const durationMs = timeline?.expectedDurationMs ?? 0;
  const progress = durationMs > 0 && runtimeCursorMs !== undefined ? Math.max(0, Math.min(1, runtimeCursorMs / durationMs)) : 0;
  return { points, progress };
}

function createWarningStub(sceneId: SceneId, scene: PersistedSceneConfig, nodeRect: FlowRect): FlowWarningStub | undefined {
  if (!isFollowTrigger(scene)) {
    return undefined;
  }
  const explicitMissingId = scene.trigger.followsSceneId;
  if (!explicitMissingId) {
    return undefined;
  }
  return {
    id: `missing:${sceneId}:${explicitMissingId}`,
    sceneId,
    label: `Missing ${explicitMissingId}`,
    rect: {
      x: nodeRect.x - 156,
      y: nodeRect.y + Math.max(10, nodeRect.height / 2 - 22),
      width: 116,
      height: 44,
    },
  };
}

export function deriveStreamFlowProjection(args: {
  stream: PersistedStreamConfig;
  timeline: CalculatedStreamTimeline | undefined;
  directorState: DirectorState | undefined;
  runtimeSceneStates?: Record<SceneId, SceneRuntimeState>;
  runtimeMainCursorMs?: number;
  authoringErrorSceneIds?: ReadonlySet<SceneId>;
}): FlowProjection {
  const { stream, timeline, directorState } = args;
  const defaultRects = calculateDefaultRects(stream, timeline);
  const threadColors = deriveStreamThreadColorMaps(timeline);
  const threadBySceneId = timeline?.threadPlan?.threadBySceneId ?? {};
  const threadById = new Map((timeline?.threadPlan?.threads ?? []).map((thread) => [thread.threadId, thread]));
  const temporarilyDisabled = new Set(timeline?.threadPlan?.temporarilyDisabledSceneIds ?? []);
  const duplicateFlowKeys = duplicateAutoFollowFlowKeys(stream);
  const nodesBySceneId: Record<SceneId, FlowSceneNode> = {};
  const warningStubs: FlowWarningStub[] = [];

  const nodes = stream.sceneOrder.flatMap((sceneId, index) => {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      return [];
    }
    const fallbackRect = defaultRects[sceneId] ?? defaultRect();
    const useDefaultRect = shouldUseDefaultRectForDuplicateFlow(scene, duplicateFlowKeys);
    const rect = useDefaultRect ? fallbackRect : scene.flow ?? fallbackRect;
    const threadId = threadBySceneId[sceneId];
    const thread = threadId ? threadById.get(threadId) : undefined;
    const node: FlowSceneNode = {
      sceneId,
      sceneNumber: index + 1,
      title: scene.title?.trim() || `Scene ${index + 1}`,
      rect,
      usesDefaultRect: scene.flow === undefined || useDefaultRect,
      status: sceneRuntimeStatus(scene, args.runtimeSceneStates?.[sceneId], temporarilyDisabled.has(sceneId)),
      progress: args.runtimeSceneStates?.[sceneId]?.progress,
      durationLabel: formatSceneDuration(directorState, scene),
      threadId,
      rootSceneId: thread?.rootSceneId,
      rootTriggerType: thread?.rootTriggerType,
      threadColor: threadId ? threadColors.byThreadId[threadId] : undefined,
      temporarilyDisabled: temporarilyDisabled.has(sceneId),
      authoringError: args.authoringErrorSceneIds?.has(sceneId) ?? false,
      visualPreviewIds: scenePreviewIds(scene),
      audioCount: countSubCues(scene, 'audio'),
      controlCount: countSubCues(scene, 'control'),
    };
    nodesBySceneId[sceneId] = node;
    const stub = createWarningStub(sceneId, scene, rect);
    if (stub && isFollowTrigger(scene) && scene.trigger.followsSceneId && !stream.scenes[scene.trigger.followsSceneId]) {
      warningStubs.push(stub);
    }
    return [node];
  });

  const links: FlowLinkProjection[] = [];
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene || !isFollowTrigger(scene)) {
      continue;
    }
    const predecessorSceneId = resolveFollowsSceneId(stream, sceneId, scene.trigger);
    if (!predecessorSceneId || !stream.scenes[predecessorSceneId]) {
      continue;
    }
    const threadId = threadBySceneId[sceneId];
    links.push({
      id: `link:${predecessorSceneId}:${sceneId}`,
      predecessorSceneId,
      followerSceneId: sceneId,
      triggerType: scene.trigger.type,
      delayMs: scene.trigger.delayMs ?? 0,
      color: threadId ? threadColors.byThreadId[threadId] : undefined,
    });
  }

  return {
    nodes,
    nodesBySceneId,
    links,
    warningStubs,
    mainCurve: createMainCurve(stream, timeline, nodesBySceneId, args.runtimeMainCursorMs),
    bounds: calculateBounds([...nodes.map((node) => node.rect), ...warningStubs.map((stub) => stub.rect)]),
  };
}

export function formatFlowAtTimecodeLaneLabel(scene: PersistedSceneConfig): string {
  return scene.trigger.type === 'at-timecode' ? formatTimecode(scene.trigger.timecodeMs / 1000) : '';
}

export function moveFlowRect(rect: FlowRect, dx: number, dy: number): FlowRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}
