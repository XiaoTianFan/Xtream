import type { AudioSourceState, DirectorState, MeterLaneState, OutputMeterReport, VirtualOutputState } from '../../../shared/types';

export function deriveOutputMeterLanes(
  output: VirtualOutputState,
  state: DirectorState | undefined,
  report: OutputMeterReport | undefined,
): MeterLaneState[] {
  const reportedById = new Map((report?.lanes ?? output.meterLanes ?? []).map((lane) => [lane.id, lane]));

  return output.sources.flatMap((selection) => {
    const source = state?.audioSources[selection.audioSourceId];
    const channelCount = getOutputLaneChannelCount(source);
    return Array.from({ length: channelCount }, (_, channelIndex): MeterLaneState => {
      const id = `${output.id}:${selection.audioSourceId}:ch-${channelIndex + 1}`;
      const reported = reportedById.get(id);
      return {
        id,
        label: formatMeterLaneLabel(source, channelIndex, channelCount),
        audioSourceId: selection.audioSourceId,
        channelIndex,
        db: reported?.db ?? -60,
        clipped: reported?.clipped ?? false,
      };
    });
  });
}

function getOutputLaneChannelCount(source: AudioSourceState | undefined): number {
  if (source?.channelMode === 'left' || source?.channelMode === 'right') {
    return 1;
  }
  return Math.max(1, Math.min(8, source?.channelCount ?? 2));
}

function formatMeterLaneLabel(source: AudioSourceState | undefined, channelIndex: number, channelCount: number): string {
  if (source?.channelMode === 'left') {
    return 'L';
  }
  if (source?.channelMode === 'right') {
    return 'R';
  }
  if (channelCount === 2) {
    return channelIndex === 0 ? 'L' : 'R';
  }
  return `C${channelIndex + 1}`;
}
