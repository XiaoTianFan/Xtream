import type {
  ControlProjectUiStreamState,
  DirectorState,
  OutputMeterReport,
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
} from '../../../shared/types';
import { syncPreviewElements } from '../patch/displayPreview';
import { createDisplayWorkspaceController, type DisplayWorkspaceController } from '../patch/displayWorkspace';
import { createEmbeddedAudioImportController } from '../patch/embeddedAudioImport';
import { createMediaPoolController, type MediaPoolController } from '../patch/mediaPool';
import { createMixerPanelController, type MixerPanelController } from '../patch/mixerPanel';
import { createAssetPreviewController, type AssetPreviewController } from '../patch/assetPreview';
import type { SelectedEntity } from '../shared/types';
import { elements } from '../shell/elements';
import { renderStreamBottomPane, type StreamBottomPaneContext } from './bottomPane';
import {
  applyStreamLayoutPrefs,
  createStreamLayoutController,
  mergeStreamLayoutFromSnapshot,
  readStreamLayoutPrefs,
} from './layoutPrefs';
import { scenesExplicitlyFollowing } from './listMode';
import {
  createStreamAssetPreviewElements,
  createStreamMediaPoolElements,
  createStreamShellLayout,
} from './shell';
import { createStreamDetailOverlay } from './streamDetailOverlay';
import { renderStreamHeader, syncStreamHeaderRuntime } from './streamHeader';
import type { SceneEditSelection, StreamSurfaceController, StreamSurfaceOptions, StreamSurfaceRefs } from './streamTypes';
import { renderStreamWorkspacePane, type StreamWorkspacePaneContext } from './workspacePane';

export type { StreamSurfaceController } from './streamTypes';

export function createStreamSurfaceController(options: StreamSurfaceOptions): StreamSurfaceController {
  let currentState: DirectorState | undefined;
  let streamState: StreamEnginePublicState | undefined;
  let selectedSceneId: SceneId | undefined;
  let mode: StreamWorkspacePaneContext['mode'] = 'list';
  let bottomTab: StreamBottomPaneContext['bottomTab'] = 'scene';
  let detailPane: StreamBottomPaneContext['detailPane'];
  let selectedEntity: SelectedEntity | undefined;
  let headerEditField: 'title' | 'note' | undefined;
  let mounted = false;
  let unsubscribeStreamState: (() => void) | undefined;
  let mediaPool: MediaPoolController | undefined;
  let assetPreview: AssetPreviewController | undefined;
  let mixerPanel: MixerPanelController | undefined;
  let displayWorkspace: DisplayWorkspaceController | undefined;
  let mixerRenderSignature = '';
  let displayRenderSignature = '';
  const expandedListSceneIds = new Set<SceneId>();
  let listDragSceneId: SceneId | undefined;
  let sceneEditSelection: SceneEditSelection = { kind: 'scene' };

  const refs: StreamSurfaceRefs = {};
  const layoutCtl = createStreamLayoutController(refs);

  const embeddedAudioImport = createEmbeddedAudioImportController({
    getState: () => currentState,
    getAudioExtractionFormat: () => currentState?.audioExtractionFormat,
    setSelectedEntity: (entity) => {
      selectedEntity = entity;
    },
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
  });

  function requireRef(name: string): HTMLElement {
    const ref = refs[name];
    if (!ref) {
      throw new Error(`Missing stream surface ref: ${name}`);
    }
    return ref;
  }

  function mount(): void {
    if (mounted) {
      return;
    }
    mounted = true;
    elements.surfacePanel.classList.add('stream-surface-panel');
    elements.surfacePanel.replaceChildren(refs.root ?? createShell());
    applyStreamLayoutPrefs(refs, readStreamLayoutPrefs());
    window.addEventListener('resize', layoutCtl.syncSplitterAria);
    layoutCtl.syncSplitterAria();
    unsubscribeStreamState = window.xtream.stream.onState((state) => {
      const previous = streamState;
      streamState = state;
      syncSelectedScene();
      if (canSyncRuntimeOnly(previous, state)) {
        syncRuntimeDom();
      } else {
        renderCurrent();
      }
    });
    void window.xtream.stream.getState().then((state) => {
      streamState = state;
      syncSelectedScene();
      renderCurrent();
    });
  }

  function unmount(): void {
    mediaPool?.dismissContextMenu();
    assetPreview?.cleanup();
    unsubscribeStreamState?.();
    unsubscribeStreamState = undefined;
    mounted = false;
    window.removeEventListener('resize', layoutCtl.syncSplitterAria);
    elements.surfacePanel.classList.remove('stream-surface-panel');
    refs.root?.remove();
  }

  function createRenderSignature(state: DirectorState): string {
    const signatureState = stripRuntimeMediaFromState(state);
    return JSON.stringify({
      stream: createStableStreamRenderModel(streamState),
      selectedSceneId,
      sceneEditSelection,
      mode,
      bottomTab,
      detailPane,
      headerEditField,
      mediaPool: mediaPool?.createRenderSignature(signatureState),
      director: {
        visuals: Object.values(signatureState.visuals).map((visual) => ({
          id: visual.id,
          label: visual.label,
          ready: visual.ready,
          durationSeconds: visual.durationSeconds,
          type: visual.type,
          kind: visual.kind,
          url: visual.kind === 'file' ? visual.url : undefined,
        })),
        audioSources: Object.values(signatureState.audioSources).map((source) => ({
          id: source.id,
          label: source.label,
          ready: source.ready,
          durationSeconds: source.durationSeconds,
          type: source.type,
        })),
        outputs: Object.values(state.outputs).map((output) => ({ ...output, meterDb: undefined, meterLanes: undefined })),
        displays: Object.values(state.displays).map((display) => ({ ...display, lastDriftSeconds: undefined })),
      },
    });
  }

  function createStableStreamRenderModel(state: StreamEnginePublicState | undefined): unknown {
    if (!state) {
      return undefined;
    }
    return {
      stream: state.stream,
      validationMessages: state.validationMessages,
      runtime: state.runtime ? createStableRuntimeRenderModel(state.runtime) : null,
    };
  }

  function createStableRuntimeRenderModel(runtime: NonNullable<StreamEnginePublicState['runtime']>): unknown {
    return {
      status: runtime.status,
      cursorSceneId: runtime.cursorSceneId,
      expectedDurationMs: runtime.expectedDurationMs,
      timelineNotice: runtime.timelineNotice,
      sceneStates: Object.fromEntries(
        Object.entries(runtime.sceneStates).map(([id, scene]) => [
          id,
          {
            status: scene.status,
            scheduledStartMs: scene.scheduledStartMs,
            startedAtStreamMs: scene.startedAtStreamMs,
            endedAtStreamMs: scene.endedAtStreamMs,
            error: scene.error,
          },
        ]),
      ),
      activeAudioSubCues: runtime.activeAudioSubCues?.map((cue) => ({
        sceneId: cue.sceneId,
        subCueId: cue.subCueId,
        outputId: cue.outputId,
        audioSourceId: cue.audioSourceId,
      })),
      activeVisualSubCues: runtime.activeVisualSubCues?.map((cue) => ({
        sceneId: cue.sceneId,
        subCueId: cue.subCueId,
        visualId: cue.visualId,
        target: cue.target,
      })),
    };
  }

  function stripRuntimeMediaFromState(state: DirectorState): DirectorState {
    const visualEntries = Object.entries(state.visuals).filter(([id]) => !isStreamRuntimeVisualId(id));
    const audioSourceEntries = Object.entries(state.audioSources).filter(([id]) => !isStreamRuntimeAudioSourceId(id));
    if (visualEntries.length === Object.keys(state.visuals).length && audioSourceEntries.length === Object.keys(state.audioSources).length) {
      return state;
    }
    return {
      ...state,
      visuals: Object.fromEntries(visualEntries),
      audioSources: Object.fromEntries(audioSourceEntries),
    };
  }

  function isStreamRuntimeVisualId(id: string): boolean {
    return id.startsWith('stream-visual:');
  }

  function isStreamRuntimeAudioSourceId(id: string): boolean {
    return id.startsWith('stream-audio:');
  }

  function render(state: DirectorState): void {
    currentState = state;
    if (!mounted) {
      mount();
    }
    syncSelectedScene();
    renderCurrent();
  }

  function renderCurrent(): void {
    if (!mounted || !currentState || !streamState) {
      return;
    }
    if (mixerPanel?.pruneSoloOutputIds(currentState)) {
      mixerRenderSignature = '';
    }
    const mediaState = stripRuntimeMediaFromState(currentState);
    renderHeader();
    mediaPool?.render(mediaState);
    mediaPool?.syncPoolSelectionHighlight(mediaState);
    assetPreview?.render(mediaState, selectedEntity);
    renderWorkspacePane();
    renderBottomPane();
    mixerPanel?.syncOutputMeters(currentState);
    void embeddedAudioImport.maybePromptEmbeddedAudioImport(currentState);
  }

  function canSyncRuntimeOnly(previous: StreamEnginePublicState | undefined, next: StreamEnginePublicState): boolean {
    if (!previous || !previous.runtime || !next.runtime) {
      return false;
    }
    return createNonVolatileStreamSignature(previous) === createNonVolatileStreamSignature(next);
  }

  function createNonVolatileStreamSignature(state: StreamEnginePublicState): string {
    return JSON.stringify(createStableStreamRenderModel(state));
  }

  function syncRuntimeDom(): void {
    if (!mounted || !currentState || !streamState) {
      return;
    }
    syncStreamHeaderRuntime(requireRef('header'), streamState.runtime, currentState);
    syncListRuntimeProgress(requireRef('workspace'), streamState);
  }

  function syncListRuntimeProgress(root: HTMLElement, state: StreamEnginePublicState): void {
    const runtime = state.runtime;
    if (!runtime) {
      return;
    }
    for (const wrap of root.querySelectorAll<HTMLElement>('[data-scene-id]')) {
      const sceneId = wrap.dataset.sceneId;
      if (!sceneId) {
        continue;
      }
      const runtimeState = runtime.sceneStates[sceneId];
      if (!runtimeState || runtimeState.status !== 'running') {
        continue;
      }
      const progress = runtimeState.progress;
      const bar = wrap.querySelector<HTMLElement>('.stream-scene-row-progress');
      if (!bar || progress === undefined || !Number.isFinite(progress)) {
        continue;
      }
      bar.style.setProperty('--stream-row-progress', `${Math.min(100, Math.max(0, progress * 100))}%`);
    }
  }

  function syncSelectedScene(): void {
    const stream = streamState?.stream;
    if (!stream) {
      selectedSceneId = undefined;
      sceneEditSelection = { kind: 'scene' };
      return;
    }
    if (!selectedSceneId || !stream.scenes[selectedSceneId]) {
      selectedSceneId = stream.sceneOrder.find((id) => !stream.scenes[id]?.disabled) ?? stream.sceneOrder[0];
      sceneEditSelection = { kind: 'scene' };
    }
    syncSceneEditSelection(stream);
  }

  function syncSceneEditSelection(stream: PersistedStreamConfig): void {
    if (sceneEditSelection.kind !== 'subcue') {
      return;
    }
    const sc = selectedSceneId ? stream.scenes[selectedSceneId] : undefined;
    if (!sc || sceneEditSelection.sceneId !== selectedSceneId || !sc.subCues[sceneEditSelection.subCueId]) {
      sceneEditSelection = { kind: 'scene' };
    }
  }

  function createShell(): HTMLElement {
    const shell = createStreamShellLayout(refs);
    const mediaPoolElements = createStreamMediaPoolElements(shell.media, refs);
    mediaPool = createMediaPoolController(mediaPoolElements, {
      getState: () => currentState,
      setSelectedEntity: (entity) => {
        selectedEntity = entity;
      },
      isSelected,
      clearSelectionIf,
      renderState: options.renderState,
      setShowStatus: options.setShowStatus,
      queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
      probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
      createEmbeddedAudioRepresentation: embeddedAudioImport.createEmbeddedAudioRepresentation,
      extractEmbeddedAudioFile: embeddedAudioImport.extractEmbeddedAudioFile,
    });
    mediaPool.install();
    assetPreview = createAssetPreviewController(createStreamAssetPreviewElements(shell.media, refs), {
      reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
    });
    mixerPanel = createMixerPanelController({ outputPanel: shell.outputPanel }, {
      getState: () => currentState,
      getAudioDevices: options.getAudioDevices,
      isSelected,
      selectEntity,
      renderState: options.renderState,
      syncTransportInputs: () => undefined,
      refreshDetails: () => renderCurrent(),
    });
    displayWorkspace = createDisplayWorkspaceController({ displayList: shell.displayList }, {
      getState: () => currentState,
      isSelected,
      selectEntity,
      clearSelectionIf,
      renderState: options.renderState,
    });
    layoutCtl.installSplitters(requireRef);
    return shell.root;
  }

  function renderHeader(): void {
    renderStreamHeader({
      headerEl: requireRef('header'),
      stream: streamState!.stream,
      runtime: streamState!.runtime,
      currentState,
      selectedSceneId,
      headerEditField,
      options,
      setHeaderEditField: (field) => {
        headerEditField = field;
      },
      updateSelectedScene,
      requestRender: renderCurrent,
    });
  }

  function renderWorkspacePane(): void {
    const panel = requireRef('workspace');
    const stream = streamState!.stream;
    const ctx: StreamWorkspacePaneContext = {
      streamState,
      selectedSceneId,
      getListDragSceneId: () => listDragSceneId,
      expandedListSceneIds,
      currentState,
      setSelectedSceneId: (id) => {
        selectedSceneId = id;
        sceneEditSelection = { kind: 'scene' };
      },
      setBottomTab: (tab) => {
        bottomTab = tab;
      },
      clearDetailPane: () => {
        detailPane = undefined;
      },
      setListDragSceneId: (id) => {
        listDragSceneId = id;
      },
      toggleExpandedScene: (id) => {
        if (expandedListSceneIds.has(id)) {
          expandedListSceneIds.delete(id);
        } else {
          expandedListSceneIds.add(id);
        }
      },
      applySceneReorder,
      requestRender: renderCurrent,
      mode,
      setMode: (m) => {
        mode = m;
      },
    };
    renderStreamWorkspacePane(panel, stream, ctx);
  }

  function applySceneReorder(draggedId: SceneId, insertBeforeId: SceneId | undefined): void {
    const stream = streamState?.stream;
    if (!stream || !stream.scenes[draggedId]) {
      return;
    }
    const followers = scenesExplicitlyFollowing(stream, draggedId);
    if (followers.length > 0) {
      const titles = followers.map((id) => stream.scenes[id]?.title ?? id).join(', ');
      const ok = window.confirm(
        `Other scenes reference this one as an explicit trigger predecessor: ${titles}. Reordering can make dependencies harder to read. Continue?`,
      );
      if (!ok) {
        return;
      }
    }
    const order = [...stream.sceneOrder];
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
    void window.xtream.stream.edit({ type: 'reorder-scenes', sceneOrder: order });
  }

  function renderBottomPane(): void {
    const panel = requireRef('bottom');
    const ctx: StreamBottomPaneContext = {
      bottomTab,
      detailPane,
      selectedEntity,
      currentState: currentState!,
      streamState: streamState!,
      selectedSceneId,
      options,
      mixerPanel,
      displayWorkspace,
      mixerRenderSignature,
      displayRenderSignature,
      setBottomTab: (tab) => {
        bottomTab = tab;
      },
      setDetailPane: (pane) => {
        detailPane = pane;
      },
      setSelectedEntity: (entity) => {
        selectedEntity = entity;
      },
      setMixerRenderSignature: (s) => {
        mixerRenderSignature = s;
      },
      setDisplayRenderSignature: (s) => {
        displayRenderSignature = s;
      },
      requestRender: renderCurrent,
      duplicateSelectedScene,
      removeSelectedScene,
      sceneEditSelection,
      setSceneEditSelection: (sel: SceneEditSelection) => {
        sceneEditSelection = sel;
      },
      getDirectorState: () => currentState,
      renderDirectorState: options.renderState,
    };
    renderStreamBottomPane(
      panel,
      ctx,
      requireRef('outputPanel') as HTMLDivElement,
      requireRef('displayList') as HTMLDivElement,
      () =>
        createStreamDetailOverlay({
          detailPane: detailPane!,
          currentState: currentState!,
          options,
          displayWorkspace,
          mixerPanel,
          setBottomTab: (t) => {
            bottomTab = t;
          },
          clearDetailPane: () => {
            detailPane = undefined;
          },
          requestRender: renderCurrent,
          refreshDirector,
        }),
    );
  }

  function updateSelectedScene(update: Partial<PersistedSceneConfig>): void {
    if (!selectedSceneId) {
      return;
    }
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: selectedSceneId, update });
  }

  function duplicateSelectedScene(sceneId: SceneId): void {
    void window.xtream.stream.edit({ type: 'duplicate-scene', sceneId }).then((state) => {
      const idx = state.stream.sceneOrder.indexOf(sceneId);
      selectedSceneId = state.stream.sceneOrder[idx + 1] ?? sceneId;
      sceneEditSelection = { kind: 'scene' };
    });
  }

  function removeSelectedScene(sceneId: SceneId): void {
    void window.xtream.stream.edit({ type: 'remove-scene', sceneId }).then((state) => {
      selectedSceneId = state.stream.sceneOrder[0];
      sceneEditSelection = { kind: 'scene' };
    });
  }

  async function refreshDirector(): Promise<void> {
    options.renderState(await window.xtream.director.getState());
  }

  function selectEntity(entity: SelectedEntity): void {
    selectedEntity = entity;
    if (entity.type === 'output') {
      detailPane = { type: 'output', id: entity.id, returnTab: 'mixer' };
      bottomTab = 'mixer';
    }
    if (entity.type === 'display') {
      detailPane = { type: 'display', id: entity.id, returnTab: 'displays' };
      bottomTab = 'displays';
    }
    renderCurrent();
  }

  function isSelected(type: SelectedEntity['type'], id: string): boolean {
    return selectedEntity?.type === type && selectedEntity.id === id;
  }

  function clearSelectionIf(entity: SelectedEntity): void {
    if (isSelected(entity.type, entity.id)) {
      selectedEntity = undefined;
      if (
        (entity.type === 'output' && detailPane?.type === 'output' && detailPane.id === entity.id) ||
        (entity.type === 'display' && detailPane?.type === 'display' && detailPane.id === entity.id)
      ) {
        bottomTab = detailPane.returnTab;
        detailPane = undefined;
      }
    }
  }

  function exportProjectUiSnapshot(): ControlProjectUiStreamState {
    return {
      mode,
      bottomTab,
      selectedSceneId,
      sceneEditSelection:
        sceneEditSelection.kind === 'subcue'
          ? { kind: 'subcue', subCueId: sceneEditSelection.subCueId }
          : { kind: 'scene' },
      expandedListSceneIds: [...expandedListSceneIds],
      layout: readStreamLayoutPrefs(),
      detailPane: detailPane
        ? {
            type: detailPane.type,
            id: detailPane.id,
            returnTab: detailPane.returnTab,
          }
        : undefined,
    };
  }

  function applyImportedProjectUi(
    snapshot: ControlProjectUiStreamState | undefined,
    directorState: DirectorState,
    streamPublic: StreamEnginePublicState,
  ): void {
    if (!snapshot) {
      return;
    }
    const streamCfg = streamPublic.stream;
    if (snapshot.mode === 'list' || snapshot.mode === 'flow') {
      mode = snapshot.mode;
    }
    if (snapshot.bottomTab === 'scene' || snapshot.bottomTab === 'mixer' || snapshot.bottomTab === 'displays') {
      bottomTab = snapshot.bottomTab;
    }
    if (snapshot.selectedSceneId && streamCfg.scenes[snapshot.selectedSceneId]) {
      selectedSceneId = snapshot.selectedSceneId;
    }
    sceneEditSelection = { kind: 'scene' };
    const seSnap = snapshot.sceneEditSelection;
    if (selectedSceneId && seSnap?.kind === 'subcue') {
      const sc = streamCfg.scenes[selectedSceneId];
      if (sc?.subCues[seSnap.subCueId]) {
        sceneEditSelection = { kind: 'subcue', sceneId: selectedSceneId, subCueId: seSnap.subCueId as SubCueId };
      }
    }
    expandedListSceneIds.clear();
    for (const sid of snapshot.expandedListSceneIds ?? []) {
      if (streamCfg.scenes[sid]) {
        expandedListSceneIds.add(sid);
      }
    }
    detailPane = undefined;
    if (snapshot.detailPane) {
      const d = snapshot.detailPane;
      if (d.type === 'display' && directorState.displays[d.id]) {
        detailPane = { type: 'display', id: d.id, returnTab: d.returnTab };
      } else if (d.type === 'output' && directorState.outputs[d.id]) {
        detailPane = { type: 'output', id: d.id, returnTab: d.returnTab };
      }
    }
    headerEditField = undefined;
    if (snapshot.layout && Object.keys(snapshot.layout).length > 0) {
      mergeStreamLayoutFromSnapshot(snapshot.layout);
      applyStreamLayoutPrefs(refs, readStreamLayoutPrefs());
      layoutCtl.syncSplitterAria();
    }
  }

  return {
    id: 'stream',
    mount,
    unmount,
    createRenderSignature,
    render,
    applyOutputMeterReport: (report: OutputMeterReport) => mixerPanel?.applyOutputMeterReport(report),
    syncPreviewElements: () => {
      if (currentState) {
        syncPreviewElements(currentState);
      }
    },
    exportProjectUiSnapshot,
    applyImportedProjectUi,
  };
}
