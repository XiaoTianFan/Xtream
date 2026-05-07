import type { DirectorState, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../shared/types';
import { getStreamAuthoringErrorHighlights, validateStreamContextFromDirector } from '../../../shared/streamSchedule';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { sceneWorkspaceFocusFlags } from './workspaceFocusModel';
import { createFlowSceneCard } from './flowCards';
import { renderFlowLinks } from './flowLinks';
import { deriveStreamFlowProjection, moveFlowRect, type FlowProjection, type FlowRect } from './flowProjection';
import { FlowReteCanvas } from './flowReteCanvas';
import type { BottomTab } from './streamTypes';

export type StreamFlowModeContext = {
  playbackFocusSceneId: SceneId | undefined;
  sceneEditSceneId: SceneId | undefined;
  currentState: DirectorState | undefined;
  streamState: StreamEnginePublicState | undefined;
  setSceneEditFocus: (id: SceneId | undefined) => void;
  setPlaybackAndEditFocus: (id: SceneId | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
  refreshSceneSelectionUi: () => void;
};

let activeFlowContextMenu: HTMLElement | undefined;

function dismissFlowContextMenu(): void {
  activeFlowContextMenu?.remove();
  activeFlowContextMenu = undefined;
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - bounds.width - 4)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - bounds.height - 4)}px`;
}

function ensureMenuDismissListeners(): void {
  document.addEventListener('click', dismissFlowContextMenu, { once: true });
  window.addEventListener('blur', dismissFlowContextMenu, { once: true });
}

function getRuntimeMainCursorMs(streamState: StreamEnginePublicState | undefined): number | undefined {
  const runtime = streamState?.runtime;
  if (!runtime) {
    return undefined;
  }
  const main = runtime.mainTimelineId ? runtime.timelineInstances?.[runtime.mainTimelineId] : undefined;
  return main?.cursorMs ?? runtime.currentStreamMs ?? runtime.pausedAtStreamMs ?? runtime.offsetStreamMs;
}

function createProjection(stream: PersistedStreamConfig, ctx: StreamFlowModeContext): FlowProjection {
  const highlights = getStreamAuthoringErrorHighlights(
    stream,
    validateStreamContextFromDirector(ctx.currentState),
    ctx.streamState?.playbackTimeline,
  );
  return deriveStreamFlowProjection({
    stream,
    timeline: ctx.streamState?.playbackTimeline,
    directorState: ctx.currentState,
    runtimeSceneStates: ctx.streamState?.runtime?.sceneStates,
    runtimeMainCursorMs: getRuntimeMainCursorMs(ctx.streamState),
    authoringErrorSceneIds: highlights.scenesWithErrors,
  });
}

function flowRectPatch(rect: FlowRect): FlowRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function createToolbar(canvas: FlowReteCanvas, getProjection: () => FlowProjection, ctx: StreamFlowModeContext): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'stream-flow-toolbar';
  const zoomOut = createButton('', 'icon-button', () => void canvas.zoomBy(0.85));
  decorateIconButton(zoomOut, 'Rewind', 'Zoom out');
  const zoomIn = createButton('', 'icon-button', () => void canvas.zoomBy(1.15));
  decorateIconButton(zoomIn, 'FastForward', 'Zoom in');
  const fit = createButton('', 'icon-button', () => void canvas.fitToProjection(getProjection()));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  const reset = createButton('', 'icon-button', () => {
    void window.xtream.stream.edit({ type: 'reset-flow-layout' }).then(() => ctx.requestRender());
  });
  decorateIconButton(reset, 'RefreshCcw', 'Reset layout');
  toolbar.append(zoomOut, zoomIn, fit, reset);
  return toolbar;
}

function syncFocusClasses(root: HTMLElement, playbackId: SceneId | undefined, editId: SceneId | undefined): void {
  for (const node of root.querySelectorAll<HTMLElement>('.stream-flow-card-node[data-scene-id]')) {
    const id = node.dataset.sceneId as SceneId | undefined;
    if (!id) {
      continue;
    }
    const card = node.querySelector<HTMLElement>('.stream-flow-card');
    if (!card) {
      continue;
    }
    const { playback, edit } = sceneWorkspaceFocusFlags(id, playbackId, editId);
    card.classList.toggle('stream-playback-focus', playback);
    card.classList.toggle('stream-edit-focus', edit);
  }
}

function applyRectToCard(root: HTMLElement, sceneId: SceneId, rect: FlowRect): void {
  const node = root.querySelector<HTMLElement>(`.stream-flow-card-node[data-scene-id="${CSS.escape(sceneId)}"]`);
  if (!node) {
    return;
  }
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

function applyOverlayBounds(overlay: SVGSVGElement, bounds: FlowRect): void {
  const pad = 420;
  overlay.setAttribute('viewBox', `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`);
  overlay.style.left = `${bounds.x - pad}px`;
  overlay.style.top = `${bounds.y - pad}px`;
  overlay.style.width = `${bounds.width + pad * 2}px`;
  overlay.style.height = `${bounds.height + pad * 2}px`;
}

async function duplicateScene(stream: PersistedStreamConfig, sceneId: SceneId, ctx: StreamFlowModeContext): Promise<void> {
  const source = stream.scenes[sceneId];
  const sourceFlow = source?.flow;
  const state = await window.xtream.stream.edit({ type: 'duplicate-scene', sceneId });
  const idx = state.stream.sceneOrder.indexOf(sceneId);
  const newId = idx >= 0 ? state.stream.sceneOrder[idx + 1] : undefined;
  if (newId) {
    if (sourceFlow) {
      await window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: newId,
        update: { flow: { ...sourceFlow, x: sourceFlow.x + 34, y: sourceFlow.y + 34 } },
      });
    }
    ctx.setPlaybackAndEditFocus(newId);
  }
  ctx.requestRender();
}

function showSceneContextMenu(event: MouseEvent, stream: PersistedStreamConfig, sceneId: SceneId, ctx: StreamFlowModeContext): void {
  event.preventDefault();
  event.stopPropagation();
  dismissFlowContextMenu();
  ensureMenuDismissListeners();
  const scene = stream.scenes[sceneId];
  if (!scene) {
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu stream-flow-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (e) => e.stopPropagation());
  const duplicateBtn = createButton('Duplicate', 'secondary context-menu-item', () => {
    dismissFlowContextMenu();
    void duplicateScene(stream, sceneId, ctx);
  });
  const toggleBtn = createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary context-menu-item', () => {
    dismissFlowContextMenu();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId, update: { disabled: !scene.disabled } }).then(() => ctx.requestRender());
  });
  const removeBtn = createButton('Remove', 'secondary context-menu-item', () => {
    if (stream.sceneOrder.length <= 1) {
      return;
    }
    dismissFlowContextMenu();
    const label = scene.title?.trim() || scene.id;
    void (async () => {
      if (!(await shellShowConfirm('Remove scene?', `Remove "${label}" from the stream?`))) {
        return;
      }
      void window.xtream.stream.edit({ type: 'remove-scene', sceneId }).then((state) => {
        ctx.setPlaybackAndEditFocus(state.stream.sceneOrder[0]);
        ctx.requestRender();
      });
    })();
  });
  removeBtn.disabled = stream.sceneOrder.length <= 1;
  menu.append(duplicateBtn, toggleBtn, removeBtn);
  document.body.append(menu);
  positionMenu(menu, event.clientX, event.clientY);
  activeFlowContextMenu = menu;
}

function showRootContextMenu(event: MouseEvent, canvas: FlowReteCanvas, ctx: StreamFlowModeContext): void {
  event.preventDefault();
  event.stopPropagation();
  dismissFlowContextMenu();
  ensureMenuDismissListeners();
  const point = canvas.screenToFlow(event);
  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu stream-flow-menu';
  menu.setAttribute('role', 'menu');
  const add = createButton('Add Scene', 'secondary context-menu-item', () => {
    dismissFlowContextMenu();
    void window.xtream.stream
      .edit({
        type: 'create-scene',
        trigger: { type: 'manual' },
        flow: { x: point.x, y: point.y, width: 214, height: 136 },
      })
      .then((state) => {
        const id = state.stream.sceneOrder[state.stream.sceneOrder.length - 1];
        ctx.setPlaybackAndEditFocus(id);
        ctx.requestRender();
      });
  });
  menu.append(add);
  document.body.append(menu);
  positionMenu(menu, event.clientX, event.clientY);
  activeFlowContextMenu = menu;
}

function renderCards(args: {
  stream: PersistedStreamConfig;
  ctx: StreamFlowModeContext;
  projection: FlowProjection;
  canvas: FlowReteCanvas;
  root: HTMLElement;
}): void {
  const { stream, ctx, projection, canvas, root } = args;
  const cards = root.querySelector('.stream-flow-card-layer') ?? document.createElement('div');
  cards.className = 'stream-flow-card-layer';
  cards.replaceChildren();
  if (!cards.parentElement) {
    canvas.content.append(cards);
  }

  const beginDrag = (event: PointerEvent, sceneId: SceneId) => {
    event.preventDefault();
    event.stopPropagation();
    const start = canvas.screenToFlow(event);
    const node = projection.nodesBySceneId[sceneId];
    if (!node) {
      return;
    }
    const movedIds =
      node.rootSceneId === sceneId && node.threadId
        ? projection.nodes.filter((candidate) => candidate.threadId === node.threadId).map((candidate) => candidate.sceneId)
        : [sceneId];
    const initial = Object.fromEntries(movedIds.map((id) => [id, { ...projection.nodesBySceneId[id].rect }]));
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = canvas.screenToFlow(moveEvent);
      const dx = next.x - start.x;
      const dy = next.y - start.y;
      for (const id of movedIds) {
        const candidate = projection.nodesBySceneId[id];
        if (!candidate) {
          continue;
        }
        candidate.rect = moveFlowRect(initial[id], dx, dy);
        applyRectToCard(root, id, candidate.rect);
      }
      renderFlowLinks(canvas.overlay, projection, ctx.streamState?.runtime?.status === 'running');
    };
    const cleanup = (upEvent: PointerEvent) => {
      if (target.hasPointerCapture(upEvent.pointerId)) {
        target.releasePointerCapture(upEvent.pointerId);
      }
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', cleanup);
      target.removeEventListener('pointercancel', cleanup);
      void Promise.all(
        movedIds.map((id) =>
          window.xtream.stream.edit({
            type: 'update-scene',
            sceneId: id,
            update: { flow: flowRectPatch(projection.nodesBySceneId[id].rect) },
          }),
        ),
      );
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', cleanup, { once: true });
    target.addEventListener('pointercancel', cleanup, { once: true });
  };

  const beginResize = (event: PointerEvent, sceneId: SceneId) => {
    event.preventDefault();
    event.stopPropagation();
    const start = canvas.screenToFlow(event);
    const node = projection.nodesBySceneId[sceneId];
    if (!node) {
      return;
    }
    const initial = { ...node.rect };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = canvas.screenToFlow(moveEvent);
      node.rect = {
        ...initial,
        width: Math.max(170, initial.width + next.x - start.x),
        height: Math.max(104, initial.height + next.y - start.y),
      };
      applyRectToCard(root, sceneId, node.rect);
      renderFlowLinks(canvas.overlay, projection, ctx.streamState?.runtime?.status === 'running');
    };
    const cleanup = (upEvent: PointerEvent) => {
      if (target.hasPointerCapture(upEvent.pointerId)) {
        target.releasePointerCapture(upEvent.pointerId);
      }
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', cleanup);
      target.removeEventListener('pointercancel', cleanup);
      void window.xtream.stream.edit({ type: 'update-scene', sceneId, update: { flow: flowRectPatch(node.rect) } });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', cleanup, { once: true });
    target.addEventListener('pointercancel', cleanup, { once: true });
  };

  for (const node of projection.nodes) {
    const scene = stream.scenes[node.sceneId];
    if (!scene) {
      continue;
    }
    cards.append(
      createFlowSceneCard({
        stream,
        scene,
        node,
        directorState: ctx.currentState,
        playbackFocusSceneId: ctx.playbackFocusSceneId,
        sceneEditSceneId: ctx.sceneEditSceneId,
        handlers: {
          selectScene: (id) => {
            ctx.setSceneEditFocus(id);
            ctx.setBottomTab('scene');
            ctx.clearDetailPane();
            ctx.refreshSceneSelectionUi();
          },
          editScene: (id) => {
            ctx.setPlaybackAndEditFocus(id);
            ctx.setBottomTab('scene');
            ctx.clearDetailPane();
            ctx.refreshSceneSelectionUi();
          },
          runScene: (id) => {
            ctx.setPlaybackAndEditFocus(id);
            ctx.setBottomTab('scene');
            ctx.clearDetailPane();
            ctx.refreshSceneSelectionUi();
            void window.xtream.stream.transport({ type: 'play', sceneId: id, source: 'flow-card' });
          },
          addFollower: (id, _anchor) => {
            void window.xtream.stream
              .edit({
                type: 'create-scene',
                afterSceneId: id,
                trigger: { type: 'follow-end', followsSceneId: id },
              })
              .then((state) => {
                const idx = state.stream.sceneOrder.indexOf(id);
                const newId = idx >= 0 ? state.stream.sceneOrder[idx + 1] : state.stream.sceneOrder.at(-1);
                ctx.setPlaybackAndEditFocus(newId);
                ctx.requestRender();
              });
          },
          showContextMenu: (event, id) => showSceneContextMenu(event, stream, id, ctx),
          beginDrag,
          beginResize,
        },
      }),
    );
  }
}

export function createStreamFlowMode(stream: PersistedStreamConfig, ctx: StreamFlowModeContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stream-flow-root';
  const canvasHost = document.createElement('div');
  canvasHost.className = 'stream-flow-canvas';
  root.append(canvasHost);

  let initialized = false;
  let canvas: FlowReteCanvas | undefined;
  let destroyObserver: MutationObserver | undefined;

  const initializeCanvas = (): void => {
    if (initialized || !root.isConnected) {
      return;
    }
    initialized = true;
    let projection = createProjection(stream, ctx);
    canvas = new FlowReteCanvas(canvasHost, {
      initialViewport: stream.flowViewport,
      onViewportChange: (flowViewport) => {
        void window.xtream.stream.edit({ type: 'update-stream', flowViewport });
      },
    });
    root.prepend(createToolbar(canvas, () => projection, ctx));
    canvas.setOverlayBounds(projection.bounds);
    renderCards({ stream, ctx, projection, canvas, root });
    renderFlowLinks(canvas.overlay, projection, ctx.streamState?.runtime?.status === 'running');
    canvasHost.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('.stream-flow-card-node, .stream-flow-toolbar')) {
        return;
      }
      showRootContextMenu(event, canvas!, ctx);
    });
    destroyObserver = new MutationObserver(() => {
      if (!root.isConnected) {
        canvas?.destroy();
        canvas = undefined;
        dismissFlowContextMenu();
        destroyObserver?.disconnect();
      }
    });
    destroyObserver.observe(document.body, { childList: true, subtree: true });
    projection = createProjection(stream, ctx);
  };

  window.queueMicrotask(initializeCanvas);
  return root;
}

export function syncStreamFlowModeRuntimeChrome(
  root: HTMLElement,
  streamState: StreamEnginePublicState,
  directorState: DirectorState | undefined,
  playbackFocusSceneId: SceneId | undefined,
  sceneEditSceneId: SceneId | undefined,
): void {
  const canvas = root.querySelector<HTMLElement>('.stream-flow-canvas');
  const overlay = root.querySelector<SVGSVGElement>('.stream-flow-link-layer');
  if (!canvas || !overlay) {
    return;
  }
  syncFocusClasses(root, playbackFocusSceneId, sceneEditSceneId);
  const projection = deriveStreamFlowProjection({
    stream: streamState.stream,
    timeline: streamState.playbackTimeline,
    directorState,
    runtimeSceneStates: streamState.runtime?.sceneStates,
    runtimeMainCursorMs: getRuntimeMainCursorMs(streamState),
    authoringErrorSceneIds: getStreamAuthoringErrorHighlights(
      streamState.stream,
      validateStreamContextFromDirector(directorState),
      streamState.playbackTimeline,
    ).scenesWithErrors,
  });
  for (const node of projection.nodes) {
    const wrapper = root.querySelector<HTMLElement>(`.stream-flow-card-node[data-scene-id="${CSS.escape(node.sceneId)}"]`);
    const card = wrapper?.querySelector<HTMLElement>('.stream-flow-card');
    if (!card) {
      continue;
    }
    applyRectToCard(root, node.sceneId, node.rect);
    for (const cl of [...card.classList]) {
      if (cl.startsWith('status-')) {
        card.classList.remove(cl);
      }
    }
    card.classList.add(`status-${node.status}`);
    card.classList.toggle('stream-flow-card--temporary-disabled', node.temporarilyDisabled);
    let bar = card.querySelector<HTMLElement>('.stream-flow-card-progress');
    if (node.status === 'running') {
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'stream-flow-card-progress';
        card.prepend(bar);
      }
      if (node.progress !== undefined && Number.isFinite(node.progress)) {
        bar.classList.remove('stream-flow-card-progress--indeterminate');
        bar.style.setProperty('--stream-flow-progress', `${Math.min(100, Math.max(0, node.progress * 100))}%`);
      } else {
        bar.classList.add('stream-flow-card-progress--indeterminate');
        bar.style.removeProperty('--stream-flow-progress');
      }
    } else {
      bar?.remove();
    }
  }
  applyOverlayBounds(overlay, projection.bounds);
  renderFlowLinks(overlay, projection, streamState.runtime?.status === 'running');
}
