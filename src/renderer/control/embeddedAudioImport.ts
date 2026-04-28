import type { AudioExtractionFormat, DirectorState, VisualId, VisualState } from '../../shared/types';
import type { SelectedEntity } from './types';
import { hasEmbeddedAudioTrack } from '../mediaMetadata';

export type EmbeddedAudioImportController = {
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
  maybePromptEmbeddedAudioImport: (state: DirectorState) => Promise<void>;
  createEmbeddedAudioRepresentation: (visualId: VisualId) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: VisualId) => Promise<void>;
};

type EmbeddedAudioImportControllerOptions = {
  getAudioExtractionFormat: () => AudioExtractionFormat | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
};

export function createEmbeddedAudioImportController(options: EmbeddedAudioImportControllerOptions): EmbeddedAudioImportController {
  const pendingEmbeddedAudioImportBatches: VisualId[][] = [];
  let embeddedAudioImportPromptActive = false;

  function queueEmbeddedAudioImportPrompt(visuals: VisualState[] | undefined): void {
    const videoIds = (visuals ?? []).filter((visual) => visual.type === 'video').map((visual) => visual.id);
    if (videoIds.length > 0) {
      pendingEmbeddedAudioImportBatches.push(videoIds);
    }
  }

  function probeVisualMetadata(visual: VisualState): void {
    if (!visual.url) {
      return;
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
      return;
    }
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
        reportVisualMetadataFromVideo(visual.id, video);
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

  function reportVisualMetadataFromVideo(visualId: VisualId, video: HTMLVideoElement): void {
    void window.xtream.visuals.reportMetadata({
      visualId,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      hasEmbeddedAudio: hasEmbeddedAudioTrack(video),
      ready: true,
    });
  }

  async function maybePromptEmbeddedAudioImport(state: DirectorState): Promise<void> {
    if (embeddedAudioImportPromptActive || pendingEmbeddedAudioImportBatches.length === 0) {
      return;
    }
    const batch = pendingEmbeddedAudioImportBatches[0];
    const batchVisuals = batch.map((visualId) => state.visuals[visualId]).filter((visual): visual is VisualState => Boolean(visual));
    if (
      batchVisuals.length < batch.length ||
      batchVisuals.some((visual) => !visual.ready && !visual.error)
    ) {
      return;
    }
    const readyAudioVisuals = batchVisuals.filter(
      (visual): visual is VisualState => visual.ready && visual.type === 'video',
    );
    pendingEmbeddedAudioImportBatches.shift();
    if (readyAudioVisuals.length === 0) {
      return;
    }
    embeddedAudioImportPromptActive = true;
    const choice = await window.xtream.show.chooseEmbeddedAudioImport(readyAudioVisuals.map((visual) => visual.label));
    try {
      if (choice === 'representation') {
        for (const visual of readyAudioVisuals) {
          await createEmbeddedAudioRepresentation(visual.id);
        }
      }
      if (choice === 'file') {
        for (const visual of readyAudioVisuals) {
          await extractEmbeddedAudioFile(visual.id);
        }
      }
    } finally {
      embeddedAudioImportPromptActive = false;
    }
  }

  async function createEmbeddedAudioRepresentation(visualId: VisualId): Promise<void> {
    const source = await window.xtream.audioSources.addEmbedded(visualId, 'representation');
    options.setSelectedEntity({ type: 'audio-source', id: source.id });
    options.renderState(await window.xtream.director.getState());
    options.setShowStatus(`Created representation audio source for ${source.label}.`);
  }

  async function extractEmbeddedAudioFile(visualId: VisualId): Promise<void> {
    try {
      const source = await window.xtream.audioSources.extractEmbedded(visualId, options.getAudioExtractionFormat());
      options.setSelectedEntity({ type: 'audio-source', id: source.id });
      options.renderState(await window.xtream.director.getState());
      const format = source.type === 'embedded-visual' ? source.extractedFormat?.toUpperCase() : undefined;
      options.setShowStatus(`Extracted embedded audio to ${format ?? 'file'} for ${source.label}.`);
    } catch (error: unknown) {
      options.renderState(await window.xtream.director.getState());
      options.setShowStatus(error instanceof Error ? error.message : 'Audio extraction failed.');
    }
  }

  return {
    queueEmbeddedAudioImportPrompt,
    probeVisualMetadata,
    reportVisualMetadataFromVideo,
    maybePromptEmbeddedAudioImport,
    createEmbeddedAudioRepresentation,
    extractEmbeddedAudioFile,
  };
}
