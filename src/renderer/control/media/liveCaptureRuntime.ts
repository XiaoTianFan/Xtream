import type { LiveDesktopSourceSummary, LiveVisualCaptureConfig, LiveVisualState, VisualMetadataReport } from '../../../shared/types';

export type LiveVisualAttachment = {
  stream: MediaStream;
  cleanup: () => void;
};

type AttachOptions = {
  reportMetadata?: (report: VisualMetadataReport) => void;
  reacquireOnEnded?: boolean;
};

const LIVE_REACQUIRE_DELAY_MS = 2000;
const LIVE_REACQUIRE_MAX_DELAY_MS = 8000;

export async function attachLiveVisualStream(
  visual: LiveVisualState,
  video: HTMLVideoElement,
  options: AttachOptions = {},
): Promise<LiveVisualAttachment> {
  let disposed = false;
  let stream = await acquireAndAttachStream(visual, video, options);
  let retryTimer: number | undefined;
  let retryDelayMs = LIVE_REACQUIRE_DELAY_MS;

  const attachEndListeners = (targetStream: MediaStream): void => {
    for (const track of targetStream.getTracks()) {
      track.addEventListener('ended', reportEnded);
      track.addEventListener('mute', reportMuted);
      track.addEventListener('unmute', reportUnmuted);
    }
  };

  const cleanupStream = (targetStream: MediaStream): void => {
    for (const track of targetStream.getTracks()) {
      track.removeEventListener('ended', reportEnded);
      track.removeEventListener('mute', reportMuted);
      track.removeEventListener('unmute', reportUnmuted);
      track.stop();
    }
  };

  const scheduleReacquire = (): void => {
    if (disposed || retryTimer !== undefined || options.reacquireOnEnded === false) {
      return;
    }
    retryTimer = window.setTimeout(async () => {
      retryTimer = undefined;
      if (disposed) {
        return;
      }
      try {
        const nextStream = await acquireAndAttachStream(visual, video, options);
        cleanupStream(stream);
        stream = nextStream;
        attachEndListeners(stream);
        retryDelayMs = LIVE_REACQUIRE_DELAY_MS;
      } catch (error: unknown) {
        reportLiveVisualError(visual, options, summarizeLiveCaptureError(error, `Unable to reacquire ${visual.capture.source} source.`));
        retryDelayMs = Math.min(LIVE_REACQUIRE_MAX_DELAY_MS, retryDelayMs * 1.5);
        scheduleReacquire();
      }
    }, retryDelayMs);
  };

  function reportEnded(): void {
    reportLiveVisualError(visual, options, `${visual.label} stream ended. Retrying...`);
    scheduleReacquire();
  }

  function reportMuted(): void {
    reportLiveVisualError(visual, options, `${visual.label} stopped producing frames. Retrying...`);
    scheduleReacquire();
  }

  function reportUnmuted(): void {
    options.reportMetadata?.({
      visualId: visual.id,
      ready: true,
      error: undefined,
    });
  }

  attachEndListeners(stream);

  return {
    get stream() {
      return stream;
    },
    cleanup: () => {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      video.pause();
      cleanupStream(stream);
      video.srcObject = null;
      void window.xtream.liveCapture.releaseDisplayStream(visual.id);
    },
  };
}

async function acquireAndAttachStream(
  visual: LiveVisualState,
  video: HTMLVideoElement,
  options: AttachOptions,
): Promise<MediaStream> {
  const stream = await acquireLiveVisualStream(visual);
  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(`${visual.label} did not provide a video track.`);
  }
  video.srcObject = stream;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  const reportReady = (): void => {
    const settings = stream.getVideoTracks()[0]?.getSettings();
    options.reportMetadata?.({
      visualId: visual.id,
      width: video.videoWidth || settings?.width,
      height: video.videoHeight || settings?.height,
      ready: stream.getVideoTracks().some((track) => track.readyState === 'live'),
    });
  };

  video.addEventListener('loadedmetadata', reportReady);
  await video.play().catch(() => undefined);
  reportReady();
  window.setTimeout(() => {
    video.removeEventListener('loadedmetadata', reportReady);
  }, 1000);
  return stream;
}

export function reportLiveVisualError(visual: LiveVisualState, options: AttachOptions, error: string): void {
  options.reportMetadata?.({
    visualId: visual.id,
    ready: false,
    error,
  });
}

async function acquireLiveVisualStream(visual: LiveVisualState): Promise<MediaStream> {
  if (visual.capture.source === 'webcam') {
    return navigator.mediaDevices.getUserMedia({
      video: visual.capture.deviceId ? { deviceId: { exact: visual.capture.deviceId } } : true,
      audio: false,
    });
  }
  const source = await resolveDesktopSource(visual.capture);
  const prepared = await window.xtream.liveCapture.prepareDisplayStream(visual.id, source.id);
  if (!prepared) {
    throw new Error(`Xtream could not prepare ${source.name} for capture.`);
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
    });
  } catch (error: unknown) {
    throw new Error(summarizeLiveCaptureError(error, `Unable to start capture for ${source.name}.`));
  }
}

async function resolveDesktopSource(capture: LiveVisualCaptureConfig): Promise<LiveDesktopSourceSummary> {
  if (capture.source !== 'screen' && capture.source !== 'window' && capture.source !== 'screen-region') {
    throw new Error('Desktop source resolution requires a screen or window capture config.');
  }
  const sources = await window.xtream.liveCapture.listDesktopSources();
  const kind = capture.source === 'window' ? 'window' : 'screen';
  const candidates = sources.filter((source) => source.kind === kind);
  const exact = capture.sourceId ? candidates.find((source) => source.id === capture.sourceId) : undefined;
  if (exact) {
    return exact;
  }
  const fallback =
    capture.source === 'window'
      ? candidates.find((source) => source.name === capture.windowName || source.name === capture.label)
      : candidates.find((source) => source.displayId === capture.displayId || source.name === capture.label);
  if (fallback) {
    return fallback;
  }
  const label = capture.label ?? capture.sourceId ?? capture.source;
  throw new Error(`Live ${kind} source is unavailable: ${label}. Reselect the source if it was closed, minimized, or disconnected.`);
}

function summarizeLiveCaptureError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  if (error.name === 'NotAllowedError') {
    return 'Capture permission was denied.';
  }
  if (error.name === 'NotFoundError') {
    return 'The requested capture source is no longer available.';
  }
  if (error.name === 'NotReadableError') {
    return 'The capture source is unavailable or already locked by the operating system.';
  }
  return error.message || fallback;
}
