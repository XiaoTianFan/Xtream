import { formatTimecode } from '../../../shared/timeline';
import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig } from '../../../shared/types';
import type { StreamEnginePublicState } from '../../../shared/types';
import { createButton, syncSliderProgress } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { StreamSurfaceOptions } from './streamTypes';

export type StreamHeaderRenderContext = {
  headerEl: HTMLElement;
  stream: PersistedStreamConfig;
  runtime: StreamEnginePublicState['runtime'];
  currentState: DirectorState | undefined;
  selectedSceneId: string | undefined;
  headerEditField: 'title' | 'note' | undefined;
  options: StreamSurfaceOptions;
  setHeaderEditField: (field: 'title' | 'note' | undefined) => void;
  updateSelectedScene: (update: Partial<PersistedSceneConfig>) => void;
  requestRender: () => void;
};

let rateDragStart: { clientX: number; rate: number } | undefined;
let timelineScrubPointerActive = false;
let timelineScrubDraftUntil = 0;

function isTimelineScrubDraftActive(): boolean {
  return timelineScrubPointerActive || performance.now() < timelineScrubDraftUntil;
}

function getStreamCurrentMs(runtime: StreamEnginePublicState['runtime'], state: DirectorState | undefined): number {
  if (!runtime) {
    return 0;
  }
  if (runtime.status === 'running' && runtime.originWallTimeMs !== undefined) {
    const rate = state?.rate && state.rate > 0 ? state.rate : 1;
    return (runtime.offsetStreamMs ?? 0) + (Date.now() - runtime.originWallTimeMs) * rate;
  }
  return runtime.currentStreamMs ?? runtime.pausedAtStreamMs ?? runtime.offsetStreamMs ?? 0;
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
  const durationMs = runtime?.expectedDurationMs;
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
    }
    syncSliderProgress(slider);
    slider.title = `Stream ${formatTimecode(Number(slider.value) || 0)} / ${formatTimecode(durationMs / 1000)}`;
  }
  slider.addEventListener('pointerdown', () => {
    timelineScrubPointerActive = true;
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
    syncSliderProgress(slider);
    slider.title =
      durationMs === undefined ? 'Stream timeline unavailable' : `Stream ${formatTimecode(Number(slider.value) || 0)} / ${formatTimecode(durationMs / 1000)}`;
  });
  slider.addEventListener('change', () => {
    timelineScrubDraftUntil = performance.now() + 1000;
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
  currentState: DirectorState | undefined,
): void {
  const currentMs = getStreamCurrentMs(runtime, currentState);
  const timecode = headerEl.querySelector<HTMLElement>('[data-stream-timecode="true"]');
  if (timecode) {
    timecode.textContent = formatTimecode(currentMs / 1000);
  }
  const slider = headerEl.querySelector<HTMLInputElement>('[data-stream-timeline-slider="true"]');
  const durationMs = runtime?.expectedDurationMs;
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
  const { stream, runtime, selectedSceneId, currentState, headerEl, options } = ctx;
  const selectedScene = selectedSceneId ? stream.scenes[selectedSceneId] : undefined;
  const currentMs = getStreamCurrentMs(runtime, currentState);

  const timecode = document.createElement('div');
  timecode.className = 'timecode stream-timecode';
  timecode.dataset.streamTimecode = 'true';
  timecode.textContent = formatTimecode(currentMs / 1000);

  const transport = document.createElement('div');
  transport.className = 'stream-transport transport-cluster';
  const back = createButton('Back to first', 'secondary', () => void window.xtream.stream.transport({ type: 'back-to-first' }));
  decorateIconButton(back, 'SkipBack', 'Back to first scene');
  const go = createButton('Go', '', () => void window.xtream.stream.transport({ type: 'go', sceneId: selectedSceneId }));
  decorateIconButton(go, 'Play', 'Go from selected scene');
  go.disabled = !selectedSceneId || !currentState?.paused;
  const pause = createButton('Pause', 'secondary', () =>
    void window.xtream.stream.transport({ type: runtime?.status === 'paused' ? 'resume' : 'pause' }),
  );
  decorateIconButton(pause, runtime?.status === 'paused' ? 'Play' : 'Pause', runtime?.status === 'paused' ? 'Resume stream' : 'Pause stream');
  pause.disabled = runtime?.status !== 'running' && runtime?.status !== 'paused';
  const next = createButton('Next', 'secondary', () => void window.xtream.stream.transport({ type: 'jump-next' }));
  decorateIconButton(next, 'SkipForward', 'Jump to next scene');
  next.disabled = runtime?.status !== 'running' && runtime?.status !== 'paused';
  transport.append(back, go, pause, next, createRateButton(ctx));

  const titleStack = document.createElement('div');
  titleStack.className = 'stream-scene-title-stack';
  titleStack.append(
    createHeaderEditableText(ctx, {
      field: 'title',
      value: selectedScene?.title ?? '',
      fallback: selectedSceneId ?? 'No scene',
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
  actions.append(save, saveAs, open, create);

  const headerCenter = document.createElement('div');
  headerCenter.className = 'stream-header-center';
  headerCenter.append(transport, titleStack);
  const headerMain = document.createElement('div');
  headerMain.className = 'stream-header-main';
  headerMain.append(timecode, headerCenter, actions);
  headerEl.replaceChildren(headerMain, createStreamTimeline(ctx));
}
