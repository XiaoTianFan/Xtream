import type { DirectorState } from '../../../shared/types';
import type { ControlSurface } from '../shared/types';

export function createSurfaceStateSignature(surface: ControlSurface, state: DirectorState): string {
  return JSON.stringify({
    surface,
    readiness: {
      ready: state.readiness.ready,
      issues: state.readiness.issues,
    },
    counts: {
      visuals: Object.keys(state.visuals).length,
      audioSources: Object.keys(state.audioSources).length,
      displays: Object.keys(state.displays).length,
      outputs: Object.keys(state.outputs).length,
    },
    globals: {
      paused: state.paused,
      globalAudioMuted: state.globalAudioMuted,
      globalDisplayBlackout: state.globalDisplayBlackout,
      globalAudioMuteFadeOutSeconds: state.globalAudioMuteFadeOutSeconds,
      globalDisplayBlackoutFadeOutSeconds: state.globalDisplayBlackoutFadeOutSeconds,
      performanceMode: state.performanceMode,
      audioExtractionFormat: state.audioExtractionFormat,
      controlDisplayPreviewMaxFps: state.controlDisplayPreviewMaxFps,
    },
    displays: Object.values(state.displays)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((display) => ({
        id: display.id,
        label: display.label,
        health: display.health,
        degradationReason: display.degradationReason,
        displayId: display.displayId,
        fullscreen: display.fullscreen,
        alwaysOnTop: display.alwaysOnTop,
        layout: display.layout,
        visualMingle: state.displayVisualMingle?.[display.id],
      })),
    outputs: Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => ({
        id: output.id,
        label: output.label,
        ready: output.ready,
        physicalRoutingAvailable: output.physicalRoutingAvailable,
        fallbackAccepted: output.fallbackAccepted,
        fallbackReason: output.fallbackReason,
        error: output.error,
      })),
  });
}
