import { formatTimecode } from '../../../shared/timeline';
import { deriveStreamThreadColorMaps, type StreamThreadColor } from '../../../shared/streamThreadColors';
import type {
  CalculatedStreamTimeline,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
  StreamRuntimeThreadInstance,
  StreamRuntimeTimelineInstance,
  StreamThreadId,
} from '../../../shared/types';

export type StreamGanttBarProjection = {
  id: string;
  canonicalThreadId: StreamThreadId;
  rootSceneId: SceneId;
  launchSceneId: SceneId;
  title: string;
  launchTitle: string;
  state: StreamRuntimeThreadInstance['state'];
  copied: boolean;
  copiedFromThreadInstanceId?: string;
  color?: StreamThreadColor;
  startMs: number;
  durationMs: number;
  endMs: number;
  scaleStartMs: number;
  scaleEndMs: number;
  leftPercent: number;
  widthPercent: number;
  cursorPercent: number;
  launchPercent: number;
  timeLabel: string;
};

export type StreamGanttLaneProjection = {
  id: string;
  kind: StreamRuntimeTimelineInstance['kind'];
  label: string;
  status: StreamRuntimeTimelineInstance['status'];
  cursorMs: number;
  durationMs: number;
  scaleStartMs: number;
  scaleCursorMs: number;
  cursorPercent: number;
  minWidthPx: number;
  trackMinWidthPx: number;
  bars: StreamGanttBarProjection[];
};

export type StreamGanttProjection = {
  lanes: StreamGanttLaneProjection[];
  hasRuntime: boolean;
};

const GANTT_LANE_FIXED_WIDTH_PX = 142;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function percent(value: number, total: number): number {
  return total > 0 ? clamp01(value / total) * 100 : 0;
}

function labelForScene(stream: PersistedStreamConfig, sceneId: SceneId): string {
  const scene = stream.scenes[sceneId];
  return scene?.title?.trim() || sceneId;
}

function timelineDuration(timeline: StreamRuntimeTimelineInstance, instances: StreamRuntimeThreadInstance[]): number {
  if (timeline.durationMs !== undefined && timeline.durationMs > 0) {
    return timeline.durationMs;
  }
  const maxEnd = instances.reduce((max, instance) => Math.max(max, instance.timelineStartMs + (instance.durationMs ?? 0)), 0);
  return Math.max(maxEnd, timeline.cursorMs, 0);
}

function orderedTimelineIds(runtime: NonNullable<StreamEnginePublicState['runtime']>): string[] {
  const ids = runtime.timelineOrder?.filter((id) => runtime.timelineInstances?.[id]) ?? Object.keys(runtime.timelineInstances ?? {});
  const seen = new Set<string>();
  const unique = ids.filter((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  for (const id of Object.keys(runtime.timelineInstances ?? {})) {
    if (!seen.has(id)) {
      unique.push(id);
    }
  }
  const mainId = runtime.mainTimelineId;
  const mainIds = unique.filter((id) => id === mainId || runtime.timelineInstances?.[id]?.kind === 'main');
  const rest = unique.filter((id) => !mainIds.includes(id));
  return [...mainIds, ...rest];
}

function createLaneLabel(timeline: StreamRuntimeTimelineInstance, parallelIndex: number): string {
  if (timeline.kind === 'main') {
    return 'Main timeline';
  }
  return `Parallel ${parallelIndex}`;
}

function laneWidthForTimeline(durationMs: number, instanceCount: number): { minWidthPx: number; trackMinWidthPx: number } {
  const durationWidth = Math.ceil(durationMs / 1000) * 72;
  const instanceWidth = Math.max(1, instanceCount) * 220;
  const trackMinWidthPx = Math.max(560, durationWidth, instanceWidth);
  return {
    minWidthPx: trackMinWidthPx + GANTT_LANE_FIXED_WIDTH_PX,
    trackMinWidthPx,
  };
}

function createBarProjection(args: {
  stream: PersistedStreamConfig;
  timeline: StreamRuntimeTimelineInstance;
  timelineDurationMs: number;
  instance: StreamRuntimeThreadInstance;
  color?: StreamThreadColor;
  scaleStartMs?: number;
}): StreamGanttBarProjection {
  const { stream, timeline, timelineDurationMs, instance, color, scaleStartMs: timelineScaleStartMs = 0 } = args;
  const durationMs = Math.max(0, instance.durationMs ?? 0);
  const startMs = Math.max(0, instance.timelineStartMs);
  const endMs = startMs + durationMs;
  const scaleStartMs = timelineScaleStartMs + startMs;
  const scaleEndMs = scaleStartMs + durationMs;
  const localCursorMs = timeline.cursorMs - startMs;
  const rootTitle = labelForScene(stream, instance.rootSceneId);
  const launchTitle = labelForScene(stream, instance.launchSceneId);
  return {
    id: instance.id,
    canonicalThreadId: instance.canonicalThreadId,
    rootSceneId: instance.rootSceneId,
    launchSceneId: instance.launchSceneId,
    title: rootTitle,
    launchTitle,
    state: instance.state,
    copied: instance.copiedFromThreadInstanceId !== undefined,
    copiedFromThreadInstanceId: instance.copiedFromThreadInstanceId,
    color,
    startMs,
    durationMs,
    endMs,
    scaleStartMs,
    scaleEndMs,
    leftPercent: percent(startMs, timelineDurationMs),
    widthPercent: durationMs > 0 ? Math.max(1.5, percent(durationMs, timelineDurationMs)) : 1.5,
    cursorPercent: percent(localCursorMs, durationMs),
    launchPercent: percent(instance.launchLocalMs, durationMs),
    timeLabel: `${formatTimecode(startMs / 1000)} - ${formatTimecode(endMs / 1000)}`,
  };
}

function createPlannedMainLane(
  stream: PersistedStreamConfig,
  playbackTimeline: CalculatedStreamTimeline,
): StreamGanttLaneProjection | undefined {
  if (playbackTimeline.status !== 'valid') {
    return undefined;
  }
  const segments = playbackTimeline.mainSegments ?? [];
  const threads = playbackTimeline.threadPlan?.threads ?? [];
  const instances = segments
    .map((segment): StreamRuntimeThreadInstance | undefined => {
      const thread = threads.find((candidate) => candidate.threadId === segment.threadId);
      if (!thread) {
        return undefined;
      }
      return {
        id: `planned:${segment.threadId}`,
        canonicalThreadId: segment.threadId,
        timelineId: 'timeline:main',
        rootSceneId: segment.rootSceneId,
        launchSceneId: segment.rootSceneId,
        launchLocalMs: 0,
        state: 'ready',
        timelineStartMs: segment.startMs,
        durationMs: segment.durationMs ?? thread.durationMs,
      };
    })
    .filter(Boolean) as StreamRuntimeThreadInstance[];
  const timeline: StreamRuntimeTimelineInstance = {
    id: 'timeline:main',
    kind: 'main',
    status: 'idle',
    orderedThreadInstanceIds: instances.map((instance) => instance.id),
    cursorMs: 0,
    durationMs:
      playbackTimeline.expectedDurationMs ??
      segments.reduce((max, segment) => Math.max(max, segment.endMs), 0),
  };
  const durationMs = timelineDuration(timeline, instances);
  const widths = laneWidthForTimeline(durationMs, instances.length);
  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  return {
    id: timeline.id,
    kind: timeline.kind,
    label: createLaneLabel(timeline, 0),
    status: timeline.status,
    cursorMs: 0,
    durationMs,
    scaleStartMs: 0,
    scaleCursorMs: 0,
    cursorPercent: 0,
    minWidthPx: widths.minWidthPx,
    trackMinWidthPx: widths.trackMinWidthPx,
    bars: instances.map((instance) =>
      createBarProjection({
        stream,
        timeline,
        timelineDurationMs: durationMs,
        instance,
        color: colors.byThreadId[instance.canonicalThreadId],
      }),
    ),
  };
}

function applySharedTimelineScale(lanes: StreamGanttLaneProjection[]): StreamGanttLaneProjection[] {
  if (lanes.length === 0) {
    return lanes;
  }
  const scaleDurationMs = Math.max(
    ...lanes.map((lane) => lane.scaleStartMs + lane.durationMs),
    ...lanes.flatMap((lane) => lane.bars.map((bar) => bar.scaleEndMs)),
    0,
  );
  if (scaleDurationMs <= 0) {
    return lanes;
  }
  const maxInstanceCount = Math.max(...lanes.map((lane) => Math.max(1, lane.bars.length)));
  const widths = laneWidthForTimeline(scaleDurationMs, maxInstanceCount);
  for (const lane of lanes) {
    lane.cursorPercent = percent(lane.scaleCursorMs, scaleDurationMs);
    lane.minWidthPx = widths.minWidthPx;
    lane.trackMinWidthPx = widths.trackMinWidthPx;
    for (const bar of lane.bars) {
      bar.leftPercent = percent(bar.scaleStartMs, scaleDurationMs);
      bar.widthPercent = bar.durationMs > 0 ? Math.max(1.5, percent(bar.durationMs, scaleDurationMs)) : 1.5;
    }
  }
  return lanes;
}

export function deriveStreamGanttProjection(args: {
  stream: PersistedStreamConfig;
  playbackTimeline: CalculatedStreamTimeline;
  runtime: StreamEnginePublicState['runtime'];
}): StreamGanttProjection {
  const { stream, playbackTimeline, runtime } = args;
  const plannedMainLane = createPlannedMainLane(stream, playbackTimeline);
  if (!runtime?.timelineInstances || !runtime.threadInstances || Object.keys(runtime.timelineInstances).length === 0) {
    return plannedMainLane ? { lanes: applySharedTimelineScale([plannedMainLane]), hasRuntime: false } : { lanes: [], hasRuntime: false };
  }

  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const lanes: StreamGanttLaneProjection[] = [];
  let runtimeHasMain = false;
  let parallelIndex = 0;
  for (const timelineId of orderedTimelineIds(runtime)) {
    const timeline = runtime.timelineInstances[timelineId];
    if (!timeline) {
      continue;
    }
    if (timeline.kind === 'main') {
      runtimeHasMain = true;
    }
    if (timeline.kind === 'parallel') {
      parallelIndex += 1;
    }
    const instances = timeline.orderedThreadInstanceIds
      .map((id) => runtime.threadInstances?.[id])
      .filter(Boolean) as StreamRuntimeThreadInstance[];
    const durationMs = timelineDuration(timeline, instances);
    const scaleStartMs = timeline.kind === 'parallel' ? Math.max(0, timeline.spawnedAtStreamMs ?? 0) : 0;
    const widths = laneWidthForTimeline(durationMs, instances.length);
    lanes.push({
      id: timeline.id,
      kind: timeline.kind,
      label: createLaneLabel(timeline, parallelIndex),
      status: timeline.status,
      cursorMs: Math.max(0, timeline.cursorMs),
      durationMs,
      scaleStartMs,
      scaleCursorMs: scaleStartMs + Math.max(0, timeline.cursorMs),
      cursorPercent: percent(timeline.cursorMs, durationMs),
      minWidthPx: widths.minWidthPx,
      trackMinWidthPx: widths.trackMinWidthPx,
      bars: instances.map((instance) =>
        createBarProjection({
          stream,
          timeline,
          timelineDurationMs: durationMs,
          instance,
          color: colors.byThreadId[instance.canonicalThreadId],
          scaleStartMs,
        }),
      ),
    });
  }

  if (!runtimeHasMain && plannedMainLane) {
    lanes.unshift(plannedMainLane);
  }

  return { lanes: applySharedTimelineScale(lanes), hasRuntime: true };
}
