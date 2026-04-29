import type { DirectorState, PersistedStreamConfig, SceneId } from '../../../shared/types';
import { formatSceneDuration, formatTriggerSummary } from './formatting';
import { sceneWorkspaceFocusFlags } from './workspaceFocusModel';
import type { BottomTab } from './streamTypes';

export type StreamFlowModeContext = {
  playbackFocusSceneId: SceneId | undefined;
  sceneEditSceneId: SceneId | undefined;
  currentState: DirectorState | undefined;
  setSceneEditFocus: (id: SceneId | undefined) => void;
  setPlaybackAndEditFocus: (id: SceneId | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
  refreshSceneSelectionUi: () => void;
};

export function createStreamFlowMode(stream: PersistedStreamConfig, ctx: StreamFlowModeContext): HTMLElement {
  const flow = document.createElement('div');
  flow.className = 'stream-flow-canvas';
  stream.sceneOrder.forEach((sceneId, index) => {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      return;
    }
    const { playback: pbFlag, edit: ebFlag } = sceneWorkspaceFocusFlags(sceneId, ctx.playbackFocusSceneId, ctx.sceneEditSceneId);
    const pb = pbFlag ? ' stream-playback-focus' : '';
    const eb = ebFlag ? ' stream-edit-focus' : '';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `stream-flow-card${pb}${eb}`;
    card.dataset.sceneId = sceneId;
    card.style.left = `${scene.flow?.x ?? 32 + index * 220}px`;
    card.style.top = `${scene.flow?.y ?? 42 + (index % 2) * 110}px`;
    card.style.width = `${scene.flow?.width ?? 180}px`;
    card.style.height = `${scene.flow?.height ?? 88}px`;
    const number = document.createElement('span');
    number.className = 'stream-flow-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('strong');
    title.textContent = scene.title ?? `Scene ${index + 1}`;
    const meta = document.createElement('small');
    meta.textContent = `${formatTriggerSummary(stream, scene)} | ${formatSceneDuration(ctx.currentState, scene)}`;
    card.append(number, title, meta);
    card.addEventListener('click', () => {
      ctx.setSceneEditFocus(sceneId);
      ctx.setBottomTab('scene');
      ctx.clearDetailPane();
      ctx.refreshSceneSelectionUi();
    });
    flow.append(card);
  });
  return flow;
}
