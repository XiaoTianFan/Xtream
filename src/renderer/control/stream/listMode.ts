import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId } from '../../../shared/types';
import type { StreamEnginePublicState } from '../../../shared/types';
import { readMediaPoolDragPayload, type MediaPoolDragPayload } from '../patch/mediaPool/dragDrop';
import { getStreamAuthoringErrorHighlights, validateStreamContextFromDirector } from '../../../shared/streamSchedule';
import { deriveStreamThreadColorMaps } from '../../../shared/streamThreadColors';
import type { BottomTab } from './streamTypes';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { createButton, createHint } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { sendLoggedStreamTransport } from '../shared/sessionTransportLog';
import {
  formatSceneDuration,
  formatSceneStateLabelForSceneList,
  formatSubCueLabel,
  formatTriggerSummary,
  sceneListRowRuntimeStatus,
} from './formatting';
import { sceneWorkspaceFocusFlags } from './workspaceFocusModel';
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
      ctx.setPlaybackAndEditFocus(newId);
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
    const label = scene.title?.trim() || scene.id;
    void (async () => {
      if (!(await shellShowConfirm('Remove scene?', `Remove "${label}" from the stream?`))) {
        return;
      }
      void window.xtream.stream.edit({ type: 'remove-scene', sceneId: scene.id }).then((s) => {
        ctx.setPlaybackAndEditFocus(s.stream.sceneOrder[0]);
        ctx.expandedListSceneIds.delete(scene.id);
        ctx.requestRender();
      });
    })();
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
  playbackFocusSceneId: SceneId | undefined;
  sceneEditSceneId: SceneId | undefined;
  /** Live dragging scene id (not snapshotted at render — required for HTML5 drop targets). */
  getListDragSceneId: () => SceneId | undefined;
  expandedListSceneIds: Set<SceneId>;
  currentState: DirectorState | undefined;
  /** List/flow click: edit target only; does not move playback focus. */
  setSceneEditFocus: (id: SceneId | undefined) => void;
  /** Run-from-here, new scene, duplicate, etc.: align playback + edit focus. */
  setPlaybackAndEditFocus: (id: SceneId | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  setListDragSceneId: (id: SceneId | undefined) => void;
  toggleExpandedScene: (id: SceneId) => void;
  applySceneReorder: (draggedId: SceneId, insertBeforeId: SceneId | undefined) => void | Promise<void>;
  addMediaPoolItemToScene: (sceneId: SceneId, payload: MediaPoolDragPayload) => void | Promise<void>;
  requestRender: () => void;
  /** Updates header, bottom pane, and list/flow selection chrome without rebuilding the scene list. */
  refreshSceneSelectionUi: () => void;
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
    if (tr.type !== 'follow-start' && tr.type !== 'follow-end') {
      continue;
    }
    if (tr.followsSceneId === predecessorId) {
      out.push(sid);
    }
  }
  return out;
}

type SceneListDragUi = {
  syncIndicatorForRowDrag: (event: DragEvent, rowEl: HTMLElement, sceneId: SceneId) => void;
  hideDropIndicator: () => void;
  finalizeDropIntent: () => { insertBeforeId: SceneId | undefined } | null;
};

export function createStreamListMode(stream: PersistedStreamConfig, ctx: StreamListModeContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stream-scene-list-root';
  const list = document.createElement('div');
  list.className = 'stream-scene-list';
  const dropLine = document.createElement('div');
  dropLine.className = 'stream-scene-drop-indicator';
  dropLine.setAttribute('aria-hidden', 'true');

  let dropIntent: { insertBeforeId: SceneId | undefined } | null = null;

  function hideDropIndicator(): void {
    dropLine.hidden = true;
    dropIntent = null;
  }

  function finalizeDropIntent(): { insertBeforeId: SceneId | undefined } | null {
    const captured = dropIntent;
    dropLine.hidden = true;
    dropIntent = null;
    return captured;
  }

  function showDropLine(left: number, top: number, width: number): void {
    dropLine.hidden = false;
    dropLine.style.left = `${left}px`;
    dropLine.style.top = `${top}px`;
    dropLine.style.width = `${width}px`;
  }

  function syncIndicatorForRowDrag(event: DragEvent, rowEl: HTMLElement, sceneId: SceneId): void {
    const dragging = ctx.getListDragSceneId();
    if (!dragging || dragging === sceneId) {
      hideDropIndicator();
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    const rect = rowEl.getBoundingClientRect();
    const beforeMid = event.clientY < rect.top + rect.height / 2;
    const order = stream.sceneOrder;
    const idx = order.indexOf(sceneId);
    let insertBeforeId: SceneId | undefined;
    if (beforeMid) {
      insertBeforeId = sceneId;
    } else {
      insertBeforeId = idx < order.length - 1 ? order[idx + 1] : undefined;
    }
    dropIntent = { insertBeforeId };
    const lineY = beforeMid ? rect.top : rect.bottom;
    showDropLine(rect.left, lineY - 1.5, rect.width);
  }

  const dragUi: SceneListDragUi = { syncIndicatorForRowDrag, hideDropIndicator, finalizeDropIntent };

  const header = document.createElement('div');
  header.className = 'stream-scene-row stream-scene-row--header';
  header.append(
    createStreamCell('', 'stream-list-col-expand'),
    createStreamCell('#', 'stream-list-col-num'),
    createStreamCell('Title', 'stream-list-col-title'),
    createStreamCell('Trigger', 'stream-list-col-trigger'),
    createStreamCell('Duration', 'stream-list-col-duration'),
    createStreamCell('State', 'stream-list-col-state'),
    createStreamCell('', 'stream-list-col-actions'),
  );
  list.append(header);
  const scenes = stream.sceneOrder.map((id) => stream.scenes[id]).filter(Boolean) as PersistedSceneConfig[];
  const highlights = getStreamAuthoringErrorHighlights(
    stream,
    validateStreamContextFromDirector(ctx.currentState),
    ctx.streamState?.playbackTimeline,
  );
  const threadColors = deriveStreamThreadColorMaps(ctx.streamState?.playbackTimeline);
  scenes.forEach((scene, index) =>
    list.append(createSceneRowWrap(stream, scene, index + 1, ctx, dragUi, highlights, threadColors.bySceneId[scene.id])),
  );

  const endDropTarget = document.createElement('div');
  endDropTarget.className = 'stream-scene-list-end-target';
  endDropTarget.setAttribute('aria-hidden', 'true');
  endDropTarget.addEventListener('dragover', (e) => {
    const dragging = ctx.getListDragSceneId();
    if (!dragging) {
      return;
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropIntent = { insertBeforeId: undefined };
    const lr = list.getBoundingClientRect();
    const er = endDropTarget.getBoundingClientRect();
    showDropLine(lr.left, er.top - 1.5, lr.width);
  });
  endDropTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragged = e.dataTransfer?.getData('text/plain') as SceneId | undefined;
    const intent = finalizeDropIntent();
    if (dragged && intent) {
      void Promise.resolve(ctx.applySceneReorder(dragged, intent.insertBeforeId)).catch((err) => {
        console.error('applySceneReorder failed.', err);
      });
    }
  });

  root.append(list, endDropTarget, createSceneListPhantomRow(stream, ctx), dropLine);
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
        ctx.setPlaybackAndEditFocus(newId);
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
  dragUi: SceneListDragUi,
  highlights: ReturnType<typeof getStreamAuthoringErrorHighlights>,
  threadColor: ReturnType<typeof deriveStreamThreadColorMaps>['bySceneId'][SceneId] | undefined,
): HTMLElement {
  const runtimeState = ctx.streamState?.runtime?.sceneStates[scene.id];
  const sceneAuthoringError = highlights.scenesWithErrors.has(scene.id);
  const badSubCues = highlights.subCuesWithErrors.get(scene.id);
  const statusClass = sceneListRowRuntimeStatus(runtimeState, scene, sceneAuthoringError);
  const { playback: pbFlag, edit: ebFlag } = sceneWorkspaceFocusFlags(scene.id, ctx.playbackFocusSceneId, ctx.sceneEditSceneId);
  const pb = pbFlag ? ' stream-playback-focus' : '';
  const eb = ebFlag ? ' stream-edit-focus' : '';
  const wrap = document.createElement('div');
  wrap.className = `stream-scene-row-wrap status-${statusClass}${pb}${eb}${sceneAuthoringError ? ' stream-scene-row-wrap--authoring-error' : ''}`;
  wrap.dataset.sceneId = scene.id;
  if (threadColor) {
    wrap.classList.add('stream-scene-row-wrap--threaded');
    wrap.dataset.threadColor = threadColor.token;
    wrap.style.setProperty('--stream-thread-base', threadColor.base);
    wrap.style.setProperty('--stream-thread-bright', threadColor.bright);
    wrap.style.setProperty('--stream-thread-dim', threadColor.dim);
  }

  const row = document.createElement('div');
  row.className = `stream-scene-row${pb}${eb} ${statusClass}${sceneAuthoringError ? ' stream-scene-row--authoring-error' : ''}${
    ctx.getListDragSceneId() === scene.id ? ' dragging' : ''
  }`;
  row.draggable = true;
  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    ctx.setSceneEditFocus(scene.id);
    ctx.setBottomTab('scene');
    ctx.clearDetailPane();
    ctx.refreshSceneSelectionUi();
  });
  row.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    ctx.setPlaybackAndEditFocus(scene.id);
    ctx.setBottomTab('scene');
    ctx.clearDetailPane();
    ctx.refreshSceneSelectionUi();
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

  row.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) {
      event.preventDefault();
      return;
    }
    dragUi.hideDropIndicator();
    ctx.setListDragSceneId(scene.id);
    event.dataTransfer?.setData('text/plain', scene.id);
    event.dataTransfer!.effectAllowed = 'move';
    wrap.classList.add('drag-source');
    // Do not call requestRender() here — rebuilding the list destroys the drag source and cancels HTML5 drag.
  });
  row.addEventListener('dragend', () => {
    ctx.setListDragSceneId(undefined);
    wrap.classList.remove('drag-source');
    dragUi.hideDropIndicator();
    ctx.requestRender();
  });

  wrap.addEventListener('dragover', (event) => {
    const mediaPayload = readMediaPoolDragPayload(event.dataTransfer);
    if (mediaPayload) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      wrap.classList.add('media-drop-over');
      dragUi.hideDropIndicator();
      return;
    }
    dragUi.syncIndicatorForRowDrag(event, row, scene.id);
  });
  wrap.addEventListener('dragleave', (event) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !wrap.contains(nextTarget)) {
      wrap.classList.remove('media-drop-over');
    }
  });
  wrap.addEventListener('drop', (event) => {
    const mediaPayload = readMediaPoolDragPayload(event.dataTransfer);
    if (mediaPayload) {
      event.preventDefault();
      wrap.classList.remove('media-drop-over');
      dragUi.hideDropIndicator();
      void Promise.resolve(ctx.addMediaPoolItemToScene(scene.id, mediaPayload)).catch((err) => {
        console.error('addMediaPoolItemToScene failed.', err);
      });
      return;
    }
    event.preventDefault();
    wrap.classList.remove('media-drop-over');
    const dragged = event.dataTransfer?.getData('text/plain') as SceneId | undefined;
    const intent = dragUi.finalizeDropIntent();
    if (!dragged || !intent) {
      return;
    }
    void Promise.resolve(ctx.applySceneReorder(dragged, intent.insertBeforeId)).catch((err) => {
      console.error('applySceneReorder failed.', err);
    });
  });

  row.addEventListener('contextmenu', (event) => showSceneRowContextMenu(event, stream, scene, ctx));

  const cueCell = createStreamCell(String(number).padStart(2, '0'), 'stream-list-col-num');
  const titleCell = createStreamCell(scene.title ?? `Scene ${number}`, 'stream-list-col-title');
  const triggerCell = createStreamCell(formatTriggerSummary(stream, scene), 'stream-list-col-trigger');
  const durationCell = createStreamCell(formatSceneDuration(ctx.currentState, scene), 'stream-list-col-duration');
  const stateCell = createStreamCell(formatSceneStateLabelForSceneList(runtimeState, scene, sceneAuthoringError), 'stream-list-col-state');

  const actions = document.createElement('div');
  actions.className = 'stream-scene-row-actions';
  const runHere = createButton('', 'icon-button stream-row-action', () => {
    ctx.setPlaybackAndEditFocus(scene.id);
    ctx.setBottomTab('scene');
    ctx.clearDetailPane();
    ctx.refreshSceneSelectionUi();
    void sendLoggedStreamTransport({ type: 'play', sceneId: scene.id, source: 'scene-row' }, 'stream');
  });
  decorateIconButton(runHere, 'Play', 'Run from here');
  runHere.disabled = !!scene.disabled;

  actions.append(runHere);

  row.append(expandBtn, cueCell, titleCell, triggerCell, durationCell, stateCell, actions);

  wrap.append(row);

  const progress = runtimeState?.progress;
  if (runtimeState?.status === 'running' && progress !== undefined && Number.isFinite(progress)) {
    const bar = document.createElement('div');
    bar.className = 'stream-scene-row-progress';
    bar.style.setProperty('--stream-row-progress', `${Math.min(100, Math.max(0, progress * 100))}%`);
    if (threadColor) {
      bar.style.setProperty('--stream-row-progress-color', threadColor.bright);
    }
    wrap.append(bar);
  } else if (runtimeState?.status === 'running') {
    const bar = document.createElement('div');
    bar.className = 'stream-scene-row-progress stream-scene-row-progress--indeterminate';
    if (threadColor) {
      bar.style.setProperty('--stream-row-progress-color', threadColor.bright);
    }
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
        line.className = `stream-scene-subcue-line${badSubCues?.has(sid) ? ' stream-scene-subcue-line--error' : ''}`;
        line.textContent = cue ? formatSubCueLabel(ctx.currentState, cue) : sid;
        sub.append(line);
      }
    }
    wrap.append(sub);
  }

  return wrap;
}
