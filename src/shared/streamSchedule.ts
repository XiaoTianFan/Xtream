import type {
  AudioSourceId,
  CalculatedStreamTimeline,
  DirectorState,
  DisplayZoneId,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  SceneTrigger,
  SubCueId,
  VisualId,
  VirtualOutputId,
} from './types';
import { createLoopValidationMessages, resolveLoopTiming } from './streamLoopTiming';
import { PATCH_COMPAT_SCENE_ID } from './streamWorkspace';

export type ValidateStreamContentContext = {
  visuals?: ReadonlySet<VisualId>;
  audioSources?: ReadonlySet<AudioSourceId>;
  outputs?: ReadonlySet<VirtualOutputId>;
  displayZones?: ReadonlyMap<string, ReadonlySet<DisplayZoneId>>;
  audioSourceLabels?: ReadonlyMap<AudioSourceId, string>;
  visualLabels?: ReadonlyMap<VisualId, string>;
};

/** Structured authoring validation (disk + live context); used for messages, UI highlights, and scene runtime `error`. */
export type StreamScheduleIssue = {
  severity: 'error' | 'warning';
  sceneId?: SceneId;
  subCueId?: SubCueId;
  message: string;
};

/** Operator-facing scene label: titled scenes use quotes; otherwise cue number in stream order. */
export function scenePrimaryLabel(stream: PersistedStreamConfig, sceneId: SceneId): string {
  const scene = stream.scenes[sceneId];
  const t = scene?.title?.trim();
  if (t) {
    return `Scene "${t}"`;
  }
  const n = stream.sceneOrder.indexOf(sceneId);
  if (n >= 0) {
    return `Scene ${n + 1}`;
  }
  return `Scene ${sceneId}`;
}

function subCueOrdinalKind(stream: PersistedStreamConfig, sceneId: SceneId, subCueId: SubCueId, kind: 'audio' | 'visual' | 'control'): string {
  const scene = stream.scenes[sceneId];
  const idx = scene?.subCueOrder.indexOf(subCueId) ?? -1;
  const ord = idx >= 0 ? idx + 1 : 0;
  const kindWord = kind === 'audio' ? 'audio' : kind === 'visual' ? 'visual' : 'control';
  return ord > 0 ? `${kindWord} sub-cue no.${ord}` : `${kindWord} sub-cue`;
}

function pushLoopIssues(out: StreamScheduleIssue[], messages: string[], sceneId: SceneId, subCueId?: SubCueId): void {
  for (const message of messages) {
    out.push({ severity: 'error', sceneId, subCueId, message });
  }
}

export function validateStreamContextFromDirector(state: DirectorState | undefined): ValidateStreamContentContext {
  if (!state) {
    return {};
  }
  return {
    visuals: new Set(Object.keys(state.visuals ?? {})),
    audioSources: new Set(Object.keys(state.audioSources ?? {})),
    outputs: new Set(Object.keys(state.outputs ?? {})),
    displayZones: new Map(
      Object.values(state.displays ?? {}).map((display) => [
        display.id,
        new Set(display.layout.type === 'split' ? (['L', 'R'] as const) : (['single'] as const)),
      ]),
    ),
    audioSourceLabels: new Map(Object.values(state.audioSources ?? {}).map((s) => [s.id, s.label])),
    visualLabels: new Map(Object.values(state.visuals ?? {}).map((v) => [v.id, v.label])),
  };
}

/** Authoring issues for Stream UI (structure, triggers, content, optional playback timeline projection). */
export function getAuthoringIssuesForStreamUi(
  stream: PersistedStreamConfig,
  context: ValidateStreamContentContext,
  playbackTimeline?: Pick<CalculatedStreamTimeline, 'issues'>,
): StreamScheduleIssue[] {
  const out = [...validateStreamStructureIssues(stream), ...validateTriggerReferencesIssues(stream), ...validateStreamContentIssues(stream, context)];
  if (playbackTimeline?.issues?.length) {
    for (const issue of playbackTimeline.issues) {
      out.push({
        severity: issue.severity,
        sceneId: issue.sceneId,
        subCueId: issue.subCueId,
        message: `Stream timeline: ${issue.message}`,
      });
    }
  }
  return out;
}

/** Scene / sub-cue keys with severity `error` for list + edit-pane highlighting. */
export function getStreamAuthoringErrorHighlights(
  stream: PersistedStreamConfig,
  context: ValidateStreamContentContext,
  playbackTimeline?: Pick<CalculatedStreamTimeline, 'issues'>,
): {
  scenesWithErrors: ReadonlySet<SceneId>;
  subCuesWithErrors: ReadonlyMap<SceneId, ReadonlySet<SubCueId>>;
} {
  const issues = getAuthoringIssuesForStreamUi(stream, context, playbackTimeline);
  const scenesWithErrors = new Set<SceneId>();
  const subCueMap = new Map<SceneId, Set<SubCueId>>();
  for (const i of issues) {
    if (i.severity !== 'error' || !i.sceneId) {
      continue;
    }
    scenesWithErrors.add(i.sceneId);
    if (i.subCueId) {
      let bucket = subCueMap.get(i.sceneId);
      if (!bucket) {
        bucket = new Set();
        subCueMap.set(i.sceneId, bucket);
      }
      bucket.add(i.subCueId);
    }
  }
  return { scenesWithErrors, subCuesWithErrors: subCueMap };
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

export function validateStreamStructureIssues(stream: PersistedStreamConfig): StreamScheduleIssue[] {
  const out: StreamScheduleIssue[] = [];
  const seen = new Set<SceneId>();
  for (const id of stream.sceneOrder) {
    if (seen.has(id)) {
      out.push({ severity: 'error', sceneId: id, message: `Duplicate scene id in sceneOrder: ${id}` });
    }
    seen.add(id);
    if (!stream.scenes[id]) {
      out.push({ severity: 'error', sceneId: id, message: `sceneOrder references missing scene: ${id}` });
    }
  }
  for (const id of Object.keys(stream.scenes)) {
    const sid = id as SceneId;
    if (!seen.has(sid)) {
      out.push({
        severity: 'error',
        sceneId: sid,
        message: `${scenePrimaryLabel(stream, sid)} is not listed in sceneOrder`,
      });
    }
    if (stream.scenes[sid].id !== sid) {
      out.push({ severity: 'error', sceneId: sid, message: `Scene record id mismatch for ${sid}` });
    }
  }
  return out;
}

export function validateStreamStructure(stream: PersistedStreamConfig): string[] {
  return validateStreamStructureIssues(stream).map((i) => i.message);
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

export function validateTriggerReferencesIssues(stream: PersistedStreamConfig): StreamScheduleIssue[] {
  const out: StreamScheduleIssue[] = [];
  const ids = new Set(stream.sceneOrder);
  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const pred = resolveFollowsSceneId(stream, sceneId, scene.trigger);
    if (pred && !ids.has(pred)) {
      out.push({
        severity: 'error',
        sceneId,
        message: `${scenePrimaryLabel(stream, sceneId)} references missing predecessor ${pred}`,
      });
    }
    const tr = scene.trigger;
    if ((tr.type === 'follow-start' || tr.type === 'follow-end') && tr.delayMs !== undefined && tr.delayMs < 0) {
      out.push({ severity: 'error', sceneId, message: `${scenePrimaryLabel(stream, sceneId)} has negative trigger delay` });
    }
    if (scene.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < 0) {
      out.push({ severity: 'error', sceneId, message: `${scenePrimaryLabel(stream, sceneId)} has negative timecode` });
    }
  }
  if (hasTriggerCycle(stream)) {
    out.push({ severity: 'error', message: 'Trigger dependency graph contains a cycle' });
  }
  return out;
}

export function validateTriggerReferences(stream: PersistedStreamConfig): string[] {
  return validateTriggerReferencesIssues(stream).map((i) => i.message);
}

export function validateStreamContentIssues(stream: PersistedStreamConfig, context: ValidateStreamContentContext = {}): StreamScheduleIssue[] {
  const out: StreamScheduleIssue[] = [];
  if (stream.sceneOrder.length === 0) {
    out.push({ severity: 'error', message: 'Stream must contain at least one scene' });
  }

  for (const sceneId of stream.sceneOrder) {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const sceneLabel = scenePrimaryLabel(stream, sceneId);
    pushLoopIssues(
      out,
      createLoopValidationMessages({ policy: scene.loop, label: `${sceneLabel} · scene loop` }),
      sceneId,
    );
    if (scene.preload.leadTimeMs !== undefined && scene.preload.leadTimeMs < 0) {
      out.push({ severity: 'error', sceneId, message: `${sceneLabel} has negative preload lead time` });
    }

    const seenSubCues = new Set<string>();
    for (const subCueId of scene.subCueOrder) {
      if (seenSubCues.has(subCueId)) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} lists the same sub-cue more than once in sub-cue order`,
        });
      }
      seenSubCues.add(subCueId);
      const subCue = scene.subCues[subCueId];
      if (!subCue) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} references missing sub-cue slot in order`,
        });
        continue;
      }
      if (subCue.id !== subCueId) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} — record id mismatch`,
        });
      }
      if ('startOffsetMs' in subCue && subCue.startOffsetMs !== undefined && subCue.startOffsetMs < 0) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has negative start offset`,
        });
      }
      if ('durationOverrideMs' in subCue && subCue.durationOverrideMs !== undefined && subCue.durationOverrideMs < 0) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has negative duration override`,
        });
      }
      if ('playbackRate' in subCue && subCue.playbackRate !== undefined && subCue.playbackRate <= 0) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has non-positive playback rate`,
        });
      }
      if (subCue.kind === 'audio') {
        const ordLabel = subCueOrdinalKind(stream, sceneId, subCueId, 'audio');
        pushLoopIssues(
          out,
          createLoopValidationMessages({ policy: subCue.loop, label: `${sceneLabel} · ${ordLabel}` }),
          sceneId,
          subCueId,
        );
        if (context.audioSources && !context.audioSources.has(subCue.audioSourceId)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} references missing audio source ${subCue.audioSourceId}`,
          });
        }
        if (sceneId !== PATCH_COMPAT_SCENE_ID && subCue.outputIds.length === 0) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel}: ${ordLabel} "${audioSubCueValidationLabel(subCue, context)}" has no output targets`,
          });
        }
        for (const outputId of subCue.outputIds) {
          if (context.outputs && !context.outputs.has(outputId)) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} references missing output ${outputId}`,
            });
          }
        }
      } else if (subCue.kind === 'visual') {
        const ordLabel = subCueOrdinalKind(stream, sceneId, subCueId, 'visual');
        pushLoopIssues(
          out,
          createLoopValidationMessages({ policy: subCue.loop, label: `${sceneLabel} · ${ordLabel}` }),
          sceneId,
          subCueId,
        );
        if (context.visuals && !context.visuals.has(subCue.visualId)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} references missing visual ${subCue.visualId}`,
          });
        }
        if (sceneId !== PATCH_COMPAT_SCENE_ID && subCue.targets.length === 0) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel}: ${ordLabel} "${visualSubCueValidationLabel(subCue, context)}" has no display targets`,
          });
        }
        for (const target of subCue.targets) {
          const zone = target.zoneId ?? 'single';
          const available = context.displayZones?.get(target.displayId);
          const ordLabelV = subCueOrdinalKind(stream, sceneId, subCueId, 'visual');
          if (context.displayZones && !available) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabelV} references missing display ${target.displayId}`,
            });
          } else if (available && !available.has(zone)) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabelV} references missing display zone ${target.displayId}:${zone}`,
            });
          }
        }
      } else if (subCue.kind === 'control') {
        const ordLabel = subCueOrdinalKind(stream, sceneId, subCueId, 'control');
        const action = subCue.action;
        if ('sceneId' in action && !stream.scenes[action.sceneId]) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} references missing scene ${action.sceneId}`,
          });
        }
        if ('subCueRef' in action) {
          const refScene = stream.scenes[action.subCueRef.sceneId];
          if (!refScene) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} references missing scene ${action.subCueRef.sceneId}`,
            });
          } else if (!refScene.subCues[action.subCueRef.subCueId]) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} references missing sub-cue in another scene`,
            });
          }
        }
      }
    }
    for (const subCueId of Object.keys(scene.subCues)) {
      if (!seenSubCues.has(subCueId)) {
        const sc = scene.subCues[subCueId];
        const kind = sc?.kind ?? 'audio';
        out.push({
          severity: 'error',
          sceneId,
          subCueId: subCueId as SubCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId as SubCueId, kind === 'visual' ? 'visual' : kind === 'control' ? 'control' : 'audio')} is not listed in subCueOrder`,
        });
      }
    }
  }

  return out;
}

export function validateStreamContent(stream: PersistedStreamConfig, context: ValidateStreamContentContext = {}): string[] {
  return validateStreamContentIssues(stream, context).map((i) => i.message);
}

export type StreamScheduleEntry = {
  sceneId: SceneId;
  startMs?: number;
  durationMs?: number;
  endMs?: number;
  triggerKnown: boolean;
};

export type StreamSchedule = {
  status: 'valid' | 'invalid';
  entries: Record<SceneId, StreamScheduleEntry>;
  expectedDurationMs?: number;
  issues: StreamScheduleIssue[];
  notice?: string;
};

function subCueBaseDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  let base: number | undefined;
  if (sub.kind === 'visual') {
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const d = visualDurations[sub.visualId];
    if (d === undefined && sub.durationOverrideMs === undefined) {
      return undefined;
    }
    base = d === undefined ? sub.durationOverrideMs : (d * 1000) / rate;
  } else if (sub.kind === 'audio') {
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const d = audioDurations[sub.audioSourceId];
    if (d === undefined && sub.durationOverrideMs === undefined) {
      return undefined;
    }
    base = d === undefined ? sub.durationOverrideMs : (d * 1000) / rate;
  } else {
    return 0;
  }
  if (base === undefined) {
    return undefined;
  }
  if (sub.durationOverrideMs !== undefined) {
    base = Math.min(base, sub.durationOverrideMs);
  }
  return base;
}

function subCueEffectiveDurationMs(
  sub: PersistedSceneConfig['subCues'][string],
  visualDurations: Record<VisualId, number>,
  audioDurations: Record<AudioSourceId, number>,
): number | undefined {
  const base = subCueBaseDurationMs(sub, visualDurations, audioDurations);
  if (base === undefined) {
    return undefined;
  }
  const loopTiming = sub.kind === 'control' ? resolveLoopTiming(undefined, base) : resolveLoopTiming(sub.loop, base);
  return loopTiming.totalDurationMs === undefined ? undefined : (sub.startOffsetMs ?? 0) + loopTiming.totalDurationMs;
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
  if (unknown) {
    return undefined;
  }
  const sceneTiming = resolveLoopTiming(scene.loop, max);
  return sceneTiming.totalDurationMs;
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

function createUnknownDurationIssue(sceneId: SceneId, scene: PersistedSceneConfig): StreamScheduleIssue {
  return {
    severity: 'error',
    sceneId,
    message: `Scene ${scene.title ?? sceneId} has no calculable duration for the Stream timeline.`,
  };
}

function scheduleIssueKey(issue: StreamScheduleIssue): string {
  return `${issue.severity}:${issue.sceneId ?? ''}:${issue.subCueId ?? ''}:${issue.message}`;
}

function pushIssueOnce(issues: StreamScheduleIssue[], seen: Set<string>, issue: StreamScheduleIssue): void {
  const key = scheduleIssueKey(issue);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  issues.push(issue);
}

function isEnabledScene(stream: PersistedStreamConfig, sceneId: SceneId): boolean {
  const scene = stream.scenes[sceneId];
  return Boolean(scene && !scene.disabled);
}

function findManualStartAfterPrecedingScenes(
  stream: PersistedStreamConfig,
  enabledIds: SceneId[],
  sceneId: SceneId,
  entries: Record<SceneId, StreamScheduleEntry>,
): { startMs?: number; blockedBySceneId?: SceneId } {
  const idx = enabledIds.indexOf(sceneId);
  if (idx <= 0) {
    return { startMs: 0 };
  }
  let maxEnd = 0;
  for (const precedingId of enabledIds.slice(0, idx)) {
    const precedingEntry = entries[precedingId];
    const precedingScene = stream.scenes[precedingId];
    if (!precedingScene || precedingScene.disabled) {
      continue;
    }
    if (precedingEntry.endMs === undefined) {
      return { blockedBySceneId: precedingId };
    }
    maxEnd = Math.max(maxEnd, precedingEntry.endMs);
  }
  return { startMs: maxEnd };
}

export function buildStreamSchedule(
  stream: PersistedStreamConfig,
  durations: {
    visualDurations: Record<VisualId, number>;
    audioDurations: Record<AudioSourceId, number>;
  },
): StreamSchedule {
  const entries: Record<SceneId, StreamScheduleEntry> = {};
  const issues: StreamScheduleIssue[] = [];
  const seenIssues = new Set<string>();
  const enabledIds = stream.sceneOrder.filter((id) => isEnabledScene(stream, id));

  for (const id of stream.sceneOrder) {
    const scene = stream.scenes[id];
    const durationMs = scene && !scene.disabled ? estimateSceneDurationMs(scene, durations.visualDurations, durations.audioDurations) : undefined;
    entries[id] = {
      sceneId: id,
      durationMs,
      triggerKnown: false,
    };
    if (scene && !scene.disabled && durationMs === undefined) {
      pushIssueOnce(issues, seenIssues, createUnknownDurationIssue(id, scene));
    }
  }

  for (const id of enabledIds) {
    const scene = stream.scenes[id];
    if (scene?.trigger.type === 'at-timecode') {
      entries[id].startMs = scene.trigger.timecodeMs;
      entries[id].triggerKnown = true;
      if (entries[id].durationMs !== undefined) {
        entries[id].endMs = scene.trigger.timecodeMs + entries[id].durationMs;
      }
    }
  }

  let changed = true;
  for (let guard = 0; guard < Math.max(1, enabledIds.length * enabledIds.length) && changed; guard += 1) {
    changed = false;

    for (const id of enabledIds) {
      const scene = stream.scenes[id];
      const entry = entries[id];
      if (!scene || entry.startMs !== undefined) {
        continue;
      }

      let start: number | undefined;
      if (scene.trigger.type === 'manual') {
        const manual = findManualStartAfterPrecedingScenes(stream, enabledIds, id, entries);
        if (manual.blockedBySceneId) {
          continue;
        }
        start = manual.startMs;
      } else if (scene.trigger.type !== 'at-timecode') {
        const pred = resolveFollowsSceneId(stream, id, scene.trigger);
        const predEntry = pred ? entries[pred] : undefined;
        if (!pred || !isEnabledScene(stream, pred)) {
          pushIssueOnce(issues, seenIssues, {
            severity: 'error',
            sceneId: id,
            message: `Scene ${scene.title ?? id} references a missing or disabled predecessor${pred ? `: ${pred}` : '.'}`,
          });
          continue;
        }
        if (!predEntry || predEntry.startMs === undefined) {
          continue;
        }
        if (scene.trigger.type === 'follow-start') {
          start = predEntry.startMs + (scene.trigger.delayMs ?? 0);
        } else if (scene.trigger.type === 'follow-end') {
          if (predEntry.endMs === undefined) {
            continue;
          }
          start = predEntry.endMs + (scene.trigger.delayMs ?? 0);
        }
      }

      if (start !== undefined) {
        entry.startMs = start;
        entry.triggerKnown = true;
        if (entry.durationMs !== undefined) {
          entry.endMs = start + entry.durationMs;
        }
        changed = true;
      }
    }
  }

  let maxEnd = 0;
  for (const id of enabledIds) {
    const scene = stream.scenes[id];
    const entry = entries[id];
    if (!scene) {
      continue;
    }
    if (entry.startMs === undefined) {
      if (scene.trigger.type === 'manual') {
        const manual = findManualStartAfterPrecedingScenes(stream, enabledIds, id, entries);
        if (manual.blockedBySceneId) {
          pushIssueOnce(issues, seenIssues, {
            severity: 'error',
            sceneId: id,
            message: `Scene ${scene.title ?? id} could not be placed because preceding scene end is unknown: ${manual.blockedBySceneId}`,
          });
          continue;
        }
      } else if (scene.trigger.type === 'follow-end') {
        const pred = resolveFollowsSceneId(stream, id, scene.trigger);
        const predEntry = pred ? entries[pred] : undefined;
        if (pred && isEnabledScene(stream, pred) && predEntry?.startMs !== undefined && predEntry.endMs === undefined) {
          pushIssueOnce(issues, seenIssues, {
            severity: 'error',
            sceneId: id,
            message: `Scene ${scene.title ?? id} could not be placed because predecessor end is unknown: ${pred}`,
          });
          continue;
        }
      }
      pushIssueOnce(issues, seenIssues, {
        severity: 'error',
        sceneId: id,
        message: `Scene ${scene.title ?? id} could not be placed on the Stream timeline.`,
      });
      continue;
    }
    if (entry.durationMs === undefined) {
      continue;
    }
    entry.endMs = entry.startMs + entry.durationMs;
    maxEnd = Math.max(maxEnd, entry.endMs);
  }

  const status: StreamSchedule['status'] = issues.some((issue) => issue.severity === 'error') ? 'invalid' : 'valid';
  /** Upper bound of stacked timeline: max of (scheduled start + duration) for every placed scene. Manual rows use the same stacking as other triggers; they contribute full segment length, not "until first manual only". */
  return {
    status,
    entries,
    expectedDurationMs: status === 'valid' ? maxEnd : undefined,
    issues,
    notice: status === 'invalid' ? 'Stream timeline has calculation errors.' : undefined,
  };
}
