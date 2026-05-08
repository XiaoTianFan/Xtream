import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, SceneId } from '../../../shared/types';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { formatFlowAtTimecodeLaneLabel, type FlowSceneNode } from './flowProjection';

export type FlowCardHandlers = {
  selectScene: (sceneId: SceneId) => void;
  editScene: (sceneId: SceneId) => void;
  runScene: (sceneId: SceneId) => void;
  addFollower: (sceneId: SceneId, anchor: { x: number; y: number }) => void;
  showContextMenu: (event: MouseEvent, sceneId: SceneId) => void;
  beginDrag: (event: PointerEvent, sceneId: SceneId) => void;
  beginResize: (event: PointerEvent, sceneId: SceneId) => void;
  canAcceptMediaDrop?: (event: DragEvent, sceneId: SceneId) => boolean;
  dropMedia?: (event: DragEvent, sceneId: SceneId) => void;
};

function createPreviewGrid(node: FlowSceneNode, directorState: DirectorState | undefined): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'stream-flow-preview-grid';
  const visualIds = node.visualPreviewIds.slice(0, 4);
  if (visualIds.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'stream-flow-preview-empty';
    empty.textContent = node.audioCount > 0 ? `${node.audioCount} audio` : node.controlCount > 0 ? `${node.controlCount} control` : 'empty';
    grid.append(empty);
    return grid;
  }
  for (const visualId of visualIds) {
    const visual = directorState?.visuals[visualId];
    const tile = document.createElement('div');
    tile.className = 'stream-flow-preview-tile';
    if (visual?.kind === 'file' && visual.type === 'image' && visual.url) {
      const img = document.createElement('img');
      img.src = visual.url;
      img.alt = visual.label;
      tile.append(img);
    } else if (visual?.kind === 'file' && visual.type === 'video' && visual.url) {
      const video = document.createElement('video');
      video.src = visual.url;
      video.muted = true;
      video.preload = 'metadata';
      video.playsInline = true;
      tile.append(video);
    } else {
      const label = document.createElement('span');
      label.textContent = visual?.label ?? visualId;
      tile.append(label);
    }
    grid.append(tile);
  }
  return grid;
}

function applyThreadStyle(card: HTMLElement, node: FlowSceneNode): void {
  if (!node.threadColor) {
    return;
  }
  card.dataset.threadColor = node.threadColor.token;
  card.style.setProperty('--stream-thread-base', node.threadColor.base);
  card.style.setProperty('--stream-thread-bright', node.threadColor.bright);
  card.style.setProperty('--stream-thread-dim', node.threadColor.dim);
}

export function createFlowSceneCard(args: {
  stream: PersistedStreamConfig;
  scene: PersistedSceneConfig;
  node: FlowSceneNode;
  directorState: DirectorState | undefined;
  playbackFocusSceneId: SceneId | undefined;
  sceneEditSceneId: SceneId | undefined;
  handlers: FlowCardHandlers;
}): HTMLElement {
  const { stream, scene, node, handlers } = args;
  const wrapper = document.createElement('div');
  wrapper.className = 'stream-flow-card-node';
  wrapper.dataset.sceneId = node.sceneId;
  wrapper.style.left = `${node.rect.x}px`;
  wrapper.style.top = `${node.rect.y}px`;
  wrapper.style.width = `${node.rect.width}px`;
  wrapper.style.height = `${node.rect.height}px`;

  const card = document.createElement('article');
  card.className = [
    'stream-flow-card',
    `status-${node.status}`,
    node.threadColor ? 'stream-flow-card--threaded' : '',
    node.authoringError ? 'stream-flow-card--authoring-error' : '',
    node.temporarilyDisabled ? 'stream-flow-card--temporary-disabled' : '',
    args.playbackFocusSceneId === node.sceneId ? 'stream-playback-focus' : '',
    args.sceneEditSceneId === node.sceneId ? 'stream-edit-focus' : '',
  ]
    .filter(Boolean)
    .join(' ');
  applyThreadStyle(card, node);

  const header = document.createElement('div');
  header.className = 'stream-flow-card-header';
  const number = document.createElement('span');
  number.className = 'stream-flow-number';
  number.textContent = String(node.sceneNumber).padStart(2, '0');
  const title = document.createElement('strong');
  title.textContent = node.title;
  header.append(number, title);

  const previews = createPreviewGrid(node, args.directorState);

  const hover = document.createElement('div');
  hover.className = 'stream-flow-card-hover';
  const run = createButton('', 'icon-button stream-flow-hover-action', () => handlers.runScene(node.sceneId));
  decorateIconButton(run, 'Play', 'Run from here');
  run.disabled = scene.disabled || node.temporarilyDisabled;
  const edit = createButton('', 'icon-button stream-flow-hover-action', () => handlers.editScene(node.sceneId));
  decorateIconButton(edit, 'Settings', 'Edit');
  hover.append(run, edit);

  const footer = document.createElement('div');
  footer.className = 'stream-flow-card-footer';
  const trigger = document.createElement('span');
  trigger.textContent = scene.trigger.type === 'at-timecode' ? formatFlowAtTimecodeLaneLabel(scene) : scene.trigger.type;
  const duration = document.createElement('span');
  duration.textContent = node.durationLabel;
  footer.append(trigger, duration);

  const add = createButton('', 'icon-button stream-flow-add-follower', () => {
    handlers.addFollower(node.sceneId, { x: node.rect.x + node.rect.width + 42, y: node.rect.y });
  });
  decorateIconButton(add, 'Plus', 'Add following scene');
  add.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const resize = document.createElement('span');
  resize.className = 'stream-flow-resize-handle';
  resize.setAttribute('aria-hidden', 'true');

  if (node.status === 'running') {
    const progress = document.createElement('div');
    progress.className = 'stream-flow-card-progress';
    if (node.progress !== undefined && Number.isFinite(node.progress)) {
      progress.style.setProperty('--stream-flow-progress', `${Math.min(100, Math.max(0, node.progress * 100))}%`);
    } else {
      progress.classList.add('stream-flow-card-progress--indeterminate');
    }
    card.append(progress);
  }

  card.append(header, previews, hover, footer, resize);
  card.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    handlers.selectScene(node.sceneId);
  });
  card.addEventListener('dblclick', (event) => {
    event.preventDefault();
    handlers.editScene(node.sceneId);
  });
  card.addEventListener('contextmenu', (event) => handlers.showContextMenu(event, node.sceneId));
  card.addEventListener('dragenter', (event) => {
    if (!handlers.canAcceptMediaDrop?.(event, node.sceneId)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    card.classList.add('media-drop-over');
  });
  card.addEventListener('dragover', (event) => {
    if (!handlers.canAcceptMediaDrop?.(event, node.sceneId)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    card.classList.add('media-drop-over');
  });
  card.addEventListener('dragleave', (event) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !card.contains(nextTarget)) {
      card.classList.remove('media-drop-over');
    }
  });
  card.addEventListener('drop', (event) => {
    if (!handlers.canAcceptMediaDrop?.(event, node.sceneId)) {
      return;
    }
    event.preventDefault();
    card.classList.remove('media-drop-over');
    handlers.dropMedia?.(event, node.sceneId);
  });
  card.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, .stream-flow-resize-handle')) {
      return;
    }
    event.preventDefault();
    handlers.beginDrag(event, node.sceneId);
  });
  resize.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handlers.beginResize(event, node.sceneId);
  });
  wrapper.append(card, add);
  wrapper.title = `${node.title} - ${stream.label}`;
  return wrapper;
}
