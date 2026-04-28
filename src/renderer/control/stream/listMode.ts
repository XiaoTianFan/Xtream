import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId } from '../../../shared/types';
import type { StreamEnginePublicState } from '../../../shared/types';
import type { BottomTab } from './streamTypes';
import { createButton, createHint } from '../shared/dom';
import { createIcon, decorateIconButton } from '../shared/icons';
import {
  formatSceneDuration,
  formatSceneStateLabel,
  formatSubCueLabel,
  formatTriggerSummary,
} from './formatting';
import { createStreamCell } from './streamDom';

let activeSceneRowMenu: HTMLElement | undefined;

function dismissSceneRowContextMenu(): void {
  activeSceneRowMenu?.remove();
  activeSceneRowMenu = undefined;
}

function positionSceneRowContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - menuBounds.width - 4)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - menuBounds.height - 4)}px`;
}

let sceneRowMenuDismissListenersAttached = false;

function ensureSceneRowMenuDismissListeners(): void {
  if (sceneRowMenuDismissListenersAttached) {
    return;
  }
  sceneRowMenuDismissListenersAttached = true;
  document.addEventListener('click', dismissSceneRowContextMenu);
  window.addEventListener('blur', dismissSceneRowContextMenu);
}

function showSceneRowContextMenu(
  event: MouseEvent,
  stream: PersistedStreamConfig,
  scene: PersistedSceneConfig,
  ctx: StreamListModeContext,
): void {
  event.preventDefault();
  event.stopPropagation();
  dismissSceneRowContextMenu();
  ensureSceneRowMenuDismissListeners();

  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (e) => e.stopPropagation());

  const duplicateBtn = createButton('Duplicate', 'secondary context-menu-item', () => {
    dismissSceneRowContextMenu();
    void window.xtream.stream.edit({ type: 'duplicate-scene', sceneId: scene.id }).then((s) => {
      const idx = s.stream.sceneOrder.indexOf(scene.id);
      const newId = idx >= 0 ? s.stream.sceneOrder[idx + 1] : scene.id;
      ctx.setSelectedSceneId(newId);
      ctx.requestRender();
    });
  });
  duplicateBtn.setAttribute('role', 'menuitem');

  const toggleDisabledBtn = createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary context-menu-item', () => {
    dismissSceneRowContextMenu();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: !scene.disabled } }).then(() => {
      ctx.requestRender();
    });
  });
  toggleDisabledBtn.setAttribute('role', 'menuitem');

  const removeDisabled = stream.sceneOrder.length <= 1;
  const removeBtn = createButton('Remove', 'secondary context-menu-item', () => {
    if (removeDisabled) {
      return;
    }
    dismissSceneRowContextMenu();
    void window.xtream.stream.edit({ type: 'remove-scene', sceneId: scene.id }).then((s) => {
      ctx.setSelectedSceneId(s.stream.sceneOrder[0]);
      ctx.expandedListSceneIds.delete(scene.id);
      ctx.requestRender();
    });
  });
  removeBtn.setAttribute('role', 'menuitem');
  removeBtn.disabled = removeDisabled;
  if (removeDisabled) {
    removeBtn.title = 'Cannot remove the last scene in the stream.';
  }

  menu.append(duplicateBtn, toggleDisabledBtn, removeBtn);
  document.body.append(menu);
  positionSceneRowContextMenu(menu, event.clientX, event.clientY);
  activeSceneRowMenu = menu;
}

export type StreamListModeContext = {
  streamState: StreamEnginePublicState | undefined;
  selectedSceneId: SceneId | undefined;
  listDragSceneId: SceneId | undefined;
  expandedListSceneIds: Set<SceneId>;
  currentState: DirectorState | undefined;
  setSelectedSceneId: (id: SceneId | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  setListDragSceneId: (id: SceneId | undefined) => void;
  toggleExpandedScene: (id: SceneId) => void;
  applySceneReorder: (draggedId: SceneId, insertBeforeId: SceneId | undefined) => void;
  requestRender: () => void;
};

export function scenesExplicitlyFollowing(stream: PersistedStreamConfig | undefined, predecessorId: SceneId): SceneId[] {
  if (!stream) {
    return [];
  }
  const out: SceneId[] = [];
  for (const sid of stream.sceneOrder) {
    const sc = stream.scenes[sid];
    if (!sc) {
      continue;
    }
    const tr = sc.trigger;
    if (tr.type !== 'simultaneous-start' && tr.type !== 'follow-end' && tr.type !== 'time-offset') {
      continue;
    }
    if (tr.followsSceneId === predecessorId) {
      out.push(sid);
    }
  }
  return out;
}

export function createStreamListMode(stream: PersistedStreamConfig, ctx: StreamListModeContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stream-scene-list-root';
  const list = document.createElement('div');
  list.className = 'stream-scene-list';
  const header = document.createElement('div');
  header.className = 'stream-scene-row stream-scene-row--header';
  header.append(
    createStreamCell('', 'stream-list-col-expand'),
    createStreamCell('', 'stream-list-col-drag'),
    createStreamCell('#', 'stream-list-col-num'),
    createStreamCell('Title', 'stream-list-col-title'),
    createStreamCell('Trigger', 'stream-list-col-trigger'),
    createStreamCell('Duration', 'stream-list-col-duration'),
    createStreamCell('State', 'stream-list-col-state'),
    createStreamCell('', 'stream-list-col-actions'),
  );
  list.append(header);
  const scenes = stream.sceneOrder.map((id) => stream.scenes[id]).filter(Boolean) as PersistedSceneConfig[];
  scenes.forEach((scene, index) => list.append(createSceneRowWrap(stream, scene, index + 1, ctx)));

  const endDropTarget = document.createElement('div');
  endDropTarget.className = 'stream-scene-list-end-target';
  endDropTarget.setAttribute('aria-hidden', 'true');
  endDropTarget.addEventListener('dragover', (e) => {
    e.preventDefault();
    endDropTarget.classList.add('drop-hover');
  });
  endDropTarget.addEventListener('dragleave', () => endDropTarget.classList.remove('drop-hover'));
  endDropTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    endDropTarget.classList.remove('drop-hover');
    const dragged = e.dataTransfer?.getData('text/plain') as SceneId | undefined;
    if (dragged) {
      ctx.applySceneReorder(dragged, undefined);
    }
  });

  root.append(list, endDropTarget, createSceneListPhantomRow(stream, ctx));
  return root;
}

function createSceneListPhantomRow(stream: PersistedStreamConfig, ctx: StreamListModeContext): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stream-scene-list-phantom-create';
  btn.textContent = '+ Create New Scene';
  btn.addEventListener('click', () => {
    const lastId = stream.sceneOrder.length > 0 ? stream.sceneOrder[stream.sceneOrder.length - 1] : undefined;
    void window.xtream.stream.edit({ type: 'create-scene', afterSceneId: lastId }).then((s) => {
      const order = s.stream.sceneOrder;
      let newId: SceneId | undefined;
      if (lastId !== undefined) {
        const idx = order.indexOf(lastId);
        newId = idx >= 0 ? order[idx + 1] : order[order.length - 1];
      } else {
        newId = order[order.length - 1];
      }
      if (newId) {
        ctx.setSelectedSceneId(newId);
      }
      ctx.setBottomTab('scene');
      ctx.clearDetailPane();
      ctx.requestRender();
    });
  });
  return btn;
}

function createSceneRowWrap(
  stream: PersistedStreamConfig,
  scene: PersistedSceneConfig,
  number: number,
  ctx: StreamListModeContext,
): HTMLElement {
  const runtimeState = ctx.streamState?.runtime?.sceneStates[scene.id];
  const runtimeRowStatus = runtimeState?.status ?? 'ready';
  const statusClass = scene.disabled ? 'disabled' : runtimeRowStatus;
  const wrap = document.createElement('div');
  wrap.className = `stream-scene-row-wrap status-${statusClass}${scene.id === ctx.selectedSceneId ? ' focused' : ''}`;
  wrap.dataset.sceneId = scene.id;

  const row = document.createElement('div');
  row.className = `stream-scene-row ${scene.id === ctx.selectedSceneId ? 'selected' : ''} ${statusClass}${ctx.listDragSceneId === scene.id ? ' dragging' : ''}`;
  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button, [draggable="true"]')) {
      return;
    }
    ctx.setSelectedSceneId(scene.id);
    ctx.setBottomTab('scene');
    ctx.clearDetailPane();
    ctx.requestRender();
  });

  const expanded = ctx.expandedListSceneIds.has(scene.id);
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'stream-scene-expand';
  expandBtn.setAttribute('aria-expanded', String(expanded));
  expandBtn.setAttribute('aria-label', expanded ? 'Collapse sub-cues' : 'Expand sub-cues');
  decorateIconButton(expandBtn, expanded ? 'ChevronDown' : 'ChevronRight', expanded ? 'Collapse' : 'Expand');
  expandBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.toggleExpandedScene(scene.id);
    ctx.requestRender();
  });

  const dragHandle = document.createElement('div');
  dragHandle.className = 'stream-scene-drag-handle';
  dragHandle.draggable = true;
  dragHandle.title = 'Drag to reorder';
  dragHandle.append(createIcon('GripVertical', 'Reorder'));
  dragHandle.addEventListener('dragstart', (event) => {
    ctx.setListDragSceneId(scene.id);
    event.dataTransfer?.setData('text/plain', scene.id);
    event.dataTransfer!.effectAllowed = 'move';
    wrap.classList.add('drag-source');
  });
  dragHandle.addEventListener('dragend', () => {
    ctx.setListDragSceneId(undefined);
    wrap.classList.remove('drag-source');
    document.querySelectorAll('.stream-scene-row-wrap.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
  });

  row.addEventListener('dragover', (event) => {
    if (!ctx.listDragSceneId || ctx.listDragSceneId === scene.id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    wrap.classList.add('drop-hover');
  });
  row.addEventListener('dragleave', () => wrap.classList.remove('drop-hover'));
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    wrap.classList.remove('drop-hover');
    const dragged = event.dataTransfer?.getData('text/plain') as SceneId | undefined;
    if (dragged && dragged !== scene.id) {
      ctx.applySceneReorder(dragged, scene.id);
    }
  });

  row.addEventListener('contextmenu', (event) => showSceneRowContextMenu(event, stream, scene, ctx));

  const cueCell = createStreamCell(String(number).padStart(2, '0'), 'stream-list-col-num');
  const titleCell = createStreamCell(scene.title ?? `Scene ${number}`, 'stream-list-col-title');
  const triggerCell = createStreamCell(formatTriggerSummary(stream, scene), 'stream-list-col-trigger');
  const durationCell = createStreamCell(formatSceneDuration(ctx.currentState, scene), 'stream-list-col-duration');
  const stateCell = createStreamCell(formatSceneStateLabel(runtimeState, scene), 'stream-list-col-state');

  const actions = document.createElement('div');
  actions.className = 'stream-scene-row-actions';
  const runHere = createButton('', 'icon-button stream-row-action', () => {
    void window.xtream.stream.transport({ type: 'go', sceneId: scene.id });
  });
  decorateIconButton(runHere, 'Play', 'Run from here');
  runHere.disabled = !!scene.disabled;

  actions.append(runHere);

  row.append(expandBtn, dragHandle, cueCell, titleCell, triggerCell, durationCell, stateCell, actions);

  wrap.append(row);

  const progress = runtimeState?.progress;
  if (runtimeState?.status === 'running' && progress !== undefined && Number.isFinite(progress)) {
    const bar = document.createElement('div');
    bar.className = 'stream-scene-row-progress';
    bar.style.setProperty('--stream-row-progress', `${Math.min(100, Math.max(0, progress * 100))}%`);
    wrap.append(bar);
  } else if (runtimeState?.status === 'running') {
    const bar = document.createElement('div');
    bar.className = 'stream-scene-row-progress stream-scene-row-progress--indeterminate';
    wrap.append(bar);
  }

  if (expanded) {
    const sub = document.createElement('div');
    sub.className = 'stream-scene-subcue-list';
    if (scene.subCueOrder.length === 0) {
      sub.append(createHint('No sub-cues in this scene.'));
    } else {
      for (const sid of scene.subCueOrder) {
        const cue = scene.subCues[sid];
        const line = document.createElement('div');
        line.className = 'stream-scene-subcue-line';
        line.textContent = cue ? formatSubCueLabel(ctx.currentState, cue) : sid;
        sub.append(line);
      }
    }
    wrap.append(sub);
  }

  return wrap;
}
