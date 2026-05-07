import { formatTimecode } from '../../../shared/timeline';
import type { PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import { deriveStreamGanttProjection, type StreamGanttBarProjection, type StreamGanttLaneProjection } from './ganttProjection';

export type StreamGanttModeContext = {
  streamState: StreamEnginePublicState | undefined;
};

function statusLabel(status: string): string {
  return status.replace('-', ' ');
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
  row.style.minWidth = `${lane.minWidthPx}px`;

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

function renderGanttBody(root: HTMLElement, streamState: StreamEnginePublicState | undefined): void {
  const body = root.querySelector<HTMLElement>('.stream-gantt-body');
  if (!body) {
    return;
  }
  if (!streamState) {
    body.classList.add('stream-gantt-body--centered');
    body.replaceChildren(createEmptyState());
    return;
  }
  const projection = deriveStreamGanttProjection({
    stream: streamState.stream,
    playbackTimeline: streamState.playbackTimeline,
    runtime: streamState.runtime,
  });
  if (!projection.hasRuntime || projection.lanes.length === 0) {
    body.classList.add('stream-gantt-body--centered');
    body.replaceChildren(createEmptyState());
    return;
  }
  body.classList.toggle('stream-gantt-body--centered', projection.lanes.length <= 4);
  body.replaceChildren(...projection.lanes.map(createLane));
}

export function createStreamGanttMode(_stream: PersistedStreamConfig, ctx: StreamGanttModeContext): HTMLElement {
  const root = document.createElement('div');
  root.className = 'stream-gantt-root';
  const body = document.createElement('div');
  body.className = 'stream-gantt-body';
  root.append(body);
  renderGanttBody(root, ctx.streamState);
  return root;
}

export function syncStreamGanttRuntimeChrome(root: HTMLElement, streamState: StreamEnginePublicState): void {
  const gantt = root.matches('.stream-gantt-root') ? root : root.querySelector<HTMLElement>('.stream-gantt-root');
  if (!gantt) {
    return;
  }
  renderGanttBody(gantt, streamState);
}
