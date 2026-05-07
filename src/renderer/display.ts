/// <reference path="./global.d.ts" />
import './display.css';
import { describeLayout, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds, getMediaEffectiveTime } from '../shared/timeline';
import type {
  DirectorState,
  DisplayWindowState,
  LoopState,
  StreamEnginePublicState,
  VisualId,
  VisualLayoutProfile,
  VisualMetadataReport,
  VisualState,
} from '../shared/types';
import { createPlaybackSyncKey, getMediaSyncState, syncTimedMediaElement } from './control/media/mediaSync';
import { hasEmbeddedAudioTrack } from './control/media/mediaMetadata';
import { attachLiveVisualStream, reportLiveVisualError } from './control/media/liveCaptureRuntime';
import { buildStreamDisplayFrames, deriveDirectorStateForStream, type StreamDisplayFrame, type StreamDisplayLayer } from './streamProjection';
import { formatDisplayWindowTitle } from '../shared/displayWindowTitle';

const root = document.querySelector<HTMLDivElement>('#displayRoot');
const params = new URLSearchParams(window.location.search);
const displayId = params.get('id') ?? 'unknown-display';
const showDiagnosticsOverlay = params.get('diagnostics') === '1';
const debugDisplayRefresh =
  showDiagnosticsOverlay ||
  params.get('debugDisplay') === '1' ||
  params.get('displayDebug') === '1' ||
  readDisplayDebugFlag();
document.title = formatDisplayWindowTitle({ id: displayId });

let currentRenderSignature = '';
let currentState: DirectorState | undefined;
let latestDirectorState: DirectorState | undefined;
let currentStreamState: StreamEnginePublicState | undefined;
let currentDirectorSeconds = 0;
let driftTimer: number | undefined;
let syncTimer: number | undefined;
let frameCounter = 0;
let lastFrameSampleMs = performance.now();
let lastFrameRateFps: number | undefined;
let mediaSeekCount = 0;
let mediaSeekFallbackCount = 0;
let lastMediaSeekDurationMs: number | undefined;
const appliedCorrectionRevisions = new Set<number>();
const videoElements = new Map<VisualId, HTMLVideoElement>();
const liveVisualCleanups = new Map<VisualId, () => void>();
const videoFrameStats = new WeakMap<HTMLVideoElement, VideoFrameStats>();
const DISPLAY_SYNC_INTERVAL_MS = 500;
const DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS = 0.5;
const SYNC_KEY_SEEK_THRESHOLD_SECONDS = 0.12;

type RenderMode = 'patch' | 'stream' | 'missing';
type DisplayDebugDetail = Record<string, unknown>;

type VideoPlaybackQualitySnapshot = {
  totalVideoFrames?: number;
  droppedVideoFrames?: number;
  corruptedVideoFrames?: number;
};

type FrameTrackedVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  getVideoPlaybackQuality?: () => VideoPlaybackQualitySnapshot;
};

type VideoFrameStats = {
  presentedFrames: number;
  samplePresentedFrames: number;
  sampleWallTimeMs: number;
  maxFrameGapMs: number;
  lastFrameWallTimeMs?: number;
  presentedFrameRateFps?: number;
};

if (!root) {
  throw new Error('Missing display root.');
}

const displayRoot = root;

const identifyOverlay = document.querySelector<HTMLElement>('#displayIdentifyOverlay');
let identifyHideTimer: number | undefined;
let currentRenderMode: RenderMode | undefined;
let currentStreamZoneSignature = '';
let lastBlackoutState: boolean | undefined;
let lastStreamDebugSignature = '';
let lastDriftDebugSignature = '';

function readDisplayDebugFlag(): boolean {
  try {
    return window.localStorage?.getItem('xtream:display-debug') === '1';
  } catch {
    return false;
  }
}

function rounded(value: number | undefined, digits = 3): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function debugDisplay(event: string, detail: DisplayDebugDetail = {}): void {
  if (!debugDisplayRefresh) {
    return;
  }
  console.debug(`[xtream-display:${displayId}] ${event}`, {
    displayId,
    event,
    renderMode: currentRenderMode,
    t: Math.round(performance.now()),
    ...detail,
  });
}

function summarizeStreamLayer(layer: StreamDisplayLayer): DisplayDebugDetail {
  return {
    layerId: layer.layerId,
    sourceVisualId: layer.sourceVisualId,
    timelineId: layer.timelineId,
    timelineKind: layer.timelineKind,
    timelineOrderIndex: layer.timelineOrderIndex,
    threadOrderIndex: layer.threadOrderIndex,
    runtimeInstanceId: layer.runtimeInstanceId,
    sceneId: layer.sceneId,
    subCueId: layer.subCueId,
    zoneId: layer.zoneId,
    streamStartMs: rounded(layer.streamStartMs, 1),
    localStartMs: rounded(layer.localStartMs, 1),
    absoluteStartMs: rounded(layer.absoluteStartMs, 1),
    selected: layer.selected,
    opacity: rounded(layer.opacity),
    visualKind: layer.visual.kind,
    visualType: layer.visual.type,
    url: layer.visual.kind === 'live' ? undefined : layer.visual.url,
    runtimeOffsetSeconds: rounded(layer.visual.runtimeOffsetSeconds),
    playbackRate: rounded(layer.visual.playbackRate),
    mediaSignature: streamLayerMediaSignature(layer),
  };
}

function summarizeStreamRuntime(): DisplayDebugDetail {
  const runtime = currentStreamState?.runtime;
  const timelines = Object.values(runtime?.timelineInstances ?? {}).map((timeline) => ({
    id: timeline.id,
    kind: timeline.kind,
    status: timeline.status,
    cursorMs: rounded(timeline.cursorMs, 1),
    offsetMs: rounded(timeline.offsetMs, 1),
    pausedAtMs: rounded(timeline.pausedAtMs, 1),
    threadCount: timeline.orderedThreadInstanceIds.length,
  }));
  return {
    runtimeStatus: runtime?.status,
    currentStreamMs: rounded(runtime?.currentStreamMs, 1),
    activeVisualCueCount: runtime?.activeVisualSubCues?.length ?? 0,
    activeAudioCueCount: runtime?.activeAudioSubCues?.length ?? 0,
    timelineCount: timelines.length,
    timelines,
  };
}

function summarizeStreamFrame(frame: StreamDisplayFrame): DisplayDebugDetail {
  return {
    displayId: frame.displayId,
    layout: frame.layout.type,
    mode: frame.mode,
    algorithm: frame.algorithm,
    transitionMs: frame.transitionMs,
    zones: frame.zones.map((zone) => ({
      zoneId: zone.zoneId,
      layerCount: zone.layers.length,
      selectedLayerIds: zone.layers.filter((layer) => layer.selected).map((layer) => layer.layerId),
    })),
    selectedLayers: frame.zones.flatMap((zone) => zone.layers.filter((layer) => layer.selected).map(summarizeStreamLayer)),
    ...summarizeStreamRuntime(),
  };
}

function logStreamFrameIfChanged(frame: StreamDisplayFrame): void {
  if (!debugDisplayRefresh) {
    return;
  }
  const signature = createStreamFrameRenderSignature(frame);
  if (signature === lastStreamDebugSignature) {
    return;
  }
  debugDisplay('stream-frame-change', {
    signature,
    previousSignature: lastStreamDebugSignature || undefined,
    ...summarizeStreamFrame(frame),
  });
  lastStreamDebugSignature = signature;
}

function replaceDisplayRoot(reason: string, detail: DisplayDebugDetail = {}): void {
  debugDisplay('root-replace', {
    reason,
    childCount: displayRoot.childElementCount,
    videoCount: videoElements.size,
    liveVisualCount: liveVisualCleanups.size,
    streamZoneSignature: currentStreamZoneSignature || undefined,
    renderSignature: currentRenderSignature || undefined,
    ...detail,
  });
  cleanupRenderedMedia();
  displayRoot.replaceChildren();
}

function applyBlackoutState(blackedOut: boolean): void {
  displayRoot.classList.toggle('blacked-out', blackedOut);
  if (lastBlackoutState === blackedOut) {
    return;
  }
  debugDisplay('blackout-change', {
    blackedOut,
    previous: lastBlackoutState,
  });
  lastBlackoutState = blackedOut;
}

function setupIdentifyFlashOverlay(): (() => void) | undefined {
  if (!identifyOverlay) {
    return undefined;
  }
  return window.xtream.displays.onIdentifyFlash((payload) => {
    if (identifyHideTimer !== undefined) {
      window.clearTimeout(identifyHideTimer);
    }
    identifyOverlay.textContent = payload.label;
    identifyOverlay.hidden = false;
    identifyOverlay.setAttribute('aria-hidden', 'false');
    const ms = payload.durationMs > 0 ? payload.durationMs : 3000;
    identifyHideTimer = window.setTimeout(() => {
      identifyOverlay.hidden = true;
      identifyOverlay.setAttribute('aria-hidden', 'true');
      identifyHideTimer = undefined;
    }, ms);
  });
}

const unsubscribeIdentifyFlash = setupIdentifyFlashOverlay();

function cleanupMediaForVisualId(visualId: VisualId): void {
  const hadLiveCleanup = liveVisualCleanups.has(visualId);
  const hadVideo = videoElements.has(visualId);
  if (hadLiveCleanup || hadVideo) {
    debugDisplay('media-cleanup-visual', { visualId, hadLiveCleanup, hadVideo });
  }
  const cleanup = liveVisualCleanups.get(visualId);
  if (cleanup) {
    cleanup();
    liveVisualCleanups.delete(visualId);
  }
  videoElements.delete(visualId);
}

function cleanupMediaInElement(element: Element): void {
  const ids = new Set<VisualId>();
  if (element instanceof HTMLElement && element.dataset.visualId) {
    ids.add(element.dataset.visualId);
  }
  for (const child of element.querySelectorAll<HTMLElement>('[data-visual-id]')) {
    if (child.dataset.visualId) {
      ids.add(child.dataset.visualId);
    }
  }
  for (const id of ids) {
    cleanupMediaForVisualId(id);
  }
}

function cleanupRenderedMedia(): void {
  if (liveVisualCleanups.size > 0 || videoElements.size > 0) {
    debugDisplay('media-cleanup-all', {
      liveVisualCount: liveVisualCleanups.size,
      videoCount: videoElements.size,
    });
  }
  for (const cleanup of liveVisualCleanups.values()) {
    cleanup();
  }
  liveVisualCleanups.clear();
  videoElements.clear();
}

function renderLayout(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): void {
  displayRoot.className = layout.type === 'split' ? 'display-root split' : 'display-root';
  replaceDisplayRoot('patch-layout', {
    layout: describeLayout(layout),
    visualIds: getLayoutVisualIds(layout),
  });
  currentRenderMode = 'patch';
  currentStreamZoneSignature = '';
  for (const visualId of getLayoutVisualIds(layout)) {
    displayRoot.append(createVisualElement(visualId, visualsById[visualId]));
  }
}

function renderStreamFrame(frame: StreamDisplayFrame): void {
  logStreamFrameIfChanged(frame);
  displayRoot.className = frame.layout.type === 'split' ? 'display-root split stream-frame' : 'display-root stream-frame';
  const zoneIds = frame.layout.type === 'split' ? (['L', 'R'] as const) : (['single'] as const);
  const zoneSignature = `${frame.displayId}:${frame.layout.type}:${zoneIds.join('|')}`;
  if (currentRenderMode !== 'stream' || currentStreamZoneSignature !== zoneSignature) {
    replaceDisplayRoot('stream-zone-layout', {
      previousMode: currentRenderMode,
      previousZoneSignature: currentStreamZoneSignature || undefined,
      nextZoneSignature: zoneSignature,
      ...summarizeStreamFrame(frame),
    });
    currentRenderMode = 'stream';
    currentStreamZoneSignature = zoneSignature;
    for (const zoneId of zoneIds) {
      const output = document.createElement('section');
      output.className = 'display-output display-output-zone';
      output.dataset.zoneId = zoneId;
      displayRoot.append(output);
    }
  }
  for (const zoneId of zoneIds) {
    const output =
      displayRoot.querySelector<HTMLElement>(`.display-output-zone[data-zone-id="${zoneId}"]`) ??
      document.createElement('section');
    if (!output.isConnected) {
      debugDisplay('stream-zone-output-add', { zoneId, zoneSignature });
      output.className = 'display-output display-output-zone';
      output.dataset.zoneId = zoneId;
      displayRoot.append(output);
    }
    const zone = frame.zones.find((candidate) => candidate.zoneId === zoneId);
    const selectedLayers = (zone?.layers ?? []).filter((layer) => layer.selected);
    reconcileStreamZone(output, zoneId, selectedLayers);
  }
}

function handleState(state: DirectorState): void {
  latestDirectorState = state;
  const effectiveState = deriveDirectorStateForStream(state, currentStreamState);
  const streamFrame = buildStreamDisplayFrames(state, currentStreamState)[displayId];
  currentState = effectiveState;
  currentDirectorSeconds = getDirectorSeconds(effectiveState);
  displayRoot.style.setProperty(
    '--display-blackout-fade',
    `${Math.max(0, effectiveState.globalDisplayBlackoutFadeOverrideSeconds ?? effectiveState.globalDisplayBlackoutFadeOutSeconds)}s`,
  );
  const blackedOut = effectiveState.globalDisplayBlackout;
  const display = effectiveState.displays[displayId];
  if (!display) {
    document.title = formatDisplayWindowTitle({ id: displayId });
    if (currentRenderMode !== 'missing') {
      replaceDisplayRoot('display-missing', { knownDisplayIds: Object.keys(effectiveState.displays) });
      const missing = document.createElement('section');
      missing.className = 'display-output';
      missing.textContent = 'UNMAPPED';
      displayRoot.append(missing);
      currentRenderMode = 'missing';
      currentStreamZoneSignature = '';
      currentRenderSignature = '';
    }
    applyBlackoutState(blackedOut);
    return;
  }
  document.title = formatDisplayWindowTitle(display);
  if (streamFrame) {
    renderStreamFrame(streamFrame);
    currentRenderSignature = createStreamFrameRenderSignature(streamFrame);
  } else {
    const renderSignature = createRenderSignature(display.layout, effectiveState.visuals);
    if (currentRenderMode !== 'patch' || currentRenderSignature !== renderSignature) {
      renderLayout(display.layout, effectiveState.visuals);
      currentRenderSignature = renderSignature;
    }
  }
  applyBlackoutState(blackedOut);
  syncVideoElements(display, effectiveState);
}

function handleStreamState(state: StreamEnginePublicState): void {
  currentStreamState = state;
  if (latestDirectorState) {
    handleState(latestDirectorState);
  }
}

function createVisualElement(visualId: VisualId, visual: VisualState | undefined): HTMLElement {
  const visualElement = document.createElement('section');
  visualElement.className = 'display-output';
  const shouldReportMetadata = !isStreamRuntimeVisualId(visualId);
  debugDisplay('patch-visual-element-create', {
    visualId,
    kind: visual?.kind,
    type: visual?.type,
    url: visual?.kind === 'live' ? undefined : visual?.url,
    ready: visual?.ready,
  });
  if (visual?.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = visualId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    visualElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(visualId, `live ${visual.capture.source}`)] : []));
    const metadataOptions = shouldReportMetadata
      ? { reportMetadata: (report: VisualMetadataReport) => void window.xtream.visuals.reportMetadata(report) }
      : {};
    void attachLiveVisualStream(visual, video, metadataOptions)
      .then((attachment) => {
        if (visualElement.isConnected) {
          liveVisualCleanups.set(visualId, attachment.cleanup);
        } else {
          attachment.cleanup();
        }
      })
      .catch((error: unknown) => {
        reportLiveVisualError(
          visual,
          metadataOptions,
          error instanceof Error ? error.message : 'Live visual capture failed.',
        );
      });
    return visualElement;
  }
  if (visual?.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    image.addEventListener('load', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        width: image.naturalWidth,
        height: image.naturalHeight,
        ready: true,
      });
    });
    image.addEventListener('error', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({ visualId, ready: false, error: 'Image failed to load.' });
    });
    visualElement.append(image, ...(showDiagnosticsOverlay ? [createOverlay(visualId, 'static image')] : []));
    return visualElement;
  }
  if (visual?.url) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = visual.url;
    video.dataset.visualId = visualId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    video.addEventListener('loadedmetadata', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        hasEmbeddedAudio: hasEmbeddedAudioTrack(video),
        ready: true,
      });
    });
    video.addEventListener('error', () => {
      if (!shouldReportMetadata) {
        return;
      }
      void window.xtream.visuals.reportMetadata({
        visualId,
        ready: false,
        error: video.error?.message ?? 'Video failed to load.',
      });
    });
    observeVideoFrames(video);
    visualElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(visualId, 'muted visual rail')] : []));
    videoElements.set(visualId, video);
    return visualElement;
  }
  const visualLabel = document.createElement('span');
  visualLabel.textContent = visual?.label ?? visualId;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'no visual selected';
  visualElement.append(visualLabel, visualMeta);
  return visualElement;
}

function createNoSignalPlaceholder(zoneId: StreamDisplayFrame['zones'][number]['zoneId']): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'display-output-placeholder';
  const visualLabel = document.createElement('span');
  visualLabel.textContent = zoneId === 'single' ? 'NO SIGNAL' : zoneId;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'no stream visual';
  placeholder.append(visualLabel, visualMeta);
  return placeholder;
}

function streamLayerMediaSignature(layer: StreamDisplayLayer): string {
  const visual = layer.visual;
  return `${layer.layerId}:${layer.sourceVisualId}:${visual.kind}:${visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty'}:${
    visual.ready ? 'ready' : 'not-ready'
  }:${visual.error ?? ''}:${visual.type ?? ''}`;
}

function applyStreamLayerElementState(layerElement: HTMLElement, layer: StreamDisplayLayer, index: number): void {
  layerElement.className = `display-layer display-layer--${layer.blendAlgorithm}`;
  layerElement.dataset.layerId = layer.layerId;
  layerElement.dataset.visualId = layer.layerId;
  layerElement.dataset.sourceVisualId = layer.sourceVisualId;
  layerElement.dataset.sceneId = layer.sceneId;
  layerElement.dataset.subCueId = layer.subCueId;
  layerElement.dataset.mediaSignature = streamLayerMediaSignature(layer);
  layerElement.style.zIndex = String(index + 1);
  layerElement.style.opacity = String(layer.opacity);
  layerElement.style.setProperty('--display-layer-transition', `${layer.transitionMs}ms`);
  layerElement.style.mixBlendMode = cssBlendMode(layer.blendAlgorithm);
  const media = layerElement.querySelector<HTMLElement>('video,img');
  if (media) {
    applyVisualStyle(media, layer.visual);
  }
}

function reconcileStreamZone(output: HTMLElement, zoneId: StreamDisplayFrame['zones'][number]['zoneId'], layers: StreamDisplayLayer[]): void {
  const wantedLayerIds = new Set(layers.map((layer) => layer.layerId));
  for (const child of [...output.children]) {
    const element = child as HTMLElement;
    const layerId = element.dataset.layerId;
    if (layerId && !wantedLayerIds.has(layerId)) {
      debugDisplay('stream-layer-remove', {
        zoneId,
        layerId,
        wantedLayerIds: [...wantedLayerIds],
        mediaSignature: element.dataset.mediaSignature,
      });
      cleanupMediaInElement(element);
      element.remove();
    } else if (!layerId && layers.length > 0) {
      debugDisplay('stream-placeholder-remove', { zoneId });
      element.remove();
    }
  }

  if (layers.length === 0) {
    if (!output.querySelector('.display-output-placeholder')) {
      debugDisplay('stream-zone-placeholder', { zoneId });
      output.replaceChildren(createNoSignalPlaceholder(zoneId));
    }
    return;
  }

  for (const [index, layer] of layers.entries()) {
    let layerElement = [...output.querySelectorAll<HTMLElement>('.display-layer')].find(
      (candidate) => candidate.dataset.layerId === layer.layerId,
    );
    const mediaSignature = streamLayerMediaSignature(layer);
    if (layerElement && layerElement.dataset.mediaSignature !== mediaSignature) {
      debugDisplay('stream-layer-replace', {
        zoneId,
        previousMediaSignature: layerElement.dataset.mediaSignature,
        mediaSignature,
        layer: summarizeStreamLayer(layer),
      });
      cleanupMediaInElement(layerElement);
      const replacement = createStreamLayerElement(layer, index);
      layerElement.replaceWith(replacement);
      layerElement = replacement;
    } else if (!layerElement) {
      debugDisplay('stream-layer-add', {
        zoneId,
        mediaSignature,
        layer: summarizeStreamLayer(layer),
      });
      layerElement = createStreamLayerElement(layer, index);
    }
    applyStreamLayerElementState(layerElement, layer, index);
    output.append(layerElement);
  }
}

function createStreamLayerElement(layer: StreamDisplayLayer, index: number): HTMLElement {
  const layerElement = document.createElement('div');
  debugDisplay('stream-layer-element-create', {
    index,
    layer: summarizeStreamLayer(layer),
  });
  applyStreamLayerElementState(layerElement, layer, index);
  const visual = layer.visual;
  if (visual.kind === 'live') {
    const video = document.createElement('video');
    video.dataset.visualId = layer.layerId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    layerElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, `stream live ${visual.capture.source}`)] : []));
    void attachLiveVisualStream(visual, video, {})
      .then((attachment) => {
        if (layerElement.isConnected) {
          liveVisualCleanups.set(layer.layerId, attachment.cleanup);
        } else {
          attachment.cleanup();
        }
      })
      .catch((error: unknown) => {
        reportLiveVisualError(visual, {}, error instanceof Error ? error.message : 'Live visual capture failed.');
      });
    return layerElement;
  }
  if (visual.type === 'image' && visual.url) {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    layerElement.append(image, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, 'stream image layer')] : []));
    return layerElement;
  }
  if (visual.url) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = visual.url;
    video.dataset.visualId = layer.layerId;
    applyVisualStyle(video, visual);
    syncVideoWhenReady(video);
    observeVideoFrames(video);
    layerElement.append(video, ...(showDiagnosticsOverlay ? [createOverlay(layer.layerId, 'stream video layer')] : []));
    videoElements.set(layer.layerId, video);
    return layerElement;
  }
  const visualLabel = document.createElement('span');
  visualLabel.textContent = visual.label;
  const visualMeta = document.createElement('small');
  visualMeta.textContent = 'stream visual missing media';
  layerElement.append(visualLabel, visualMeta);
  return layerElement;
}

function cssBlendMode(algorithm: StreamDisplayLayer['blendAlgorithm']): string {
  if (algorithm === 'additive') {
    return 'plus-lighter';
  }
  if (algorithm === 'alpha-over' || algorithm === 'latest' || algorithm === 'crossfade') {
    return 'normal';
  }
  return algorithm;
}

function isStreamRuntimeVisualId(visualId: string): boolean {
  return visualId.startsWith('stream-visual:');
}

function createOverlay(visualId: string, detail: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'display-output-overlay';
  overlay.append(createTextSpan(`Visual ${visualId}`), createTextSpan(detail));
  return overlay;
}

function createTextSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function createRenderSignature(layout: VisualLayoutProfile, visualsById: Record<VisualId, VisualState>): string {
  const visualParts = getLayoutVisualIds(layout).map((visualId) => {
    const visual = visualsById[visualId];
    return `${visualId}:${visual?.kind ?? 'file'}:${visual?.url ?? 'empty'}:${
      visual?.kind === 'live' ? JSON.stringify(visual.capture) : ''
    }:${visual?.ready ? 'ready' : 'not-ready'}:${visual?.error ?? ''}:${visual?.opacity ?? 1}:${
      visual?.brightness ?? 1
    }:${visual?.contrast ?? 1}:${visual?.playbackRate ?? 1}`;
  });
  return `${describeLayout(layout)}|${visualParts.join('|')}`;
}

function createStreamFrameRenderSignature(frame: StreamDisplayFrame): string {
  const zones = frame.zones.map((zone) => {
    const layers = zone.layers
      .filter((layer) => layer.selected)
      .map((layer) => {
        const visual = layer.visual;
        return `${layer.layerId}:${layer.order}:${layer.blendAlgorithm}:${visual.kind}:${
          visual.kind === 'live' ? JSON.stringify(visual.capture) : visual.url ?? 'empty'
        }:${visual.ready ? 'ready' : 'not-ready'}:${visual.error ?? ''}`;
      });
    return `${zone.zoneId}[${layers.join(',')}]`;
  });
  return `stream:${frame.displayId}:${frame.layout.type}:${frame.mode}:${frame.algorithm}:${frame.transitionMs}:${zones.join('|')}`;
}

function syncVideoWhenReady(video: HTMLVideoElement): void {
  const sync = (event: Event) => {
    debugDisplay('video-ready-event', {
      eventType: event.type,
      visualId: video.dataset.visualId,
      readyState: video.readyState,
      currentTime: rounded(video.currentTime),
      duration: rounded(video.duration),
      src: video.currentSrc || video.src || undefined,
    });
    const state = currentState;
    const display = state?.displays[displayId];
    if (state && display) {
      syncVideoElements(display, state);
    }
  };
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('canplay', sync);
}

function syncVideoElements(display: DisplayWindowState, state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  currentDirectorSeconds = targetSeconds;
  const syncKey = createPlaybackSyncKey(state);
  for (const video of videoElements.values()) {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }
    const correction = state.corrections.displays[display.id];
    const shouldApplyCorrection =
      correction?.action === 'seek' &&
      correction.targetSeconds !== undefined &&
      !appliedCorrectionRevisions.has(correction.revision);
    const visualId = video.dataset.visualId;
    const visual = visualId ? state.visuals[visualId] : undefined;
    const visualDuration = visual?.durationSeconds;
    const baseTarget = shouldApplyCorrection ? correction.targetSeconds! : targetSeconds;
    const runtime = visual as (VisualState & { runtimeOffsetSeconds?: number; runtimeLoop?: LoopState }) | undefined;
    const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
    const effectiveTarget = getMediaEffectiveTime(
      (baseTarget - runtimeOffsetSeconds) * (visual?.playbackRate ?? 1),
      visualDuration,
      runtime?.runtimeLoop ?? state.loop,
    );
    const syncStateBefore = getMediaSyncState(video);
    const syncKeyChanged = syncStateBefore.lastSyncKey !== syncKey;
    const driftBeforeSeconds = video.currentTime - effectiveTarget;
    if (debugDisplayRefresh && correction?.action !== 'none' && correction?.revision !== undefined && shouldApplyCorrection) {
      debugDisplay('media-correction-apply', {
        visualId,
        correctionAction: correction.action,
        correctionRevision: correction.revision,
        correctionTargetSeconds: rounded(correction.targetSeconds),
        correctionDriftSeconds: rounded(correction.driftSeconds),
        directorSeconds: rounded(targetSeconds),
        effectiveTargetSeconds: rounded(effectiveTarget),
        currentTime: rounded(video.currentTime),
        driftBeforeSeconds: rounded(driftBeforeSeconds),
      });
    }
    syncTimedMediaElement(
      video,
      effectiveTarget,
      !state.paused,
      shouldApplyCorrection ? `${syncKey}:correction:${correction.revision}` : syncKey,
      DISPLAY_DRIFT_SEEK_THRESHOLD_SECONDS,
      {
        syncKeySeekThresholdSeconds: SYNC_KEY_SEEK_THRESHOLD_SECONDS,
        onSeekStart: (seekTargetSeconds) => {
          mediaSeekCount += 1;
          debugDisplay('media-seek-start', {
            visualId,
            seekTargetSeconds: rounded(seekTargetSeconds),
            effectiveTargetSeconds: rounded(effectiveTarget),
            directorSeconds: rounded(targetSeconds),
            baseTargetSeconds: rounded(baseTarget),
            runtimeOffsetSeconds: rounded(runtimeOffsetSeconds),
            currentTime: rounded(video.currentTime),
            driftBeforeSeconds: rounded(driftBeforeSeconds),
            syncKeyChanged,
            shouldApplyCorrection,
            correctionAction: correction?.action,
            correctionRevision: correction?.revision,
            playbackRate: rounded(video.playbackRate),
            stateRate: rounded(state.rate),
            visualPlaybackRate: rounded(visual?.playbackRate),
            readyState: video.readyState,
            pendingSeekSeconds: rounded(syncStateBefore.pendingSeekSeconds),
            src: video.currentSrc || video.src || undefined,
          });
        },
        onSeekComplete: ({ durationMs, usedFallback }) => {
          lastMediaSeekDurationMs = durationMs;
          if (usedFallback) {
            mediaSeekFallbackCount += 1;
          }
          debugDisplay('media-seek-complete', {
            visualId,
            durationMs: rounded(durationMs, 1),
            usedFallback,
            currentTime: rounded(video.currentTime),
            mediaSeekCount,
            mediaSeekFallbackCount,
          });
        },
      },
    );
    if (correction?.revision !== undefined && shouldApplyCorrection) {
      appliedCorrectionRevisions.add(correction.revision);
    }
    video.playbackRate = state.rate * (visual?.playbackRate ?? 1);
    if (visual) {
      applyVisualStyle(video, visual);
    }
  }
}

function applyVisualStyle(element: HTMLElement, visual: VisualState): void {
  element.style.opacity = element.closest('.display-layer') ? '1' : String(visual.opacity ?? 1);
  element.style.filter = `brightness(${visual.brightness ?? 1}) contrast(${visual.contrast ?? 1})`;
}

function observeVideoFrames(video: HTMLVideoElement): void {
  const trackedVideo = video as FrameTrackedVideo;
  if (!trackedVideo.requestVideoFrameCallback) {
    return;
  }
  const stats: VideoFrameStats = {
    presentedFrames: 0,
    samplePresentedFrames: 0,
    sampleWallTimeMs: performance.now(),
    maxFrameGapMs: 0,
  };
  videoFrameStats.set(video, stats);
  const recordFrame = (now: number) => {
    if (!videoFrameStats.has(video)) {
      return;
    }
    if (stats.lastFrameWallTimeMs !== undefined) {
      stats.maxFrameGapMs = Math.max(stats.maxFrameGapMs, now - stats.lastFrameWallTimeMs);
    }
    stats.lastFrameWallTimeMs = now;
    stats.presentedFrames += 1;
    trackedVideo.requestVideoFrameCallback?.(recordFrame);
  };
  trackedVideo.requestVideoFrameCallback(recordFrame);
}

function summarizeVideoDiagnostics(videos: HTMLVideoElement[]): {
  presentedFrameRateFps?: number;
  droppedVideoFrames?: number;
  totalVideoFrames?: number;
  maxVideoFrameGapMs?: number;
} {
  let presentedFrameRateFps = 0;
  let presentedFrameSamples = 0;
  let maxVideoFrameGapMs: number | undefined;
  let droppedVideoFrames: number | undefined;
  let totalVideoFrames: number | undefined;
  const now = performance.now();
  for (const video of videos) {
    const stats = videoFrameStats.get(video);
    if (stats) {
      const elapsedMs = now - stats.sampleWallTimeMs;
      if (elapsedMs > 0) {
        stats.presentedFrameRateFps = ((stats.presentedFrames - stats.samplePresentedFrames) * 1000) / elapsedMs;
        stats.samplePresentedFrames = stats.presentedFrames;
        stats.sampleWallTimeMs = now;
      }
      if (stats.presentedFrameRateFps !== undefined) {
        presentedFrameRateFps += stats.presentedFrameRateFps;
        presentedFrameSamples += 1;
      }
      maxVideoFrameGapMs = Math.max(maxVideoFrameGapMs ?? 0, stats.maxFrameGapMs);
      stats.maxFrameGapMs = 0;
    }
    const quality = (video as FrameTrackedVideo).getVideoPlaybackQuality?.();
    if (quality) {
      droppedVideoFrames = (droppedVideoFrames ?? 0) + (quality.droppedVideoFrames ?? 0);
      totalVideoFrames = (totalVideoFrames ?? 0) + (quality.totalVideoFrames ?? 0);
    }
  }
  return {
    presentedFrameRateFps: presentedFrameSamples > 0 ? presentedFrameRateFps / presentedFrameSamples : undefined,
    droppedVideoFrames,
    totalVideoFrames,
    maxVideoFrameGapMs,
  };
}

window.xtream.director.onState(handleState);
window.xtream.stream.onState(handleStreamState);
void window.xtream.renderer.ready({ kind: 'display', displayId });
void window.xtream.director.getState().then(handleState);
void window.xtream.stream.getState().then(handleStreamState);

function sampleFrameRate(): void {
  frameCounter += 1;
  const now = performance.now();
  if (now - lastFrameSampleMs >= 1000) {
    lastFrameRateFps = (frameCounter * 1000) / (now - lastFrameSampleMs);
    frameCounter = 0;
    lastFrameSampleMs = now;
  }
  window.requestAnimationFrame(sampleFrameRate);
}

window.requestAnimationFrame(sampleFrameRate);

driftTimer = window.setInterval(() => {
  if (currentState?.paused) {
    return;
  }
  const videos = Array.from(videoElements.values()).filter((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA);
  const directorSeconds = currentState ? getDirectorSeconds(currentState) : currentDirectorSeconds;
  currentDirectorSeconds = directorSeconds;
  if (videos.some((video) => getMediaSyncState(video).pendingSeekSeconds !== undefined)) {
    return;
  }
  const driftSeconds =
    videos.length > 0 && currentState
      ? videos.reduce((max, video) => {
          const visualId = video.dataset.visualId;
          const state = currentState!;
          const visual = visualId ? state.visuals[visualId] : undefined;
          const runtime = visual as (VisualState & { runtimeOffsetSeconds?: number; runtimeLoop?: LoopState }) | undefined;
          const runtimeOffsetSeconds = runtime?.runtimeOffsetSeconds ?? 0;
          const targetSeconds = getMediaEffectiveTime(
            (directorSeconds - runtimeOffsetSeconds) * (visual?.playbackRate ?? 1),
            visual?.durationSeconds,
            runtime?.runtimeLoop ?? state.loop,
          );
          const drift = video.currentTime - targetSeconds;
          return Math.abs(drift) > Math.abs(max) ? drift : max;
        }, 0)
      : 0;
  const videoDiagnostics = summarizeVideoDiagnostics(videos);
  const displayCorrection = currentState?.corrections.displays[displayId];
  const driftDebugSignature = `${videos.length}:${rounded(driftSeconds)}:${rounded(videoDiagnostics.maxVideoFrameGapMs, 1)}:${mediaSeekCount}:${mediaSeekFallbackCount}:${
    displayCorrection?.revision ?? 'none'
  }`;
  if (
    debugDisplayRefresh &&
    driftDebugSignature !== lastDriftDebugSignature &&
    (Math.abs(driftSeconds) > 0.1 || mediaSeekCount > 0 || mediaSeekFallbackCount > 0)
  ) {
    debugDisplay('drift-report', {
      videos: videos.map((video) => ({
        visualId: video.dataset.visualId,
        currentTime: rounded(video.currentTime),
        readyState: video.readyState,
        pendingSeekSeconds: rounded(getMediaSyncState(video).pendingSeekSeconds),
        src: video.currentSrc || video.src || undefined,
      })),
      directorSeconds: rounded(directorSeconds),
      driftSeconds: rounded(driftSeconds),
      frameRateFps: rounded(lastFrameRateFps),
      presentedFrameRateFps: rounded(videoDiagnostics.presentedFrameRateFps),
      droppedVideoFrames: videoDiagnostics.droppedVideoFrames,
      totalVideoFrames: videoDiagnostics.totalVideoFrames,
      maxVideoFrameGapMs: rounded(videoDiagnostics.maxVideoFrameGapMs, 1),
      mediaSeekCount,
      mediaSeekFallbackCount,
      mediaSeekDurationMs: rounded(lastMediaSeekDurationMs, 1),
      correction: displayCorrection,
      ...summarizeStreamRuntime(),
    });
    lastDriftDebugSignature = driftDebugSignature;
  }
  void window.xtream.renderer.reportDrift({
    kind: 'display',
    displayId,
    observedSeconds: videos[0]?.currentTime ?? directorSeconds,
    directorSeconds,
    driftSeconds,
    frameRateFps: lastFrameRateFps,
    presentedFrameRateFps: videoDiagnostics.presentedFrameRateFps,
    droppedVideoFrames: videoDiagnostics.droppedVideoFrames,
    totalVideoFrames: videoDiagnostics.totalVideoFrames,
    maxVideoFrameGapMs: videoDiagnostics.maxVideoFrameGapMs,
    mediaSeekCount,
    mediaSeekFallbackCount,
    mediaSeekDurationMs: lastMediaSeekDurationMs,
    reportedAtWallTimeMs: Date.now(),
  });
}, 1000);

syncTimer = window.setInterval(() => {
  if (currentState) {
    const display = currentState.displays[displayId];
    if (display) {
      syncVideoElements(display, currentState);
    }
  }
}, DISPLAY_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  unsubscribeIdentifyFlash?.();
  if (identifyHideTimer !== undefined) {
    window.clearTimeout(identifyHideTimer);
  }
  for (const cleanup of liveVisualCleanups.values()) {
    cleanup();
  }
  liveVisualCleanups.clear();
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
  if (syncTimer !== undefined) {
    window.clearInterval(syncTimer);
  }
});
