import type { DirectorState, PersistedStreamConfig, SceneId } from '../../../../shared/types';
import { createHint } from '../../shared/dom';
import { formatSubCueLabel } from '../formatting';
import { createStreamSceneForm } from './sceneForm';

export type SceneEditPaneDeps = {
  stream: PersistedStreamConfig;
  selectedSceneId: SceneId | undefined;
  duplicateScene: (sceneId: SceneId) => void;
  removeScene: (sceneId: SceneId) => void;
  currentState: DirectorState | undefined;
};

function createSceneSectionButton(label: string, active: boolean, phantom = false): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-section-pill ${active ? 'active' : ''} ${phantom ? 'phantom' : ''}`;
  button.textContent = label;
  return button;
}

export function createSceneEditPane(deps: SceneEditPaneDeps): HTMLElement {
  const { stream, selectedSceneId, duplicateScene, removeScene, currentState } = deps;
  const scene = selectedSceneId ? stream.scenes[selectedSceneId] : undefined;
  const wrap = document.createElement('section');
  wrap.className = 'stream-scene-edit';
  if (!scene) {
    wrap.append(createHint('No scene selected.'));
    return wrap;
  }
  const rail = document.createElement('div');
  rail.className = 'stream-subcue-rail';
  rail.append(createSceneSectionButton(scene.title ?? scene.id, true));
  for (const subCueId of scene.subCueOrder) {
    const sub = scene.subCues[subCueId];
    if (sub) {
      rail.append(createSceneSectionButton(formatSubCueLabel(currentState, sub), false));
    }
  }
  rail.append(createSceneSectionButton('Add Sub-Cue', false, true));

  const detail = document.createElement('div');
  detail.className = 'stream-scene-edit-detail';
  detail.append(createStreamSceneForm({ stream, scene, duplicateScene, removeScene }));
  wrap.append(rail, detail);
  return wrap;
}
