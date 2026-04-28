import type { AudioSourceId, DirectorState, VisualId } from '../../../../shared/types';

const embeddedId = (visualId: VisualId) => `audio-source-embedded-${visualId}` as AudioSourceId;

/**
 * Prefer existing extracted file embedded source, then representation embedded source,
 * otherwise create representation via IPC (Director.addEmbeddedAudioSource).
 */
export async function resolveEmbeddedAudioSourceForVideo(
  visualId: VisualId,
  getState: () => DirectorState | undefined,
  renderState: (state: DirectorState) => void,
): Promise<AudioSourceId | undefined> {
  const state = getState();
  const visual = state?.visuals[visualId];
  if (!visual || visual.kind !== 'file' || visual.type !== 'video') {
    return undefined;
  }
  if (!visual.hasEmbeddedAudio) {
    return undefined;
  }

  const sid = embeddedId(visualId);
  const existing = state.audioSources[sid];
  if (existing?.type === 'embedded-visual' && existing.extractionMode === 'file' && existing.extractedPath && existing.extractionStatus === 'ready') {
    return sid;
  }
  if (existing?.type === 'embedded-visual' && existing.extractionMode === 'representation') {
    return sid;
  }

  await window.xtream.audioSources.addEmbedded(visualId, 'representation');
  renderState(await window.xtream.director.getState());

  const after = getState()?.audioSources[sid];
  if (after?.type === 'embedded-visual') {
    return sid;
  }
  return undefined;
}
