import { formatTimecode } from '../../../shared/timeline';
import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig } from '../../../shared/types';
import type { StreamEnginePublicState } from '../../../shared/types';
import { createButton } from '../shared/dom';
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
  const currentMs = runtime?.originWallTimeMs && runtime.status === 'running' ? Date.now() - runtime.originWallTimeMs : 0;

  const timecode = document.createElement('div');
  timecode.className = 'timecode stream-timecode';
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
  transport.append(back, go, pause, next);

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
  headerEl.replaceChildren(timecode, headerCenter, actions);
}
