import { formatTimecode } from '../../../shared/timeline';
import { deriveStreamThreadColorMaps, type StreamThreadColor } from '../../../shared/streamThreadColors';
import { getAudioSubCueBaseDurationMs } from '../../../shared/audioSubCueAutomation';
import { resolveSubCuePassLoopTiming } from '../../../shared/subCuePassLoopTiming';
import type {
  AudioSourceId,
  CalculatedStreamTimeline,
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
  StreamRuntimeAudioSubCue,
  StreamRuntimeThreadInstance,
  StreamRuntimeTimelineInstance,
  StreamThreadId,
  SubCueId,
  VirtualOutputId,
} from '../../../shared/types';

export type OutputBusGanttRowProjection = {
  id: string;
  timelineId: string;
  timelineKind: StreamRuntimeTimelineInstance['kind'] | 'planned';
  timelineLabel: string;
  threadInstanceId?: string;
  canonicalThreadId: StreamThreadId;
  sceneId: SceneId;
  subCueId: SubCueId;
  audioSourceId: AudioSourceId;
  sceneLabel: string;
  audioLabel: string;
  title: string;
  metaLabel: string;
  timeLabel: string;
  levelLabel: string;
  muted: boolean;
  solo: boolean;
  copied: boolean;
  live: boolean;
  orphaned: boolean;
  startMs: number;
  durationMs?: number;
  endMs?: number;
  leftPercent: number;
  widthPercent: number;
  cursorPercent: number;
  color?: StreamThreadColor;
};

export type OutputBusGanttProjection = {
  status: 'no-stream' | 'invalid-timeline' | 'empty' | 'ready';
  rows: OutputBusGanttRowProjection[];
  hasRuntime: boolean;
  scaleDurationMs: number;
  cursorMs: number;
  cursorPercent: number;
  minWidthPx: number;
  trackMinWidthPx: number;
};

type RowSeed = Omit<
  OutputBusGanttRowProjection,
  'leftPercent' | 'widthPercent' | 'cursorPercent' | 'live' | 'orphaned' | 'timeLabel' | 'levelLabel'
> & {
  activeCue?: StreamRuntimeAudioSubCue;
};

const OUTPUT_GANTT_FIXED_WIDTH_PX = 128;

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

function audioLabel(state: DirectorState, audioSourceId: AudioSourceId): string {
  return state.audioSources[audioSourceId]?.label?.trim() || audioSourceId;
}

function levelLabel(sub: PersistedAudioSubCueConfig): string {
  const level = sub.levelDb ?? 0;
  return `${level > 0 ? '+' : ''}${level.toFixed(Number.isInteger(level) ? 0 : 1)} dB`;
}

function rowTimeLabel(startMs: number, durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return `${formatTimecode(startMs / 1000)} - live`;
  }
  return `${formatTimecode(startMs / 1000)} - ${formatTimecode((startMs + durationMs) / 1000)}`;
}

function outputGanttWidth(scaleDurationMs: number, rowCount: number): { minWidthPx: number; trackMinWidthPx: number } {
  const durationWidth = Math.ceil(scaleDurationMs / 1000) * 64;
  const rowWidth = Math.max(1, rowCount) * 96;
  const trackMinWidthPx = Math.max(420, durationWidth, rowWidth);
  return {
    minWidthPx: trackMinWidthPx + OUTPUT_GANTT_FIXED_WIDTH_PX,
    trackMinWidthPx,
  };
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

function audioSubCueDurationMs(sub: PersistedAudioSubCueConfig, state: DirectorState): number | undefined {
  const source = state.audioSources[sub.audioSourceId];
  const base = getAudioSubCueBaseDurationMs(sub, source?.durationSeconds, source?.playbackRate);
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

function cueAbsoluteStart(cue: StreamRuntimeAudioSubCue): number {
  return cue.streamStartMs + cue.localStartMs;
}

function activeCueForRow(args: {
  activeCues: StreamRuntimeAudioSubCue[];
  outputId: VirtualOutputId;
  sceneId: SceneId;
  subCueId: SubCueId;
  audioSourceId: AudioSourceId;
  threadInstanceId?: string;
  startMs: number;
}): StreamRuntimeAudioSubCue | undefined {
  const { activeCues, outputId, sceneId, subCueId, audioSourceId, threadInstanceId, startMs } = args;
  return activeCues.find((cue) => {
    if (cue.outputId !== outputId || cue.sceneId !== sceneId || cue.subCueId !== subCueId || cue.audioSourceId !== audioSourceId) {
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
  outputId: VirtualOutputId;
  activeCues: StreamRuntimeAudioSubCue[];
  timelineId: string;
  timelineKind: StreamRuntimeTimelineInstance['kind'] | 'planned';
  timelineLabel: string;
  scaleStartMs: number;
  instance: StreamRuntimeThreadInstance;
  color?: StreamThreadColor;
}): RowSeed[] {
  const {
    stream,
    state,
    playbackTimeline,
    outputId,
    activeCues,
    timelineId,
    timelineKind,
    timelineLabel,
    scaleStartMs,
    instance,
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
      if (!sub || sub.kind !== 'audio' || !sub.outputIds.includes(outputId)) {
        continue;
      }
      const localStartMs = sub.startOffsetMs ?? 0;
      const startMs = scaleStartMs + instance.timelineStartMs + sceneLocalStartMs + localStartMs;
      const durationMs = audioSubCueDurationMs(sub, state);
      const activeCue = activeCueForRow({
        activeCues,
        outputId,
        sceneId,
        subCueId,
        audioSourceId: sub.audioSourceId,
        threadInstanceId: instance.id.startsWith('planned:') ? undefined : instance.id,
        startMs,
      });
      const sourceLabel = audioLabel(state, sub.audioSourceId);
      const sceneName = sceneLabel(stream, sceneId);
      rows.push({
        id: `${timelineId}:${instance.id}:${sceneId}:${subCueId}:${outputId}:${startMs}`,
        timelineId,
        timelineKind,
        timelineLabel,
        threadInstanceId: instance.id.startsWith('planned:') ? undefined : instance.id,
        canonicalThreadId: instance.canonicalThreadId,
        sceneId,
        subCueId,
        audioSourceId: sub.audioSourceId,
        sceneLabel: sceneName,
        audioLabel: sourceLabel,
        title: sourceLabel,
        metaLabel: `${sceneName} | ${levelLabel(sub)}${sub.muted ? ' | muted' : ''}${sub.solo ? ' | solo' : ''}`,
        muted: sub.muted === true,
        solo: sub.solo === true,
        copied: instance.copiedFromThreadInstanceId !== undefined,
        startMs,
        durationMs,
        endMs: durationMs === undefined ? undefined : startMs + durationMs,
        color,
        activeCue,
      });
    }
  }
  return rows;
}

function plannedMainRows(args: {
  stream: PersistedStreamConfig;
  state: DirectorState;
  playbackTimeline: CalculatedStreamTimeline;
  outputId: VirtualOutputId;
  activeCues: StreamRuntimeAudioSubCue[];
}): RowSeed[] {
  const { stream, state, playbackTimeline, outputId, activeCues } = args;
  if (playbackTimeline.status !== 'valid') {
    return [];
  }
  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const threads = playbackTimeline.threadPlan?.threads ?? [];
  const segments = playbackTimeline.mainSegments ?? [];
  return segments.flatMap((segment) => {
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
      outputId,
      activeCues,
      timelineId: 'timeline:main',
      timelineKind: 'planned',
      timelineLabel: 'Main timeline',
      scaleStartMs: 0,
      instance,
      color: colors.byThreadId[segment.threadId],
    });
  });
}

function runtimeRows(args: {
  stream: PersistedStreamConfig;
  state: DirectorState;
  playbackTimeline: CalculatedStreamTimeline;
  runtime: NonNullable<StreamEnginePublicState['runtime']>;
  outputId: VirtualOutputId;
}): { rows: RowSeed[]; hasMain: boolean } {
  const { stream, state, playbackTimeline, runtime, outputId } = args;
  const colors = deriveStreamThreadColorMaps(playbackTimeline);
  const activeCues = runtime.activeAudioSubCues ?? [];
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
    for (const instanceId of timeline.orderedThreadInstanceIds) {
      const instance = runtime.threadInstances?.[instanceId];
      if (!instance) {
        continue;
      }
      rows.push(
        ...createRowsForThreadInstance({
          stream,
          state,
          playbackTimeline,
          outputId,
          activeCues,
          timelineId,
          timelineKind: timeline.kind,
          timelineLabel,
          scaleStartMs,
          instance,
          color: colors.byThreadId[instance.canonicalThreadId],
        }),
      );
    }
  }
  return { rows, hasMain };
}

function finalizeRows(seeds: RowSeed[], runtime: StreamEnginePublicState['runtime']): OutputBusGanttProjection {
  const cursorMs = runtimeCursorMs(runtime);
  const scaleDurationMs = Math.max(
    ...seeds.map((row) => row.endMs ?? row.startMs),
    0,
  );
  const widths = outputGanttWidth(scaleDurationMs, seeds.length);
  const rows = seeds
    .sort((left, right) => left.startMs - right.startMs || left.sceneLabel.localeCompare(right.sceneLabel) || left.audioLabel.localeCompare(right.audioLabel))
    .map((row): OutputBusGanttRowProjection => {
      const durationMs = row.durationMs;
      const live = row.activeCue !== undefined;
      return {
        ...row,
        live,
        orphaned: row.activeCue?.orphaned === true,
        timeLabel: rowTimeLabel(row.startMs, durationMs),
        levelLabel: row.metaLabel,
        leftPercent: percent(row.startMs, scaleDurationMs),
        widthPercent: durationMs !== undefined && durationMs > 0 ? Math.max(1.2, percent(durationMs, scaleDurationMs)) : 1.2,
        cursorPercent: live && durationMs !== undefined && durationMs > 0 ? percent(cursorMs - row.startMs, durationMs) : 0,
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
  };
}

export function deriveOutputBusGanttProjection(args: {
  streamState: StreamEnginePublicState | undefined;
  directorState: DirectorState;
  outputId: VirtualOutputId;
}): OutputBusGanttProjection {
  const { streamState, directorState, outputId } = args;
  if (!streamState) {
    return {
      status: 'no-stream',
      rows: [],
      hasRuntime: false,
      scaleDurationMs: 0,
      cursorMs: 0,
      cursorPercent: 0,
      minWidthPx: outputGanttWidth(0, 0).minWidthPx,
      trackMinWidthPx: outputGanttWidth(0, 0).trackMinWidthPx,
    };
  }
  const playbackTimeline = streamState.playbackTimeline;
  if (playbackTimeline.status !== 'valid' || !playbackTimeline.threadPlan) {
    const widths = outputGanttWidth(0, 0);
    return {
      status: 'invalid-timeline',
      rows: [],
      hasRuntime: streamState.runtime !== null,
      scaleDurationMs: 0,
      cursorMs: runtimeCursorMs(streamState.runtime),
      cursorPercent: 0,
      minWidthPx: widths.minWidthPx,
      trackMinWidthPx: widths.trackMinWidthPx,
    };
  }
  const activeCues = streamState.runtime?.activeAudioSubCues ?? [];
  let seeds: RowSeed[] = [];
  let runtimeHasMain = false;
  if (streamState.runtime?.timelineInstances && streamState.runtime.threadInstances && Object.keys(streamState.runtime.timelineInstances).length > 0) {
    const projected = runtimeRows({
      stream: streamState.playbackStream,
      state: directorState,
      playbackTimeline,
      runtime: streamState.runtime,
      outputId,
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
        outputId,
        activeCues,
      }),
    );
  }
  return finalizeRows(seeds, streamState.runtime);
}
