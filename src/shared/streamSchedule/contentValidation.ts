import type { CalculatedStreamTimeline, DirectorState, PersistedStreamConfig, SubCueId } from '../types';
import { createLoopValidationMessages } from '../streamLoopTiming';
import { PATCH_COMPAT_SCENE_ID } from '../streamWorkspace';
import {
  audioSubCueValidationLabel,
  scenePrimaryLabel,
  subCueOrdinalKind,
  visualSubCueValidationLabel,
} from './labels';
import type { StreamScheduleIssue, ValidateStreamContentContext } from './types';
import {
  validateStreamStructureIssues,
  validateTriggerReferencesIssues,
} from './structureValidation';

function pushLoopIssues(out: StreamScheduleIssue[], messages: string[], sceneId: string, subCueId?: SubCueId): void {
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
  scenesWithErrors: ReadonlySet<string>;
  subCuesWithErrors: ReadonlyMap<string, ReadonlySet<SubCueId>>;
} {
  const issues = getAuthoringIssuesForStreamUi(stream, context, playbackTimeline);
  const scenesWithErrors = new Set<string>();
  const subCueMap = new Map<string, Set<SubCueId>>();
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
