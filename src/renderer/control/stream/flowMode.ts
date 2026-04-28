import type { DirectorState, PersistedStreamConfig, SceneId } from '../../../shared/types';
import { formatSceneDuration, formatTriggerSummary } from './formatting';
import type { BottomTab } from './streamTypes';

export type StreamFlowModeContext = {
  selectedSceneId: SceneId | undefined;
  currentState: DirectorState | undefined;
  setSelectedSceneId: (id: SceneId | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
};

export function createStreamFlowMode(stream: PersistedStreamConfig, ctx: StreamFlowModeContext): HTMLElement {
  const flow = document.createElement('div');
  flow.className = 'stream-flow-canvas';
  stream.sceneOrder.forEach((sceneId, index) => {
    const scene = stream.scenes[sceneId];
    if (!scene) {
      return;
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `stream-flow-card ${sceneId === ctx.selectedSceneId ? 'selected' : ''}`;
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
      ctx.setSelectedSceneId(sceneId);
      ctx.setBottomTab('scene');
      ctx.clearDetailPane();
      ctx.requestRender();
    });
    flow.append(card);
  });
  return flow;
}
