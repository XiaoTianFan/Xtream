import type { AudioSourceId, PersistedSceneConfig, PersistedStreamConfig, SceneId, StreamMainTimelineSegment, VisualId } from '../types';
import { deriveStreamThreadPlan } from '../streamThreadPlan';
import { classifySceneDurationMs } from './durations';
import { resolveFollowsSceneId } from './triggerGraph';
import type { StreamSchedule, StreamScheduleEntry, StreamScheduleIssue } from './types';
import type { AudioSubCueMediaInfo } from '../audioSubCueAutomation';
import type { VisualSubCueMediaInfo } from '../visualSubCueTiming';

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

export function buildStreamSchedule(
  stream: PersistedStreamConfig,
  durations: {
    visualDurations: Record<VisualId, number>;
    audioDurations: Record<AudioSourceId, number>;
    visualMedia?: Record<VisualId, VisualSubCueMediaInfo>;
    audioMedia?: Record<AudioSourceId, AudioSubCueMediaInfo>;
  },
): StreamSchedule {
  const entries: Record<SceneId, StreamScheduleEntry> = {};
  const issues: StreamScheduleIssue[] = [];
  const seenIssues = new Set<string>();
  const sceneDurations: Record<SceneId, number | undefined> = {};
  const indefiniteLoopSceneIds = new Set<SceneId>();

  for (const id of stream.sceneOrder) {
    const scene = stream.scenes[id];
    const classified = scene && !scene.disabled
      ? classifySceneDurationMs(scene, durations.visualDurations, durations.audioDurations, durations.visualMedia, durations.audioMedia)
      : undefined;
    const durationMs = classified?.classification === 'finite' ? classified.durationMs : undefined;
    if (classified?.classification === 'indefinite-loop') {
      indefiniteLoopSceneIds.add(id);
    }
    sceneDurations[id] = durationMs;
    entries[id] = {
      sceneId: id,
      durationMs,
      triggerKnown: false,
    };
    if (scene && !scene.disabled && classified?.classification === 'unknown-error') {
      pushIssueOnce(issues, seenIssues, createUnknownDurationIssue(id, scene));
    }
  }

  const threadPlan = deriveStreamThreadPlan(stream, sceneDurations, { indefiniteLoopSceneIds });
  for (const issue of threadPlan.issues) {
    pushIssueOnce(issues, seenIssues, issue);
  }

  let mainCursorMs = 0;
  const mainSegments: StreamMainTimelineSegment[] = [];
  for (const thread of threadPlan.threads) {
    if (thread.rootTriggerType !== 'manual' || thread.detachedReason === 'infinite-loop') {
      continue;
    }
    if (thread.durationMs === undefined) {
      continue;
    }
    const startMs = mainCursorMs;
    const endMs = startMs + thread.durationMs;
    mainSegments.push({
      threadId: thread.threadId,
      rootSceneId: thread.rootSceneId,
      startMs,
      durationMs: thread.durationMs,
      endMs,
      proportion: 0,
    });
    mainCursorMs = endMs;
  }

  const mainDurationMs = mainCursorMs;
  for (const segment of mainSegments) {
    segment.proportion = mainDurationMs > 0 ? segment.durationMs / mainDurationMs : 0;
  }
  const segmentByThreadId = new Map(mainSegments.map((segment) => [segment.threadId, segment]));
  const temporarilyDisabled = new Set(threadPlan.temporarilyDisabledSceneIds);

  for (const thread of threadPlan.threads) {
    const rootScene = stream.scenes[thread.rootSceneId];
    const threadBaseMs =
      thread.rootTriggerType === 'manual'
        ? segmentByThreadId.get(thread.threadId)?.startMs
        : rootScene?.trigger.type === 'at-timecode'
          ? rootScene.trigger.timecodeMs
          : undefined;
    if (threadBaseMs === undefined) {
      continue;
    }
    for (const sceneId of thread.sceneIds) {
      if (temporarilyDisabled.has(sceneId)) {
        continue;
      }
      const timing = thread.sceneTimings[sceneId];
      const entry = entries[sceneId];
      if (!timing || !entry || timing.threadLocalStartMs === undefined) {
        continue;
      }
      entry.startMs = threadBaseMs + timing.threadLocalStartMs;
      entry.triggerKnown = true;
      if (entry.durationMs !== undefined) {
        entry.endMs = entry.startMs + entry.durationMs;
      }
    }
  }

  for (const id of stream.sceneOrder) {
    const scene = stream.scenes[id];
    const entry = entries[id];
    if (!scene || scene.disabled) {
      continue;
    }
    if (temporarilyDisabled.has(id)) {
      continue;
    }
    if (entry.startMs !== undefined) {
      continue;
    }
    const threadId = threadPlan.threadBySceneId[id];
    const thread = threadId ? threadPlan.threads.find((candidate) => candidate.threadId === threadId) : undefined;
    if (thread?.detachedReason === 'infinite-loop') {
      continue;
    }
    if (scene.trigger.type === 'follow-end') {
      const pred = resolveFollowsSceneId(stream, id, scene.trigger);
      const predEntry = pred ? entries[pred] : undefined;
      if (pred && isEnabledScene(stream, pred) && predEntry && predEntry.endMs === undefined) {
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
  }

  const status: StreamSchedule['status'] = issues.some((issue) => issue.severity === 'error') ? 'invalid' : 'valid';
  return {
    status,
    entries,
    expectedDurationMs: status === 'valid' ? mainDurationMs : undefined,
    threadPlan,
    mainSegments,
    issues,
    notice: status === 'invalid' ? 'Stream timeline has calculation errors.' : undefined,
  };
}
