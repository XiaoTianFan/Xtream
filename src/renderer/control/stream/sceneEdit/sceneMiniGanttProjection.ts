import { getAudioSubCueBaseDurationMs } from '../../../../shared/audioSubCueAutomation';
import { resolveSubCuePassLoopTiming } from '../../../../shared/subCuePassLoopTiming';
import { formatTimecode } from '../../../../shared/timeline';
import { getVisualSubCueBaseDurationMs } from '../../../../shared/visualSubCueTiming';
import type {
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedSubCueConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SubCueId,
} from '../../../../shared/types';
import { formatSubCueLabel } from '../formatting';

export type SceneMiniGanttRowProjection = {
  id: string;
  sceneId: SceneId;
  subCueId: SubCueId;
  kind: PersistedSubCueConfig['kind'];
  title: string;
  metaLabel: string;
  timeLabel: string;
  startMs: number;
  durationMs?: number;
  endMs?: number;
  unbounded: boolean;
  leftPercent: number;
  widthPercent: number;
};

export type SceneMiniGanttProjection = {
  status: 'empty' | 'ready';
  rows: SceneMiniGanttRowProjection[];
  scaleDurationMs: number;
  minWidthPx: number;
  trackMinWidthPx: number;
};

const DEFAULT_SCENE_MINI_GANTT_RANGE_MS = 10_000;
const SCENE_MINI_GANTT_FIXED_WIDTH_PX = 132;
const INFINITE_VISIBLE_TAIL_MS = DEFAULT_SCENE_MINI_GANTT_RANGE_MS;

function safeMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function percent(value: number, total: number): number {
  if (total <= 0 || !Number.isFinite(total) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / total)) * 100;
}

function kindLabel(kind: PersistedSubCueConfig['kind']): string {
  if (kind === 'audio') {
    return 'Audio';
  }
  if (kind === 'visual') {
    return 'Visual';
  }
  return 'Control';
}

function expandedAudioDurationMs(sub: PersistedAudioSubCueConfig, state: DirectorState | undefined): number | undefined {
  const source = state?.audioSources?.[sub.audioSourceId];
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

function expandedVisualDurationMs(sub: PersistedVisualSubCueConfig, state: DirectorState | undefined): number | undefined {
  const visual = state?.visuals?.[sub.visualId];
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

function expandedSubCueDurationMs(sub: PersistedSubCueConfig, state: DirectorState | undefined): number | undefined {
  if (sub.kind === 'audio') {
    return expandedAudioDurationMs(sub, state);
  }
  if (sub.kind === 'visual') {
    return expandedVisualDurationMs(sub, state);
  }
  return 0;
}

function rowTimeLabel(startMs: number, durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return `${formatTimecode(startMs / 1000)} - live`;
  }
  if (durationMs <= 0) {
    return formatTimecode(startMs / 1000);
  }
  return `${formatTimecode(startMs / 1000)} - ${formatTimecode((startMs + durationMs) / 1000)}`;
}

function widthForProjection(scaleDurationMs: number, rowCount: number): { minWidthPx: number; trackMinWidthPx: number } {
  const durationWidth = Math.ceil(scaleDurationMs / 1000) * 64;
  const rowWidth = Math.max(1, rowCount) * 96;
  const trackMinWidthPx = Math.max(420, durationWidth, rowWidth);
  return {
    minWidthPx: trackMinWidthPx + SCENE_MINI_GANTT_FIXED_WIDTH_PX,
    trackMinWidthPx,
  };
}

function deriveScaleDuration(rows: Array<{ startMs: number; endMs?: number; unbounded: boolean }>): number {
  const finiteEndMs = rows.reduce((max, row) => Math.max(max, row.endMs ?? 0), 0);
  const unboundedTailEndMs = rows.reduce(
    (max, row) => (row.unbounded ? Math.max(max, row.startMs + INFINITE_VISIBLE_TAIL_MS) : max),
    0,
  );
  return Math.max(DEFAULT_SCENE_MINI_GANTT_RANGE_MS, finiteEndMs, unboundedTailEndMs);
}

export function deriveSceneMiniGanttProjection(args: {
  scene: PersistedSceneConfig;
  currentState: DirectorState | undefined;
}): SceneMiniGanttProjection {
  const { scene, currentState } = args;
  const seeds = scene.subCueOrder.flatMap((subCueId) => {
    const sub = scene.subCues[subCueId];
    if (!sub) {
      return [];
    }
    const startMs = safeMs(sub.startOffsetMs);
    const durationMs = expandedSubCueDurationMs(sub, currentState);
    const normalizedDurationMs = durationMs !== undefined ? Math.max(0, durationMs) : undefined;
    return [
      {
        sub,
        subCueId,
        startMs,
        durationMs: normalizedDurationMs,
        endMs: normalizedDurationMs === undefined ? undefined : startMs + normalizedDurationMs,
        unbounded: normalizedDurationMs === undefined,
      },
    ];
  });

  const scaleDurationMs = deriveScaleDuration(seeds);
  const widths = widthForProjection(scaleDurationMs, seeds.length);
  const rows = seeds.map((row): SceneMiniGanttRowProjection => {
    const leftPercent = percent(row.startMs, scaleDurationMs);
    const widthPercent = row.unbounded
      ? Math.max(16, 100 - leftPercent + 24)
      : row.durationMs !== undefined && row.durationMs > 0
        ? Math.max(1.4, percent(row.durationMs, scaleDurationMs))
        : 1.4;
    return {
      id: `${scene.id}:${row.subCueId}`,
      sceneId: scene.id,
      subCueId: row.subCueId,
      kind: row.sub.kind,
      title: formatSubCueLabel(currentState, row.sub),
      metaLabel: `${kindLabel(row.sub.kind)} | ${row.subCueId}`,
      timeLabel: rowTimeLabel(row.startMs, row.durationMs),
      startMs: row.startMs,
      durationMs: row.durationMs,
      endMs: row.endMs,
      unbounded: row.unbounded,
      leftPercent,
      widthPercent,
    };
  });

  return {
    status: rows.length > 0 ? 'ready' : 'empty',
    rows,
    scaleDurationMs,
    minWidthPx: widths.minWidthPx,
    trackMinWidthPx: widths.trackMinWidthPx,
  };
}
