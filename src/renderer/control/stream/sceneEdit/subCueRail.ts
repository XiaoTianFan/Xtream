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
  getDirectorState: () => DirectorState | undefined;
  renderDirectorState: (state: DirectorState) => void;
  requestRender: () => void;
};

export function createSubCueRail(deps: SubCueRailDeps): HTMLElement {
  const { stream, scene, currentState, sceneEditSelection, setSceneEditSelection, getDirectorState, renderDirectorState, requestRender } = deps;

  const rail = document.createElement('div');
  rail.className = 'stream-subcue-rail';

  const sceneBtn = document.createElement('button');
  sceneBtn.type = 'button';
  sceneBtn.className = `stream-section-pill ${sceneEditSelection.kind === 'scene' ? 'active' : ''}`;
  sceneBtn.textContent = scene.title ?? scene.id;
  sceneBtn.addEventListener('click', () => {
    setSceneEditSelection({ kind: 'scene' });
    requestRender();
  });
  rail.append(sceneBtn);

  for (let i = 0; i < scene.subCueOrder.length; i++) {
    const subCueId = scene.subCueOrder[i]!;
    const sub = scene.subCues[subCueId];
    if (!sub) {
      continue;
    }
    const row = document.createElement('div');
    row.className = 'stream-subcue-rail-row';

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = `stream-section-pill ${sceneEditSelection.kind === 'subcue' && sceneEditSelection.subCueId === subCueId ? 'active' : ''}`;
    labelBtn.textContent = formatSubCueLabel(currentState, sub);
    labelBtn.addEventListener('click', () => {
      setSceneEditSelection({ kind: 'subcue', sceneId: scene.id, subCueId });
      requestRender();
    });

    const reorder = document.createElement('div');
    reorder.className = 'stream-subcue-rail-reorder';
    const up = createButton('↑', 'secondary icon-button', () => moveSubCue(i, i - 1));
    up.title = 'Move up';
    up.setAttribute('aria-label', 'Move up');
    up.disabled = i === 0;
    const down = createButton('↓', 'secondary icon-button', () => moveSubCue(i, i + 1));
    down.title = 'Move down';
    down.setAttribute('aria-label', 'Move down');
    down.disabled = i >= scene.subCueOrder.length - 1;

    const removeBtn = createButton('', 'secondary icon-button', () => removeSubCue(subCueId));
    decorateIconButton(removeBtn, 'Trash2', 'Remove sub-cue');

    reorder.append(up, down, removeBtn);
    row.append(labelBtn, reorder);
    rail.append(row);
  }

  const addWrap = document.createElement('div');
  addWrap.className = 'stream-subcue-add';
  const addDetails = document.createElement('details');
  addDetails.className = 'stream-subcue-add-details';
  const addSummaryBtn = document.createElement('summary');
  addSummaryBtn.className = 'stream-section-pill phantom';
  addSummaryBtn.textContent = 'Add Sub-Cue';

  const menu = document.createElement('div');
  menu.className = 'stream-subcue-add-menu';
  menu.append(
    createButton('Audio', 'secondary', () => void addCue('audio')),
    createButton('Visual', 'secondary', () => void addCue('visual')),
    createButton('Control', 'secondary', () => void addCue('control')),
  );
  addDetails.append(addSummaryBtn, menu);
  addWrap.append(addDetails);
  rail.append(addWrap);

  function patchScene(update: Partial<PersistedSceneConfig>): Promise<StreamEnginePublicState> {
    return window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update });
  }

  function moveSubCue(from: number, to: number): void {
    if (to < 0 || to >= scene.subCueOrder.length) {
      return;
    }
    const order = [...scene.subCueOrder];
    const [item] = order.splice(from, 1);
    if (!item) {
      return;
    }
    order.splice(to, 0, item);
    void patchScene({ subCueOrder: order }).then(() => requestRender());
  }

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
