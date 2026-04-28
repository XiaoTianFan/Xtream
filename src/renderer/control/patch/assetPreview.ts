import type { AudioSourceState, DirectorState, VisualId, VisualState } from '../../../shared/types';
import { applyVisualStyle } from './displayPreview';
import { createButton, createHint, createSlider, syncSliderProgress } from '../shared/dom';
import { elements } from '../shell/elements';
import type { SelectedEntity } from '../shared/types';

export type AssetPreviewController = {
  render: (state: DirectorState, selectedEntity: SelectedEntity | undefined) => void;
  cleanup: () => void;
};

type AssetPreviewControllerOptions = {
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
};

export function createAssetPreviewController(options: AssetPreviewControllerOptions): AssetPreviewController {
  let assetPreviewSignature = '';
  let localPreviewCleanup: (() => void) | undefined;

  function render(state: DirectorState, selectedEntity: SelectedEntity | undefined): void {
    const previewableSelection = selectedEntity?.type === 'visual' || selectedEntity?.type === 'audio-source' ? selectedEntity : undefined;
    if (state.performanceMode) {
      assetPreviewSignature = 'performance-mode';
      cleanup();
      elements.assetPreview.replaceChildren();
      elements.assetPreviewRegion.hidden = true;
      return;
    }
    const signature = JSON.stringify({
      selectedEntity: previewableSelection,
      visual: selectedEntity?.type === 'visual' ? state.visuals[selectedEntity.id] : undefined,
      audio: selectedEntity?.type === 'audio-source' ? state.audioSources[selectedEntity.id] : undefined,
    });
    if (assetPreviewSignature === signature) {
      return;
    }
    assetPreviewSignature = signature;
    cleanup();
    elements.assetPreview.replaceChildren();
    elements.assetPreviewRegion.hidden = !previewableSelection;
    if (!previewableSelection) {
      return;
    }
    if (selectedEntity?.type === 'visual') {
      const visual = state.visuals[selectedEntity.id];
      if (visual) {
        renderVisualAssetPreview(visual);
      }
      return;
    }
    if (selectedEntity?.type === 'audio-source') {
      const source = state.audioSources[selectedEntity.id];
      if (source) {
        renderAudioAssetPreview(source, state);
      }
    }
  }

  function cleanup(): void {
    localPreviewCleanup?.();
    localPreviewCleanup = undefined;
  }

  function renderVisualAssetPreview(visual: VisualState): void {
    const shell = document.createElement('div');
    shell.className = 'asset-preview-shell';
    const title = createAssetPreviewTitle(visual.label);
    if (!visual.url) {
      shell.append(title, createHint('No playable URL for this visual.'));
      elements.assetPreview.replaceChildren(shell);
      return;
    }
    if (visual.type === 'image') {
      const image = document.createElement('img');
      image.src = visual.url;
      image.alt = visual.label;
      applyVisualStyle(image, visual);
      shell.append(title, image);
      elements.assetPreview.replaceChildren(shell);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = visual.url;
    applyVisualStyle(video, visual);
    video.playbackRate = visual.playbackRate ?? 1;
    video.addEventListener('loadedmetadata', () => options.reportVisualMetadataFromVideo(visual.id, video));
    const controls = createLocalMediaControls(video);
    shell.append(title, video, controls);
    elements.assetPreview.replaceChildren(shell);
    localPreviewCleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }

  function renderAudioAssetPreview(source: AudioSourceState, state: DirectorState): void {
    const url =
      source.type === 'external-file'
        ? source.url
        : source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl
          ? source.extractedUrl
          : state.visuals[source.visualId]?.url;
    const shell = document.createElement('div');
    shell.className = 'asset-preview-shell';
    shell.append(createAssetPreviewTitle(source.label));
    if (!url) {
      shell.append(createHint('No playable URL for this audio source.'));
      elements.assetPreview.replaceChildren(shell);
      return;
    }
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    const controls = createLocalMediaControls(audio);
    shell.append(audio, controls);
    elements.assetPreview.replaceChildren(shell);
    localPreviewCleanup = () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }

  function createLocalMediaControls(media: HTMLMediaElement): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'local-preview-controls';
    const play = createButton('Play', 'secondary', () => {
      if (media.paused) {
        void media.play();
        play.textContent = 'Pause';
      } else {
        media.pause();
        play.textContent = 'Play';
      }
    });
    const scrubber = createSlider({ min: '0', max: '0', step: '0.01', value: '0', ariaLabel: 'Preview scrubber' });
    media.addEventListener('loadedmetadata', () => {
      scrubber.max = Number.isFinite(media.duration) ? String(media.duration) : '0';
      syncSliderProgress(scrubber);
    });
    media.addEventListener('timeupdate', () => {
      if (document.activeElement !== scrubber) {
        scrubber.value = String(media.currentTime);
        syncSliderProgress(scrubber);
      }
    });
    media.addEventListener('pause', () => {
      play.textContent = 'Play';
    });
    scrubber.addEventListener('input', () => {
      media.currentTime = Number(scrubber.value) || 0;
    });
    controls.append(play, scrubber);
    return controls;
  }

  return {
    render,
    cleanup,
  };
}

function createAssetPreviewTitle(label: string): HTMLHeadingElement {
  const title = document.createElement('h4');
  title.textContent = label;
  return title;
}
