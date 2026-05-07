import type { AudioSourceState, DirectorState } from '../../../shared/types';
import { hasEmbeddedAudioTrack } from '../media/mediaMetadata';

export function probeAllMedia(state: DirectorState): void {
  for (const visual of Object.values(state.visuals)) {
    if (!visual.url) {
      continue;
    }
    if (visual.type === 'image') {
      const image = new Image();
      image.src = visual.url;
      image.addEventListener('load', () => {
        void window.xtream.visuals.reportMetadata({
          visualId: visual.id,
          width: image.naturalWidth,
          height: image.naturalHeight,
          ready: true,
        });
      });
      image.addEventListener('error', () => {
        void window.xtream.visuals.reportMetadata({ visualId: visual.id, ready: false, error: 'Image failed to load.' });
      });
      continue;
    }
    
    if (visual.type === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.style.display = 'none';
      video.src = visual.url;
      document.body.append(video);
      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
        video.remove();
      };
      video.addEventListener(
        'loadedmetadata',
        () => {
          void window.xtream.visuals.reportMetadata({
            visualId: visual.id,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            hasEmbeddedAudio: hasEmbeddedAudioTrack(video),
            ready: true,
          });
          cleanup();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          void window.xtream.visuals.reportMetadata({ visualId: visual.id, ready: false, error: video.error?.message ?? 'Video failed to load.' });
          cleanup();
        },
        { once: true },
      );
    }
  }

  for (const source of Object.values(state.audioSources)) {
    probeAudioMetadata(source, state);
  }
}

export function probeAudioMetadata(source: AudioSourceState, state?: DirectorState): void {
  const url = resolveAudioSourceUrl(source, state);
  if (!url) {
    return;
  }
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.muted = true;
  audio.style.display = 'none';
  audio.src = url;
  document.body.append(audio);

  let context: AudioContext | undefined;
  let sourceNode: MediaElementAudioSourceNode | undefined;
  try {
    context = new AudioContext();
    sourceNode = context.createMediaElementSource(audio);
  } catch {
    context = undefined;
    sourceNode = undefined;
  }

  const cleanup = () => {
    audio.removeAttribute('src');
    audio.load();
    audio.remove();
    if (context) {
      void context.close();
    }
  };

  audio.addEventListener(
    'loadedmetadata',
    () => {
      const channelCount = source.channelCount ?? (sourceNode ? Math.max(1, Math.min(8, sourceNode.channelCount || 2)) : undefined);
      void window.xtream.audioSources.reportMetadata({
        audioSourceId: source.id,
        durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
        channelCount,
        ready: true,
      });
      cleanup();
    },
    { once: true },
  );
  audio.addEventListener(
    'error',
    () => {
      void window.xtream.audioSources.reportMetadata({
        audioSourceId: source.id,
        durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
        ready: false,
        error: audio.error?.message ?? 'Audio failed to load.',
      });
      cleanup();
    },
    { once: true },
  );
}

function resolveAudioSourceUrl(source: AudioSourceState, state: DirectorState | undefined): string | undefined {
  if (source.type === 'external-file') {
    return source.url;
  }
  if (source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl) {
    return source.extractedUrl;
  }
  return state?.visuals[source.visualId]?.url;
}
