import type {
  DirectorState,
  PersistedAudioSubCueConfig,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  PersistedVisualSubCueConfig,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
} from '../../../../shared/types';
import { createButton } from '../../shared/dom';
import { decorateIconButton } from '../../shared/icons';
import { formatSubCueLabel } from '../formatting';
import type { SceneEditSelection } from '../streamTypes';
import { resolveEmbeddedAudioSourceForVideo } from './embeddedVisualAudio';
import { buildDefaultAudioSubCue, buildDefaultControlSubCue, buildDefaultVisualSubCue } from './subCueDefaults';
import { createNewSubCueId } from './subCueIds';

export type SubCueRailDeps = {
  stream: PersistedStreamConfig;
  scene: PersistedSceneConfig;
  currentState: DirectorState;
  sceneEditSelection: SceneEditSelection;
  setSceneEditSelection: (sel: SceneEditSelection) => void;
  editsDisabled?: boolean;
  getDirectorState: () => DirectorState | undefined;
  renderDirectorState: (state: DirectorState) => void;
  requestRender: () => void;
  authoringSceneHasError?: boolean;
  authoringSubCueIdsWithError?: ReadonlySet<SubCueId>;
};

export function createSubCueRail(deps: SubCueRailDeps): HTMLElement {
  const {
    stream,
    scene,
    currentState,
    sceneEditSelection,
    setSceneEditSelection,
    editsDisabled = false,
    getDirectorState,
    renderDirectorState,
    requestRender,
    authoringSceneHasError = false,
    authoringSubCueIdsWithError,
  } = deps;

  const rail = document.createElement('div');
  rail.className = 'stream-subcue-rail';

  const dropLine = document.createElement('div');
  dropLine.className = 'stream-scene-drop-indicator';
  dropLine.setAttribute('aria-hidden', 'true');

  let draggingSubCueId: SubCueId | undefined;
  let dropIntent: { insertBeforeSubCueId: SubCueId | undefined } | null = null;

  function hideDropIndicator(): void {
    dropLine.hidden = true;
    dropIntent = null;
  }

  function finalizeDropIntent(): { insertBeforeSubCueId: SubCueId | undefined } | null {
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

  function syncIndicatorForRowDrag(event: DragEvent, rowEl: HTMLElement, hoveredSubCueId: SubCueId): void {
    if (!draggingSubCueId || draggingSubCueId === hoveredSubCueId) {
      hideDropIndicator();
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    const rect = rowEl.getBoundingClientRect();
    const beforeMid = event.clientY < rect.top + rect.height / 2;
    const order = scene.subCueOrder;
    const idx = order.indexOf(hoveredSubCueId);
    let insertBeforeSubCueId: SubCueId | undefined;
    if (beforeMid) {
      insertBeforeSubCueId = hoveredSubCueId;
    } else {
      insertBeforeSubCueId = idx < order.length - 1 ? order[idx + 1] : undefined;
    }
    dropIntent = { insertBeforeSubCueId };
    const lineY = beforeMid ? rect.top : rect.bottom;
    showDropLine(rect.left, lineY - 1.5, rect.width);
  }

  function patchScene(update: Partial<PersistedSceneConfig>): Promise<StreamEnginePublicState> {
    return window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update });
  }

  function applySubCueReorder(draggedId: SubCueId, insertBeforeId: SubCueId | undefined): void {
    const order = [...scene.subCueOrder];
    const from = order.indexOf(draggedId);
    if (from < 0) {
      return;
    }
    order.splice(from, 1);
    if (insertBeforeId === undefined) {
      order.push(draggedId);
    } else {
      const to = order.indexOf(insertBeforeId);
      if (to < 0) {
        return;
      }
      order.splice(to, 0, draggedId);
    }
    void patchScene({ subCueOrder: order }).then(() => requestRender());
  }

  const sceneBtn = document.createElement('button');
  sceneBtn.type = 'button';
  sceneBtn.className = `stream-section-pill ${sceneEditSelection.kind === 'scene' ? 'active' : ''}${
    authoringSceneHasError ? ' stream-section-pill--authoring-error' : ''
  }`;
  sceneBtn.textContent = scene.title ?? scene.id;
  sceneBtn.addEventListener('click', () => {
    setSceneEditSelection({ kind: 'scene' });
    requestRender();
  });
  const railHeader = document.createElement('div');
  railHeader.className = 'stream-subcue-rail-header';
  railHeader.append(sceneBtn);

  const listEl = document.createElement('div');
  listEl.className = 'stream-subcue-rail-list';

  for (const subCueId of scene.subCueOrder) {
    const sub = scene.subCues[subCueId];
    if (!sub) {
      continue;
    }
    const rowWrap = document.createElement('div');
    rowWrap.className = 'stream-subcue-rail-row-wrap';
    rowWrap.dataset.subCueId = subCueId;

    const row = document.createElement('div');
    row.className = 'stream-subcue-rail-row';
    row.draggable = !editsDisabled;

    const selected = sceneEditSelection.kind === 'subcue' && sceneEditSelection.subCueId === subCueId;
    const subAuthoringError = authoringSubCueIdsWithError?.has(subCueId) ?? false;
    const titleWrap = document.createElement('div');
    titleWrap.className = `stream-subcue-rail-title-wrap${selected ? ' active' : ''}${
      subAuthoringError ? ' stream-subcue-rail-title-wrap--authoring-error' : ''
    }`;

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'stream-subcue-rail-label';
    labelBtn.textContent = formatSubCueLabel(currentState, sub);
    labelBtn.addEventListener('click', () => {
      setSceneEditSelection({ kind: 'subcue', sceneId: scene.id, subCueId });
      requestRender();
    });

    const removeBtn = createButton('', 'secondary icon-button stream-subcue-rail-remove', () => removeSubCue(subCueId));
    decorateIconButton(removeBtn, 'Trash2', 'Remove sub-cue');
    removeBtn.disabled = editsDisabled;

    row.addEventListener('dragstart', (event) => {
      if (editsDisabled) {
        event.preventDefault();
        return;
      }
      const el = event.target as HTMLElement;
      if (el.closest('.stream-subcue-rail-remove')) {
        event.preventDefault();
        return;
      }
      hideDropIndicator();
      draggingSubCueId = subCueId;
      event.dataTransfer?.setData('text/plain', subCueId);
      event.dataTransfer!.effectAllowed = 'move';
      rowWrap.classList.add('drag-source');
    });
    row.addEventListener('dragend', () => {
      draggingSubCueId = undefined;
      rowWrap.classList.remove('drag-source');
      hideDropIndicator();
      requestRender();
    });

    rowWrap.addEventListener('dragover', (event) => {
      if (editsDisabled) {
        return;
      }
      syncIndicatorForRowDrag(event, row, subCueId);
    });
    rowWrap.addEventListener('drop', (event) => {
      if (editsDisabled) {
        return;
      }
      event.preventDefault();
      const dragged = event.dataTransfer?.getData('text/plain') as SubCueId | undefined;
      const intent = finalizeDropIntent();
      if (!dragged || !intent) {
        return;
      }
      applySubCueReorder(dragged, intent.insertBeforeSubCueId);
    });

    titleWrap.append(labelBtn, removeBtn);
    row.append(titleWrap);
    rowWrap.append(row);
    listEl.append(rowWrap);
  }

  const endDropTarget = document.createElement('div');
  endDropTarget.className = 'stream-subcue-rail-end-target';
  endDropTarget.setAttribute('aria-hidden', 'true');
  endDropTarget.addEventListener('dragover', (e) => {
    if (editsDisabled) {
      return;
    }
    if (!draggingSubCueId) {
      return;
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropIntent = { insertBeforeSubCueId: undefined };
    const lr = rail.getBoundingClientRect();
    const er = endDropTarget.getBoundingClientRect();
    showDropLine(lr.left, er.top - 1.5, lr.width);
  });
  endDropTarget.addEventListener('drop', (e) => {
    if (editsDisabled) {
      return;
    }
    e.preventDefault();
    const dragged = e.dataTransfer?.getData('text/plain') as SubCueId | undefined;
    const intent = finalizeDropIntent();
    if (!dragged || !intent) {
      return;
    }
    applySubCueReorder(dragged, intent.insertBeforeSubCueId);
  });

  const addWrap = document.createElement('div');
  addWrap.className = 'stream-subcue-add';
  const addDetails = document.createElement('details');
  addDetails.className = 'stream-subcue-add-details';
  const addSummaryBtn = document.createElement('summary');
  addSummaryBtn.className = 'stream-section-pill phantom stream-subcue-add-summary';
  addSummaryBtn.textContent = 'Add Sub-Cue';
  if (editsDisabled) {
    addSummaryBtn.setAttribute('aria-disabled', 'true');
  }

  const menu = document.createElement('div');
  menu.className = 'stream-subcue-add-menu';
  const addAudio = createButton('Audio', 'secondary', () => void addCue('audio'));
  const addVisual = createButton('Visual', 'secondary', () => void addCue('visual'));
  const addControl = createButton('Control', 'secondary', () => void addCue('control'));
  addAudio.disabled = editsDisabled;
  addVisual.disabled = editsDisabled;
  addControl.disabled = editsDisabled;
  menu.append(addAudio, addVisual, addControl);
  addDetails.append(addSummaryBtn, menu);
  addDetails.addEventListener('toggle', () => {
    if (editsDisabled && addDetails.open) {
      addDetails.open = false;
    }
  });
  addWrap.append(addDetails);

  listEl.append(addWrap, endDropTarget);
  rail.append(railHeader, listEl, dropLine);

  function removeSubCue(id: SubCueId): void {
    const order = scene.subCueOrder.filter((sid) => sid !== id);
    const subCues = { ...scene.subCues };
    delete subCues[id];
    if (sceneEditSelection.kind === 'subcue' && sceneEditSelection.subCueId === id) {
      setSceneEditSelection({ kind: 'scene' });
    }
    void patchScene({ subCueOrder: order, subCues }).then(() => requestRender());
  }

  async function addCue(kind: 'audio' | 'visual' | 'control'): Promise<void> {
    addDetails.open = false;
    const id = createNewSubCueId();
    const st = getDirectorState() ?? currentState;
    let subCue: PersistedSubCueConfig;
    if (kind === 'audio') {
      subCue = buildDefaultAudioSubCue(id, st);
    } else if (kind === 'visual') {
      subCue = buildDefaultVisualSubCue(id, st);
    } else {
      subCue = buildDefaultControlSubCue(stream, scene.id, id);
    }

    const nextOrder = [...scene.subCueOrder, id];
    const nextCues = { ...scene.subCues, [id]: subCue };
    const pub = await patchScene({ subCues: nextCues, subCueOrder: nextOrder });

    setSceneEditSelection({ kind: 'subcue', sceneId: scene.id, subCueId: id });
    requestRender();

    if (kind === 'visual' && subCue.kind === 'visual') {
      void maybeAppendEmbeddedAfter(pub, scene.id, id, subCue);
    }
  }

  async function maybeAppendEmbeddedAfter(
    pub: StreamEnginePublicState,
    sceneId: SceneId,
    visualCueId: SubCueId,
    visualSub: PersistedVisualSubCueConfig,
  ): Promise<void> {
    const aid = await resolveEmbeddedAudioSourceForVideo(visualSub.visualId, getDirectorState, renderDirectorState);
    if (!aid) {
      return;
    }
    const sc = pub.stream.scenes[sceneId];
    if (!sc?.subCues[visualCueId]) {
      return;
    }
    const st = getDirectorState();
    if (!st) {
      return;
    }
    const aSubId = createNewSubCueId();
    const audioSub: PersistedAudioSubCueConfig = {
      ...buildDefaultAudioSubCue(aSubId, st),
      audioSourceId: aid,
    };
    void window.xtream.stream
      .edit({
        type: 'update-scene',
        sceneId,
        update: {
          subCues: { ...sc.subCues, [aSubId]: audioSub },
          subCueOrder: [...sc.subCueOrder, aSubId],
        },
      })
      .then(() => requestRender());
  }

  return rail;
}
