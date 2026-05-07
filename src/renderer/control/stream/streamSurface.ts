import type {
  ControlProjectUiStreamState,
  DirectorState,
  OutputMeterReport,
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  StreamEnginePublicState,
  SubCueId,
  VirtualOutputId,
} from '../../../shared/types';
import { syncPreviewElements } from '../patch/displayPreview';
import { createDisplayWorkspaceController, type DisplayWorkspaceController } from '../patch/displayWorkspace';
import { createEmbeddedAudioImportController } from '../patch/embeddedAudioImport';
import { probeAudioMetadata } from '../app/mediaProber';
import type { MediaDetailSharedDeps } from '../patch/mediaDetailSharedForms';
import { createMediaPoolController, type MediaPoolController } from '../patch/mediaPool';
import { createMixerPanelController, type MixerPanelController } from '../patch/mixerPanel';
import type { SelectedEntity } from '../shared/types';
import { installInteractionLock, isPanelInteractionActive } from '../app/interactionLocks';
import { elements } from '../shell/elements';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { renderStreamBottomPane, syncStreamSceneEditPaneContent, type StreamBottomPaneContext } from './bottomPane';
import { shouldDeferStreamMixerBottomPaneRedraw } from './streamMixerBottomRedrawDefer';
import {
  applyStreamLayoutPrefs,
  createStreamLayoutController,
  mergeStreamLayoutFromSnapshot,
  readStreamLayoutPrefs,
  type StreamLayoutPrefs,
} from './layoutPrefs';
import { scenesExplicitlyFollowing } from './listMode';
import { createStreamMediaPoolElements, createStreamShellLayout } from './shell';
import { createStreamDetailOverlay } from './streamDetailOverlay';
import { createGlobalStreamPlayCommand, deriveStreamTransportUiState, renderStreamHeader, syncStreamHeaderRuntime } from './streamHeader';
import { syncStreamFlowModeRuntimeChrome } from './flowMode';
import { syncStreamGanttRuntimeChrome } from './ganttMode';
import { syncOutputBusGanttRuntimeChrome } from './outputBusGantt';
import type { SceneEditSelection, StreamSurfaceController, StreamSurfaceOptions, StreamSurfaceRefs } from './streamTypes';
import { renderStreamWorkspacePane, type StreamWorkspacePaneContext } from './workspacePane';
import { createStreamWorkspacePaneSignature } from './workspacePaneSignature';
import {
  createSceneEditRenderModel as createSceneEditRenderModelSignature,
  createStreamProjectUiSnapshot,
  createStreamSurfaceRenderSignature,
  createStructuralStreamRenderModel,
  isStreamRuntimeAudioSourceId,
  isStreamRuntimeVisualId,
  stripRuntimeMediaFromState,
} from './streamSurface/signatures';
import {
  syncListDragAppearance,
  syncListRuntimeChrome,
  syncWorkspaceSceneSelection,
} from './streamSurface/runtimeChrome';

export type { StreamSurfaceController } from './streamTypes';

export function createStreamSurfaceController(options: StreamSurfaceOptions): StreamSurfaceController {
  let currentState: DirectorState | undefined;
  let streamState: StreamEnginePublicState | undefined;
  let sceneEditSceneId: SceneId | undefined;
  let playbackFocusSceneId: SceneId | undefined;
  let mode: StreamWorkspacePaneContext['mode'] = 'list';
  let bottomTab: StreamBottomPaneContext['bottomTab'] = 'scene';
  let detailPane: StreamBottomPaneContext['detailPane'];
  let selectedEntity: SelectedEntity | undefined;
  let headerEditField: 'title' | 'note' | undefined;
  let mounted = false;
  let unsubscribeStreamState: (() => void) | undefined;
  let mediaPool: MediaPoolController | undefined;
  let streamDetailOverlayCleanup: (() => void) | undefined;
  let mixerPanel: MixerPanelController | undefined;
  let displayWorkspace: DisplayWorkspaceController | undefined;
  let bottomRenderSignature = '';
  let mixerRenderSignature = '';
  let displayRenderSignature = '';
  let headerRenderSignature = '';
  let lastWorkspacePaneSignature = '';
  const expandedListSceneIds = new Set<SceneId>();
  let listDragSceneId: SceneId | undefined;
  let sceneEditSelection: SceneEditSelection = { kind: 'scene' };

  const refs: StreamSurfaceRefs = {};
  const layoutCtl = createStreamLayoutController(refs);
  /** Timestamp (from performance.now()) until which scene-edit bottom pane rebuilds are deferred. */
  let bottomPaneInteractionGuardUntil = 0;

  const embeddedAudioImport = createEmbeddedAudioImportController({
    getState: () => currentState,
    getAudioExtractionFormat: () => currentState?.audioExtractionFormat,
    setSelectedEntity: (entity) => {
      selectedEntity = entity;
    },
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
  });

  async function confirmPoolRecordRemoval(label: string): Promise<boolean> {
    return shellShowConfirm(
      'Remove from media pool',
      `Remove "${label}" from the media pool?`,
      'This only removes the project record from the pool. It will not erase or delete the media file from disk.',
    );
  }

  function streamMediaDetailDeps(): MediaDetailSharedDeps {
    return {
      renderState: options.renderState,
      clearSelectionIf,
      confirmPoolRecordRemoval,
      queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
      probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
      reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
    };
  }

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
      applyStreamState(state);
    });
    void window.xtream.stream.getState().then((state) => {
      applyStreamState(state);
    });
  }

  function unmount(): void {
    mediaPool?.dismissContextMenu();
    mediaPool?.teardownVisualPreviews();
    streamDetailOverlayCleanup?.();
    streamDetailOverlayCleanup = undefined;
    unsubscribeStreamState?.();
    unsubscribeStreamState = undefined;
    mounted = false;
    window.removeEventListener('resize', layoutCtl.syncSplitterAria);
    elements.surfacePanel.classList.remove('stream-surface-panel');
    headerRenderSignature = '';
    lastWorkspacePaneSignature = '';
    refs.root?.remove();
  }

  function applyStoredTwinLayoutPrefs(prefs: StreamLayoutPrefs): void {
    if (!mounted) {
      return;
    }
    applyStreamLayoutPrefs(refs, prefs);
    layoutCtl.syncSplitterAria();
  }

  function createRenderSignature(state: DirectorState): string {
    return createStreamSurfaceRenderSignature({
      directorState: state,
      streamState,
      sceneEditSceneId,
      playbackFocusSceneId,
      sceneEditSelection,
      mode,
      bottomTab,
      detailPane,
      headerEditField,
      mediaPoolShellSignature: mediaPool?.createStreamSurfaceShellSignature(),
    });
  }

  function render(state: DirectorState): void {
    currentState = state;
    const latest = options.getLatestStreamState();
    if (latest && latest !== streamState) {
      streamState = latest;
    }
    if (!mounted) {
      mount();
    }
    // `surfaceRouter` calls `mount()` before `render()`, so `createShell()` runs while `currentState`
    // is still undefined and `applyEngineSoloOutputIds` cannot hydrate solo from the IPC cache.
    // Re-apply once director state exists on every stream render (no-op if solo already matches).
    mixerPanel?.applyEngineSoloOutputIds(options.getEngineSoloOutputIds());
    syncSelectedScene();
    renderCurrent();
  }

  function applyStreamState(state: StreamEnginePublicState): void {
    const previous = streamState;
    streamState = state;
    syncSelectedScene(previous);
    if (!mounted || !currentState) {
      return;
    }
    if (canSyncRuntimeOnly(previous, state) && lastWorkspacePaneSignature !== '') {
      syncRuntimeDom();
    } else {
      renderCurrent();
    }
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
    const nextWorkspaceSig = createStreamWorkspacePaneSignature({
      mode,
      stream: streamState.stream,
      expandedListSceneIds,
      directorState: mediaState,
      validationMessages: streamState.validationMessages,
      playbackTimelineStatus: streamState.playbackTimeline.status,
    });
    if (lastWorkspacePaneSignature !== nextWorkspaceSig) {
      renderWorkspacePane();
      lastWorkspacePaneSignature = nextWorkspaceSig;
    } else {
      const workspace = requireRef('workspace');
      syncWorkspaceSceneSelection(workspace, playbackFocusSceneId, sceneEditSceneId);
      syncListRuntimeChrome(workspace, streamState, currentState);
      syncStreamFlowModeRuntimeChrome(workspace, streamState, currentState, playbackFocusSceneId, sceneEditSceneId);
      syncListDragAppearance(workspace, listDragSceneId);
      syncStreamGanttRuntimeChrome(workspace, streamState);
    }
    renderBottomPaneIfNeeded();
    mixerPanel?.syncOutputMeters(currentState);
    void embeddedAudioImport.maybePromptEmbeddedAudioImport(currentState);
  }

  function canSyncRuntimeOnly(previous: StreamEnginePublicState | undefined, next: StreamEnginePublicState): boolean {
    if (!previous) {
      return false;
    }
    return createNonVolatileStreamSignature(previous) === createNonVolatileStreamSignature(next);
  }

  function createNonVolatileStreamSignature(state: StreamEnginePublicState): string {
    return JSON.stringify(createStructuralStreamRenderModel(state));
  }

  function syncRuntimeDom(): void {
    if (!mounted || !currentState || !streamState) {
      return;
    }
    syncStreamHeaderRuntime(requireRef('header'), streamState.runtime, streamState.playbackStream, streamState.playbackTimeline, playbackFocusSceneId, currentState);
    syncListRuntimeChrome(requireRef('workspace'), streamState, currentState);
    syncStreamFlowModeRuntimeChrome(requireRef('workspace'), streamState, currentState, playbackFocusSceneId, sceneEditSceneId);
    syncStreamGanttRuntimeChrome(requireRef('workspace'), streamState);
    syncOutputBusGanttRuntimeChrome(requireRef('bottom'), { streamState, directorState: currentState });
    syncWorkspaceSceneSelection(requireRef('workspace'), playbackFocusSceneId, sceneEditSceneId);
    syncSceneEditRunningLock();
  }

  /** Header, media pool highlight, workspace selection + list runtime chrome, meters — does not rebuild list/flow or bottom pane DOM. */
  function refreshWorkspaceChromeUi(streamPublicOverride?: StreamEnginePublicState): void {
    if (!mounted || !currentState || !streamState) {
      return;
    }
    const pub = streamPublicOverride ?? streamState;
    if (mixerPanel?.pruneSoloOutputIds(currentState)) {
      mixerRenderSignature = '';
    }
    const mediaState = stripRuntimeMediaFromState(currentState);
    renderHeader(pub);
    mediaPool?.syncPoolSelectionHighlight(mediaState);
    syncWorkspaceSceneSelection(requireRef('workspace'), playbackFocusSceneId, sceneEditSceneId);
    syncListRuntimeChrome(requireRef('workspace'), pub, currentState);
    syncStreamFlowModeRuntimeChrome(requireRef('workspace'), pub, currentState, playbackFocusSceneId, sceneEditSceneId);
    syncListDragAppearance(requireRef('workspace'), listDragSceneId);
    syncStreamGanttRuntimeChrome(requireRef('workspace'), pub);
    mixerPanel?.syncOutputMeters(currentState);
    void embeddedAudioImport.maybePromptEmbeddedAudioImport(currentState);
    syncSceneEditRunningLock();
  }

  /** Selection-only refresh: avoid media-pool, mixer, meter, and workspace rebuild paths. */
  function refreshSceneSelectionUi(): void {
    if (!mounted || !currentState || !streamState) {
      return;
    }
    renderHeader();
    syncWorkspaceSceneSelection(requireRef('workspace'), playbackFocusSceneId, sceneEditSceneId);
    syncBottomSceneEditorSelection();
    syncSceneEditRunningLock();
  }

  function syncSelectedScene(previousStreamState?: StreamEnginePublicState): void {
    const stream = streamState?.stream;
    if (!stream) {
      sceneEditSceneId = undefined;
      playbackFocusSceneId = undefined;
      sceneEditSelection = { kind: 'scene' };
      return;
    }
    const fallback = stream.sceneOrder.find((id) => !stream.scenes[id]?.disabled) ?? stream.sceneOrder[0];
    if (!sceneEditSceneId || !stream.scenes[sceneEditSceneId]) {
      sceneEditSceneId = fallback;
      sceneEditSelection = { kind: 'scene' };
    }
    syncSceneEditSelection(stream);

    const runtimeFocus = streamState?.runtime?.playbackFocusSceneId;
    const previousRuntimeFocus = previousStreamState?.runtime?.playbackFocusSceneId;
    if (
      runtimeFocus &&
      stream.scenes[runtimeFocus] &&
      (runtimeFocus !== previousRuntimeFocus || !playbackFocusSceneId || !stream.scenes[playbackFocusSceneId])
    ) {
      playbackFocusSceneId = runtimeFocus;
    } else if (!playbackFocusSceneId || !stream.scenes[playbackFocusSceneId]) {
      playbackFocusSceneId = sceneEditSceneId ?? fallback;
    }
  }

  function syncSceneEditSelection(stream: PersistedStreamConfig): void {
    if (sceneEditSelection.kind !== 'subcue') {
      return;
    }
    const sc = sceneEditSceneId ? stream.scenes[sceneEditSceneId] : undefined;
    if (!sc || sceneEditSelection.sceneId !== sceneEditSceneId || !sc.subCues[sceneEditSelection.subCueId]) {
      sceneEditSelection = { kind: 'scene' };
    }
  }

  function createShell(): HTMLElement {
    const shell = createStreamShellLayout(refs);
    const mediaPoolElements = createStreamMediaPoolElements(shell.media, refs);
    mediaPool = createMediaPoolController(mediaPoolElements, {
      getState: () => currentState,
      setSelectedEntity: (entity) => {
        if (!entity) {
          selectedEntity = undefined;
          renderCurrent();
          return;
        }
        selectEntity(entity);
      },
      isSelected,
      clearSelectionIf,
      renderState: options.renderState,
      setShowStatus: options.setShowStatus,
      queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
      probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
      probeAudioMetadata,
      createEmbeddedAudioRepresentation: embeddedAudioImport.createEmbeddedAudioRepresentation,
      extractEmbeddedAudioFile: embeddedAudioImport.extractEmbeddedAudioFile,
      getShowConfigPath: options.getShowConfigPath,
    });
    mediaPool.install();
    mixerPanel = createMixerPanelController({ outputPanel: shell.outputPanel }, {
      getState: () => currentState,
      getMeteringState: () => options.getPresentationState() ?? currentState,
      getAudioDevices: options.getAudioDevices,
      isSelected,
      selectEntity,
      clearSelectionIf,
      renderState: options.renderState,
      syncTransportInputs: () => undefined,
      refreshDetails: () => renderCurrent(),
    });
    displayWorkspace = createDisplayWorkspaceController({ displayList: shell.displayList }, {
      getState: () => options.getPresentationState() ?? currentState,
      isSelected,
      selectEntity,
      clearSelectionIf,
      renderState: options.renderState,
    });
    installInteractionLock(shell.outputPanel);
    shell.outputPanel.addEventListener('pointerup', () => {
      window.queueMicrotask(() => {
        if (!mounted || !currentState || !streamState) {
          return;
        }
        if (!isPanelInteractionActive(shell.outputPanel)) {
          bottomRenderSignature = '';
          renderBottomPaneIfNeeded();
        }
      });
    });
    // Guard the scene-edit bottom pane against rebuilds briefly after a pointer gesture.
    // This prevents the Loop toggle (and other buttons) from triggering a full form redraw
    // mid-click: the async IPC stream-state update arrives within the guard window and is
    // skipped; the form rebuilds once the panel is idle.
    // 30 ms is imperceptible to the user but safely outlasts a local IPC round-trip (~5–15 ms).
    installInteractionLock(shell.bottom);
    shell.bottom.addEventListener('pointerup', () => {
      bottomPaneInteractionGuardUntil = performance.now() + 30;
      window.setTimeout(() => {
        if (!mounted || !currentState || !streamState) {
          return;
        }
        // Flush any deferred redraw now that the guard has expired.
        if (bottomPaneInteractionGuardUntil <= performance.now()) {
          renderBottomPaneIfNeeded();
        }
      }, 60);
    });
    shell.bottom.addEventListener('pointercancel', () => {
      bottomPaneInteractionGuardUntil = 0;
    });
    layoutCtl.installSplitters(requireRef);
    return shell.root;
  }

  function createHeaderRenderSignature(pub: StreamEnginePublicState): string {
    const selectedScene = sceneEditSceneId ? pub.stream.scenes[sceneEditSceneId] : undefined;
    return JSON.stringify({
      sceneEditSceneId,
      playbackFocusSceneId,
      selectedSceneTitle: selectedScene?.title,
      selectedSceneNote: selectedScene?.note,
      headerEditField,
      runtimeTransport: pub.runtime
        ? {
            status: pub.runtime.status,
            cursorSceneId: pub.runtime.cursorSceneId,
            selectedSceneIdAtPause: pub.runtime.selectedSceneIdAtPause,
            playbackFocusSceneId: pub.runtime.playbackFocusSceneId,
          }
        : undefined,
      playbackTimeline: {
        status: pub.playbackTimeline.status,
        revision: pub.playbackTimeline.revision,
        expectedDurationMs: pub.playbackTimeline.expectedDurationMs,
        notice: pub.playbackTimeline.notice,
        mainSegments: pub.playbackTimeline.mainSegments?.map((segment) => ({
          threadId: segment.threadId,
          rootSceneId: segment.rootSceneId,
          startMs: segment.startMs,
          durationMs: segment.durationMs,
          endMs: segment.endMs,
        })),
        threads: pub.playbackTimeline.threadPlan?.threads.map((thread) => ({
          threadId: thread.threadId,
          rootSceneId: thread.rootSceneId,
          rootTriggerType: thread.rootTriggerType,
          durationMs: thread.durationMs,
          sceneIds: thread.sceneIds,
        })),
      },
      validationMessages: pub.validationMessages,
      playbackSettings: pub.playbackStream.playbackSettings,
      rate: currentState?.rate,
    });
  }

  function renderHeader(streamPublicOverride?: StreamEnginePublicState): void {
    const pub = streamPublicOverride ?? streamState!;
    const nextSignature = createHeaderRenderSignature(pub);
    if (headerRenderSignature === nextSignature) {
      syncStreamHeaderRuntime(requireRef('header'), pub.runtime, pub.playbackStream, pub.playbackTimeline, playbackFocusSceneId, currentState);
      return;
    }
    renderStreamHeader({
      headerEl: requireRef('header'),
      stream: pub.stream,
      playbackStream: pub.playbackStream,
      runtime: pub.runtime,
      playbackTimeline: pub.playbackTimeline,
      validationMessages: pub.validationMessages,
      currentState,
      sceneEditSceneId,
      playbackFocusSceneId,
      headerEditField,
      options,
      setHeaderEditField: (field) => {
        headerEditField = field;
      },
      updateSelectedScene,
      setPlaybackFocusSceneId: (id) => {
        playbackFocusSceneId = id as SceneId | undefined;
      },
      refreshChrome: refreshWorkspaceChromeUi,
      requestRender: renderCurrent,
    });
    headerRenderSignature = nextSignature;
  }

  function renderWorkspacePane(): void {
    const panel = requireRef('workspace');
    const stream = streamState!.stream;
    const ctx: StreamWorkspacePaneContext = {
      streamState,
      playbackFocusSceneId,
      sceneEditSceneId,
      getListDragSceneId: () => listDragSceneId,
      expandedListSceneIds,
      currentState,
      setSceneEditFocus: (id) => {
        sceneEditSceneId = id;
        sceneEditSelection = { kind: 'scene' };
        bottomRenderSignature = '';
      },
      setPlaybackAndEditFocus: (id) => {
        sceneEditSceneId = id;
        playbackFocusSceneId = id;
        sceneEditSelection = { kind: 'scene' };
        bottomRenderSignature = '';
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
      refreshSceneSelectionUi,
      mode,
      setMode: (m) => {
        if (mode === m) {
          return;
        }
        mode = m;
        lastWorkspacePaneSignature = '';
        renderCurrent();
      },
    };
    renderStreamWorkspacePane(panel, stream, ctx);
  }

  async function applySceneReorder(draggedId: SceneId, insertBeforeId: SceneId | undefined): Promise<void> {
    const stream = streamState?.stream;
    if (!stream || !stream.scenes[draggedId]) {
      return;
    }
    const followers = scenesExplicitlyFollowing(stream, draggedId);
    if (followers.length > 0) {
      const titles = followers.map((id) => stream.scenes[id]?.title ?? id).join(', ');
      if (
        !(await shellShowConfirm(
          'Reorder scenes?',
          `Other scenes reference this one as an explicit trigger predecessor: ${titles}. Reordering can make dependencies harder to read. Continue?`,
        ))
      ) {
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

  function createBottomPaneContext(): StreamBottomPaneContext {
    const presentation = options.getPresentationState() ?? currentState!;
    const streamOutputPanel = requireRef('outputPanel') as HTMLDivElement;
    return {
      bottomTab,
      detailPane,
      selectedEntity,
      currentState: currentState!,
      presentationState: presentation,
      streamOutputPanel,
      streamState: streamState!,
      selectedSceneId: sceneEditSceneId,
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
        bottomRenderSignature = '';
      },
      isSelectedSceneRunning,
      getDirectorState: () => currentState,
      renderDirectorState: options.renderState,
    };
  }

  function renderBottomPane(): void {
    streamDetailOverlayCleanup?.();
    streamDetailOverlayCleanup = undefined;
    const panel = requireRef('bottom');
    const ctx = createBottomPaneContext();
    renderStreamBottomPane(
      panel,
      ctx,
      ctx.streamOutputPanel,
      requireRef('displayList') as HTMLDivElement,
      () =>
        createStreamDetailOverlay({
          detailPane: detailPane!,
          currentState: currentState!,
          streamState,
          getDirectorState: () => currentState,
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
          mediaDetailDeps: streamMediaDetailDeps(),
          registerStreamDetailUnmount: (fn) => {
            streamDetailOverlayCleanup = fn;
          },
        }),
    );
  }

  function syncBottomSceneEditorSelection(): void {
    const panel = refs.bottom;
    if (!panel) {
      return;
    }
    const ctx = createBottomPaneContext();
    if (syncStreamSceneEditPaneContent(panel, ctx)) {
      bottomRenderSignature = createBottomRenderSignature();
      return;
    }
    renderBottomPane();
    bottomRenderSignature = createBottomRenderSignature();
  }

  function renderBottomPaneIfNeeded(): void {
    const signature = createBottomRenderSignature();
    if (bottomRenderSignature === signature) {
      syncSceneEditRunningLock();
      return;
    }
    const streamOutputPanel = refs.outputPanel;
    if (shouldDeferStreamMixerBottomPaneRedraw(
      detailPane,
      bottomTab,
      streamOutputPanel ?? undefined,
      isPanelInteractionActive,
      refs.bottom ?? undefined,
    )) {
      return;
    }
    // Also defer while a pointer gesture in the scene-edit bottom pane is still settling.
    if (bottomTab === 'scene' && bottomPaneInteractionGuardUntil > performance.now()) {
      return;
    }
    bottomRenderSignature = signature;
    renderBottomPane();
  }

  function createBottomRenderSignature(): string {
    const presentation = options.getPresentationState() ?? currentState!;
    const state = currentState!;
    const base = {
      bottomTab,
      detailPane,
      selectedEntity,
      sceneEditSceneId,
      sceneEditSelection,
      performanceMode: state.performanceMode,
      sceneEdit: bottomTab === 'scene' ? createSceneEditRenderModel() : undefined,
      mixer: bottomTab === 'mixer' ? mixerPanel?.createRenderSignature(options.getPresentationState() ?? state) : undefined,
      displays: bottomTab === 'displays' ? displayWorkspace?.createRenderSignature(presentation) : undefined,
    };
    const dp = detailPane;
    // Temp detail panes must include live director fields used by the form; otherwise the overlay
    // never rebuilds after refreshDirector() and toggles look broken (stale button labels / state).
    if (dp?.type === 'display') {
      const d = state.displays[dp.id];
      return JSON.stringify({
        ...base,
        detailDisplayLive: d
          ? {
              label: d.label,
              displayId: d.displayId,
              fullscreen: d.fullscreen,
              alwaysOnTop: d.alwaysOnTop,
              health: d.health,
              degradationReason: d.degradationReason,
              layout: d.layout,
              visualMingle: state.displayVisualMingle?.[dp.id],
            }
          : null,
      });
    }
    if (dp?.type === 'output') {
      const o = state.outputs[dp.id];
      return JSON.stringify({
        ...base,
        detailOutputLive: o
          ? {
              label: o.label,
              sinkId: o.sinkId,
              sinkLabel: o.sinkLabel,
              streamOutputGantt: createStructuralStreamRenderModel(streamState),
              streamOutputGanttAudioSources: Object.values(state.audioSources).map((source) => ({
                id: source.id,
                label: source.label,
                durationSeconds: source.durationSeconds,
              })),
              ready: o.ready,
              physicalRoutingAvailable: o.physicalRoutingAvailable,
              fallbackAccepted: o.fallbackAccepted,
              fallbackReason: o.fallbackReason,
              error: o.error,
              sources: o.sources.map((s) => ({
                id: s.id,
                audioSourceId: s.audioSourceId,
                levelDb: s.levelDb,
                pan: s.pan,
                muted: s.muted,
                solo: s.solo,
              })),
              busLevelDb: o.busLevelDb,
              pan: o.pan,
              muted: o.muted,
              outputDelaySeconds: o.outputDelaySeconds,
            }
          : null,
      });
    }
    return JSON.stringify(base);
  }

  function createSceneEditRenderModel(): unknown {
    return createSceneEditRenderModelSignature({
      streamState: streamState!,
      sceneEditSceneId,
      currentState,
      selectedSceneRunning: isSelectedSceneRunning(),
    });
  }

  function isSelectedSceneRunning(): boolean {
    if (!sceneEditSceneId) {
      return false;
    }
    return streamState?.runtime?.sceneStates[sceneEditSceneId]?.status === 'running';
  }

  function syncSceneEditRunningLock(): void {
    const bottom = refs.bottom;
    if (!bottom || bottomTab !== 'scene') {
      return;
    }
    const edit = bottom.querySelector<HTMLElement>('.stream-scene-edit');
    if (!edit) {
      return;
    }
    edit.classList.toggle('is-locked', isSelectedSceneRunning());
  }

  function updateSelectedScene(update: Partial<PersistedSceneConfig>): void {
    if (!sceneEditSceneId) {
      return;
    }
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: sceneEditSceneId, update });
  }

  function duplicateSelectedScene(sceneId: SceneId): void {
    void window.xtream.stream.edit({ type: 'duplicate-scene', sceneId }).then((state) => {
      const idx = state.stream.sceneOrder.indexOf(sceneId);
      const newId = state.stream.sceneOrder[idx + 1] ?? sceneId;
      sceneEditSceneId = newId;
      playbackFocusSceneId = newId;
      sceneEditSelection = { kind: 'scene' };
      bottomRenderSignature = '';
    });
  }

  function removeSelectedScene(sceneId: SceneId): void {
    const pub = streamState;
    if (!pub || pub.stream.sceneOrder.length <= 1) {
      return;
    }
    const scene = pub.stream.scenes[sceneId];
    if (!scene) {
      return;
    }
    const label = scene.title?.trim() || scene.id;
    void (async () => {
      if (!(await shellShowConfirm('Remove scene?', `Remove "${label}" from the stream?`))) {
        return;
      }
      void window.xtream.stream.edit({ type: 'remove-scene', sceneId }).then((next) => {
        const first = next.stream.sceneOrder[0];
        sceneEditSceneId = first;
        playbackFocusSceneId = first;
        sceneEditSelection = { kind: 'scene' };
        bottomRenderSignature = '';
      });
    })();
  }

  async function refreshDirector(): Promise<void> {
    options.renderState(await window.xtream.director.getState());
  }

  function selectEntity(entity: SelectedEntity): void {
    selectedEntity = entity;
    if (entity.type === 'output') {
      detailPane = { type: 'output', id: entity.id, returnTab: 'mixer' };
      bottomTab = 'mixer';
      bottomRenderSignature = '';
    }
    if (entity.type === 'display') {
      detailPane = { type: 'display', id: entity.id, returnTab: 'displays' };
      bottomTab = 'displays';
      bottomRenderSignature = '';
    }
    if (entity.type === 'visual') {
      detailPane = { type: 'visual', id: entity.id, returnTab: bottomTab };
      bottomRenderSignature = '';
    }
    if (entity.type === 'audio-source') {
      detailPane = { type: 'audio-source', id: entity.id, returnTab: bottomTab };
      bottomRenderSignature = '';
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
        (entity.type === 'display' && detailPane?.type === 'display' && detailPane.id === entity.id) ||
        (entity.type === 'visual' && detailPane?.type === 'visual' && detailPane.id === entity.id) ||
        (entity.type === 'audio-source' && detailPane?.type === 'audio-source' && detailPane.id === entity.id)
      ) {
        bottomTab = detailPane.returnTab;
        detailPane = undefined;
      }
    }
  }

  function exportProjectUiSnapshot(): ControlProjectUiStreamState {
    return createStreamProjectUiSnapshot({
      mode,
      bottomTab,
      selectedSceneId: sceneEditSceneId,
      sceneEditSelection,
      expandedListSceneIds,
      layout: readStreamLayoutPrefs(),
      detailPane,
    });
  }

  function applyImportedProjectUi(
    snapshot: ControlProjectUiStreamState | undefined,
    directorState: DirectorState,
    streamPublic: StreamEnginePublicState,
  ): void {
    streamState = streamPublic;
    syncSelectedScene();
    if (!snapshot) {
      if (mounted && currentState) {
        lastWorkspacePaneSignature = '';
        bottomRenderSignature = '';
        renderCurrent();
      }
      return;
    }
    const streamCfg = streamPublic.stream;
    if (snapshot.mode === 'list' || snapshot.mode === 'flow' || snapshot.mode === 'gantt') {
      mode = snapshot.mode;
    }
    if (snapshot.bottomTab === 'scene' || snapshot.bottomTab === 'mixer' || snapshot.bottomTab === 'displays') {
      bottomTab = snapshot.bottomTab;
    }
    if (snapshot.selectedSceneId && streamCfg.scenes[snapshot.selectedSceneId]) {
      sceneEditSceneId = snapshot.selectedSceneId;
    }
    sceneEditSelection = { kind: 'scene' };
    const seSnap = snapshot.sceneEditSelection;
    if (sceneEditSceneId && seSnap?.kind === 'subcue') {
      const sc = streamCfg.scenes[sceneEditSceneId];
      if (sc?.subCues[seSnap.subCueId]) {
        sceneEditSelection = { kind: 'subcue', sceneId: sceneEditSceneId, subCueId: seSnap.subCueId as SubCueId };
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
      } else if (d.type === 'visual' && directorState.visuals[d.id]) {
        detailPane = { type: 'visual', id: d.id, returnTab: d.returnTab };
      } else if (d.type === 'audio-source' && directorState.audioSources[d.id]) {
        detailPane = { type: 'audio-source', id: d.id, returnTab: d.returnTab };
      }
    }
    headerEditField = undefined;
    if (snapshot.layout && Object.keys(snapshot.layout).length > 0) {
      mergeStreamLayoutFromSnapshot(snapshot.layout);
      applyStreamLayoutPrefs(refs, readStreamLayoutPrefs());
      layoutCtl.syncSplitterAria();
    }
    const runtimeFocus = streamPublic.runtime?.playbackFocusSceneId;
    if (runtimeFocus && streamCfg.scenes[runtimeFocus]) {
      playbackFocusSceneId = runtimeFocus;
    } else if (!playbackFocusSceneId || !streamCfg.scenes[playbackFocusSceneId]) {
      playbackFocusSceneId =
        sceneEditSceneId ?? streamCfg.sceneOrder.find((id) => !streamCfg.scenes[id]?.disabled) ?? streamCfg.sceneOrder[0];
    }
    if (mounted && currentState) {
      lastWorkspacePaneSignature = '';
      bottomRenderSignature = '';
      renderCurrent();
    }
  }

  function tickMixerBallistics(): void {
    mixerPanel?.tickMeterBallistics(performance.now());
  }

  function syncReferenceFromTransport(next: StreamEnginePublicState): void {
    const cursorSceneId = next.runtime?.cursorSceneId;
    if (cursorSceneId && next.stream.scenes[cursorSceneId]) {
      playbackFocusSceneId = cursorSceneId;
      refreshWorkspaceChromeUi(next);
    }
  }

  function handleWorkspaceTransportKeydown(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }
    if (!currentState || !streamState) {
      return false;
    }
    const isToggleKey = event.code === 'Space' || event.key === 'Enter';
    const isBackspace = event.key === 'Backspace';
    if (!isToggleKey && !isBackspace) {
      return false;
    }
    if (event.code === 'Space' && event.repeat) {
      return false;
    }
    const transportState = deriveStreamTransportUiState({
      runtime: streamState.runtime,
      playbackTimeline: streamState.playbackTimeline,
      playbackFocusSceneId,
      playbackStream: streamState.playbackStream,
      isPatchTransportPlaying: currentState.paused === false,
    });
    if (isToggleKey) {
      const running = streamState.runtime?.status === 'running' || streamState.runtime?.status === 'preloading';
      if (running) {
        if (transportState.pauseDisabled) {
          return false;
        }
        void window.xtream.stream.transport({ type: 'pause' });
      } else {
        if (transportState.playDisabled) {
          return false;
        }
        void window.xtream.stream.transport(
          createGlobalStreamPlayCommand({
            runtime: streamState.runtime,
            playbackStream: streamState.playbackStream,
            playbackTimeline: streamState.playbackTimeline,
            playbackFocusSceneId,
          }),
        );
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (transportState.backDisabled) {
      return false;
    }
    void window.xtream.stream.transport({ type: 'back-to-first' }).then(syncReferenceFromTransport);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    id: 'stream',
    mount,
    unmount,
    createRenderSignature,
    render,
    applyOutputMeterReport: (report: OutputMeterReport) => mixerPanel?.applyOutputMeterReport(report),
    applyEngineSoloOutputIds: (outputIds: VirtualOutputId[]) => {
      mixerPanel?.applyEngineSoloOutputIds(outputIds);
    },
    tickMixerBallistics,
    syncPreviewElements: (presentation: DirectorState) => {
      syncPreviewElements(presentation);
    },
    exportProjectUiSnapshot,
    applyImportedProjectUi,
    applyStreamState,
    handleWorkspaceTransportKeydown,
    applyStoredTwinLayoutPrefs,
  };
}
