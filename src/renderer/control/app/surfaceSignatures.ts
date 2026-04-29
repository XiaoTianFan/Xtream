import type { DirectorState } from '../../../shared/types';
import type { ControlSurface } from '../shared/types';

export function createSurfaceStateSignature(surface: ControlSurface, state: DirectorState): string {
  return JSON.stringify({
    surface,
    readiness: state.readiness,
    counts: {
      visuals: Object.keys(state.visuals).length,
      audioSources: Object.keys(state.audioSources).length,
      displays: Object.keys(state.displays).length,
      outputs: Object.keys(state.outputs).length,
    },
    globals: {
      globalAudioMuted: state.globalAudioMuted,
      globalDisplayBlackout: state.globalDisplayBlackout,
      globalAudioMuteFadeOutSeconds: state.globalAudioMuteFadeOutSeconds,
      globalDisplayBlackoutFadeOutSeconds: state.globalDisplayBlackoutFadeOutSeconds,
      performanceMode: state.performanceMode,
      audioExtractionFormat: state.audioExtractionFormat,
      controlDisplayPreviewMaxFps: state.controlDisplayPreviewMaxFps,
    },
    displays: Object.values(state.displays).map((display) => ({
      id: display.id,
      label: display.label,
      health: display.health,
      lastDriftSeconds: display.lastDriftSeconds,
      lastFrameRateFps: display.lastFrameRateFps,
    })),
    outputs: Object.values(state.outputs).map((output) => ({
      id: output.id,
      label: output.label,
      ready: output.ready,
      physicalRoutingAvailable: output.physicalRoutingAvailable,
      fallbackAccepted: output.fallbackAccepted,
      error: output.error,
    })),
  });
}
