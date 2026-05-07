import type { DirectorState, StreamEnginePublicState, VirtualOutputId } from '../../../shared/types';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { deriveOutputBusGanttProjection, type OutputBusGanttProjection, type OutputBusGanttRowProjection } from './outputBusGanttProjection';

export type OutputBusGanttContext = {
  streamState: StreamEnginePublicState | undefined;
  directorState: DirectorState;
};

const DEFAULT_OUTPUT_GANTT_ZOOM = 1;
const MIN_OUTPUT_GANTT_ZOOM = 0.05;
const MAX_OUTPUT_GANTT_ZOOM = 4;
const OUTPUT_GANTT_WHEEL_ZOOM_FACTOR = 1.12;

function clampZoom(value: number, minZoom = MIN_OUTPUT_GANTT_ZOOM): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_OUTPUT_GANTT_ZOOM;
  }
  return Math.max(minZoom, Math.min(MAX_OUTPUT_GANTT_ZOOM, value));
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function applyThreadColor(el: HTMLElement, row: OutputBusGanttRowProjection): void {
  if (!row.color) {
    return;
  }
  el.dataset.threadColor = row.color.token;
  el.style.setProperty('--stream-thread-base', row.color.base);
  el.style.setProperty('--stream-thread-bright', row.color.bright);
  el.style.setProperty('--stream-thread-dim', row.color.dim);
}

function statusText(status: OutputBusGanttProjection['status']): { title: string; detail: string } {
  if (status === 'no-stream') {
    return { title: 'No Stream timeline', detail: 'Open a Stream timeline to inspect this output bus.' };
  }
  if (status === 'invalid-timeline') {
    return { title: 'Timeline unavailable', detail: 'Resolve Stream timing issues to show routed audio sub-cues.' };
  }
  return { title: 'No routed audio', detail: 'No planned audio sub-cues target this output bus.' };
}

function createEmptyState(status: OutputBusGanttProjection['status']): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'stream-output-gantt-empty';
  const text = statusText(status);
  const title = document.createElement('strong');
  title.textContent = text.title;
  const detail = document.createElement('span');
  detail.textContent = text.detail;
  empty.append(title, detail);
  return empty;
}

function createBar(row: OutputBusGanttRowProjection): HTMLElement {
  const bar = document.createElement('div');
  bar.className = `stream-output-gantt-bar${row.live ? ' is-live' : ''}${row.orphaned ? ' is-orphaned' : ''}${row.copied ? ' is-copy' : ''}`;
  bar.dataset.subCueId = row.subCueId;
  bar.style.left = `${row.leftPercent.toFixed(3)}%`;
  bar.style.width = `${row.widthPercent.toFixed(3)}%`;
  bar.style.setProperty('--stream-output-gantt-bar-cursor', `${row.cursorPercent.toFixed(3)}%`);
  applyThreadColor(bar, row);
  bar.title = `${row.audioLabel} | ${row.sceneLabel} | ${row.timelineLabel} | ${row.timeLabel}${row.live ? ' | live' : ''}`;

  const title = document.createElement('span');
  title.className = 'stream-output-gantt-bar-title';
  title.textContent = row.audioLabel;
  const meta = document.createElement('span');
  meta.className = 'stream-output-gantt-bar-meta';
  meta.textContent = row.timeLabel;
  bar.append(title, meta);
  return bar;
}

function createRow(row: OutputBusGanttRowProjection, projection: OutputBusGanttProjection): HTMLElement {
  const el = document.createElement('section');
  el.className = `stream-output-gantt-row${row.live ? ' is-live' : ''}${row.copied ? ' is-copy' : ''}`;
  el.dataset.outputBusGanttRow = row.id;
  el.dataset.baseMinWidthPx = String(projection.minWidthPx);
  el.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  el.style.minWidth = `${projection.minWidthPx}px`;
  applyThreadColor(el, row);

  const header = document.createElement('div');
  header.className = 'stream-output-gantt-row-header';
  const scene = document.createElement('strong');
  scene.textContent = row.sceneLabel;
  const audio = document.createElement('span');
  audio.className = 'stream-output-gantt-row-audio';
  audio.textContent = row.audioLabel;
  const meta = document.createElement('span');
  meta.className = 'stream-output-gantt-row-meta';
  meta.textContent = `${row.timelineLabel}${row.copied ? ' copy' : ''} | ${row.levelLabel}`;
  header.append(scene, audio, meta);

  const track = document.createElement('div');
  track.className = 'stream-output-gantt-track';
  track.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  track.style.minWidth = `${projection.trackMinWidthPx}px`;
  track.style.setProperty('--stream-output-gantt-cursor', `${projection.cursorPercent.toFixed(3)}%`);
  track.append(createBar(row));
  const cursor = document.createElement('div');
  cursor.className = 'stream-output-gantt-cursor';
  track.append(cursor);
  el.append(header, track);
  return el;
}

function measureFit(root: HTMLElement): { zoom: number; fixedWidth: number } | undefined {
  const body = root.querySelector<HTMLElement>('.stream-output-gantt-body');
  if (!body || body.clientWidth <= 0) {
    return undefined;
  }
  let longestTrackWidth = 0;
  let fixedWidth = 0;
  for (const row of root.querySelectorAll<HTMLElement>('.stream-output-gantt-row')) {
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
    return MIN_OUTPUT_GANTT_ZOOM;
  }
  return clampZoom(fit.zoom, MIN_OUTPUT_GANTT_ZOOM);
}

function getRootZoom(root: HTMLElement): number {
  return clampZoom(Number(root.dataset.outputGanttZoom ?? DEFAULT_OUTPUT_GANTT_ZOOM), getMinimumZoom(root));
}

function applyZoom(root: HTMLElement, zoom = getRootZoom(root)): void {
  const nextZoom = clampZoom(zoom, getMinimumZoom(root));
  root.dataset.outputGanttZoom = String(nextZoom);
  for (const row of root.querySelectorAll<HTMLElement>('.stream-output-gantt-row')) {
    const baseMinWidth = Number(row.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(row.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    const fixedWidth = Math.max(0, baseMinWidth - baseTrackWidth);
    const zoomedTrackWidth = baseTrackWidth * nextZoom;
    row.style.minWidth = px(fixedWidth + zoomedTrackWidth);
    const track = row.querySelector<HTMLElement>('.stream-output-gantt-track');
    if (track) {
      track.style.minWidth = px(zoomedTrackWidth);
    }
  }
}

function fitToContent(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>('.stream-output-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return;
  }
  root.dataset.outputGanttUserZoomed = 'true';
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
}

function autoFitFullRange(root: HTMLElement): boolean {
  if (root.dataset.outputGanttUserZoomed === 'true') {
    return false;
  }
  const body = root.querySelector<HTMLElement>('.stream-output-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return false;
  }
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
  return true;
}

function queueAutoFitFullRange(root: HTMLElement): void {
  if (root.dataset.outputGanttUserZoomed === 'true' || root.dataset.outputGanttFitScheduled === 'true') {
    return;
  }
  root.dataset.outputGanttFitScheduled = 'true';
  requestAnimationFrame(() => {
    delete root.dataset.outputGanttFitScheduled;
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
  const body = event.currentTarget instanceof HTMLElement ? event.currentTarget : root.querySelector<HTMLElement>('.stream-output-gantt-body');
  if (!body) {
    return;
  }
  const previousZoom = getRootZoom(root);
  const nextZoom = clampZoom(
    previousZoom * (event.deltaY < 0 ? OUTPUT_GANTT_WHEEL_ZOOM_FACTOR : 1 / OUTPUT_GANTT_WHEEL_ZOOM_FACTOR),
    getMinimumZoom(root),
  );
  if (nextZoom === previousZoom) {
    return;
  }
  const bounds = body.getBoundingClientRect();
  const pointerX = Math.max(0, Math.min(body.clientWidth || bounds.width, event.clientX - bounds.left));
  const logicalX = (body.scrollLeft + pointerX) / previousZoom;
  root.dataset.outputGanttUserZoomed = 'true';
  applyZoom(root, nextZoom);
  body.scrollLeft = Math.max(0, logicalX * nextZoom - pointerX);
}

function createToolbar(root: HTMLElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'stream-output-gantt-toolbar';
  const title = document.createElement('h3');
  title.textContent = 'Bus Timeline';
  const fit = createButton('', 'icon-button stream-output-gantt-fit-button', () => fitToContent(root));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  toolbar.append(title, fit);
  return toolbar;
}

function setFitButtonEnabled(root: HTMLElement): void {
  const fit = root.querySelector<HTMLButtonElement>('.stream-output-gantt-fit-button');
  if (fit) {
    fit.disabled = root.querySelector('.stream-output-gantt-row') === null;
  }
}

function renderBody(root: HTMLElement, ctx: OutputBusGanttContext): void {
  const body = root.querySelector<HTMLElement>('.stream-output-gantt-body');
  const outputId = root.dataset.outputId as VirtualOutputId | undefined;
  if (!body || !outputId) {
    return;
  }
  const projection = deriveOutputBusGanttProjection({ streamState: ctx.streamState, directorState: ctx.directorState, outputId });
  if (projection.status !== 'ready') {
    body.classList.add('stream-output-gantt-body--empty');
    body.replaceChildren(createEmptyState(projection.status));
    setFitButtonEnabled(root);
    return;
  }
  body.classList.remove('stream-output-gantt-body--empty');
  body.replaceChildren(...projection.rows.map((row) => createRow(row, projection)));
  if (!autoFitFullRange(root)) {
    applyZoom(root);
  }
  queueAutoFitFullRange(root);
  setFitButtonEnabled(root);
}

export function createOutputBusGantt(outputId: VirtualOutputId, ctx: OutputBusGanttContext): HTMLElement {
  const root = document.createElement('section');
  root.className = 'stream-output-gantt-root';
  root.dataset.outputId = outputId;
  root.dataset.outputGanttZoom = String(DEFAULT_OUTPUT_GANTT_ZOOM);
  const body = document.createElement('div');
  body.className = 'stream-output-gantt-body';
  body.addEventListener('wheel', (event) => handleWheel(root, event), { passive: false });
  root.append(createToolbar(root), body);
  renderBody(root, ctx);
  return root;
}

export function syncOutputBusGanttRuntimeChrome(root: HTMLElement, ctx: OutputBusGanttContext): void {
  const gantts = root.matches('.stream-output-gantt-root')
    ? [root]
    : [...root.querySelectorAll<HTMLElement>('.stream-output-gantt-root')];
  for (const gantt of gantts) {
    renderBody(gantt, ctx);
  }
}
