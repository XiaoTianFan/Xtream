import { formatTimecode } from '../../../shared/timeline';
import type { PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { deriveStreamGanttProjection, type StreamGanttBarProjection, type StreamGanttLaneProjection } from './ganttProjection';

export type StreamGanttModeContext = {
  streamState: StreamEnginePublicState | undefined;
};

const DEFAULT_GANTT_ZOOM = 1;
const MIN_GANTT_ZOOM = 0.02;
const MAX_GANTT_ZOOM = 4;
const GANTT_WHEEL_ZOOM_FACTOR = 1.12;

let activeGanttContextMenu: HTMLElement | undefined;

function dismissGanttContextMenu(): void {
  activeGanttContextMenu?.remove();
  activeGanttContextMenu = undefined;
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - bounds.width - 4)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - bounds.height - 4)}px`;
}

function ensureContextMenuDismissListeners(): void {
  document.addEventListener('click', dismissGanttContextMenu, { once: true });
  window.addEventListener('blur', dismissGanttContextMenu, { once: true });
}

function statusLabel(status: string): string {
  return status.replace('-', ' ');
}

function clampZoom(value: number, minZoom = MIN_GANTT_ZOOM): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GANTT_ZOOM;
  }
  return Math.max(minZoom, Math.min(MAX_GANTT_ZOOM, value));
}

function getRootZoom(root: HTMLElement): number {
  return clampZoom(Number(root.dataset.ganttZoom ?? DEFAULT_GANTT_ZOOM), getMinimumGanttZoom(root));
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'stream-gantt-empty';
  const title = document.createElement('strong');
  title.textContent = 'No active Stream timelines';
  const detail = document.createElement('span');
  detail.textContent = 'Start playback to monitor main and parallel thread instances.';
  empty.append(title, detail);
  return empty;
}

function showTimelineContextMenu(event: MouseEvent, lane: StreamGanttLaneProjection): void {
  if (lane.kind === 'main') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  dismissGanttContextMenu();
  ensureContextMenuDismissListeners();
  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu stream-gantt-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (e) => e.stopPropagation());
  const remove = createButton('Remove timeline', 'secondary context-menu-item', () => {
    dismissGanttContextMenu();
    void window.xtream.stream.transport({ type: 'remove-timeline', timelineId: lane.id });
  });
  remove.setAttribute('role', 'menuitem');
  menu.append(remove);
  document.body.append(menu);
  positionMenu(menu, event.clientX, event.clientY);
  activeGanttContextMenu = menu;
}

function applyThreadColor(el: HTMLElement, bar: StreamGanttBarProjection): void {
  if (!bar.color) {
    return;
  }
  el.dataset.threadColor = bar.color.token;
  el.style.setProperty('--stream-thread-base', bar.color.base);
  el.style.setProperty('--stream-thread-bright', bar.color.bright);
  el.style.setProperty('--stream-thread-dim', bar.color.dim);
}

function createBar(bar: StreamGanttBarProjection): HTMLElement {
  const el = document.createElement('div');
  el.className = `stream-gantt-bar status-${bar.state}${bar.copied ? ' stream-gantt-bar--copy' : ''}`;
  el.dataset.threadInstanceId = bar.id;
  el.dataset.threadId = bar.canonicalThreadId;
  el.style.left = `${bar.leftPercent.toFixed(3)}%`;
  el.style.width = `${bar.widthPercent.toFixed(3)}%`;
  el.style.setProperty('--stream-gantt-bar-cursor', `${bar.cursorPercent.toFixed(3)}%`);
  el.style.setProperty('--stream-gantt-launch', `${bar.launchPercent.toFixed(3)}%`);
  applyThreadColor(el, bar);
  el.title = `${bar.title}${bar.copied ? ' copy' : ''} | ${statusLabel(bar.state)} | ${bar.timeLabel}`;

  const title = document.createElement('span');
  title.className = 'stream-gantt-bar-title';
  title.textContent = bar.title;

  const meta = document.createElement('span');
  meta.className = 'stream-gantt-bar-meta';
  meta.textContent = bar.launchSceneId === bar.rootSceneId ? bar.timeLabel : `from ${bar.launchTitle}`;

  if (bar.copied) {
    const copy = document.createElement('span');
    copy.className = 'stream-gantt-copy-marker';
    copy.textContent = 'copy';
    el.append(copy);
  }
  el.append(title, meta);
  return el;
}

function createLane(lane: StreamGanttLaneProjection): HTMLElement {
  const row = document.createElement('section');
  row.className = `stream-gantt-lane is-${lane.kind} status-${lane.status}`;
  row.dataset.timelineId = lane.id;
  row.dataset.baseMinWidthPx = String(lane.minWidthPx);
  row.dataset.baseTrackWidthPx = String(lane.trackMinWidthPx);
  row.style.minWidth = `${lane.minWidthPx}px`;
  row.addEventListener('contextmenu', (event) => showTimelineContextMenu(event, lane));

  const header = document.createElement('div');
  header.className = 'stream-gantt-lane-header';
  const label = document.createElement('strong');
  label.textContent = lane.label;
  const status = document.createElement('span');
  status.className = 'stream-gantt-status';
  status.textContent = statusLabel(lane.status);
  const time = document.createElement('span');
  time.className = 'stream-gantt-time';
  time.textContent = `${formatTimecode(lane.cursorMs / 1000)} / ${formatTimecode(lane.durationMs / 1000)}`;
  header.append(label, status, time);

  const track = document.createElement('div');
  track.className = 'stream-gantt-track';
  track.dataset.baseTrackWidthPx = String(lane.trackMinWidthPx);
  track.style.minWidth = `${lane.trackMinWidthPx}px`;
  track.style.setProperty('--stream-gantt-cursor', `${lane.cursorPercent.toFixed(3)}%`);
  for (const bar of lane.bars) {
    track.append(createBar(bar));
  }
  const cursor = document.createElement('div');
  cursor.className = 'stream-gantt-cursor';
  track.append(cursor);

  row.append(header, track);
  return row;
}

function measureGanttFit(root: HTMLElement, mode: 'longest' | 'main' = 'longest'): { zoom: number; fixedLaneWidth: number } | undefined {
  const body = root.querySelector<HTMLElement>('.stream-gantt-body');
  if (!body) {
    return undefined;
  }
  if (body.clientWidth <= 0) {
    return undefined;
  }
  let longestBaseTrackWidth = 0;
  let fixedLaneWidth = 0;
  const lanes = [...root.querySelectorAll<HTMLElement>('.stream-gantt-lane')];
  const mainLanes = mode === 'main' ? lanes.filter((lane) => lane.classList.contains('is-main')) : [];
  for (const lane of mainLanes.length > 0 ? mainLanes : lanes) {
    const baseMinWidth = Number(lane.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(lane.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    longestBaseTrackWidth = Math.max(longestBaseTrackWidth, baseTrackWidth);
    fixedLaneWidth = Math.max(fixedLaneWidth, baseMinWidth - baseTrackWidth);
  }
  if (longestBaseTrackWidth <= 0) {
    return undefined;
  }
  const availableTrackWidth = Math.max(1, body.clientWidth - fixedLaneWidth);
  return {
    zoom: availableTrackWidth / longestBaseTrackWidth,
    fixedLaneWidth,
  };
}

function getMinimumGanttZoom(root: HTMLElement): number {
  const fit = measureGanttFit(root);
  if (!fit) {
    return MIN_GANTT_ZOOM;
  }
  return Math.max(MIN_GANTT_ZOOM, Math.min(DEFAULT_GANTT_ZOOM, fit.zoom));
}

function autoFitMainTimeline(root: HTMLElement): boolean {
  if (root.dataset.ganttUserZoomed === 'true' || root.dataset.ganttAutoFitApplied === 'true') {
    return false;
  }
  const body = root.querySelector<HTMLElement>('.stream-gantt-body');
  const fit = measureGanttFit(root, 'main');
  if (!body || !fit) {
    return false;
  }
  applyGanttZoom(root, fit.zoom);
  root.dataset.ganttAutoFitApplied = 'true';
  body.scrollLeft = 0;
  return true;
}

function queueAutoFitMainTimeline(root: HTMLElement): void {
  if (root.dataset.ganttUserZoomed === 'true' || root.dataset.ganttAutoFitApplied === 'true' || root.dataset.ganttFitScheduled === 'true') {
    return;
  }
  root.dataset.ganttFitScheduled = 'true';
  requestAnimationFrame(() => {
    delete root.dataset.ganttFitScheduled;
    if (root.isConnected) {
      autoFitMainTimeline(root);
    }
  });
}

function applyGanttZoom(root: HTMLElement, zoom = getRootZoom(root)): void {
  const nextZoom = clampZoom(zoom, getMinimumGanttZoom(root));
  root.dataset.ganttZoom = String(nextZoom);
  for (const lane of root.querySelectorAll<HTMLElement>('.stream-gantt-lane')) {
    const baseMinWidth = Number(lane.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(lane.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    const fixedLaneWidth = Math.max(0, baseMinWidth - baseTrackWidth);
    const zoomedTrackWidth = baseTrackWidth * nextZoom;
    lane.style.minWidth = px(fixedLaneWidth + zoomedTrackWidth);
    const track = lane.querySelector<HTMLElement>('.stream-gantt-track');
    if (track) {
      track.style.minWidth = px(zoomedTrackWidth);
    }
  }
}

function setFitButtonEnabled(root: HTMLElement): void {
  const fit = root.querySelector<HTMLButtonElement>('.stream-gantt-fit-button');
  if (fit) {
    fit.disabled = root.querySelector('.stream-gantt-lane') === null;
  }
}

function fitGanttToContent(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>('.stream-gantt-body');
  if (!body) {
    return;
  }
  const fit = measureGanttFit(root);
  if (!fit) {
    return;
  }
  root.dataset.ganttUserZoomed = 'true';
  applyGanttZoom(root, fit.zoom);
  body.scrollLeft = 0;
}

function createToolbar(root: HTMLElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'stream-gantt-toolbar';
  const fit = createButton('', 'icon-button stream-gantt-fit-button', () => fitGanttToContent(root));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  toolbar.append(fit);
  return toolbar;
}

function handleGanttWheel(root: HTMLElement, event: WheelEvent): void {
  if (!event.ctrlKey) {
    return;
  }
  event.preventDefault();
  const body = event.currentTarget instanceof HTMLElement ? event.currentTarget : root.querySelector<HTMLElement>('.stream-gantt-body');
  if (!body) {
    return;
  }
  const previousZoom = getRootZoom(root);
  const nextZoom = clampZoom(
    previousZoom * (event.deltaY < 0 ? GANTT_WHEEL_ZOOM_FACTOR : 1 / GANTT_WHEEL_ZOOM_FACTOR),
    getMinimumGanttZoom(root),
  );
  if (nextZoom === previousZoom) {
    return;
  }
  const bounds = body.getBoundingClientRect();
  const pointerX = Math.max(0, Math.min(body.clientWidth || bounds.width, event.clientX - bounds.left));
  const logicalX = (body.scrollLeft + pointerX) / previousZoom;
  root.dataset.ganttUserZoomed = 'true';
  applyGanttZoom(root, nextZoom);
  body.scrollLeft = Math.max(0, logicalX * nextZoom - pointerX);
}

function renderGanttBody(root: HTMLElement, streamState: StreamEnginePublicState | undefined): void {
  const body = root.querySelector<HTMLElement>('.stream-gantt-body');
  if (!body) {
    return;
  }
  if (!streamState) {
    body.classList.add('stream-gantt-body--centered');
    body.replaceChildren(createEmptyState());
    setFitButtonEnabled(root);
    return;
  }
  const projection = deriveStreamGanttProjection({
    stream: streamState.stream,
    playbackTimeline: streamState.playbackTimeline,
    runtime: streamState.runtime,
  });
  if (projection.lanes.length === 0) {
    body.classList.add('stream-gantt-body--centered');
    body.replaceChildren(createEmptyState());
    setFitButtonEnabled(root);
    return;
  }
  body.classList.toggle('stream-gantt-body--centered', projection.lanes.length <= 4);
  body.replaceChildren(...projection.lanes.map(createLane));
  if (!autoFitMainTimeline(root)) {
    applyGanttZoom(root);
  }
  queueAutoFitMainTimeline(root);
  setFitButtonEnabled(root);
}

export function createStreamGanttMode(_stream: PersistedStreamConfig, ctx: StreamGanttModeContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stream-gantt-root';
  root.dataset.ganttZoom = String(DEFAULT_GANTT_ZOOM);
  const body = document.createElement('div');
  body.className = 'stream-gantt-body';
  body.addEventListener('wheel', (event) => handleGanttWheel(root, event), { passive: false });
  root.append(createToolbar(root), body);
  renderGanttBody(root, ctx.streamState);
  const destroyObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      dismissGanttContextMenu();
      destroyObserver.disconnect();
    }
  });
  destroyObserver.observe(document.body, { childList: true, subtree: true });
  return root;
}

export function syncStreamGanttRuntimeChrome(root: HTMLElement, streamState: StreamEnginePublicState): void {
  const gantt = root.matches('.stream-gantt-root') ? root : root.querySelector<HTMLElement>('.stream-gantt-root');
  if (!gantt) {
    return;
  }
  renderGanttBody(gantt, streamState);
}
