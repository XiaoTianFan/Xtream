import type { DirectorState, SceneId, StreamEnginePublicState } from '../../../shared/types';
import type { DisplayWorkspaceController } from '../patch/displayWorkspace';
import type { MixerPanelController } from '../patch/mixerPanel';
import { createButton } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { createSceneEditPane } from './sceneEdit/sceneEditPane';
import { createStreamTabBar } from './streamDom';
import type { BottomTab, DetailPane, StreamSurfaceOptions } from './streamTypes';

export type StreamBottomPaneContext = {
  bottomTab: BottomTab;
  detailPane: DetailPane | undefined;
  selectedEntity: SelectedEntity | undefined;
  currentState: DirectorState;
  streamState: StreamEnginePublicState;
  selectedSceneId: string | undefined;
  options: StreamSurfaceOptions;
  mixerPanel: MixerPanelController | undefined;
  displayWorkspace: DisplayWorkspaceController | undefined;
  mixerRenderSignature: string;
  displayRenderSignature: string;
  setBottomTab: (tab: BottomTab) => void;
  setDetailPane: (pane: DetailPane | undefined) => void;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  setMixerRenderSignature: (s: string) => void;
  setDisplayRenderSignature: (s: string) => void;
  requestRender: () => void;
  duplicateSelectedScene: (sceneId: SceneId) => void;
  removeSelectedScene: (sceneId: SceneId) => void;
};

export function createStreamBottomTabAction(ctx: StreamBottomPaneContext): HTMLButtonElement | undefined {
  if (ctx.bottomTab === 'mixer') {
    const add = createButton('Create Output', '', async () => {
      const output = await window.xtream.outputs.create();
      ctx.setDetailPane({ type: 'output', id: output.id, returnTab: 'mixer' });
      ctx.setSelectedEntity({ type: 'output', id: output.id });
      ctx.options.renderState(await window.xtream.director.getState());
    });
    decorateIconButton(add, 'Plus', 'Create output');
    return add;
  }
  if (ctx.bottomTab === 'displays') {
    const add = createButton('Add Display', '', async () => {
      const display = await window.xtream.displays.create({ layout: { type: 'single' } });
      ctx.setDetailPane({ type: 'display', id: display.id, returnTab: 'displays' });
      ctx.setSelectedEntity({ type: 'display', id: display.id });
      ctx.options.renderState(await window.xtream.director.getState());
    });
    decorateIconButton(add, 'Plus', 'Add display');
    return add;
  }
  return undefined;
}

export function renderStreamMixerPane(ctx: StreamBottomPaneContext, outputPanel: HTMLDivElement): HTMLElement {
  const signature = ctx.mixerPanel?.createRenderSignature(ctx.currentState) ?? '';
  if (ctx.mixerRenderSignature !== signature) {
    ctx.setMixerRenderSignature(signature);
    ctx.mixerPanel?.renderOutputs(ctx.currentState);
  }
  ctx.mixerPanel?.syncSelection(ctx.selectedEntity);
  ctx.mixerPanel?.syncOutputMeters(ctx.currentState);
  return outputPanel;
}

export function renderStreamDisplayPane(ctx: StreamBottomPaneContext, displayList: HTMLDivElement): HTMLElement {
  const signature = ctx.displayWorkspace?.createRenderSignature(ctx.currentState) ?? '';
  const displays = Object.values(ctx.currentState.displays);
  if (ctx.displayRenderSignature !== signature) {
    ctx.setDisplayRenderSignature(signature);
    ctx.displayWorkspace?.render(displays);
  } else {
    ctx.displayWorkspace?.syncCardSummaries(displays);
  }
  return displayList;
}

export function renderStreamBottomPane(
  panel: HTMLElement,
  ctx: StreamBottomPaneContext,
  outputPanel: HTMLDivElement,
  displayList: HTMLDivElement,
  detailOverlay: () => HTMLElement,
): void {
  if (ctx.detailPane) {
    panel.replaceChildren(detailOverlay());
    return;
  }
  const tabs = createStreamTabBar(
    'Stream bottom tabs',
    [
      ['scene', 'Scene Edit'],
      ['mixer', 'Audio Mixer'],
      ['displays', 'Display Windows Preview'],
    ],
    ctx.bottomTab,
    (next) => {
      ctx.setBottomTab(next);
      ctx.requestRender();
    },
  );
  const tabRow = document.createElement('div');
  tabRow.className = 'stream-tab-row';
  tabRow.append(tabs);
  const action = createStreamBottomTabAction(ctx);
  if (action) {
    tabRow.append(action);
  }
  const content = document.createElement('div');
  content.className = 'stream-bottom-content';
  if (ctx.bottomTab === 'scene') {
    content.append(
      createSceneEditPane({
        stream: ctx.streamState.stream,
        selectedSceneId: ctx.selectedSceneId,
        duplicateScene: ctx.duplicateSelectedScene,
        removeScene: ctx.removeSelectedScene,
        currentState: ctx.currentState,
      }),
    );
  } else if (ctx.bottomTab === 'mixer') {
    content.append(renderStreamMixerPane(ctx, outputPanel));
  } else {
    content.append(renderStreamDisplayPane(ctx, displayList));
  }
  panel.replaceChildren(tabRow, content);
}
