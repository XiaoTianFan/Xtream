import type { DirectorState, SceneId, SceneRuntimeState, StreamEnginePublicState } from '../../../../shared/types';
import { getStreamAuthoringErrorHighlights, validateStreamContextFromDirector } from '../../../../shared/streamSchedule';
import { deriveStreamThreadColorMaps } from '../../../../shared/streamThreadColors';
import { formatSceneStateLabelForSceneList, sceneListRowRuntimeStatus } from '../formatting';

const LIST_ROW_RUNTIME_STATUSES = new Set<SceneRuntimeState['status'] | 'disabled'>([
  'disabled',
  'failed',
  'error',
  'paused',
  'preloading',
  'ready',
  'running',
  'complete',
  'skipped',
]);

function stripWrapTimelineStatusClasses(wrap: HTMLElement): void {
  for (const cl of [...wrap.classList]) {
    if (cl.startsWith('status-')) {
      wrap.classList.remove(cl);
    }
  }
}

function replaceWrapListRuntimeStatus(wrap: HTMLElement, statusClass: string): void {
  stripWrapTimelineStatusClasses(wrap);
  wrap.classList.add(`status-${statusClass}`);
}

function replaceRowListRuntimeStatus(row: HTMLElement, statusClass: string): void {
  for (const s of LIST_ROW_RUNTIME_STATUSES) {
    row.classList.remove(s);
  }
  row.classList.add(statusClass);
}

export function syncListRuntimeChrome(root: HTMLElement, state: StreamEnginePublicState, directorState: DirectorState | undefined): void {
  const stream = state.stream;
  const highlights = getStreamAuthoringErrorHighlights(
    stream,
    validateStreamContextFromDirector(directorState),
    state.playbackTimeline,
  );
  const threadColors = deriveStreamThreadColorMaps(state.playbackTimeline);
  const runtime = state.runtime;
  for (const wrap of root.querySelectorAll<HTMLElement>('.stream-scene-row-wrap[data-scene-id]')) {
    const sceneId = wrap.dataset.sceneId as SceneId | undefined;
    if (!sceneId) {
      continue;
    }
    const scene = stream.scenes[sceneId];
    if (!scene) {
      continue;
    }
    const runtimeState = runtime?.sceneStates[sceneId];
    const threadColor = threadColors.bySceneId[sceneId];
    if (threadColor) {
      wrap.classList.add('stream-scene-row-wrap--threaded');
      wrap.dataset.threadColor = threadColor.token;
      wrap.style.setProperty('--stream-thread-base', threadColor.base);
      wrap.style.setProperty('--stream-thread-bright', threadColor.bright);
      wrap.style.setProperty('--stream-thread-dim', threadColor.dim);
    }
    const authoringErr = highlights.scenesWithErrors.has(sceneId);
    const statusClass = sceneListRowRuntimeStatus(runtimeState, scene, authoringErr);
    replaceWrapListRuntimeStatus(wrap, statusClass);

    const row = wrap.querySelector<HTMLElement>(':scope > .stream-scene-row');
    if (row) {
      replaceRowListRuntimeStatus(row, statusClass);
      const stateCell = row.querySelector<HTMLElement>('.stream-list-col-state');
      if (stateCell) {
        stateCell.textContent = formatSceneStateLabelForSceneList(runtimeState, scene, authoringErr);
      }
    }

    let bar = wrap.querySelector<HTMLElement>('.stream-scene-row-progress');
    if (runtimeState?.status === 'running') {
      const progress = runtimeState.progress;
      if (!bar) {
        bar = document.createElement('div');
        wrap.append(bar);
      }
      if (progress !== undefined && Number.isFinite(progress)) {
        bar.className = 'stream-scene-row-progress';
        bar.style.setProperty('--stream-row-progress', `${Math.min(100, Math.max(0, progress * 100))}%`);
      } else {
        bar.className = 'stream-scene-row-progress stream-scene-row-progress--indeterminate';
        bar.style.removeProperty('--stream-row-progress');
      }
      if (threadColor) {
        bar.style.setProperty('--stream-row-progress-color', threadColor.bright);
      }
    } else {
      bar?.remove();
    }
  }
}

export function syncListDragAppearance(root: HTMLElement, draggingSceneId: SceneId | undefined): void {
  for (const wrap of root.querySelectorAll<HTMLElement>('.stream-scene-row-wrap[data-scene-id]')) {
    const id = wrap.dataset.sceneId as SceneId | undefined;
    const row = wrap.querySelector<HTMLElement>(':scope > .stream-scene-row');
    if (!id || !row) {
      continue;
    }
    row.classList.toggle('dragging', draggingSceneId !== undefined && id === draggingSceneId);
  }
}

export function syncWorkspaceSceneSelection(
  root: HTMLElement,
  playbackId: SceneId | undefined,
  editId: SceneId | undefined,
): void {
  for (const node of root.querySelectorAll<HTMLElement>('.stream-flow-card-node[data-scene-id]')) {
    const id = node.dataset.sceneId as SceneId | undefined;
    if (!id) {
      continue;
    }
    const card = node.querySelector<HTMLElement>('.stream-flow-card');
    if (!card) {
      continue;
    }
    card.classList.toggle('stream-playback-focus', playbackId !== undefined && id === playbackId);
    card.classList.toggle('stream-edit-focus', editId !== undefined && id === editId);
  }
  for (const wrap of root.querySelectorAll<HTMLElement>('.stream-scene-row-wrap[data-scene-id]')) {
    const id = wrap.dataset.sceneId as SceneId | undefined;
    if (!id) {
      continue;
    }
    wrap.classList.toggle('stream-playback-focus', playbackId !== undefined && id === playbackId);
    wrap.classList.toggle('stream-edit-focus', editId !== undefined && id === editId);
    const row = wrap.querySelector<HTMLElement>(':scope > .stream-scene-row');
    if (row) {
      row.classList.toggle('stream-playback-focus', playbackId !== undefined && id === playbackId);
      row.classList.toggle('stream-edit-focus', editId !== undefined && id === editId);
    }
  }
}
