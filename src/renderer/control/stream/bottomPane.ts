import type { DirectorState, SceneId, StreamEnginePublicState, SubCueId } from '../../../shared/types';
import { getStreamAuthoringErrorHighlights, validateStreamContextFromDirector } from '../../../shared/streamSchedule';
import type { SceneEditSelection } from './streamTypes';
import type { DisplayWorkspaceController } from '../patch/displayWorkspace';
import type { MixerPanelController } from '../patch/mixerPanel';
import { createButton, createHint } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { createSceneEditPane } from './sceneEdit/sceneEditPane';
import { createStreamTabBar } from './streamDom';
import { isPanelInteractionActive } from '../app/interactionLocks';
import type { BottomTab, DetailPane, StreamSurfaceOptions } from './streamTypes';

export type StreamBottomPaneContext = {
  bottomTab: BottomTab;
  detailPane: DetailPane | undefined;
  selectedEntity: SelectedEntity | undefined;
  currentState: DirectorState;
  /** Stream-derived (or raw) state for display previews / display signatures. */
  presentationState: DirectorState;
  streamState: StreamEnginePublicState;
  selectedSceneId: string | undefined;
  options: StreamSurfaceOptions;
  mixerPanel: MixerPanelController | undefined;
  displayWorkspace: DisplayWorkspaceController | undefined;
  /** Stream shell output panel (for interaction lock while dragging faders). */
  streamOutputPanel: HTMLDivElement;
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
  sceneEditSelection: SceneEditSelection;
  setSceneEditSelection: (sel: SceneEditSelection) => void;
  isSelectedSceneRunning: () => boolean;
  getDirectorState: () => DirectorState | undefined;
  renderDirectorState: (state: DirectorState) => void;
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
  /** Lane topology for stream playback comes from `deriveDirectorStateForStream` (virtual `stream-audio:*` sources). Those entries are not in raw director state, so `createRenderSignature(currentState)` did not change when clone metadata / routing changed — `mixerRenderSignature` stayed stale and strips never rebuilt. Signature must include presentation state; strip DOM still uses `currentState` so routing controls reflect persisted outputs. */
  const signatureState = ctx.presentationState ?? ctx.currentState;
  const signature = ctx.mixerPanel?.createRenderSignature(signatureState) ?? '';
  if (ctx.mixerRenderSignature !== signature && !isPanelInteractionActive(ctx.streamOutputPanel)) {
    ctx.setMixerRenderSignature(signature);
    ctx.mixerPanel?.renderOutputs(ctx.currentState);
  }
  ctx.mixerPanel?.syncSelection(ctx.selectedEntity);
  ctx.mixerPanel?.syncOutputMeters(ctx.currentState);
  return outputPanel;
}

export function renderStreamDisplayPane(ctx: StreamBottomPaneContext, displayList: HTMLDivElement): HTMLElement {
  const signature = ctx.displayWorkspace?.createRenderSignature(ctx.presentationState) ?? '';
  const displays = Object.values(ctx.presentationState.displays);
  if (ctx.displayRenderSignature !== signature) {
    ctx.setDisplayRenderSignature(signature);
    ctx.displayWorkspace?.render(displays);
  } else {
    ctx.displayWorkspace?.syncCardSummaries(displays);
  }
  return displayList;
}

function createSceneEditContent(ctx: StreamBottomPaneContext): HTMLElement {
  const stream = ctx.streamState.stream;
  const sid = ctx.selectedSceneId;
  const scene = sid ? stream.scenes[sid] : undefined;
  const highlights = getStreamAuthoringErrorHighlights(
    stream,
    validateStreamContextFromDirector(ctx.currentState),
    ctx.streamState.playbackTimeline,
  );
  const authoringSceneHasError = sid ? highlights.scenesWithErrors.has(sid) : false;
  const authoringSubCueIdsWithError: ReadonlySet<SubCueId> | undefined =
    sid ? highlights.subCuesWithErrors.get(sid) : undefined;
  return scene
    ? createSceneEditPane({
        stream,
        scene,
        currentState: ctx.currentState,
        streamPublic: ctx.streamState,
        isSceneRunning: ctx.isSelectedSceneRunning(),
        sceneEditSelection: ctx.sceneEditSelection,
        setSceneEditSelection: ctx.setSceneEditSelection,
        getDirectorState: ctx.getDirectorState,
        renderDirectorState: ctx.renderDirectorState,
        requestRender: ctx.requestRender,
        duplicateScene: ctx.duplicateSelectedScene,
        removeScene: ctx.removeSelectedScene,
        authoringSceneHasError,
        authoringSubCueIdsWithError,
      })
    : createHint('No scene selected.');
}

export function syncStreamSceneEditPaneContent(panel: HTMLElement, ctx: StreamBottomPaneContext): boolean {
  if (ctx.detailPane || ctx.bottomTab !== 'scene') {
    return false;
  }
  const content = panel.querySelector<HTMLElement>('.stream-bottom-content');
  if (!content) {
    return false;
  }
  content.replaceChildren(createSceneEditContent(ctx));
  return true;
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
    content.append(createSceneEditContent(ctx));
  } else if (ctx.bottomTab === 'mixer') {
    content.append(renderStreamMixerPane(ctx, outputPanel));
  } else {
    content.append(renderStreamDisplayPane(ctx, displayList));
  }
  panel.replaceChildren(tabRow, content);
}
