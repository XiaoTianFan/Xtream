import type {
  AudioSourceState,
  DirectorState,
  VirtualOutputSourceSelection,
  VirtualOutputState,
} from '../../../../shared/types';

/** Strip topology/routing only; excludes runtime fades, meters, decode-ready flips, and async errors. */
export function compactAudioSourceForSignature(source: AudioSourceState): Record<string, unknown> {
  const base: Record<string, unknown> = { id: source.id, label: source.label, type: source.type };
  if (source.type === 'embedded-visual') {
    base.visualId = source.visualId;
  }
  return base;
}

export function compactOutputForSignature(output: VirtualOutputState): Record<string, unknown> {
  return {
    id: output.id,
    label: output.label,
    sinkId: output.sinkId,
    sinkLabel: output.sinkLabel,
    busLevelDb: output.busLevelDb,
    pan: output.pan,
    muted: output.muted,
    outputDelaySeconds: output.outputDelaySeconds,
    sources: output.sources.map((sel: VirtualOutputSourceSelection) => ({
      id: sel.id,
      audioSourceId: sel.audioSourceId,
      pan: sel.pan,
      muted: sel.muted,
      solo: sel.solo,
    })),
  };
}

export function createMixerRenderSignature(
  state: DirectorState,
  audioDevices: MediaDeviceInfo[],
  soloSignature: string,
): string {
  return JSON.stringify({
    sources: Object.values(state.audioSources)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => compactAudioSourceForSignature(source)),
    outputs: Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => compactOutputForSignature(output)),
    devices: audioDevices.map((device) => `${device.deviceId}:${device.label}`).join('|'),
    solo: soloSignature,
  });
}
