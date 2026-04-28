import type { VisualState } from '../../../shared/types';
import { attachLiveVisualStream, reportLiveVisualError } from '../media/liveCaptureRuntime';
import { applyVisualStyle } from './displayPreview';
import { getVisualPoolThumbDataUrl, setVisualPoolThumbDataUrl } from './visualPoolThumbnailCache';

const LIVE_POOL_GRID_SNAPSHOT_MS = 2000;

function tryCacheImageBitmap(visual: VisualState, img: HTMLImageElement): void {
  img.addEventListener(
    'load',
    () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w <= 0 || h <= 0) {
          return;
        }
        const c = document.createElement('canvas');
        const maxW = 320;
        const maxH = 180;
        let cw = maxW;
        let ch = Math.round(maxW / (w / h));
        if (ch > maxH) {
          ch = maxH;
          cw = Math.round(maxH * (w / h));
        }
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, cw, ch);
          setVisualPoolThumbDataUrl(visual, c.toDataURL('image/jpeg', 0.88));
        }
      } catch {
        /* tainted canvas or OOM */
      }
    },
    { once: true },
  );
}

function tryCacheVideoFrame(visual: VisualState, video: HTMLVideoElement): void {
  try {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const c = document.createElement('canvas');
    const maxW = 320;
    const maxH = 180;
    let cw = maxW;
    let ch = Math.round(maxW / (w / h));
    if (ch > maxH) {
      ch = maxH;
      cw = Math.round(maxH * (w / h));
    }
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, cw, ch);
      setVisualPoolThumbDataUrl(visual, c.toDataURL('image/jpeg', 0.88));
    }
  } catch {
    /* tainted */
  }
}

export function mountVisualPoolGridPreview(
  container: HTMLElement,
  visual: VisualState,
  registerCleanup: (cleanup: () => void) => void,
): void {
  container.replaceChildren();

  if (visual.kind === 'live') {
    const wrap = document.createElement('div');
    wrap.className = 'visual-pool-card__live-wrap';
    const video = document.createElement('video');
    video.className = 'visual-pool-card__live-video';
    video.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'visual-pool-card__live-canvas';
    applyVisualStyle(canvas, visual);
    const cached = getVisualPoolThumbDataUrl(visual);
    let placeholder: HTMLImageElement | undefined;
    if (cached) {
      placeholder = document.createElement('img');
      placeholder.src = cached;
      placeholder.alt = '';
      placeholder.className = 'visual-pool-card__live-placeholder';
      wrap.append(placeholder);
    }
    wrap.append(video, canvas);
    container.append(wrap);

    let intervalId: number | undefined;
    let attachmentCleanup: (() => void) | undefined;

    const draw = (): void => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        return;
      }
      const maxW = 320;
      const maxH = 180;
      let cw = maxW;
      let ch = Math.round(maxW / (w / h));
      if (ch > maxH) {
        ch = maxH;
        cw = Math.round(maxH * (w / h));
      }
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.drawImage(video, 0, 0, cw, ch);
      if (placeholder) {
        placeholder.remove();
        placeholder = undefined;
      }
      try {
        setVisualPoolThumbDataUrl(visual, canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        /* quota */
      }
    };

    void attachLiveVisualStream(visual, video, {
      reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report),
    })
      .then((att) => {
        attachmentCleanup = att.cleanup;
        draw();
        intervalId = window.setInterval(draw, LIVE_POOL_GRID_SNAPSHOT_MS);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Live preview unavailable.';
        reportLiveVisualError(visual, { reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report) }, message);
        const hint = document.createElement('p');
        hint.className = 'visual-pool-card__preview-fallback';
        hint.textContent = message;
        container.replaceChildren(hint);
      });

    registerCleanup(() => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
      attachmentCleanup?.();
    });
    return;
  }

  if (visual.type === 'image' && visual.url) {
    const img = document.createElement('img');
    const cached = getVisualPoolThumbDataUrl(visual);
    img.src = cached ?? visual.url;
    img.alt = visual.label;
    applyVisualStyle(img, visual);
    if (!cached) {
      tryCacheImageBitmap(visual, img);
    }
    container.append(img);
    return;
  }

  if (visual.type === 'video' && visual.url) {
    const cached = getVisualPoolThumbDataUrl(visual);
    if (cached) {
      const img = document.createElement('img');
      img.src = cached;
      img.alt = visual.label;
      applyVisualStyle(img, visual);
      container.append(img);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = visual.url;
    applyVisualStyle(video, visual);
    const onLoaded = (): void => {
      video.currentTime = 0.05;
    };
    const onSeeked = (): void => {
      video.pause();
      tryCacheVideoFrame(visual, video);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    registerCleanup(() => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    container.append(video);
    return;
  }

  const fallback = document.createElement('p');
  fallback.className = 'visual-pool-card__preview-fallback';
  fallback.textContent = 'No preview';
  container.append(fallback);
}
