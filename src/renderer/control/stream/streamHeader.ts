import { formatTimecode } from '../../../shared/timeline';
import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, StreamCommand } from '../../../shared/types';
import type { StreamEnginePublicState } from '../../../shared/types';
import { createButton, syncSliderProgress } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { StreamSurfaceOptions } from './streamTypes';

export type StreamHeaderRenderContext = {
  headerEl: HTMLElement;
  stream: PersistedStreamConfig;
  playbackStream: PersistedStreamConfig;
  runtime: StreamEnginePublicState['runtime'];
  playbackTimeline: StreamEnginePublicState['playbackTimeline'];
  validationMessages: string[];
  currentState: DirectorState | undefined;
  /** Scene shown in Scene Edit / header title & note. */
  sceneEditSceneId: string | undefined;
  /** Transport and workspace playback highlight reference. */
  playbackFocusSceneId: string | undefined;
  headerEditField: 'title' | 'note' | undefined;
  options: StreamSurfaceOptions;
  setHeaderEditField: (field: 'title' | 'note' | undefined) => void;
  updateSelectedScene: (update: Partial<PersistedSceneConfig>) => void;
  setPlaybackFocusSceneId: (id: string | undefined) => void;
  /** Header, workspace list chrome, meters — avoids full surface render / list rebuild. */
  refreshChrome: (streamPublic?: StreamEnginePublicState) => void;
  requestRender: () => void;
};

let rateDragStart: { clientX: number; rate: number } | undefined;
let timelineScrubPointerActive = false;
let timelineScrubDraftUntil = 0;
let timelineScrubDraftValueSeconds: number | undefined;

export function deriveStreamTransportUiState(args: {
  runtime: StreamEnginePublicState['runtime'];
  playbackTimeline: StreamEnginePublicState['playbackTimeline'];
  playbackFocusSceneId: string | undefined;
  playbackStream: PersistedStreamConfig;
  isPatchTransportPlaying?: boolean;
}): {
  backDisabled: boolean;
  playDisabled: boolean;
  playDisabledReason?: string;
  pauseDisabled: boolean;
  nextDisabled: boolean;
} {
  const status = args.runtime?.status;
  const running = status === 'running' || status === 'preloading';
  const paused = status === 'paused';
  const hasRuntimeReference = Boolean(args.runtime?.cursorSceneId);
  const hasEnabledScene = args.playbackStream.sceneOrder.some((id) => !args.playbackStream.scenes[id]?.disabled);
  let playDisabledReason: string | undefined;
  if (args.playbackTimeline.status !== 'valid') {
    playDisabledReason = args.playbackTimeline.notice ?? 'Stream timeline has calculation errors.';
  } else if (!hasEnabledScene) {
    playDisabledReason = 'No enabled Stream scenes are available to play.';
  } else if (args.isPatchTransportPlaying === true) {
    playDisabledReason = 'Patch playback is active.';
  }
  return {
    backDisabled: running,
    playDisabled: playDisabledReason !== undefined,
    playDisabledReason,
    pauseDisabled: status !== 'running',
    nextDisabled: !args.playbackFocusSceneId && !running && !paused && !hasRuntimeReference,
  };
}

export function createGlobalStreamPlayCommand(args: {
  runtime: StreamEnginePublicState['runtime'];
  playbackStream: PersistedStreamConfig;
  playbackTimeline: StreamEnginePublicState['playbackTimeline'];
  playbackFocusSceneId: string | undefined;
}): StreamCommand {
  const { runtime, playbackStream, playbackTimeline, playbackFocusSceneId } = args;
  const playableFocusSceneId = playableSceneId(playbackStream, playbackTimeline, playbackFocusSceneId);
  if (runtime?.status === 'paused') {
    const behavior = playbackStream.playbackSettings?.pausedPlayBehavior ?? 'selection-aware';
    const selectedAtPause = runtime.selectedSceneIdAtPause ?? runtime.cursorSceneId;
    if (behavior === 'selection-aware' && playableFocusSceneId && playableFocusSceneId !== selectedAtPause) {
      return { type: 'play', sceneId: playableFocusSceneId, source: 'global' };
    }
    return { type: 'play', source: 'global' };
  }
  return playableFocusSceneId ? { type: 'play', sceneId: playableFocusSceneId, source: 'global' } : { type: 'play', source: 'global' };
}

export function deriveStreamWorkspaceLiveStateLabel(args: {
  runtime: StreamEnginePublicState['runtime'];
  playbackTimeline: StreamEnginePublicState['playbackTimeline'];
}): 'LIVE' | 'STANDBY' | 'BLOCKED' | 'DEGRADED' {
  const { runtime, playbackTimeline } = args;
  if (playbackTimeline.status === 'invalid' || runtime?.status === 'failed') {
    return 'BLOCKED';
  }
  if (playbackTimeline.issues.some((issue) => issue.severity === 'error')) {
    return 'BLOCKED';
  }
  if (playbackTimeline.issues.some((issue) => issue.severity === 'warning')) {
    return 'DEGRADED';
  }
  const status = runtime?.status;
  if (status === 'running' || status === 'preloading') {
    return 'LIVE';
  }
  return 'STANDBY';
}

function playableSceneId(
  playbackStream: PersistedStreamConfig,
  playbackTimeline: StreamEnginePublicState['playbackTimeline'],
  sceneId: string | undefined,
): string | undefined {
  if (!sceneId || playbackTimeline.status !== 'valid') {
    return undefined;
  }
  const scene = playbackStream.scenes[sceneId];
  const entry = playbackTimeline.entries[sceneId];
  return scene && !scene.disabled && entry?.startMs !== undefined ? sceneId : undefined;
}

function isTimelineScrubDraftActive(): boolean {
  return timelineScrubPointerActive || performance.now() < timelineScrubDraftUntil;
}

function getStreamCurrentMs(runtime: StreamEnginePublicState['runtime'], state: DirectorState | undefined): number {
  if (!runtime) {
    return 0;
  }
  const states = Object.values(runtime.sceneStates ?? {});
  const originWall = runtime.originWallTimeMs;
  const wallClockRunning =
    (runtime.status === 'running' || runtime.status === 'preloading') &&
    originWall !== undefined &&
    (states.length === 0 || states.some((s) => s.status === 'running' || s.status === 'preloading'));
  if (wallClockRunning) {
    const rate = state?.rate && state.rate > 0 ? state.rate : 1;
    return (runtime.offsetStreamMs ?? 0) + (Date.now() - originWall) * rate;
  }
  return runtime.currentStreamMs ?? runtime.pausedAtStreamMs ?? runtime.offsetStreamMs ?? 0;
}

function formatStreamDuration(playbackTimeline: StreamEnginePublicState['playbackTimeline']): string {
  if (playbackTimeline.status !== 'valid') {
    return '/ timeline error';
  }
  return playbackTimeline.expectedDurationMs !== undefined
    ? `/ ${formatTimecode(playbackTimeline.expectedDurationMs / 1000)}`
    : '/ --:--:--';
}

function createRateButton(ctx: StreamHeaderRenderContext): HTMLButtonElement {
  const state = ctx.currentState;
  const button = createButton(state ? `${state.rate.toFixed(2)}x` : '1.00x', 'secondary stream-rate-button', () => undefined);
  button.title = 'Drag to adjust global rate, double-click to type a value';
  button.disabled = !state;
  button.addEventListener('dblclick', () => {
    const latestRate = ctx.currentState?.rate ?? 1;
    const input = document.createElement('input');
    input.className = 'rate-input-inline';
    input.type = 'number';
    input.min = '0.1';
    input.step = '0.01';
    input.value = String(latestRate);
    button.replaceChildren(input);
    input.focus();
    input.select();
    const finish = (commit: boolean) => {
      if (commit) {
        const rate = Number(input.value);
        if (Number.isFinite(rate) && rate > 0) {
          void window.xtream.director.transport({ type: 'set-rate', rate });
        }
      }
      button.textContent = `${(ctx.currentState?.rate ?? latestRate).toFixed(2)}x`;
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        finish(true);
      }
      if (event.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  });
  button.addEventListener('pointerdown', (event) => {
    if (!ctx.currentState || event.button !== 0) {
      return;
    }
    rateDragStart = { clientX: event.clientX, rate: ctx.currentState.rate };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!rateDragStart) {
      return;
    }
    const delta = event.clientX - rateDragStart.clientX;
    const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
    button.textContent = `${nextRate.toFixed(2)}x`;
  });
  button.addEventListener('pointerup', (event) => {
    if (!rateDragStart) {
      return;
    }
    const delta = event.clientX - rateDragStart.clientX;
    const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
    rateDragStart = undefined;
    if (Math.abs(delta) > 2) {
      void window.xtream.director.transport({ type: 'set-rate', rate: Number(nextRate.toFixed(2)) });
    }
  });
  button.addEventListener('pointercancel', () => {
    rateDragStart = undefined;
  });
  return button;
}

function createStreamTimeline(ctx: StreamHeaderRenderContext): HTMLElement {
  const { runtime, currentState } = ctx;
  const wrapper = document.createElement('div');
  wrapper.className = 'stream-timeline-row';
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'timeline-control';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'mini-slider timeline-slider stream-timeline-slider';
  slider.dataset.streamTimelineSlider = 'true';
  slider.min = '0';
  slider.step = '0.01';
  slider.setAttribute('aria-label', 'Stream timeline scrubber');
  const durationMs = ctx.playbackTimeline.expectedDurationMs ?? runtime?.expectedDurationMs;
  const currentMs = getStreamCurrentMs(runtime, currentState);
  if (durationMs === undefined || durationMs <= 0) {
    slider.disabled = true;
    slider.max = '0';
    slider.value = '0';
    slider.style.setProperty('--progress', '0%');
    slider.title = runtime?.timelineNotice ?? 'Stream timeline unavailable';
  } else {
    slider.max = String(durationMs / 1000);
    if (!isTimelineScrubDraftActive()) {
      slider.value = String(Math.min(durationMs, Math.max(0, currentMs)) / 1000);
      timelineScrubDraftValueSeconds = undefined;
    } else if (timelineScrubDraftValueSeconds !== undefined) {
      slider.value = String(Math.min(durationMs / 1000, Math.max(0, timelineScrubDraftValueSeconds)));
    }
    syncSliderProgress(slider);
    slider.title = `Stream ${formatTimecode(Number(slider.value) || 0)} / ${formatTimecode(durationMs / 1000)}`;
  }
  slider.addEventListener('pointerdown', () => {
    timelineScrubPointerActive = true;
    timelineScrubDraftValueSeconds = Number(slider.value) || 0;
  });
  slider.addEventListener('pointerup', () => {
    timelineScrubPointerActive = false;
    timelineScrubDraftUntil = performance.now() + 300;
  });
  slider.addEventListener('pointercancel', () => {
    timelineScrubPointerActive = false;
  });
  slider.addEventListener('input', () => {
    timelineScrubDraftUntil = performance.now() + 300;
    timelineScrubDraftValueSeconds = Number(slider.value) || 0;
    syncSliderProgress(slider);
    slider.title =
      durationMs === undefined ? 'Stream timeline unavailable' : `Stream ${formatTimecode(Number(slider.value) || 0)} / ${formatTimecode(durationMs / 1000)}`;
  });
  slider.addEventListener('change', () => {
    timelineScrubDraftUntil = performance.now() + 1000;
    timelineScrubDraftValueSeconds = Number(slider.value) || 0;
    void window.xtream.stream.transport({ type: 'seek', timeMs: (Number(slider.value) || 0) * 1000 }).finally(() => {
      timelineScrubPointerActive = false;
    });
  });
  sliderWrap.append(slider);
  wrapper.append(sliderWrap);
  return wrapper;
}

export function syncStreamHeaderRuntime(
  headerEl: HTMLElement,
  runtime: StreamEnginePublicState['runtime'],
  playbackTimeline: StreamEnginePublicState['playbackTimeline'],
  currentState: DirectorState | undefined,
): void {
  const currentMs = getStreamCurrentMs(runtime, currentState);
  const timecode = headerEl.querySelector<HTMLElement>('[data-stream-timecode="true"]');
  if (timecode) {
    timecode.textContent = formatTimecode(currentMs / 1000);
  }
  const duration = headerEl.querySelector<HTMLElement>('[data-stream-duration="true"]');
  if (duration) {
    duration.textContent = formatStreamDuration(playbackTimeline);
  }
  const liveChip = headerEl.querySelector<HTMLElement>('[data-stream-live-state="true"]');
  if (liveChip) {
    const label = deriveStreamWorkspaceLiveStateLabel({ runtime, playbackTimeline });
    liveChip.textContent = label;
    liveChip.dataset.state = label.toLowerCase();
  }
  const slider = headerEl.querySelector<HTMLInputElement>('[data-stream-timeline-slider="true"]');
  const durationMs = playbackTimeline.expectedDurationMs ?? runtime?.expectedDurationMs;
  if (!slider) {
    return;
  }
  if (durationMs === undefined || durationMs <= 0) {
    slider.disabled = true;
    slider.max = '0';
    slider.value = '0';
    slider.style.setProperty('--progress', '0%');
    slider.title = runtime?.timelineNotice ?? 'Stream timeline unavailable';
    return;
  }
  slider.disabled = false;
  slider.max = String(durationMs / 1000);
  if (!isTimelineScrubDraftActive()) {
    slider.value = String(Math.min(durationMs, Math.max(0, currentMs)) / 1000);
    timelineScrubDraftValueSeconds = undefined;
  } else if (timelineScrubDraftValueSeconds !== undefined) {
    slider.value = String(Math.min(durationMs / 1000, Math.max(0, timelineScrubDraftValueSeconds)));
  }
  syncSliderProgress(slider);
  slider.title = `Stream ${formatTimecode(Number(slider.value) || 0)} / ${formatTimecode(durationMs / 1000)}`;
}

function createHeaderEditableText(
  ctx: StreamHeaderRenderContext,
  args: {
    field: 'title' | 'note';
    value: string;
    fallback: string;
    className: string;
    ariaLabel: string;
    disabled: boolean;
    onCommit: (value: string) => void;
  },
): HTMLElement {
  const { field, value, fallback, className, ariaLabel, disabled, onCommit } = args;
  if (ctx.headerEditField === field && !disabled) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = `stream-header-inline-input ${className}`;
    input.value = value;
    input.placeholder = fallback;
    input.setAttribute('aria-label', ariaLabel);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    let finishing = false;
    const finish = (commit: boolean) => {
      if (finishing) {
        return;
      }
      finishing = true;
      const next = input.value.trim();
      ctx.setHeaderEditField(undefined);
      if (commit && next !== value.trim()) {
        onCommit(next);
      }
      ctx.requestRender();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    return input;
  }

  const label = document.createElement('div');
  label.className = `${className} stream-header-editable${disabled ? ' disabled' : ''}${value ? '' : ' empty'}`;
  label.textContent = value || fallback;
  label.setAttribute('aria-label', ariaLabel);
  if (!disabled) {
    label.tabIndex = 0;
    label.title = `Double-click to edit ${field}`;
    label.addEventListener('dblclick', () => {
      ctx.setHeaderEditField(field);
      ctx.requestRender();
    });
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        ctx.setHeaderEditField(field);
        ctx.requestRender();
      }
    });
  }
  return label;
}

export function renderStreamHeader(ctx: StreamHeaderRenderContext): void {
  const { stream, playbackStream, runtime, sceneEditSceneId, playbackFocusSceneId, currentState, headerEl, options } = ctx;
  const selectedScene = sceneEditSceneId ? stream.scenes[sceneEditSceneId] : undefined;
  const playbackFocusPlayable = playableSceneId(playbackStream, ctx.playbackTimeline, playbackFocusSceneId) !== undefined;
  const currentMs = getStreamCurrentMs(runtime, currentState);
  const timelineIssue = ctx.validationMessages.find((message) => message.includes('Stream timeline')) ?? ctx.playbackTimeline.notice;
  const transportState = deriveStreamTransportUiState({
    runtime,
    playbackTimeline: ctx.playbackTimeline,
    playbackFocusSceneId,
    playbackStream,
    isPatchTransportPlaying: currentState?.paused === false,
  });

  const timecode = document.createElement('div');
  timecode.className = 'stream-timecode-wrap';
  const currentTimecode = document.createElement('span');
  currentTimecode.className = 'timecode stream-timecode';
  currentTimecode.dataset.streamTimecode = 'true';
  currentTimecode.textContent = formatTimecode(currentMs / 1000);
  const duration = document.createElement('span');
  duration.className = 'stream-duration-total';
  duration.dataset.streamDuration = 'true';
  duration.textContent = formatStreamDuration(ctx.playbackTimeline);
  timecode.append(currentTimecode, duration);

  const transport = document.createElement('div');
  transport.className = 'stream-transport transport-cluster';
  const syncReferenceFromTransport = (state: StreamEnginePublicState): void => {
    const cursorSceneId = state.runtime?.cursorSceneId;
    if (cursorSceneId && state.stream.scenes[cursorSceneId]) {
      ctx.setPlaybackFocusSceneId(cursorSceneId);
      ctx.refreshChrome(state);
    }
  };
  const back = createButton('Back to first', 'secondary', () => {
    void window.xtream.stream.transport({ type: 'back-to-first' }).then(syncReferenceFromTransport);
  });
  decorateIconButton(back, 'SkipBack', 'Back to first scene');
  back.disabled = transportState.backDisabled;
  const play = createButton(
    'Play',
    '',
    () =>
      void window.xtream.stream.transport(
        createGlobalStreamPlayCommand({
          runtime,
          playbackStream,
          playbackTimeline: ctx.playbackTimeline,
          playbackFocusSceneId,
        }),
      ),
  );
  const playDisabledDetail =
    transportState.playDisabledReason && ctx.playbackTimeline.status === 'invalid' && timelineIssue ? timelineIssue : transportState.playDisabledReason;
  const playTooltip =
    playDisabledDetail ??
    (runtime?.status === 'paused'
      ? 'Resume stream'
      : playbackFocusPlayable
        ? 'Play from playback focus'
        : 'Play from cursor');
  decorateIconButton(play, 'Play', playTooltip);
  play.disabled = transportState.playDisabled;
  const pause = createButton('Pause', 'secondary', () => void window.xtream.stream.transport({ type: 'pause' }));
  decorateIconButton(pause, 'Pause', 'Pause stream');
  pause.disabled = transportState.pauseDisabled;
  const next = createButton('Next', 'secondary', () => {
    void window.xtream.stream.transport({ type: 'jump-next', referenceSceneId: playbackFocusSceneId }).then(syncReferenceFromTransport);
  });
  decorateIconButton(next, 'SkipForward', 'Jump to next scene');
  next.disabled = transportState.nextDisabled;
  transport.append(back, play, pause, next, createRateButton(ctx));

  const titleStack = document.createElement('div');
  titleStack.className = 'stream-scene-title-stack';
  titleStack.append(
    createHeaderEditableText(ctx, {
      field: 'title',
      value: selectedScene?.title ?? '',
      fallback: sceneEditSceneId ?? 'No scene',
      className: 'stream-title-label',
      ariaLabel: 'Scene title',
      disabled: !selectedScene,
      onCommit: (value) => ctx.updateSelectedScene({ title: value || undefined }),
    }),
    createHeaderEditableText(ctx, {
      field: 'note',
      value: selectedScene?.note ?? '',
      fallback: 'Scene note',
      className: 'stream-note-label',
      ariaLabel: 'Scene note',
      disabled: !selectedScene,
      onCommit: (value) => ctx.updateSelectedScene({ note: value || undefined }),
    }),
  );

  const actions = document.createElement('div');
  actions.className = 'stream-show-actions utility-cluster';
  const save = createButton('Save', '', () => void options.showActions.saveShow());
  decorateIconButton(save, 'Save', 'Save show');
  const saveAs = createButton('Save As', '', () => void options.showActions.saveShowAs());
  decorateIconButton(saveAs, 'FileJson', 'Save show as');
  const open = createButton('Open', '', () => void options.showActions.openShow());
  decorateIconButton(open, 'FolderOpen', 'Open show');
  const create = createButton('New', '', () => void options.showActions.createShow());
  decorateIconButton(create, 'Plus', 'Create new show');
  const liveStateChip = document.createElement('span');
  liveStateChip.className = 'status-chip';
  liveStateChip.setAttribute('aria-live', 'polite');
  liveStateChip.dataset.streamLiveState = 'true';
  const streamLiveLabel = deriveStreamWorkspaceLiveStateLabel({ runtime, playbackTimeline: ctx.playbackTimeline });
  liveStateChip.textContent = streamLiveLabel;
  liveStateChip.dataset.state = streamLiveLabel.toLowerCase();
  actions.append(save, saveAs, open, create, liveStateChip);

  const headerCenter = document.createElement('div');
  headerCenter.className = 'stream-header-center';
  const transportStack = document.createElement('div');
  transportStack.className = 'stream-transport-stack';
  transportStack.append(transport);
  headerCenter.append(transportStack, titleStack);
  const headerMain = document.createElement('div');
  headerMain.className = 'stream-header-main';
  headerMain.append(timecode, headerCenter, actions);
  headerEl.replaceChildren(headerMain, createStreamTimeline(ctx));
}
