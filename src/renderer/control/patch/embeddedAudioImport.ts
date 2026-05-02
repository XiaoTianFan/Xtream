import type { AudioExtractionFormat, DirectorState, VisualId, VisualState } from '../../../shared/types';
import { elements as shellElements } from '../shell/elements';
import { createButton } from '../shared/dom';
import { hasEmbeddedAudioTrack } from '../media/mediaMetadata';
import type { SelectedEntity } from '../shared/types';

export { LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS } from '../../../shared/embeddedAudioImportPrompt';

export type EmbeddedAudioImportController = {
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
  maybePromptEmbeddedAudioImport: (state: DirectorState) => Promise<void>;
  createEmbeddedAudioRepresentation: (visualId: VisualId) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: VisualId) => Promise<void>;
};

type EmbeddedAudioImportControllerOptions = {
  getState: () => DirectorState | undefined;
  getAudioExtractionFormat: () => AudioExtractionFormat | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
};

export function createEmbeddedAudioImportController(options: EmbeddedAudioImportControllerOptions): EmbeddedAudioImportController {
  const pendingEmbeddedAudioImportBatches: VisualId[][] = [];
  let embeddedAudioImportPromptActive = false;
  let extractionOverlayActive = false;

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
    const choice = await window.xtream.show.chooseEmbeddedAudioImport(
      readyAudioVisuals.map((visual) => ({
        label: visual.label,
        durationSeconds: visual.durationSeconds,
      })),
    );
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
    if (extractionOverlayActive) {
      options.setShowStatus('Audio extraction is already running.');
      return;
    }
    const initialFormat = options.getAudioExtractionFormat() ?? 'm4a';
    extractionOverlayActive = true;
    showExtractionPending(visualId, initialFormat);
    try {
      await runExtractionAttempt(visualId, initialFormat);
      hideExtractionOverlay();
    } catch (error: unknown) {
      options.renderState(await window.xtream.director.getState());
      const message = error instanceof Error ? error.message : 'Audio extraction failed.';
      options.setShowStatus(message);
      if (initialFormat === 'm4a') {
        const retry = await showExtractionErrorWithRetry(message);
        if (retry) {
          try {
            showExtractionPending(visualId, 'wav');
            await runExtractionAttempt(visualId, 'wav');
            hideExtractionOverlay();
          } catch (retryError: unknown) {
            options.renderState(await window.xtream.director.getState());
            const retryMessage = retryError instanceof Error ? retryError.message : 'WAV extraction failed.';
            options.setShowStatus(retryMessage);
            await showExtractionDismissibleError(retryMessage);
          }
        }
      } else {
        await showExtractionDismissibleError(message);
      }
    } finally {
      extractionOverlayActive = false;
    }
  }

  async function runExtractionAttempt(visualId: VisualId, format: AudioExtractionFormat): Promise<void> {
    const source = await window.xtream.audioSources.extractEmbedded(visualId, format);
    options.setSelectedEntity({ type: 'audio-source', id: source.id });
    options.renderState(await window.xtream.director.getState());
    const extractedFormat = source.type === 'embedded-visual' ? source.extractedFormat?.toUpperCase() : undefined;
    options.setShowStatus(`Extracted embedded audio to ${extractedFormat ?? format.toUpperCase()} for ${source.label}.`);
  }

  function showExtractionPending(visualId: VisualId, format: AudioExtractionFormat): void {
    document.body.classList.add('extraction-blocked');
    shellElements.appFrame.classList.add('extraction-blocked');
    shellElements.extractionOverlay.hidden = false;
    shellElements.extractionOverlay.dataset.state = 'pending';
    shellElements.extractionOverlayHeading.textContent = 'Extracting Audio';
    shellElements.extractionOverlayStatus.textContent = format.toUpperCase();
    shellElements.extractionOverlayMessage.textContent = `Extracting embedded audio from ${getVisualLabel(visualId)}.`;
    shellElements.extractionOverlayError.hidden = true;
    shellElements.extractionOverlayError.textContent = '';
    shellElements.extractionOverlayActions.replaceChildren();
  }

  function showExtractionErrorWithRetry(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      shellElements.extractionOverlay.dataset.state = 'error';
      shellElements.extractionOverlayHeading.textContent = 'Audio Extraction Failed';
      shellElements.extractionOverlayStatus.textContent = 'M4A failed';
      shellElements.extractionOverlayMessage.textContent = 'The M4A/AAC extraction failed. Try extracting a WAV file instead.';
      shellElements.extractionOverlayError.hidden = false;
      shellElements.extractionOverlayError.textContent = message;
      const dismissButton = createButton('Dismiss', 'secondary', () => {
        hideExtractionOverlay();
        resolve(false);
      });
      const retryButton = createButton('Extract WAV', '', () => resolve(true));
      shellElements.extractionOverlayActions.replaceChildren(dismissButton, retryButton);
    });
  }

  function showExtractionDismissibleError(message: string): Promise<void> {
    return new Promise((resolve) => {
      shellElements.extractionOverlay.dataset.state = 'error';
      shellElements.extractionOverlayHeading.textContent = 'Audio Extraction Failed';
      shellElements.extractionOverlayStatus.textContent = 'Failed';
      shellElements.extractionOverlayMessage.textContent = 'The audio extraction could not be completed.';
      shellElements.extractionOverlayError.hidden = false;
      shellElements.extractionOverlayError.textContent = message;
      const dismissButton = createButton('Dismiss', '', () => {
        hideExtractionOverlay();
        resolve();
      });
      shellElements.extractionOverlayActions.replaceChildren(dismissButton);
    });
  }

  function hideExtractionOverlay(): void {
    shellElements.extractionOverlay.hidden = true;
    shellElements.extractionOverlay.dataset.state = '';
    shellElements.extractionOverlayActions.replaceChildren();
    shellElements.appFrame.classList.remove('extraction-blocked');
    document.body.classList.remove('extraction-blocked');
  }

  function getVisualLabel(visualId: VisualId): string {
    return options.getState()?.visuals[visualId]?.label ?? visualId;
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
