import type { DirectorState } from '../../../../shared/types';

export function createVisualRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) => ({
        id: visual.id,
        label: visual.label,
        type: visual.type,
        path: visual.path,
        url: visual.url,
        ready: visual.ready,
        error: visual.error,
        durationSeconds: visual.durationSeconds,
        width: visual.width,
        height: visual.height,
        hasEmbeddedAudio: visual.hasEmbeddedAudio,
        kind: visual.kind,
        capture: visual.kind === 'live' ? visual.capture : undefined,
        opacity: visual.opacity,
        brightness: visual.brightness,
        contrast: visual.contrast,
        playbackRate: visual.playbackRate,
        fileSizeBytes: visual.fileSizeBytes,
      })),
  );
}

/**
 * Key for rebuilding media pool list/grid rows. For live visuals, omits `width`, `height`, and `ready`
 * so hover pool preview metadata does not thrash the DOM (that feedback loop would detach/re-attach capture in a loop).
 */
export function createVisualPoolContentSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) =>
        visual.kind === 'live'
          ? {
              id: visual.id,
              label: visual.label,
              type: visual.type,
              path: visual.path,
              url: visual.url,
              error: visual.error,
              durationSeconds: visual.durationSeconds,
              hasEmbeddedAudio: visual.hasEmbeddedAudio,
              kind: visual.kind,
              capture: visual.capture,
              opacity: visual.opacity,
              brightness: visual.brightness,
              contrast: visual.contrast,
              playbackRate: visual.playbackRate,
              fileSizeBytes: visual.fileSizeBytes,
            }
          : {
              id: visual.id,
              label: visual.label,
              type: visual.type,
              path: visual.path,
              url: visual.url,
              ready: visual.ready,
              error: visual.error,
              durationSeconds: visual.durationSeconds,
              width: visual.width,
              height: visual.height,
              hasEmbeddedAudio: visual.hasEmbeddedAudio,
              kind: visual.kind,
              capture: undefined,
              opacity: visual.opacity,
              brightness: visual.brightness,
              contrast: visual.contrast,
              playbackRate: visual.playbackRate,
              fileSizeBytes: visual.fileSizeBytes,
            },
      ),
  );
}

export function createAudioRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.audioSources)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => ({
        id: source.id,
        label: source.label,
        type: source.type,
        durationSeconds: source.durationSeconds,
        ready: source.ready,
        error: source.error,
        fileSizeBytes: source.fileSizeBytes,
        playbackRate: source.playbackRate,
        levelDb: source.levelDb,
        channelCount: source.channelCount,
        channelMode: source.channelMode,
        derivedFromAudioSourceId: source.derivedFromAudioSourceId,
        ...(source.type === 'external-file'
          ? {
              path: source.path,
              url: source.url,
            }
          : {
              visualId: source.visualId,
              extractionMode: source.extractionMode,
              extractionStatus: source.extractionStatus,
              extractedPath: source.extractedPath,
              extractedUrl: source.extractedUrl,
              extractedFormat: source.extractedFormat,
              visualLabel: state.visuals[source.visualId]?.label,
            }),
      })),
  );
}
