import type { DirectorState, DisplayWindowId, StreamEnginePublicState } from '../../../shared/types';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import {
  deriveDisplayWindowGanttProjection,
  type DisplayWindowGanttProjection,
  type DisplayWindowGanttRowProjection,
  type DisplayWindowGanttRenderSegmentProjection,
} from './displayWindowGanttProjection';

export type DisplayWindowGanttContext = {
  streamState: StreamEnginePublicState | undefined;
  directorState: DirectorState;
};

const DEFAULT_DISPLAY_GANTT_ZOOM = 1;
const MIN_DISPLAY_GANTT_ZOOM = 0.05;
const MAX_DISPLAY_GANTT_ZOOM = 4;
const DISPLAY_GANTT_WHEEL_ZOOM_FACTOR = 1.12;

function clampZoom(value: number, minZoom = MIN_DISPLAY_GANTT_ZOOM): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DISPLAY_GANTT_ZOOM;
  }
  return Math.max(minZoom, Math.min(MAX_DISPLAY_GANTT_ZOOM, value));
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function applyThreadColor(el: HTMLElement, row: DisplayWindowGanttRowProjection): void {
  if (!row.color) {
    return;
  }
  el.dataset.threadColor = row.color.token;
  el.style.setProperty('--stream-thread-base', row.color.base);
  el.style.setProperty('--stream-thread-bright', row.color.bright);
  el.style.setProperty('--stream-thread-dim', row.color.dim);
}

function statusText(status: DisplayWindowGanttProjection['status']): { title: string; detail: string } {
  if (status === 'no-stream') {
    return { title: 'No Stream timeline', detail: 'Open a Stream timeline to inspect this display.' };
  }
  if (status === 'invalid-timeline') {
    return { title: 'Timeline unavailable', detail: 'Resolve Stream timing issues to show visual sub-cues.' };
  }
  return { title: 'No visual cues', detail: 'No planned visual sub-cues target this display.' };
}

function createEmptyState(status: DisplayWindowGanttProjection['status']): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'stream-display-gantt-empty';
  const text = statusText(status);
  const title = document.createElement('strong');
  title.textContent = text.title;
  const detail = document.createElement('span');
  detail.textContent = text.detail;
  empty.append(title, detail);
  return empty;
}

function createRenderSegment(segment: DisplayWindowGanttRenderSegmentProjection): HTMLElement {
  const el = document.createElement('span');
  el.className = 'stream-display-gantt-render-segment';
  el.style.left = `${segment.leftPercent.toFixed(3)}%`;
  el.style.width = `${segment.widthPercent.toFixed(3)}%`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function createBar(row: DisplayWindowGanttRowProjection): HTMLElement {
  const bar = document.createElement('div');
  bar.className = `stream-display-gantt-bar${row.live ? ' is-live' : ''}${row.orphaned ? ' is-orphaned' : ''}${row.copied ? ' is-copy' : ''}${
    row.renderSegments.length === 0 ? ' is-covered' : ''
  }`;
  bar.dataset.subCueId = row.subCueId;
  bar.dataset.zoneId = row.zoneId;
  bar.style.left = `${row.leftPercent.toFixed(3)}%`;
  bar.style.width = `${row.widthPercent.toFixed(3)}%`;
  bar.style.setProperty('--stream-display-gantt-bar-cursor', `${row.cursorPercent.toFixed(3)}%`);
  applyThreadColor(bar, row);
  bar.title = `${row.visualLabel} | ${row.sceneLabel} | ${row.zoneLabel} | ${row.timelineLabel} | ${row.timeLabel}${
    row.live ? ' | live' : ''
  }${row.renderSegments.length === 0 ? ' | covered' : ''}`;

  const segmentWrap = document.createElement('span');
  segmentWrap.className = 'stream-display-gantt-render-segments';
  segmentWrap.append(...row.renderSegments.map(createRenderSegment));

  const title = document.createElement('span');
  title.className = 'stream-display-gantt-bar-title';
  title.textContent = row.visualLabel;
  const meta = document.createElement('span');
  meta.className = 'stream-display-gantt-bar-meta';
  meta.textContent = row.timeLabel;
  bar.append(segmentWrap, title, meta);
  return bar;
}

function createRow(row: DisplayWindowGanttRowProjection, projection: DisplayWindowGanttProjection): HTMLElement {
  const el = document.createElement('section');
  el.className = `stream-display-gantt-row${row.live ? ' is-live' : ''}${row.copied ? ' is-copy' : ''}`;
  el.dataset.displayWindowGanttRow = row.id;
  el.dataset.baseMinWidthPx = String(projection.minWidthPx);
  el.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  el.style.minWidth = `${projection.minWidthPx}px`;
  applyThreadColor(el, row);

  const header = document.createElement('div');
  header.className = 'stream-display-gantt-row-header';
  const scene = document.createElement('strong');
  scene.textContent = row.sceneLabel;
  const visual = document.createElement('span');
  visual.className = 'stream-display-gantt-row-visual';
  visual.textContent = row.visualLabel;
  const meta = document.createElement('span');
  meta.className = 'stream-display-gantt-row-meta';
  meta.textContent = `${row.zoneLabel} | ${row.timelineLabel}${row.copied ? ' copy' : ''}`;
  header.append(scene, visual, meta);

  const track = document.createElement('div');
  track.className = 'stream-display-gantt-track';
  track.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  track.style.minWidth = `${projection.trackMinWidthPx}px`;
  track.style.setProperty('--stream-display-gantt-cursor', `${projection.cursorPercent.toFixed(3)}%`);
  track.append(createBar(row));
  const cursor = document.createElement('div');
  cursor.className = 'stream-display-gantt-cursor';
  track.append(cursor);
  el.append(header, track);
  return el;
}

function measureFit(root: HTMLElement): { zoom: number; fixedWidth: number } | undefined {
  const body = root.querySelector<HTMLElement>('.stream-display-gantt-body');
  if (!body || body.clientWidth <= 0) {
    return undefined;
  }
  let longestTrackWidth = 0;
  let fixedWidth = 0;
  for (const row of root.querySelectorAll<HTMLElement>('.stream-display-gantt-row')) {
    const baseMinWidth = Number(row.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(row.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    longestTrackWidth = Math.max(longestTrackWidth, baseTrackWidth);
    fixedWidth = Math.max(fixedWidth, baseMinWidth - baseTrackWidth);
  }
  if (longestTrackWidth <= 0) {
    return undefined;
  }
  return {
    zoom: Math.max(1, body.clientWidth - fixedWidth) / longestTrackWidth,
    fixedWidth,
  };
}

function getMinimumZoom(root: HTMLElement): number {
  const fit = measureFit(root);
  if (!fit) {
    return MIN_DISPLAY_GANTT_ZOOM;
  }
  return clampZoom(fit.zoom, MIN_DISPLAY_GANTT_ZOOM);
}

function getRootZoom(root: HTMLElement): number {
  return clampZoom(Number(root.dataset.displayGanttZoom ?? DEFAULT_DISPLAY_GANTT_ZOOM), getMinimumZoom(root));
}

function applyZoom(root: HTMLElement, zoom = getRootZoom(root)): void {
  const nextZoom = clampZoom(zoom, getMinimumZoom(root));
  root.dataset.displayGanttZoom = String(nextZoom);
  for (const row of root.querySelectorAll<HTMLElement>('.stream-display-gantt-row')) {
    const baseMinWidth = Number(row.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(row.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    const fixedWidth = Math.max(0, baseMinWidth - baseTrackWidth);
    const zoomedTrackWidth = baseTrackWidth * nextZoom;
    row.style.minWidth = px(fixedWidth + zoomedTrackWidth);
    const track = row.querySelector<HTMLElement>('.stream-display-gantt-track');
    if (track) {
      track.style.minWidth = px(zoomedTrackWidth);
    }
  }
}

function fitToContent(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>('.stream-display-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return;
  }
  root.dataset.displayGanttUserZoomed = 'true';
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
}

function autoFitFullRange(root: HTMLElement): boolean {
  if (root.dataset.displayGanttUserZoomed === 'true') {
    return false;
  }
  const body = root.querySelector<HTMLElement>('.stream-display-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return false;
  }
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
  return true;
}

function queueAutoFitFullRange(root: HTMLElement): void {
  if (root.dataset.displayGanttUserZoomed === 'true' || root.dataset.displayGanttFitScheduled === 'true') {
    return;
  }
  root.dataset.displayGanttFitScheduled = 'true';
  requestAnimationFrame(() => {
    delete root.dataset.displayGanttFitScheduled;
    if (root.isConnected) {
      autoFitFullRange(root);
    }
  });
}

function handleWheel(root: HTMLElement, event: WheelEvent): void {
  if (!event.ctrlKey) {
    return;
  }
  event.preventDefault();
  const body = event.currentTarget instanceof HTMLElement ? event.currentTarget : root.querySelector<HTMLElement>('.stream-display-gantt-body');
  if (!body) {
    return;
  }
  const previousZoom = getRootZoom(root);
  const nextZoom = clampZoom(
    previousZoom * (event.deltaY < 0 ? DISPLAY_GANTT_WHEEL_ZOOM_FACTOR : 1 / DISPLAY_GANTT_WHEEL_ZOOM_FACTOR),
    getMinimumZoom(root),
  );
  if (nextZoom === previousZoom) {
    return;
  }
  const bounds = body.getBoundingClientRect();
  const pointerX = Math.max(0, Math.min(body.clientWidth || bounds.width, event.clientX - bounds.left));
  const logicalX = (body.scrollLeft + pointerX) / previousZoom;
  root.dataset.displayGanttUserZoomed = 'true';
  applyZoom(root, nextZoom);
  body.scrollLeft = Math.max(0, logicalX * nextZoom - pointerX);
}

function createToolbar(root: HTMLElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'stream-display-gantt-toolbar';
  const title = document.createElement('h3');
  title.textContent = 'Display Timeline';
  const fit = createButton('', 'icon-button stream-display-gantt-fit-button', () => fitToContent(root));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  toolbar.append(title, fit);
  return toolbar;
}

function setFitButtonEnabled(root: HTMLElement): void {
  const fit = root.querySelector<HTMLButtonElement>('.stream-display-gantt-fit-button');
  if (fit) {
    fit.disabled = root.querySelector('.stream-display-gantt-row') === null;
  }
}

function renderBody(root: HTMLElement, ctx: DisplayWindowGanttContext): void {
  const body = root.querySelector<HTMLElement>('.stream-display-gantt-body');
  const displayId = root.dataset.displayId as DisplayWindowId | undefined;
  if (!body || !displayId) {
    return;
  }
  const projection = deriveDisplayWindowGanttProjection({ streamState: ctx.streamState, directorState: ctx.directorState, displayId });
  root.dataset.displayGanttMode = projection.mingleMode;
  root.dataset.displayGanttAlgorithm = projection.mingleAlgorithm;
  if (projection.status !== 'ready') {
    body.classList.add('stream-display-gantt-body--empty');
    body.replaceChildren(createEmptyState(projection.status));
    setFitButtonEnabled(root);
    return;
  }
  body.classList.remove('stream-display-gantt-body--empty');
  body.replaceChildren(...projection.rows.map((row) => createRow(row, projection)));
  if (!autoFitFullRange(root)) {
    applyZoom(root);
  }
  queueAutoFitFullRange(root);
  setFitButtonEnabled(root);
}

export function createDisplayWindowGantt(displayId: DisplayWindowId, ctx: DisplayWindowGanttContext): HTMLElement {
  const root = document.createElement('section');
  root.className = 'stream-display-gantt-root';
  root.dataset.displayId = displayId;
  root.dataset.displayGanttZoom = String(DEFAULT_DISPLAY_GANTT_ZOOM);
  const body = document.createElement('div');
  body.className = 'stream-display-gantt-body';
  body.addEventListener('wheel', (event) => handleWheel(root, event), { passive: false });
  root.append(createToolbar(root), body);
  renderBody(root, ctx);
  return root;
}

export function syncDisplayWindowGanttRuntimeChrome(root: HTMLElement, ctx: DisplayWindowGanttContext): void {
  const gantts = root.matches('.stream-display-gantt-root')
    ? [root]
    : [...root.querySelectorAll<HTMLElement>('.stream-display-gantt-root')];
  for (const gantt of gantts) {
    renderBody(gantt, ctx);
  }
}
