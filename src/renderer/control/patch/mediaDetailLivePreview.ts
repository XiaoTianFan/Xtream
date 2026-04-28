import type { AudioSourceState, DirectorState, VisualState } from '../../../shared/types';
import { applyVisualStyle } from './displayPreview';
import type { SelectedEntity } from '../shared/types';

function readNumericOverrides(meta: HTMLElement, labelHandlers: Record<string, (v: number) => void>): void {
  for (const row of meta.querySelectorAll('.detail-number-control')) {
    const title = row.querySelector('span:first-of-type');
    const labelText = title?.textContent?.trim();
    const range = row.querySelector<HTMLInputElement>('input[type="range"]');
    if (!labelText || !range || !(labelText in labelHandlers)) {
      continue;
    }
    const v = Number(range.value);
    if (!Number.isFinite(v)) {
      continue;
    }
    labelHandlers[labelText](v);
  }
}

function mergeVisualWithMetaSliders(meta: HTMLElement | null | undefined, base: VisualState): VisualState {
  const next = { ...base } as VisualState;
  if (!meta) {
    return next;
  }
  readNumericOverrides(meta, {
    Opacity: (v) => {
      (next as VisualState).opacity = v;
    },
    Brightness: (v) => {
      (next as VisualState).brightness = v;
    },
    Contrast: (v) => {
      (next as VisualState).contrast = v;
    },
    'Playback Rate': (v) => {
      (next as VisualState).playbackRate = v;
    },
  });
  return next;
}

function mergeAudioWithMetaSliders(meta: HTMLElement | null | undefined, base: AudioSourceState): AudioSourceState {
  const next = { ...base } as AudioSourceState;
  if (!meta) {
    return next;
  }
  readNumericOverrides(meta, {
    'Playback Rate': (v) => {
      next.playbackRate = v;
    },
  });
  return next;
}

/**
 * Applies current director values plus in-progress slider values from the meta column
 * to the left preview column (playback rate + visual appearance).
 */
export function applyMediaDetailLivePreview(
  detailsContent: HTMLElement,
  state: DirectorState,
  selected: SelectedEntity | undefined,
): void {
  if (!selected || (selected.type !== 'visual' && selected.type !== 'audio-source')) {
    return;
  }
  const mount = detailsContent.querySelector('.media-detail-preview-mount');
  const meta = detailsContent.querySelector('.media-detail-layout__meta');
  if (!(mount instanceof HTMLElement)) {
    return;
  }

  if (selected.type === 'visual') {
    const visual = state.visuals[selected.id];
    if (!visual) {
      return;
    }
    if (state.performanceMode && visual.kind !== 'live') {
      return;
    }
    const merged = mergeVisualWithMetaSliders(meta instanceof HTMLElement ? meta : undefined, visual);
    const video = mount.querySelector('video');
    const img = mount.querySelector('img');
    const target = img ?? video;
    if (target) {
      applyVisualStyle(target, merged);
    }
    if (video) {
      video.playbackRate = merged.playbackRate ?? 1;
    }
    return;
  }

  const source = state.audioSources[selected.id];
  if (!source) {
    return;
  }
  const merged = mergeAudioWithMetaSliders(meta instanceof HTMLElement ? meta : undefined, source);
  const audio = mount.querySelector('audio');
  if (audio) {
    audio.playbackRate = merged.playbackRate ?? 1;
  }
}
