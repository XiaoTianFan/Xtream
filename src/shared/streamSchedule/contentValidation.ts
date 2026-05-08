import type { CalculatedStreamTimeline, DirectorState, PersistedStreamConfig, SubCueId } from '../types';
import { createLoopValidationMessages } from '../streamLoopTiming';
import { createSubCuePassLoopValidationMessages } from '../subCuePassLoopTiming';
import { PATCH_COMPAT_SCENE_ID } from '../streamWorkspace';
import {
  AUDIO_SUBCUE_LEVEL_MAX_DB,
  AUDIO_SUBCUE_LEVEL_MIN_DB,
  AUDIO_SUBCUE_PAN_MAX,
  AUDIO_SUBCUE_PAN_MIN,
  AUDIO_SUBCUE_PITCH_MAX_SEMITONES,
  AUDIO_SUBCUE_PITCH_MIN_SEMITONES,
} from '../audioSubCueAutomation';
import { getAudioSubCueBaseDurationMs } from '../audioSubCueAutomation';
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
import { getVisualSubCueBaseDurationMs, isImageOrLiveVisual } from '../visualSubCueTiming';

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
    audioDurations: new Map(
      Object.values(state.audioSources ?? {}).flatMap((s) => (s.durationSeconds !== undefined ? [[s.id, s.durationSeconds] as const] : [])),
    ),
    audioMedia: new Map(Object.values(state.audioSources ?? {}).map((s) => [s.id, { id: s.id, durationSeconds: s.durationSeconds, playbackRate: s.playbackRate }])),
    visualLabels: new Map(Object.values(state.visuals ?? {}).map((v) => [v.id, v.label])),
    visualMedia: new Map(Object.values(state.visuals ?? {}).map((v) => [v.id, { id: v.id, kind: v.kind, type: v.type, durationSeconds: v.durationSeconds, playbackRate: v.playbackRate }])),
  };
}

function validateCurvePoints(args: {
  out: StreamScheduleIssue[];
  stream: PersistedStreamConfig;
  sceneId: string;
  subCueId: SubCueId;
  points: readonly { timeMs: number; value: number }[] | undefined;
  label: string;
  min: number;
  max: number;
}): void {
  const { out, stream, sceneId, subCueId, points, label, min, max } = args;
  if (!points) {
    return;
  }
  const sceneLabel = scenePrimaryLabel(stream, sceneId);
  const ordLabel = subCueOrdinalKind(stream, sceneId, subCueId, 'audio');
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point.timeMs) || point.timeMs < 0) {
      out.push({
        severity: 'error',
        sceneId,
        subCueId,
        message: `${sceneLabel} · ${ordLabel} has invalid ${label} automation point ${index + 1} time`,
      });
    }
    if (!Number.isFinite(point.value) || point.value < min || point.value > max) {
      out.push({
        severity: 'error',
        sceneId,
        subCueId,
        message: `${sceneLabel} · ${ordLabel} has invalid ${label} automation point ${index + 1} value`,
      });
    }
  }
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
      if ('startOffsetMs' in subCue && subCue.startOffsetMs !== undefined && (!Number.isFinite(subCue.startOffsetMs) || subCue.startOffsetMs < 0)) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has invalid start offset`,
        });
      }
      if (
        'durationOverrideMs' in subCue &&
        subCue.durationOverrideMs !== undefined &&
        (!Number.isFinite(subCue.durationOverrideMs) || subCue.durationOverrideMs < 0)
      ) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has invalid duration override`,
        });
      }
      if ('playbackRate' in subCue && subCue.playbackRate !== undefined && (!Number.isFinite(subCue.playbackRate) || subCue.playbackRate <= 0)) {
        out.push({
          severity: 'error',
          sceneId,
          subCueId,
          message: `${sceneLabel} · ${subCueOrdinalKind(stream, sceneId, subCueId, subCue.kind)} has non-positive playback rate`,
        });
      }
      if (subCue.kind === 'audio') {
        const ordLabel = subCueOrdinalKind(stream, sceneId, subCueId, 'audio');
        const audioMedia = context.audioMedia?.get(subCue.audioSourceId);
        const sourceDurationSeconds = audioMedia?.durationSeconds ?? context.audioDurations?.get(subCue.audioSourceId);
        pushLoopIssues(
          out,
          createSubCuePassLoopValidationMessages({
            pass: subCue.pass,
            innerLoop: subCue.innerLoop,
            legacyLoop: subCue.loop,
            baseDurationMs: getAudioSubCueBaseDurationMs(subCue, sourceDurationSeconds, audioMedia?.playbackRate),
            label: `${sceneLabel} · ${ordLabel}`,
          }),
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
        if (subCue.sourceStartMs !== undefined && (!Number.isFinite(subCue.sourceStartMs) || subCue.sourceStartMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid source start`,
          });
        }
        if (subCue.sourceEndMs !== undefined && (!Number.isFinite(subCue.sourceEndMs) || subCue.sourceEndMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid source end`,
          });
        }
        if (
          subCue.sourceStartMs !== undefined &&
          subCue.sourceEndMs !== undefined &&
          Number.isFinite(subCue.sourceStartMs) &&
          Number.isFinite(subCue.sourceEndMs) &&
          subCue.sourceEndMs <= subCue.sourceStartMs
        ) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} source end must be after source start`,
          });
        }
        const sourceDurationMs = sourceDurationSeconds === undefined ? undefined : sourceDurationSeconds * 1000;
        if (sourceDurationMs !== undefined) {
          if (subCue.sourceStartMs !== undefined && Number.isFinite(subCue.sourceStartMs) && subCue.sourceStartMs > sourceDurationMs) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} source start exceeds audio duration`,
            });
          }
          if (subCue.sourceEndMs !== undefined && Number.isFinite(subCue.sourceEndMs) && subCue.sourceEndMs > sourceDurationMs) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} source end exceeds audio duration`,
            });
          }
        }
        if (
          subCue.pitchShiftSemitones !== undefined &&
          (!Number.isFinite(subCue.pitchShiftSemitones) ||
            subCue.pitchShiftSemitones < AUDIO_SUBCUE_PITCH_MIN_SEMITONES ||
            subCue.pitchShiftSemitones > AUDIO_SUBCUE_PITCH_MAX_SEMITONES)
        ) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has pitch shift outside -12..12 semitones`,
          });
        }
        validateCurvePoints({
          out,
          stream,
          sceneId,
          subCueId,
          points: subCue.levelAutomation,
          label: 'level',
          min: AUDIO_SUBCUE_LEVEL_MIN_DB,
          max: AUDIO_SUBCUE_LEVEL_MAX_DB,
        });
        validateCurvePoints({
          out,
          stream,
          sceneId,
          subCueId,
          points: subCue.panAutomation,
          label: 'pan',
          min: AUDIO_SUBCUE_PAN_MIN,
          max: AUDIO_SUBCUE_PAN_MAX,
        });
        if (subCue.fadeIn !== undefined && (!Number.isFinite(subCue.fadeIn.durationMs) || subCue.fadeIn.durationMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid fade in duration`,
          });
        }
        if (subCue.fadeOut !== undefined && (!Number.isFinite(subCue.fadeOut.durationMs) || subCue.fadeOut.durationMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid fade out duration`,
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
        const visualMedia = context.visualMedia?.get(subCue.visualId);
        const visualDurationMs = visualMedia?.durationSeconds !== undefined ? visualMedia.durationSeconds * 1000 : undefined;
        pushLoopIssues(
          out,
          createSubCuePassLoopValidationMessages({
            pass: subCue.pass,
            innerLoop: subCue.innerLoop,
            legacyLoop: subCue.loop,
            baseDurationMs: getVisualSubCueBaseDurationMs(subCue, visualMedia),
            label: `${sceneLabel} · ${ordLabel}`,
          }),
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
        if (
          isImageOrLiveVisual(visualMedia) &&
          subCue.durationOverrideMs === undefined &&
          !(
            subCue.pass?.iterations.type === 'infinite' ||
            (!subCue.pass && subCue.loop?.enabled && subCue.loop.iterations.type === 'infinite')
          )
        ) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} requires duration or infinite render for image/live visual media`,
          });
        }
        if (subCue.sourceStartMs !== undefined && (!Number.isFinite(subCue.sourceStartMs) || subCue.sourceStartMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid source start`,
          });
        }
        if (subCue.sourceEndMs !== undefined && (!Number.isFinite(subCue.sourceEndMs) || subCue.sourceEndMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid source end`,
          });
        }
        if (
          subCue.sourceStartMs !== undefined &&
          subCue.sourceEndMs !== undefined &&
          Number.isFinite(subCue.sourceStartMs) &&
          Number.isFinite(subCue.sourceEndMs) &&
          subCue.sourceEndMs <= subCue.sourceStartMs
        ) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} source end must be after source start`,
          });
        }
        if (visualDurationMs !== undefined) {
          if (subCue.sourceStartMs !== undefined && Number.isFinite(subCue.sourceStartMs) && subCue.sourceStartMs > visualDurationMs) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} source start exceeds visual duration`,
            });
          }
          if (subCue.sourceEndMs !== undefined && Number.isFinite(subCue.sourceEndMs) && subCue.sourceEndMs > visualDurationMs) {
            out.push({
              severity: 'error',
              sceneId,
              subCueId,
              message: `${sceneLabel} · ${ordLabel} source end exceeds visual duration`,
            });
          }
        }
        if ((subCue.sourceStartMs !== undefined || subCue.sourceEndMs !== undefined) && visualMedia && (visualMedia.kind === 'live' || visualMedia.type === 'image')) {
          out.push({
            severity: 'warning',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} source range is ignored for image/live visual media`,
          });
        }
        if (subCue.freezeFrameMs !== undefined && (!Number.isFinite(subCue.freezeFrameMs) || subCue.freezeFrameMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid freeze frame`,
          });
        }
        if (
          subCue.freezeFrameMs !== undefined &&
          visualDurationMs !== undefined &&
          Number.isFinite(subCue.freezeFrameMs) &&
          subCue.freezeFrameMs > visualDurationMs
        ) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} freeze frame exceeds visual duration`,
          });
        }
        if (subCue.freezeFrameMs !== undefined && visualMedia?.type === 'image') {
          out.push({
            severity: 'warning',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} freeze frame is ignored for image visual media`,
          });
        }
        if (subCue.fadeIn !== undefined && (!Number.isFinite(subCue.fadeIn.durationMs) || subCue.fadeIn.durationMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid fade in duration`,
          });
        }
        if (subCue.fadeOut !== undefined && (!Number.isFinite(subCue.fadeOut.durationMs) || subCue.fadeOut.durationMs < 0)) {
          out.push({
            severity: 'error',
            sceneId,
            subCueId,
            message: `${sceneLabel} · ${ordLabel} has invalid fade out duration`,
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
