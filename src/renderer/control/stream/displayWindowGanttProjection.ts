import { resolveSubCuePassLoopTiming } from '../../../shared/subCuePassLoopTiming';
import { deriveStreamThreadColorMaps, type StreamThreadColor } from '../../../shared/streamThreadColors';
import { formatTimecode } from '../../../shared/timeline';
import { getVisualSubCueBaseDurationMs } from '../../../shared/visualSubCueTiming';
import {
  compareStreamDisplayLayerOrder,
  normalizeVisualMingleSettings,
  selectRenderableStreamDisplayLayerIds,
  type StreamDisplayLayerOrder,
} from '../../streamProjection';
import type {
  CalculatedStreamTimeline,
  DirectorState,
  DisplayWindowId,
  DisplayZoneId,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  StreamEnginePublicState,
  StreamRuntimeThreadInstance,
  StreamRuntimeTimelineInstance,
  StreamRuntimeVisualSubCue,
  StreamThreadId,
  SubCueId,
  VisualId,
  VisualMingleSettings,
} from '../../../shared/types';

export type DisplayWindowGanttRenderSegmentProjection = {
  startMs: number;
  endMs: number;
  leftPercent: number;
  widthPercent: number;
};

export type DisplayWindowGanttRowProjection = {
  id: string;
  timelineId: string;
  timelineKind: StreamRuntimeTimelineInstance['kind'] | 'planned';
  timelineLabel: string;
  threadInstanceId?: string;
  canonicalThreadId: StreamThreadId;
  sceneId: SceneId;
  subCueId: SubCueId;
  visualId: VisualId;
  displayId: DisplayWindowId;
  zoneId: DisplayZoneId;
  zoneLabel: string;
  sceneLabel: string;
  visualLabel: string;
  title: string;
  metaLabel: string;
  timeLabel: string;
  copied: boolean;
  live: boolean;
  orphaned: boolean;
  startMs: number;
  durationMs?: number;
  endMs?: number;
  visibleEndMs: number;
  leftPercent: number;
  widthPercent: number;
  cursorPercent: number;
  renderSegments: DisplayWindowGanttRenderSegmentProjection[];
  color?: StreamThreadColor;
};

export type DisplayWindowGanttProjection = {
  status: 'no-stream' | 'invalid-timeline' | 'empty' | 'ready';
  rows: DisplayWindowGanttRowProjection[];
  hasRuntime: boolean;
  scaleDurationMs: number;
  cursorMs: number;
  cursorPercent: number;
  minWidthPx: number;
  trackMinWidthPx: number;
  mingleMode: Required<VisualMingleSettings>['mode'];
  mingleAlgorithm: Required<VisualMingleSettings>['algorithm'];
  transitionMs: number;
};

type RowSeed = Omit<
  DisplayWindowGanttRowProjection,
  | 'leftPercent'
  | 'widthPercent'
  | 'cursorPercent'
  | 'live'
  | 'orphaned'
  | 'timeLabel'
  | 'renderSegments'
  | 'visibleEndMs'
  | 'zoneLabel'
> &
  StreamDisplayLayerOrder & {
    activeCue?: StreamRuntimeVisualSubCue;
  };

type RuntimeWithInstances = NonNullable<StreamEnginePublicState['runtime']>;

const DISPLAY_GANTT_FIXED_WIDTH_PX = 128;
const UNBOUNDED_VISIBLE_TAIL_MS = 10_000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function percent(value: number, total: number): number {
  return total > 0 ? clamp01(value / total) * 100 : 0;
}

function sceneLabel(stream: PersistedStreamConfig, sceneId: SceneId): string {
  return stream.scenes[sceneId]?.title?.trim() || sceneId;
}

function visualLabel(state: DirectorState, visualId: VisualId): string {
  return state.visuals[visualId]?.label?.trim() || visualId;
}

function zoneLabel(zoneId: DisplayZoneId): string {
  if (zoneId === 'L') {
    return 'Left zone';
  }
  if (zoneId === 'R') {
    return 'Right zone';
  }
  return 'Single zone';
}

function rowTimeLabel(startMs: number, durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return `${formatTimecode(startMs / 1000)} - live`;
  }
  return `${formatTimecode(startMs / 1000)} - ${formatTimecode((startMs + durationMs) / 1000)}`;
}

function displayGanttWidth(scaleDurationMs: number, rowCount: number): { minWidthPx: number; trackMinWidthPx: number } {
  const durationWidth = Math.ceil(scaleDurationMs / 1000) * 64;
  const rowWidth = Math.max(1, rowCount) * 96;
  const trackMinWidthPx = Math.max(420, durationWidth, rowWidth);
  return {
    minWidthPx: trackMinWidthPx + DISPLAY_GANTT_FIXED_WIDTH_PX,
    trackMinWidthPx,
  };
}

function orderedTimelineIds(runtime: RuntimeWithInstances): string[] {
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

function rawTimelineOrderIndex(runtime: RuntimeWithInstances, timelineId: string): number {
  const rawOrder = runtime.timelineOrder ?? Object.keys(runtime.timelineInstances ?? {});
  const index = rawOrder.indexOf(timelineId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function sceneOrderIndex(stream: PersistedStreamConfig, sceneId: SceneId): number {
  const index = stream.sceneOrder.indexOf(sceneId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function subCueOrderIndex(stream: PersistedStreamConfig, sceneId: SceneId, subCueId: SubCueId): number {
  const index = stream.scenes[sceneId]?.subCueOrder.indexOf(subCueId) ?? -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function visualSubCueDurationMs(sub: PersistedVisualSubCueConfig, state: DirectorState): number | undefined {
  const visual = state.visuals[sub.visualId];
  const base = getVisualSubCueBaseDurationMs(sub, visual, visual?.durationSeconds);
  if (base === undefined) {
    return undefined;
  }
  return resolveSubCuePassLoopTiming({
    pass: sub.pass,
    innerLoop: sub.innerLoop,
    legacyLoop: sub.loop,
    baseDurationMs: base,
  }).totalDurationMs;
}

function runtimeCursorMs(runtime: StreamEnginePublicState['runtime']): number {
  if (!runtime) {
    return 0;
  }
  return Math.max(0, runtime.currentStreamMs ?? runtime.pausedAtStreamMs ?? runtime.pausedCursorMs ?? runtime.offsetStreamMs ?? 0);
}

function cueAbsoluteStart(cue: StreamRuntimeVisualSubCue): number {
  return cue.streamStartMs + cue.localStartMs;
}

function activeCueForRow(args: {
  activeCues: StreamRuntimeVisualSubCue[];
  displayId: DisplayWindowId;
  zoneId: DisplayZoneId;
  sceneId: SceneId;
  subCueId: SubCueId;
  visualId: VisualId;
  threadInstanceId?: string;
  startMs: number;
}): StreamRuntimeVisualSubCue | undefined {
  const { activeCues, displayId, zoneId, sceneId, subCueId, visualId, threadInstanceId, startMs } = args;
  return activeCues.find((cue) => {
    if (
      cue.target.displayId !== displayId ||
      (cue.target.zoneId ?? 'single') !== zoneId ||
      cue.sceneId !== sceneId ||
      cue.subCueId !== subCueId ||
      cue.visualId !== visualId
    ) {
      return false;
    }
    if (threadInstanceId !== undefined && cue.runtimeInstanceId !== undefined && cue.runtimeInstanceId !== threadInstanceId) {
      return false;
    }
    return Math.abs(cueAbsoluteStart(cue) - startMs) <= 2;
  });
}

function createRowsForThreadInstance(args: {
  stream: PersistedStreamConfig;
  state: DirectorState;
  playbackTimeline: CalculatedStreamTimeline;
  displayId: DisplayWindowId;
  activeCues: StreamRuntimeVisualSubCue[];
  timelineId: string;
  timelineKind: StreamRuntimeTimelineInstance['kind'] | 'planned';
  timelineLabel: string;
  scaleStartMs: number;
  timelineOrderIndex: number;
  instance: StreamRuntimeThreadInstance;
  threadOrderIndex: number;
  color?: StreamThreadColor;
}): RowSeed[] {
  const {
    stream,
    state,
    playbackTimeline,
    displayId,
    activeCues,
    timelineId,
    timelineKind,
    timelineLabel,
    scaleStartMs,
    timelineOrderIndex,
    instance,
    threadOrderIndex,
    color,
  } = args;
  const thread = playbackTimeline.threadPlan?.threads.find((candidate) => candidate.threadId === instance.canonicalThreadId);
  if (!thread) {
    return [];
  }
  const rows: RowSeed[] = [];
  for (const sceneId of thread.sceneIds) {
    const scene = stream.scenes[sceneId];
    const entry = playbackTimeline.entries[sceneId];
    const timing =
      sceneId === thread.rootSceneId
        ? { sceneId, threadLocalStartMs: 0, threadLocalEndMs: entry?.durationMs }
        : thread.sceneTimings[sceneId];
    const sceneLocalStartMs = timing?.threadLocalStartMs;
    if (!scene || scene.disabled || sceneLocalStartMs === undefined || instance.launchLocalMs > sceneLocalStartMs) {
      continue;
    }
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub || sub.kind !== 'visual') {
        continue;
      }
      const targets = sub.targets.filter((target) => target.displayId === displayId);
      if (targets.length === 0) {
        continue;
      }
      const localStartMs = sub.startOffsetMs ?? 0;
      const startMs = scaleStartMs + instance.timelineStartMs + sceneLocalStartMs + localStartMs;
      const durationMs = visualSubCueDurationMs(sub, state);
      const sceneName = sceneLabel(stream, sceneId);
      const sourceLabel = visualLabel(state, sub.visualId);
      for (const target of targets) {
        const zoneId = target.zoneId ?? 'single';
        const activeCue = activeCueForRow({
          activeCues,
          displayId,
          zoneId,
          sceneId,
          subCueId,
          visualId: sub.visualId,
          threadInstanceId: instance.id.startsWith('planned:') ? undefined : instance.id,
          startMs,
        });
        const threadInstanceId = instance.id.startsWith('planned:') ? undefined : instance.id;
        const layerId = `gantt-visual:${timelineId}:${threadInstanceId ?? 'planned'}:${sceneId}:${subCueId}:${displayId}:${zoneId}:${startMs}`;
        rows.push({
          id: `${timelineId}:${instance.id}:${sceneId}:${subCueId}:${displayId}:${zoneId}:${startMs}`,
          layerId,
          timelineId,
          timelineKind,
          timelineLabel,
          threadInstanceId,
          canonicalThreadId: instance.canonicalThreadId,
          sceneId,
          subCueId,
          visualId: sub.visualId,
          displayId,
          zoneId,
          sceneLabel: sceneName,
          visualLabel: sourceLabel,
          title: sourceLabel,
          metaLabel: `${sceneName} | ${zoneLabel(zoneId)}`,
          copied: instance.copiedFromThreadInstanceId !== undefined,
          startMs,
          durationMs,
          endMs: durationMs === undefined ? undefined : startMs + durationMs,
          absoluteStartMs: startMs,
          timelineOrderIndex,
          threadOrderIndex,
          runtimeInstanceId: threadInstanceId,
          sceneOrderIndex: sceneOrderIndex(stream, sceneId),
          subCueOrderIndex: subCueOrderIndex(stream, sceneId, subCueId),
          color,
          activeCue,
        });
      }
    }
  }
  return rows;
}

function plannedMainRows(args: {
  stream: PersistedStreamConfig;
  state: DirectorState;
  playbackTimeline: CalculatedStreamTimeline;
  displayId: DisplayWindowId;
  activeCues: StreamRuntimeVisualSubCue[];
}): RowSeed[] {
  const { stream, state, playbackTimeline, displayId, activeCues } = args;
  if (playbackTimeline.status !== 'valid') {
    return [];
  }
  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const threads = playbackTimeline.threadPlan?.threads ?? [];
  const segments = playbackTimeline.mainSegments ?? [];
  return segments.flatMap((segment, segmentIndex) => {
    const thread = threads.find((candidate) => candidate.threadId === segment.threadId);
    if (!thread) {
      return [];
    }
    const instance: StreamRuntimeThreadInstance = {
      id: `planned:${segment.threadId}`,
      canonicalThreadId: segment.threadId,
      timelineId: 'timeline:main',
      rootSceneId: segment.rootSceneId,
      launchSceneId: segment.rootSceneId,
      launchLocalMs: 0,
      state: 'ready',
      timelineStartMs: segment.startMs,
      durationMs: segment.durationMs,
    };
    return createRowsForThreadInstance({
      stream,
      state,
      playbackTimeline,
      displayId,
      activeCues,
      timelineId: 'timeline:main',
      timelineKind: 'planned',
      timelineLabel: 'Main timeline',
      scaleStartMs: 0,
      timelineOrderIndex: 0,
      instance,
      threadOrderIndex: segmentIndex,
      color: colors.byThreadId[segment.threadId],
    });
  });
}

function runtimeRows(args: {
  stream: PersistedStreamConfig;
  state: DirectorState;
  playbackTimeline: CalculatedStreamTimeline;
  runtime: RuntimeWithInstances;
  displayId: DisplayWindowId;
}): { rows: RowSeed[]; hasMain: boolean } {
  const { stream, state, playbackTimeline, runtime, displayId } = args;
  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const activeCues = runtime.activeVisualSubCues ?? [];
  const rows: RowSeed[] = [];
  let hasMain = false;
  let parallelIndex = 0;
  for (const timelineId of orderedTimelineIds(runtime)) {
    const timeline = runtime.timelineInstances?.[timelineId];
    if (!timeline) {
      continue;
    }
    if (timeline.kind === 'main') {
      hasMain = true;
    } else {
      parallelIndex += 1;
    }
    const timelineLabel = timeline.kind === 'main' ? 'Main timeline' : `Parallel ${parallelIndex}`;
    const scaleStartMs = timeline.kind === 'parallel' ? Math.max(0, timeline.spawnedAtStreamMs ?? 0) : 0;
    for (const [threadOrderIndex, instanceId] of timeline.orderedThreadInstanceIds.entries()) {
      const instance = runtime.threadInstances?.[instanceId];
      if (!instance) {
        continue;
      }
      rows.push(
        ...createRowsForThreadInstance({
          stream,
          state,
          playbackTimeline,
          displayId,
          activeCues,
          timelineId,
          timelineKind: timeline.kind,
          timelineLabel,
          scaleStartMs,
          timelineOrderIndex: rawTimelineOrderIndex(runtime, timelineId),
          instance,
          threadOrderIndex,
          color: colors.byThreadId[instance.canonicalThreadId],
        }),
      );
    }
  }
  return { rows, hasMain };
}

function deriveScaleDurationMs(seeds: RowSeed[]): number {
  return Math.max(
    ...seeds.map((row) => row.endMs ?? row.startMs + UNBOUNDED_VISIBLE_TAIL_MS),
    0,
  );
}

function addMergedSegment(segments: Map<string, Array<{ startMs: number; endMs: number }>>, rowId: string, startMs: number, endMs: number): void {
  if (endMs <= startMs) {
    return;
  }
  const list = segments.get(rowId) ?? [];
  const previous = list[list.length - 1];
  if (previous && previous.endMs >= startMs) {
    previous.endMs = Math.max(previous.endMs, endMs);
  } else {
    list.push({ startMs, endMs });
  }
  segments.set(rowId, list);
}

function buildRenderSegments(seeds: RowSeed[], scaleDurationMs: number, settings: Required<VisualMingleSettings>): Map<string, Array<{ startMs: number; endMs: number }>> {
  const segments = new Map<string, Array<{ startMs: number; endMs: number }>>();
  const rows = seeds
    .map((row) => ({ ...row, visibleEndMs: row.endMs ?? scaleDurationMs }))
    .filter((row) => row.visibleEndMs > row.startMs);
  const zoneIds = new Set(rows.map((row) => row.zoneId));

  for (const zoneId of zoneIds) {
    const zoneRows = rows
      .filter((row) => row.zoneId === zoneId)
      .sort((left, right) => compareStreamDisplayLayerOrder(left, right));
    if (settings.mode === 'layered') {
      for (const row of zoneRows) {
        addMergedSegment(segments, row.id, row.startMs, row.visibleEndMs);
      }
      continue;
    }

    const boundaries = new Set<number>();
    for (const row of zoneRows) {
      boundaries.add(row.startMs);
      boundaries.add(row.visibleEndMs);
      if (settings.defaultTransitionMs > 0) {
        boundaries.add(Math.min(scaleDurationMs, row.startMs + settings.defaultTransitionMs));
      }
    }
    const sortedBoundaries = [...boundaries]
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= scaleDurationMs)
      .sort((left, right) => left - right);
    for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
      const startMs = sortedBoundaries[i]!;
      const endMs = sortedBoundaries[i + 1]!;
      if (endMs <= startMs) {
        continue;
      }
      const activeRows = zoneRows
        .filter((row) => row.startMs <= startMs && row.visibleEndMs > startMs)
        .sort((left, right) => compareStreamDisplayLayerOrder(left, right));
      const selectedIds = selectRenderableStreamDisplayLayerIds(activeRows, settings, startMs);
      for (const row of activeRows) {
        if (selectedIds.has(row.layerId)) {
          addMergedSegment(segments, row.id, Math.max(startMs, row.startMs), Math.min(endMs, row.visibleEndMs));
        }
      }
    }
  }

  return segments;
}

function segmentProjection(row: { startMs: number; visibleEndMs: number }, segment: { startMs: number; endMs: number }): DisplayWindowGanttRenderSegmentProjection {
  const durationMs = Math.max(0, row.visibleEndMs - row.startMs);
  return {
    startMs: segment.startMs,
    endMs: segment.endMs,
    leftPercent: percent(segment.startMs - row.startMs, durationMs),
    widthPercent: Math.max(0.6, percent(segment.endMs - segment.startMs, durationMs)),
  };
}

function finalizeRows(
  seeds: RowSeed[],
  runtime: StreamEnginePublicState['runtime'],
  settings: Required<VisualMingleSettings>,
): DisplayWindowGanttProjection {
  const cursorMs = runtimeCursorMs(runtime);
  const scaleDurationMs = deriveScaleDurationMs(seeds);
  const widths = displayGanttWidth(scaleDurationMs, seeds.length);
  const renderSegmentsByRow = buildRenderSegments(seeds, scaleDurationMs, settings);
  const rows = seeds
    .sort((left, right) => left.startMs - right.startMs || left.sceneLabel.localeCompare(right.sceneLabel) || left.visualLabel.localeCompare(right.visualLabel))
    .map((row): DisplayWindowGanttRowProjection => {
      const durationMs = row.durationMs;
      const visibleEndMs = row.endMs ?? scaleDurationMs;
      const visibleDurationMs = Math.max(0, visibleEndMs - row.startMs);
      const live = row.activeCue !== undefined;
      return {
        ...row,
        zoneLabel: zoneLabel(row.zoneId),
        live,
        orphaned: row.activeCue?.orphaned === true,
        timeLabel: rowTimeLabel(row.startMs, durationMs),
        visibleEndMs,
        leftPercent: percent(row.startMs, scaleDurationMs),
        widthPercent: visibleDurationMs > 0 ? Math.max(1.2, percent(visibleDurationMs, scaleDurationMs)) : 1.2,
        cursorPercent: live && visibleDurationMs > 0 ? percent(cursorMs - row.startMs, visibleDurationMs) : 0,
        renderSegments: (renderSegmentsByRow.get(row.id) ?? []).map((segment) => segmentProjection({ startMs: row.startMs, visibleEndMs }, segment)),
      };
    });
  return {
    status: rows.length > 0 ? 'ready' : 'empty',
    rows,
    hasRuntime: runtime !== null,
    scaleDurationMs,
    cursorMs,
    cursorPercent: percent(cursorMs, scaleDurationMs),
    minWidthPx: widths.minWidthPx,
    trackMinWidthPx: widths.trackMinWidthPx,
    mingleMode: settings.mode,
    mingleAlgorithm: settings.algorithm,
    transitionMs: settings.defaultTransitionMs,
  };
}

export function deriveDisplayWindowGanttProjection(args: {
  streamState: StreamEnginePublicState | undefined;
  directorState: DirectorState;
  displayId: DisplayWindowId;
}): DisplayWindowGanttProjection {
  const { streamState, directorState, displayId } = args;
  const settings = normalizeVisualMingleSettings(directorState.displayVisualMingle?.[displayId]);
  if (!streamState) {
    return {
      status: 'no-stream',
      rows: [],
      hasRuntime: false,
      scaleDurationMs: 0,
      cursorMs: 0,
      cursorPercent: 0,
      minWidthPx: displayGanttWidth(0, 0).minWidthPx,
      trackMinWidthPx: displayGanttWidth(0, 0).trackMinWidthPx,
      mingleMode: settings.mode,
      mingleAlgorithm: settings.algorithm,
      transitionMs: settings.defaultTransitionMs,
    };
  }
  const playbackTimeline = streamState.playbackTimeline;
  if (playbackTimeline.status !== 'valid' || !playbackTimeline.threadPlan) {
    const widths = displayGanttWidth(0, 0);
    return {
      status: 'invalid-timeline',
      rows: [],
      hasRuntime: streamState.runtime !== null,
      scaleDurationMs: 0,
      cursorMs: runtimeCursorMs(streamState.runtime),
      cursorPercent: 0,
      minWidthPx: widths.minWidthPx,
      trackMinWidthPx: widths.trackMinWidthPx,
      mingleMode: settings.mode,
      mingleAlgorithm: settings.algorithm,
      transitionMs: settings.defaultTransitionMs,
    };
  }

  const activeCues = streamState.runtime?.activeVisualSubCues ?? [];
  let seeds: RowSeed[] = [];
  let runtimeHasMain = false;
  if (streamState.runtime?.timelineInstances && streamState.runtime.threadInstances && Object.keys(streamState.runtime.timelineInstances).length > 0) {
    const projected = runtimeRows({
      stream: streamState.playbackStream,
      state: directorState,
      playbackTimeline,
      runtime: streamState.runtime,
      displayId,
    });
    seeds = projected.rows;
    runtimeHasMain = projected.hasMain;
  }
  if (seeds.length === 0 || !runtimeHasMain) {
    seeds.unshift(
      ...plannedMainRows({
        stream: streamState.playbackStream,
        state: directorState,
        playbackTimeline,
        displayId,
        activeCues,
      }),
    );
  }
  return finalizeRows(seeds, streamState.runtime, settings);
}
