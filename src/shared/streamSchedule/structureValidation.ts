import type { PersistedStreamConfig, SceneId } from '../types';
import { scenePrimaryLabel } from './labels';
import type { StreamScheduleIssue } from './types';
import { hasTriggerCycle, resolveFollowsSceneId } from './triggerGraph';

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
