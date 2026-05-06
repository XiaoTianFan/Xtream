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
  cursorPercent: number;
  bars: StreamGanttBarProjection[];
};

export type StreamGanttProjection = {
  lanes: StreamGanttLaneProjection[];
  hasRuntime: boolean;
};

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

function createBarProjection(args: {
  stream: PersistedStreamConfig;
  timeline: StreamRuntimeTimelineInstance;
  timelineDurationMs: number;
  instance: StreamRuntimeThreadInstance;
  color?: StreamThreadColor;
}): StreamGanttBarProjection {
  const { stream, timeline, timelineDurationMs, instance, color } = args;
  const durationMs = Math.max(0, instance.durationMs ?? 0);
  const startMs = Math.max(0, instance.timelineStartMs);
  const endMs = startMs + durationMs;
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
    leftPercent: percent(startMs, timelineDurationMs),
    widthPercent: durationMs > 0 ? Math.max(1.5, percent(durationMs, timelineDurationMs)) : 1.5,
    cursorPercent: percent(localCursorMs, durationMs),
    launchPercent: percent(instance.launchLocalMs, durationMs),
    timeLabel: `${formatTimecode(startMs / 1000)} - ${formatTimecode(endMs / 1000)}`,
  };
}

export function deriveStreamGanttProjection(args: {
  stream: PersistedStreamConfig;
  playbackTimeline: CalculatedStreamTimeline;
  runtime: StreamEnginePublicState['runtime'];
}): StreamGanttProjection {
  const { stream, playbackTimeline, runtime } = args;
  if (!runtime?.timelineInstances || !runtime.threadInstances || Object.keys(runtime.timelineInstances).length === 0) {
    return { lanes: [], hasRuntime: false };
  }

  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const lanes: StreamGanttLaneProjection[] = [];
  let parallelIndex = 0;
  for (const timelineId of orderedTimelineIds(runtime)) {
    const timeline = runtime.timelineInstances[timelineId];
    if (!timeline) {
      continue;
    }
    if (timeline.kind === 'parallel') {
      parallelIndex += 1;
    }
    const instances = timeline.orderedThreadInstanceIds
      .map((id) => runtime.threadInstances?.[id])
      .filter(Boolean) as StreamRuntimeThreadInstance[];
    const durationMs = timelineDuration(timeline, instances);
    lanes.push({
      id: timeline.id,
      kind: timeline.kind,
      label: createLaneLabel(timeline, parallelIndex),
      status: timeline.status,
      cursorMs: Math.max(0, timeline.cursorMs),
      durationMs,
      cursorPercent: percent(timeline.cursorMs, durationMs),
      bars: instances.map((instance) =>
        createBarProjection({
          stream,
          timeline,
          timelineDurationMs: durationMs,
          instance,
          color: colors.byThreadId[instance.canonicalThreadId],
        }),
      ),
    });
  }

  return { lanes, hasRuntime: true };
}
