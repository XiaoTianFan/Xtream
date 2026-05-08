import type {
  AudioSourceId,
  AudioSourceState,
  AudioSubCuePreviewPayload,
  DirectorState,
  PersistedAudioSubCueConfig,
  RuntimeSubCueTiming,
  VirtualOutputId,
} from '../../../../shared/types';
import { getAudioSubCueBaseDurationMs } from '../../../../shared/audioSubCueAutomation';
import { resolveSubCuePassLoopTiming } from '../../../../shared/subCuePassLoopTiming';
import { resolveAudioWaveformUrl } from './audioWaveformPeaks';

export function chooseAudioSubCuePreviewOutput(sub: PersistedAudioSubCueConfig, state: DirectorState): VirtualOutputId | undefined {
  const selected = sub.outputIds.find((outputId) => state.outputs[outputId]);
  return selected ?? (Object.keys(state.outputs).sort()[0] as VirtualOutputId | undefined);
}

export function buildAudioSubCuePreviewPayload(
  sub: PersistedAudioSubCueConfig,
  state: DirectorState,
  previewId: string,
): AudioSubCuePreviewPayload | undefined {
  const source = state.audioSources[sub.audioSourceId] as AudioSourceState | undefined;
  const url = resolveAudioWaveformUrl(source, state);
  const outputId = chooseAudioSubCuePreviewOutput(sub, state);
  const output = outputId ? state.outputs[outputId] : undefined;
  if (!source || !url || !outputId || !output) {
    return undefined;
  }
  const baseDurationMs = getAudioSubCueBaseDurationMs(sub, source.durationSeconds);
  const timing =
    baseDurationMs === undefined
      ? undefined
      : resolveSubCuePassLoopTiming({
          pass: sub.pass,
          innerLoop: sub.innerLoop,
          legacyLoop: sub.loop,
          baseDurationMs,
        });
  return {
    previewId,
    audioSourceId: sub.audioSourceId as AudioSourceId,
    url,
    outputId,
    outputSinkId: output.sinkId,
    outputBusLevelDb: output.busLevelDb,
    outputPan: output.pan,
    sourceStartMs: sub.sourceStartMs,
    sourceEndMs: sub.sourceEndMs,
    fadeIn: sub.fadeIn,
    fadeOut: sub.fadeOut,
    levelDb: sub.levelDb,
    sourceLevelDb: source.levelDb,
    pan: sub.pan,
    levelAutomation: sub.levelAutomation,
    panAutomation: sub.panAutomation,
    playbackRate: (source.playbackRate ?? 1) * (sub.playbackRate ?? 1),
    pitchShiftSemitones: sub.pitchShiftSemitones,
    pass: timing?.pass ?? sub.pass,
    innerLoop: timing?.innerLoop ?? sub.innerLoop,
    subCueTiming: timing ? toRuntimeSubCueTiming(timing) : undefined,
    loop: sub.loop,
    playTimeMs: timing?.totalDurationMs,
    channelMode: source.channelMode,
    channelCount: source.channelCount,
  };
}

function toRuntimeSubCueTiming(timing: ReturnType<typeof resolveSubCuePassLoopTiming>): RuntimeSubCueTiming {
  return {
    baseDurationMs: timing.baseDurationMs,
    pass: timing.pass,
    innerLoop: timing.innerLoop.enabled
      ? {
          enabled: true,
          range: { ...timing.innerLoop.range },
          iterations:
            timing.innerLoop.iterations.type === 'infinite'
              ? { type: 'infinite' }
              : { type: 'count', count: timing.innerLoop.iterations.count },
        }
      : timing.innerLoop.range
        ? { enabled: false, range: { ...timing.innerLoop.range } }
        : { enabled: false },
  };
}
