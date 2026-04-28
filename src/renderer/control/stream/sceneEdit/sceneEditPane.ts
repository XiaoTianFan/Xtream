import type { DirectorState, PersistedStreamConfig, SceneId, StreamEnginePublicState } from '../../../../shared/types';
import { createHint } from '../../shared/dom';
import type { SceneEditSelection } from '../streamTypes';
import { createAudioSubCueForm } from './audioSubCueForm';
import { createControlSubCueForm } from './controlSubCueForm';
import { createStreamSceneForm } from './sceneForm';
import { createSubCueRail, type SubCueRailDeps } from './subCueRail';
import { createVisualSubCueForm } from './visualSubCueForm';

export type SceneEditPaneDeps = SubCueRailDeps & {
  streamPublic: StreamEnginePublicState;
  duplicateScene: (sceneId: SceneId) => void;
  removeScene: (sceneId: SceneId) => void;
};

export function createSceneEditPane(deps: SceneEditPaneDeps): HTMLElement {
  const {
    stream,
    scene,
    currentState,
    streamPublic,
    sceneEditSelection,
    setSceneEditSelection,
    duplicateScene,
    removeScene,
    getDirectorState,
    renderDirectorState,
    requestRender,
  } = deps;

  const wrap = document.createElement('section');
  wrap.className = 'stream-scene-edit';

  if (streamPublic.validationMessages.length > 0) {
    const vb = document.createElement('div');
    vb.className = 'stream-validation-banner hint';
    vb.textContent = streamPublic.validationMessages.slice(0, 6).join(' · ');
    wrap.append(vb);
  }

  const rail = createSubCueRail({
    stream,
    scene,
    currentState,
    sceneEditSelection,
    setSceneEditSelection,
    getDirectorState,
    renderDirectorState,
    requestRender,
  });

  const detail = document.createElement('div');
  detail.className = 'stream-scene-edit-detail';

  if (sceneEditSelection.kind === 'scene') {
    detail.append(createStreamSceneForm({ stream, scene, duplicateScene, removeScene }));
  } else {
    const sid = sceneEditSelection.subCueId;
    const sub = scene.subCues[sid];
    if (!sub) {
      detail.append(createHint('Sub-cue not found.'));
    } else if (sub.kind === 'audio') {
      detail.append(
        createAudioSubCueForm({
          sceneId: scene.id,
          subCueId: sid,
          sub,
          currentState,
          patchSubCue: (update) => {
            void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId: sid, update });
          },
        }),
      );
    } else if (sub.kind === 'visual') {
      detail.append(
        createVisualSubCueForm({
          sceneId: scene.id,
          subCueId: sid,
          sub,
          currentState,
          patchSubCue: (update) => {
            void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId: sid, update });
          },
        }),
      );
    } else {
      detail.append(
        createControlSubCueForm({
          stream,
          sceneId: scene.id,
          subCueId: sid,
          sub,
          currentState,
          patchSubCue: (update) => {
            void window.xtream.stream.edit({ type: 'update-subcue', sceneId: scene.id, subCueId: sid, update });
          },
        }),
      );
    }
  }

  wrap.append(rail, detail);
  return wrap;
}
