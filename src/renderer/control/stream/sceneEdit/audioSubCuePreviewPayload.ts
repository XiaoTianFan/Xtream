import type {
  AudioSourceId,
  AudioSourceState,
  AudioSubCuePreviewPayload,
  DirectorState,
  PersistedAudioSubCueConfig,
  VirtualOutputId,
} from '../../../../shared/types';
import { getAudioSubCueBaseDurationMs } from '../../../../shared/audioSubCueAutomation';
import { resolveLoopTiming } from '../../../../shared/streamLoopTiming';
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
    loop: sub.loop,
    playTimeMs: getAudioSubCuePreviewPlayTimeMs(sub, source.durationSeconds),
    channelMode: source.channelMode,
    channelCount: source.channelCount,
  };
}

function getAudioSubCuePreviewPlayTimeMs(sub: PersistedAudioSubCueConfig, sourceDurationSeconds: number | undefined): number | undefined {
  const baseDurationMs = getAudioSubCueBaseDurationMs(sub, sourceDurationSeconds);
  if (baseDurationMs === undefined) {
    return undefined;
  }
  return resolveLoopTiming(sub.loop, baseDurationMs).totalDurationMs;
}
