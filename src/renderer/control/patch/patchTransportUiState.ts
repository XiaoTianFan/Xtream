export type PatchTransportUiState = {
  playDisabled: boolean;
  pauseDisabled: boolean;
  stopDisabled: boolean;
  rateDisabled: boolean;
};

export function derivePatchTransportUiState(args: {
  ready: boolean;
  patchPaused: boolean;
  currentSeconds: number;
  streamPlaybackActive: boolean;
}): PatchTransportUiState {
  const { ready, patchPaused, currentSeconds, streamPlaybackActive } = args;
  return {
    playDisabled: !ready || streamPlaybackActive,
    pauseDisabled: !ready || patchPaused,
    stopDisabled: !ready || (patchPaused && currentSeconds <= 0.001),
    rateDisabled: !ready,
  };
}
