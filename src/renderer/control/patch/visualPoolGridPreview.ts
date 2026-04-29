import type { LiveVisualState, VisualState } from '../../../shared/types';
import { attachLiveVisualStream, reportLiveVisualError } from '../media/liveCaptureRuntime';
import { applyVisualStyle } from './displayPreview';
import { getVisualPoolThumbDataUrl, setVisualPoolThumbDataUrl } from './visualPoolThumbnailCache';
import { decorateIconButton } from '../shared/icons';

const LIVE_POOL_GRID_SNAPSHOT_MS = 2000;
/** If file video pool preview never reaches seeked/error, settle with error so launch gating does not hang. */
const POOL_FILE_VIDEO_PREVIEW_TIMEOUT_MS = 20_000;

export type VisualPoolGridMountOptions = {
  /** When false, live grid cards never attach capture (cached / placeholder only). */
  livePoolPreviewGloballyAllowed: boolean;
};

function reportPoolPreviewStatus(visual: VisualState, ready: boolean, error?: string): void {
  void window.xtream.renderer.reportPreviewStatus({
    key: `pool:${visual.id}`,
    visualId: visual.id,
    ready,
    error,
    reportedAtWallTimeMs: Date.now(),
  });
}

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

function createDualSenseOverlayButton(icon: 'Pause' | 'Play', label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'visual-pool-card__live-overlay-btn';
  decorateIconButton(btn, icon, label);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return btn;
}

/**
 * Hover/focus-visible shows this layer via CSS; it only contains transport controls — no attach on hover.
 */
function appendHoverActions(container: HTMLElement, inner: HTMLElement): void {
  const layer = document.createElement('div');
  layer.className = 'visual-pool-card__live-hover-actions';
  layer.append(inner);
  container.append(layer);
}

function mountLazyLivePoolGridPreview(
  container: HTMLElement,
  visual: LiveVisualState,
  livePoolPreviewGloballyAllowed: boolean,
  registerCleanup: (cleanup: () => void) => void,
): void {
  container.classList.add('visual-pool-card__preview--live');
  container.tabIndex = 0;

  type LivePhase = 'idle' | 'streaming' | 'paused_manual';

  let phase: LivePhase = 'idle';
  let attachInFlight = false;
  /** Bumped when a new attach starts or mount tears down — invalidates in-flight `attachLiveVisualStream`. */
  let attachGeneration = 0;

  let intervalId: number | undefined;
  let attachmentCleanup: (() => void) | undefined;
  let wrapEl: HTMLElement | undefined;
  let poolReportedForSession = false;

  function stopStreamResources(): void {
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      intervalId = undefined;
    }
    attachmentCleanup?.();
    attachmentCleanup = undefined;
    wrapEl?.remove();
    wrapEl = undefined;
  }

  /**
   * @param pausedManual — User paused streaming; hover shows Resume only (click restores stream).
   */
  function renderIdle(pausedManual: boolean): void {
    stopStreamResources();
    phase = pausedManual ? 'paused_manual' : 'idle';

    container.replaceChildren();

    const idleRoot = document.createElement('div');
    idleRoot.className = 'visual-pool-card__live-idle';

    const cached = getVisualPoolThumbDataUrl(visual);
    if (cached) {
      const img = document.createElement('img');
      img.src = cached;
      img.alt = '';
      img.className = 'visual-pool-card__live-placeholder';
      idleRoot.append(img);
    } else {
      const hint = document.createElement('p');
      hint.className = 'visual-pool-card__preview-fallback';
      hint.textContent = 'Live';
      idleRoot.append(hint);
    }

    container.append(idleRoot);

    if (!livePoolPreviewGloballyAllowed) {
      const hint = document.createElement('span');
      hint.className = 'visual-pool-card__live-preview-off-hint';
      hint.textContent = 'Grid live preview off — use toolbar to enable.';
      appendHoverActions(container, hint);
      reportPoolPreviewStatus(visual, true);
      return;
    }

    if (pausedManual) {
      const resumeBtn = createDualSenseOverlayButton('Play', 'Resume live preview');
      resumeBtn.addEventListener('click', () => {
        if (!livePoolPreviewGloballyAllowed || phase !== 'paused_manual') {
          return;
        }
        phase = 'idle';
        void beginLiveAttachment();
      });
      appendHoverActions(container, resumeBtn);
      reportPoolPreviewStatus(visual, true);
      return;
    }

    const playBtn = createDualSenseOverlayButton('Play', 'Start live preview');
    playBtn.addEventListener('click', () => {
      if (!livePoolPreviewGloballyAllowed || phase !== 'idle') {
        return;
      }
      void beginLiveAttachment();
    });
    appendHoverActions(container, playBtn);
    reportPoolPreviewStatus(visual, true);
  }

  async function beginLiveAttachment(): Promise<void> {
    if (!livePoolPreviewGloballyAllowed || phase !== 'idle' || attachInFlight) {
      return;
    }
    const mySnap = ++attachGeneration;
    attachInFlight = true;
    poolReportedForSession = false;
    container.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'visual-pool-card__live-wrap';
    const video = document.createElement('video');
    video.className = 'visual-pool-card__live-video';
    video.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'visual-pool-card__live-canvas';
    applyVisualStyle(canvas, visual);

    let placeholder: HTMLImageElement | undefined;
    const thumb = getVisualPoolThumbDataUrl(visual);
    if (thumb) {
      placeholder = document.createElement('img');
      placeholder.src = thumb;
      placeholder.alt = '';
      placeholder.className = 'visual-pool-card__live-placeholder';
      wrap.append(placeholder);
    }
    wrap.append(video, canvas);

    container.append(wrap);
    wrapEl = wrap;

    const maybeReportPoolOk = (): void => {
      if (poolReportedForSession) {
        return;
      }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        return;
      }
      poolReportedForSession = true;
      reportPoolPreviewStatus(visual, true);
    };

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
      maybeReportPoolOk();
      try {
        setVisualPoolThumbDataUrl(visual, canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        /* quota */
      }
    };

    try {
      const att = await attachLiveVisualStream(visual, video, {
        reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report),
      });
      if (mySnap !== attachGeneration) {
        att.cleanup();
        return;
      }
      attachmentCleanup = att.cleanup;
      if (phase !== 'idle') {
        stopStreamResources();
        return;
      }
      draw();
      maybeReportPoolOk();
      intervalId = window.setInterval(draw, LIVE_POOL_GRID_SNAPSHOT_MS);
      phase = 'streaming';

      const pauseBtn = createDualSenseOverlayButton('Pause', 'Pause live preview');
      pauseBtn.addEventListener('click', () => {
        if (phase !== 'streaming') {
          return;
        }
        stopStreamResources();
        phase = 'paused_manual';
        renderIdle(true);
      });
      appendHoverActions(wrap, pauseBtn);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Live preview unavailable.';
      reportPoolPreviewStatus(visual, false, message);
      reportLiveVisualError(visual, { reportMetadata: (report) => void window.xtream.visuals.reportMetadata(report) }, message);
      phase = 'idle';
      const hint = document.createElement('p');
      hint.className = 'visual-pool-card__preview-fallback';
      hint.textContent = message;
      container.replaceChildren(hint);
    } finally {
      attachInFlight = false;
    }
  }

  renderIdle(false);

  registerCleanup(() => {
    attachGeneration++;
    stopStreamResources();
    container.classList.remove('visual-pool-card__preview--live');
    container.removeAttribute('tabindex');
  });
}

export function mountVisualPoolGridPreview(
  container: HTMLElement,
  visual: VisualState,
  registerCleanup: (cleanup: () => void) => void,
  mountOptions?: VisualPoolGridMountOptions,
): void {
  container.replaceChildren();

  if (visual.kind === 'live') {
    const allowed = mountOptions?.livePoolPreviewGloballyAllowed !== false;
    mountLazyLivePoolGridPreview(container, visual, allowed, registerCleanup);
    return;
  }

  if (visual.type === 'image' && visual.url) {
    const img = document.createElement('img');
    const cached = getVisualPoolThumbDataUrl(visual);
    img.src = cached ?? visual.url;
    img.alt = visual.label;
    applyVisualStyle(img, visual);
    const settlePoolOk = (): void => reportPoolPreviewStatus(visual, true);
    const settlePoolErr = (): void => reportPoolPreviewStatus(visual, false, 'Pool image preview failed to load.');
    if (img.complete && img.naturalHeight > 0) {
      settlePoolOk();
    } else {
      img.addEventListener('load', settlePoolOk, { once: true });
      img.addEventListener('error', settlePoolErr, { once: true });
    }
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
      const settlePoolOk = (): void => reportPoolPreviewStatus(visual, true);
      const settlePoolErr = (): void => reportPoolPreviewStatus(visual, false, 'Pool cached thumb failed to load.');
      if (img.complete && img.naturalHeight > 0) {
        settlePoolOk();
      } else {
        img.addEventListener('load', settlePoolOk, { once: true });
        img.addEventListener('error', settlePoolErr, { once: true });
      }
      container.append(img);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = visual.url;
    applyVisualStyle(video, visual);

    let settled = false;
    const settle = (ready: boolean, error?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      reportPoolPreviewStatus(visual, ready, error);
    };

    const timeoutId = window.setTimeout(() => {
      settle(false, 'Pool video preview timed out.');
    }, POOL_FILE_VIDEO_PREVIEW_TIMEOUT_MS);

    video.addEventListener(
      'error',
      () => settle(false, 'Pool video preview failed to load.'),
      { once: true },
    );
    const onLoaded = (): void => {
      video.currentTime = 0.05;
    };
    const onSeeked = (): void => {
      video.pause();
      tryCacheVideoFrame(visual, video);
      settle(true);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    registerCleanup(() => {
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    container.append(video);
    return;
  }

  reportPoolPreviewStatus(visual, true);
  const fallback = document.createElement('p');
  fallback.className = 'visual-pool-card__preview-fallback';
  fallback.textContent = 'No preview';
  container.append(fallback);
}
