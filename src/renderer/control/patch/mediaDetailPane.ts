import type { AudioSourceState, DirectorState, VisualId, VisualState } from '../../../shared/types';
import { attachLiveVisualStream, reportLiveVisualError } from '../media/liveCaptureRuntime';
import { createButton, createHint, createSlider, syncSliderProgress } from '../shared/dom';
import { applyVisualStyle } from './displayPreview';

export type MediaDetailPreviewOptions = {
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
};

/**
 * Builds Play + scrubber row for previewing file media in the detail pane.
 */
export function createLocalMediaControls(media: HTMLMediaElement): HTMLElement {
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

/** Returns cleanup called when swapping selection or unloading. */
export function attachVisualPreviewColumn(
  parent: HTMLElement,
  visual: VisualState,
  options: MediaDetailPreviewOptions,
  perfMode?: boolean,
): () => void {
  parent.replaceChildren();
  let cleanupLive: (() => void) | undefined;
  let cleanupFile: (() => void) | undefined;

  if (perfMode) {
    parent.append(createHint('Preview unavailable in Performance mode.'));
    return () => undefined;
  }

  const shell = document.createElement('div');
  shell.className = 'media-detail-preview-shell';

  if (visual.kind === 'live') {
    const video = document.createElement('video');
    applyVisualStyle(video, visual);
    shell.append(video);
    parent.append(shell);

    let detach = (): void => undefined;
    void attachLiveVisualStream(visual, video, {
      reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report),
    })
      .then((attachment) => {
        detach = attachment.cleanup;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Live preview failed.';
        reportLiveVisualError(visual, { reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report) }, message);
        shell.append(createHint(message));
      });

    return () => {
      detach();
    };
  }

  if (!visual.url) {
    shell.append(createHint('No playable URL for this visual.'));
    parent.append(shell);
    return () => undefined;
  }

  if (visual.type === 'image') {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    shell.append(image);
    parent.append(shell);
    return () => undefined;
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
  shell.append(video, controls);
  parent.append(shell);
  cleanupFile = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  return () => cleanupFile?.();
}

/** Returns cleanup when swapping selection or unloading. */
export function attachAudioPreviewColumn(
  parent: HTMLElement,
  source: AudioSourceState,
  state: DirectorState,
  perfMode?: boolean,
): () => void {
  parent.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'media-detail-preview-shell';

  if (perfMode) {
    shell.append(createHint('Preview unavailable in Performance mode.'));
    parent.append(shell);
    return () => undefined;
  }

  const url =
    source.type === 'external-file'
      ? source.url
      : source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl
        ? source.extractedUrl
        : state.visuals[source.visualId]?.url;

  if (!url) {
    shell.append(createHint('No playable URL for this audio source.'));
    parent.append(shell);
    return () => undefined;
  }

  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  const controls = createLocalMediaControls(audio);
  shell.append(audio, controls);
  parent.append(shell);
  return () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
}

export function wrapMediaDetailTwoColumn(previewMount: HTMLElement, metaColumn: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'media-detail-layout';
  const leftCol = document.createElement('div');
  leftCol.className = 'media-detail-layout__preview';
  leftCol.append(previewMount);
  const rightCol = document.createElement('div');
  rightCol.className = 'media-detail-layout__meta';
  rightCol.append(metaColumn);
  wrap.append(leftCol, rightCol);
  return wrap;
}
