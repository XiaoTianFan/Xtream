import { formatTimecode } from '../../../shared/timeline';
import { resolveFollowsSceneId } from '../../../shared/streamSchedule';
import type {
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  OutputMeterReport,
  PersistedSceneConfig,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  SceneId,
  SceneLoopPolicy,
  SceneRuntimeState,
  SceneTrigger,
  StreamEnginePublicState,
  VirtualOutputState,
} from '../../../shared/types';
import type { SurfaceController } from '../app/surfaceRouter';
import type { ShowActions } from '../app/showActions';
import { createAssetPreviewController, type AssetPreviewController, type AssetPreviewElements } from '../patch/assetPreview';
import { syncPreviewElements } from '../patch/displayPreview';
import { createDisplayWorkspaceController, type DisplayWorkspaceController } from '../patch/displayWorkspace';
import { createEmbeddedAudioImportController } from '../patch/embeddedAudioImport';
import { createMediaPoolController, type MediaPoolController, type MediaPoolElements } from '../patch/mediaPool';
import { createMixerPanelController, type MixerPanelController } from '../patch/mixerPanel';
import { createButton, createHint, createSelect } from '../shared/dom';
import { createIcon, decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { elements } from '../shell/elements';

type StreamMode = 'list' | 'flow';
type BottomTab = 'scene' | 'mixer' | 'displays';
type DetailPane = { type: 'display'; id: string; returnTab: BottomTab } | { type: 'output'; id: string; returnTab: BottomTab };

type StreamSurfaceOptions = {
  getAudioDevices: () => MediaDeviceInfo[];
  getDisplayMonitors: () => DisplayMonitorInfo[];
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  showActions: ShowActions;
};

export type StreamSurfaceController = SurfaceController & {
  applyOutputMeterReport: (report: OutputMeterReport) => void;
  syncPreviewElements: () => void;
};

const STREAM_LAYOUT_PREF_KEY = 'xtream.control.stream.layout.v1';

export function createStreamSurfaceController(options: StreamSurfaceOptions): StreamSurfaceController {
  let currentState: DirectorState | undefined;
  let streamState: StreamEnginePublicState | undefined;
  let selectedSceneId: SceneId | undefined;
  let mode: StreamMode = 'list';
  let bottomTab: BottomTab = 'scene';
  let detailPane: DetailPane | undefined;
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

  const refs: Partial<Record<string, HTMLElement>> = {};
  const embeddedAudioImport = createEmbeddedAudioImportController({
    getState: () => currentState,
    getAudioExtractionFormat: () => currentState?.audioExtractionFormat,
    setSelectedEntity: (entity) => {
      selectedEntity = entity;
    },
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
  });

  function mount(): void {
    if (mounted) {
      return;
    }
    mounted = true;
    elements.surfacePanel.classList.add('stream-surface-panel');
    elements.surfacePanel.replaceChildren(refs.root ?? createShell());
    applyStreamLayoutPrefs(readStreamLayoutPrefs());
    window.addEventListener('resize', syncStreamSplitterAria);
    syncStreamSplitterAria();
    unsubscribeStreamState = window.xtream.stream.onState((state) => {
      streamState = state;
      syncSelectedScene();
      renderCurrent();
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
    window.removeEventListener('resize', syncStreamSplitterAria);
    elements.surfacePanel.classList.remove('stream-surface-panel');
    refs.root?.remove();
  }

  function createRenderSignature(state: DirectorState): string {
    return JSON.stringify({
      stream: streamState,
      selectedSceneId,
      mode,
      bottomTab,
      detailPane,
      headerEditField,
      mediaPool: mediaPool?.createRenderSignature(state, selectedEntity),
      director: {
        visuals: Object.values(state.visuals).map((visual) => ({
          id: visual.id,
          label: visual.label,
          ready: visual.ready,
          durationSeconds: visual.durationSeconds,
          type: visual.type,
          kind: visual.kind,
          url: visual.kind === 'file' ? visual.url : undefined,
        })),
        audioSources: Object.values(state.audioSources).map((source) => ({
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
    renderHeader();
    mediaPool?.render(currentState);
    assetPreview?.render(currentState, selectedEntity);
    renderWorkspacePane();
    renderBottomPane();
    mixerPanel?.syncOutputMeters(currentState);
    void embeddedAudioImport.maybePromptEmbeddedAudioImport(currentState);
  }

  function syncSelectedScene(): void {
    const stream = streamState?.stream;
    if (!stream) {
      selectedSceneId = undefined;
      return;
    }
    if (!selectedSceneId || !stream.scenes[selectedSceneId]) {
      selectedSceneId = stream.sceneOrder.find((id) => !stream.scenes[id]?.disabled) ?? stream.sceneOrder[0];
    }
  }

  function createShell(): HTMLElement {
    const root = document.createElement('section');
    root.className = 'stream-surface';
    refs.root = root;

    const header = document.createElement('header');
    header.className = 'stream-header';
    refs.header = header;

    const middle = document.createElement('section');
    middle.className = 'stream-middle';
    const media = document.createElement('section');
    media.className = 'panel media-pool stream-media-pool';
    refs.media = media;
    const mediaPoolElements = createStreamMediaPoolElements(media);
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
    assetPreview = createAssetPreviewController(createStreamAssetPreviewElements(media), {
      reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
    });
    const middleSplitter = createSplitter('streamMiddleSplitter', 'vertical', 'Resize media and stream panes');
    const workspace = document.createElement('section');
    workspace.className = 'panel stream-workspace-pane';
    refs.workspace = workspace;
    middle.append(media, middleSplitter, workspace);

    const bottomSplitter = createSplitter('streamBottomSplitter', 'horizontal', 'Resize stream workspace and bottom pane');
    const bottom = document.createElement('section');
    bottom.className = 'panel stream-bottom-pane';
    refs.bottom = bottom;
    const outputPanel = document.createElement('div');
    outputPanel.className = 'output-panel stream-output-panel';
    refs.outputPanel = outputPanel;
    const displayList = document.createElement('div');
    displayList.className = 'display-list stream-display-list';
    refs.displayList = displayList;
    mixerPanel = createMixerPanelController({ outputPanel }, {
      getState: () => currentState,
      getAudioDevices: options.getAudioDevices,
      isSelected,
      selectEntity,
      renderState: options.renderState,
      syncTransportInputs: () => undefined,
      refreshDetails: () => renderCurrent(),
    });
    displayWorkspace = createDisplayWorkspaceController({ displayList }, {
      getState: () => currentState,
      isSelected,
      selectEntity,
      clearSelectionIf,
      renderState: options.renderState,
    });

    root.append(header, middle, bottomSplitter, bottom);
    installSplitters();
    return root;
  }

  function createStreamMediaPoolElements(panel: HTMLElement): MediaPoolElements {
    const header = document.createElement('div');
    header.className = 'panel-header';
    const heading = document.createElement('h2');
    heading.textContent = 'Media Pool';
    const addVisualsButton = createButton('Add Media', '', () => undefined);
    decorateIconButton(addVisualsButton, 'Plus', 'Add visuals');
    header.append(heading, addVisualsButton);

    const main = document.createElement('div');
    main.className = 'media-pool-main';
    const tabs = document.createElement('div');
    tabs.className = 'pool-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Media pool tabs');
    const visualTabButton = createPoolTabButton('Visuals', true);
    const audioTabButton = createPoolTabButton('Audio', false);
    tabs.append(visualTabButton, audioTabButton);

    const toolbar = document.createElement('div');
    toolbar.className = 'pool-toolbar';
    const searchLabel = document.createElement('label');
    const searchText = document.createElement('span');
    searchText.className = 'sr-only';
    searchText.textContent = 'Search media pool';
    const poolSearchInput = document.createElement('input');
    poolSearchInput.type = 'search';
    poolSearchInput.placeholder = 'Search media';
    searchLabel.append(searchText, poolSearchInput);
    const poolSortSelect = document.createElement('select');
    poolSortSelect.setAttribute('aria-label', 'Sort media pool');
    for (const [value, label] of [
      ['label', 'Label'],
      ['duration', 'Duration'],
      ['status', 'Status'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      poolSortSelect.append(option);
    }
    toolbar.append(searchLabel, poolSortSelect);

    const mediaListRegion = document.createElement('div');
    mediaListRegion.className = 'media-list-region drop-target';
    const visualList = document.createElement('div');
    visualList.className = 'visual-list';
    const audioPanel = document.createElement('div');
    audioPanel.className = 'audio-panel';
    mediaListRegion.append(visualList, audioPanel);
    main.append(tabs, toolbar, mediaListRegion);
    panel.replaceChildren(header, main);
    return {
      mediaPoolPanel: panel,
      visualList,
      audioPanel,
      visualTabButton,
      audioTabButton,
      poolSearchInput,
      poolSortSelect,
      addVisualsButton,
    };
  }

  function createStreamAssetPreviewElements(panel: HTMLElement): AssetPreviewElements {
    const assetPreviewRegion = document.createElement('div');
    assetPreviewRegion.className = 'asset-preview-region';
    assetPreviewRegion.hidden = true;
    const assetPreviewSplitter = createSplitter('streamAssetPreviewSplitter', 'horizontal', 'Resize asset preview');
    const assetPreview = document.createElement('div');
    assetPreview.className = 'asset-preview';
    assetPreview.setAttribute('aria-live', 'polite');
    assetPreviewRegion.append(assetPreviewSplitter, assetPreview);
    panel.append(assetPreviewRegion);
    refs.assetPreviewRegion = assetPreviewRegion;
    refs.assetPreview = assetPreview;
    return {
      assetPreviewRegion,
      assetPreview,
    };
  }

  function createPoolTabButton(label: string, active: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pool-tab ${active ? 'active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.textContent = label;
    return button;
  }

  function createSplitter(id: string, orientation: 'horizontal' | 'vertical', label: string): HTMLElement {
    const splitter = document.createElement('div');
    splitter.id = id;
    splitter.className = `splitter ${orientation}`;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', orientation);
    splitter.setAttribute('aria-label', label);
    splitter.tabIndex = 0;
    refs[id] = splitter;
    return splitter;
  }

  function renderHeader(): void {
    const header = requireRef('header');
    const stream = streamState!.stream;
    const runtime = streamState!.runtime;
    const selectedScene = selectedSceneId ? stream.scenes[selectedSceneId] : undefined;
    const currentMs = runtime?.originWallTimeMs && runtime.status === 'running' ? Date.now() - runtime.originWallTimeMs : 0;

    const timecode = document.createElement('div');
    timecode.className = 'timecode stream-timecode';
    timecode.textContent = formatTimecode(currentMs / 1000);

    const transport = document.createElement('div');
    transport.className = 'stream-transport transport-cluster';
    const back = createButton('Back to first', 'secondary', () => void window.xtream.stream.transport({ type: 'back-to-first' }));
    decorateIconButton(back, 'SkipBack', 'Back to first scene');
    const go = createButton('Go', '', () => void window.xtream.stream.transport({ type: 'go', sceneId: selectedSceneId }));
    decorateIconButton(go, 'Play', 'Go from selected scene');
    go.disabled = !selectedSceneId || !currentState?.paused;
    const pause = createButton('Pause', 'secondary', () => void window.xtream.stream.transport({ type: runtime?.status === 'paused' ? 'resume' : 'pause' }));
    decorateIconButton(pause, runtime?.status === 'paused' ? 'Play' : 'Pause', runtime?.status === 'paused' ? 'Resume stream' : 'Pause stream');
    pause.disabled = runtime?.status !== 'running' && runtime?.status !== 'paused';
    const next = createButton('Next', 'secondary', () => void window.xtream.stream.transport({ type: 'jump-next' }));
    decorateIconButton(next, 'SkipForward', 'Jump to next scene');
    next.disabled = runtime?.status !== 'running' && runtime?.status !== 'paused';
    transport.append(back, go, pause, next);

    const titleStack = document.createElement('div');
    titleStack.className = 'stream-scene-title-stack';
    titleStack.append(
      createHeaderEditableText({
        field: 'title',
        value: selectedScene?.title ?? '',
        fallback: selectedSceneId ?? 'No scene',
        className: 'stream-title-label',
        ariaLabel: 'Scene title',
        disabled: !selectedScene,
        onCommit: (value) => updateSelectedScene({ title: value || undefined }),
      }),
      createHeaderEditableText({
        field: 'note',
        value: selectedScene?.note ?? '',
        fallback: 'Scene note',
        className: 'stream-note-label',
        ariaLabel: 'Scene note',
        disabled: !selectedScene,
        onCommit: (value) => updateSelectedScene({ note: value || undefined }),
      }),
    );

    const actions = document.createElement('div');
    actions.className = 'stream-show-actions utility-cluster';
    const save = createButton('Save', '', () => void options.showActions.saveShow());
    decorateIconButton(save, 'Save', 'Save show');
    const saveAs = createButton('Save As', '', () => void options.showActions.saveShowAs());
    decorateIconButton(saveAs, 'FileJson', 'Save show as');
    const open = createButton('Open', '', () => void options.showActions.openShow());
    decorateIconButton(open, 'FolderOpen', 'Open show');
    const create = createButton('New', '', () => void options.showActions.createShow());
    decorateIconButton(create, 'Plus', 'Create new show');
    actions.append(save, saveAs, open, create);

    header.replaceChildren(timecode, transport, titleStack, actions);
  }

  function createHeaderEditableText({
    field,
    value,
    fallback,
    className,
    ariaLabel,
    disabled,
    onCommit,
  }: {
    field: 'title' | 'note';
    value: string;
    fallback: string;
    className: string;
    ariaLabel: string;
    disabled: boolean;
    onCommit: (value: string) => void;
  }): HTMLElement {
    if (headerEditField === field && !disabled) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = `stream-header-inline-input ${className}`;
      input.value = value;
      input.placeholder = fallback;
      input.setAttribute('aria-label', ariaLabel);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      let finishing = false;
      const finish = (commit: boolean) => {
        if (finishing) {
          return;
        }
        finishing = true;
        const next = input.value.trim();
        headerEditField = undefined;
        if (commit && next !== value.trim()) {
          onCommit(next);
        }
        renderCurrent();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      return input;
    }

    const label = document.createElement('div');
    label.className = `${className} stream-header-editable${disabled ? ' disabled' : ''}${value ? '' : ' empty'}`;
    label.textContent = value || fallback;
    label.setAttribute('aria-label', ariaLabel);
    if (!disabled) {
      label.tabIndex = 0;
      label.title = `Double-click to edit ${field}`;
      label.addEventListener('dblclick', () => {
        headerEditField = field;
        renderCurrent();
      });
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          headerEditField = field;
          renderCurrent();
        }
      });
    }
    return label;
  }

  function renderWorkspacePane(): void {
    const panel = requireRef('workspace');
    const stream = streamState!.stream;
    const tabs = createTabBar(
      'Stream modes',
      [
        ['list', 'List'],
        ['flow', 'Flow'],
      ],
      mode,
      (next) => {
        mode = next as StreamMode;
        renderCurrent();
      },
    );
    const content = document.createElement('div');
    content.className = 'stream-workspace-content';
    content.append(mode === 'list' ? createListMode(stream) : createFlowMode());
    panel.replaceChildren(tabs, content);
  }

  function createListMode(stream: PersistedStreamConfig): HTMLElement {
    const root = document.createElement('div');
    root.className = 'stream-scene-list-root';
    const toolbar = document.createElement('div');
    toolbar.className = 'stream-scene-list-toolbar';
    const addScene = createButton('Add scene', 'secondary', () => {
      void window.xtream.stream.edit({ type: 'create-scene', afterSceneId: selectedSceneId }).then((s) => {
        const idx = selectedSceneId ? s.stream.sceneOrder.indexOf(selectedSceneId) : -1;
        const newId = idx >= 0 ? s.stream.sceneOrder[idx + 1] : s.stream.sceneOrder[s.stream.sceneOrder.length - 1];
        if (newId) {
          selectedSceneId = newId;
        }
        renderCurrent();
      });
    });
    decorateIconButton(addScene, 'Plus', 'Add scene after selected row');
    toolbar.append(addScene);

    const list = document.createElement('div');
    list.className = 'stream-scene-list';
    const header = document.createElement('div');
    header.className = 'stream-scene-row stream-scene-row--header';
    header.append(
      createCell('', 'stream-list-col-expand'),
      createCell('', 'stream-list-col-drag'),
      createCell('#', 'stream-list-col-num'),
      createCell('Title', 'stream-list-col-title'),
      createCell('Trigger', 'stream-list-col-trigger'),
      createCell('Duration', 'stream-list-col-duration'),
      createCell('State', 'stream-list-col-state'),
      createCell('', 'stream-list-col-actions'),
    );
    list.append(header);
    const scenes = stream.sceneOrder.map((id) => stream.scenes[id]).filter(Boolean) as PersistedSceneConfig[];
    scenes.forEach((scene, index) => list.append(createSceneRowWrap(stream, scene, index + 1)));

    const endDrop = document.createElement('div');
    endDrop.className = 'stream-scene-list-end-drop';
    endDrop.textContent = 'Drop here to move to end';
    endDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      endDrop.classList.add('drag-hover');
    });
    endDrop.addEventListener('dragleave', () => endDrop.classList.remove('drag-hover'));
    endDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      endDrop.classList.remove('drag-hover');
      const dragged = e.dataTransfer?.getData('text/plain') as SceneId | undefined;
      if (dragged) {
        applySceneReorder(dragged, undefined);
      }
    });

    root.append(toolbar, list, endDrop);
    return root;
  }

  function scenesExplicitlyFollowing(predecessorId: SceneId): SceneId[] {
    const stream = streamState?.stream;
    if (!stream) {
      return [];
    }
    const out: SceneId[] = [];
    for (const sid of stream.sceneOrder) {
      const sc = stream.scenes[sid];
      if (!sc) {
        continue;
      }
      const tr = sc.trigger;
      if (tr.type !== 'simultaneous-start' && tr.type !== 'follow-end' && tr.type !== 'time-offset') {
        continue;
      }
      if (tr.followsSceneId === predecessorId) {
        out.push(sid);
      }
    }
    return out;
  }

  function applySceneReorder(draggedId: SceneId, insertBeforeId: SceneId | undefined): void {
    const stream = streamState?.stream;
    if (!stream || !stream.scenes[draggedId]) {
      return;
    }
    const followers = scenesExplicitlyFollowing(draggedId);
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

  function createSceneRowWrap(stream: PersistedStreamConfig, scene: PersistedSceneConfig, number: number): HTMLElement {
    const runtimeState = streamState?.runtime?.sceneStates[scene.id];
    const statusClass = runtimeState?.status ?? (scene.disabled ? 'disabled' : 'ready');
    const wrap = document.createElement('div');
    wrap.className = `stream-scene-row-wrap status-${statusClass}${scene.id === selectedSceneId ? ' focused' : ''}`;
    wrap.dataset.sceneId = scene.id;

    const row = document.createElement('div');
    row.className = `stream-scene-row ${scene.id === selectedSceneId ? 'selected' : ''} ${statusClass}${listDragSceneId === scene.id ? ' dragging' : ''}`;
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button, [draggable="true"]')) {
        return;
      }
      selectedSceneId = scene.id;
      bottomTab = 'scene';
      detailPane = undefined;
      renderCurrent();
    });

    const expanded = expandedListSceneIds.has(scene.id);
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'stream-scene-expand';
    expandBtn.setAttribute('aria-expanded', String(expanded));
    expandBtn.setAttribute('aria-label', expanded ? 'Collapse sub-cues' : 'Expand sub-cues');
    decorateIconButton(expandBtn, expanded ? 'ChevronDown' : 'ChevronRight', expanded ? 'Collapse' : 'Expand');
    expandBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (expandedListSceneIds.has(scene.id)) {
        expandedListSceneIds.delete(scene.id);
      } else {
        expandedListSceneIds.add(scene.id);
      }
      renderCurrent();
    });

    const dragHandle = document.createElement('div');
    dragHandle.className = 'stream-scene-drag-handle';
    dragHandle.draggable = true;
    dragHandle.title = 'Drag to reorder';
    dragHandle.append(createIcon('GripVertical', 'Reorder'));
    dragHandle.addEventListener('dragstart', (event) => {
      listDragSceneId = scene.id;
      event.dataTransfer?.setData('text/plain', scene.id);
      event.dataTransfer!.effectAllowed = 'move';
      wrap.classList.add('drag-source');
    });
    dragHandle.addEventListener('dragend', () => {
      listDragSceneId = undefined;
      wrap.classList.remove('drag-source');
      document.querySelectorAll('.stream-scene-row-wrap.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    });

    row.addEventListener('dragover', (event) => {
      if (!listDragSceneId || listDragSceneId === scene.id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'move';
      wrap.classList.add('drop-hover');
    });
    row.addEventListener('dragleave', () => wrap.classList.remove('drop-hover'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      wrap.classList.remove('drop-hover');
      const dragged = event.dataTransfer?.getData('text/plain') as SceneId | undefined;
      if (dragged && dragged !== scene.id) {
        applySceneReorder(dragged, scene.id);
      }
    });

    const cueCell = createCell(String(number).padStart(2, '0'), 'stream-list-col-num');
    const titleCell = createCell(scene.title ?? `Scene ${number}`, 'stream-list-col-title');
    const triggerCell = createCell(formatTriggerSummary(stream, scene), 'stream-list-col-trigger');
    const durationCell = createCell(formatSceneDuration(scene), 'stream-list-col-duration');
    const stateCell = createCell(formatSceneStateLabel(runtimeState, scene), 'stream-list-col-state');

    const actions = document.createElement('div');
    actions.className = 'stream-scene-row-actions';
    const runHere = createButton('', 'icon-button stream-row-action', () => {
      void window.xtream.stream.transport({ type: 'go', sceneId: scene.id });
    });
    decorateIconButton(runHere, 'Play', 'Run from here');
    runHere.disabled = !!scene.disabled;

    const dup = createButton('', 'icon-button stream-row-action', () => {
      void window.xtream.stream.edit({ type: 'duplicate-scene', sceneId: scene.id }).then((s) => {
        const idx = s.stream.sceneOrder.indexOf(scene.id);
        const newId = idx >= 0 ? s.stream.sceneOrder[idx + 1] : scene.id;
        selectedSceneId = newId;
        renderCurrent();
      });
    });
    decorateIconButton(dup, 'Copy', 'Duplicate scene');

    const dis = createButton('', 'icon-button stream-row-action', () => {
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: !scene.disabled } });
    });
    decorateIconButton(dis, scene.disabled ? 'Play' : 'StopCircle', scene.disabled ? 'Enable scene' : 'Disable scene');

    const rem = createButton('', 'icon-button stream-row-action', () => {
      if (stream.sceneOrder.length <= 1) {
        return;
      }
      void window.xtream.stream.edit({ type: 'remove-scene', sceneId: scene.id }).then((s) => {
        selectedSceneId = s.stream.sceneOrder[0];
        expandedListSceneIds.delete(scene.id);
        renderCurrent();
      });
    });
    decorateIconButton(rem, 'Trash2', 'Remove scene');
    rem.disabled = stream.sceneOrder.length <= 1;

    actions.append(runHere, dup, dis, rem);

    row.append(expandBtn, dragHandle, cueCell, titleCell, triggerCell, durationCell, stateCell, actions);

    wrap.append(row);

    const progress = runtimeState?.progress;
    if (runtimeState?.status === 'running' && progress !== undefined && Number.isFinite(progress)) {
      const bar = document.createElement('div');
      bar.className = 'stream-scene-row-progress';
      bar.style.setProperty('--stream-row-progress', `${Math.min(100, Math.max(0, progress * 100))}%`);
      wrap.append(bar);
    } else if (runtimeState?.status === 'running') {
      const bar = document.createElement('div');
      bar.className = 'stream-scene-row-progress stream-scene-row-progress--indeterminate';
      wrap.append(bar);
    }

    if (expanded) {
      const sub = document.createElement('div');
      sub.className = 'stream-scene-subcue-list';
      if (scene.subCueOrder.length === 0) {
        sub.append(createHint('No sub-cues in this scene.'));
      } else {
        for (const sid of scene.subCueOrder) {
          const cue = scene.subCues[sid];
          const line = document.createElement('div');
          line.className = 'stream-scene-subcue-line';
          line.textContent = cue ? formatSubCueLabel(cue) : sid;
          sub.append(line);
        }
      }
      wrap.append(sub);
    }

    return wrap;
  }

  function formatSceneStateLabel(runtimeState: SceneRuntimeState | undefined, scene: PersistedSceneConfig): string {
    if (runtimeState?.status) {
      return runtimeState.status;
    }
    return scene.disabled ? 'disabled' : 'ready';
  }

  function createFlowMode(): HTMLElement {
    const flow = document.createElement('div');
    flow.className = 'stream-flow-canvas';
    const stream = streamState!.stream;
    stream.sceneOrder.forEach((sceneId, index) => {
      const scene = stream.scenes[sceneId];
      if (!scene) {
        return;
      }
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `stream-flow-card ${sceneId === selectedSceneId ? 'selected' : ''}`;
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
      meta.textContent = `${formatTriggerSummary(stream, scene)} | ${formatSceneDuration(scene)}`;
      card.append(number, title, meta);
      card.addEventListener('click', () => {
        selectedSceneId = sceneId;
        bottomTab = 'scene';
        detailPane = undefined;
        renderCurrent();
      });
      flow.append(card);
    });
    return flow;
  }

  function renderBottomPane(): void {
    const panel = requireRef('bottom');
    if (detailPane) {
      panel.replaceChildren(createDetailPane());
      return;
    }
    const tabs = createTabBar(
      'Stream bottom tabs',
      [
        ['scene', 'Scene Edit'],
        ['mixer', 'Audio Mixer'],
        ['displays', 'Display Windows Preview'],
      ],
      bottomTab,
      (next) => {
        bottomTab = next as BottomTab;
        renderCurrent();
      },
    );
    const tabRow = document.createElement('div');
    tabRow.className = 'stream-tab-row';
    tabRow.append(tabs);
    const action = createBottomTabAction();
    if (action) {
      tabRow.append(action);
    }
    const content = document.createElement('div');
    content.className = 'stream-bottom-content';
    if (bottomTab === 'scene') {
      content.append(createSceneEditPane());
    } else if (bottomTab === 'mixer') {
      content.append(renderMixerPane());
    } else {
      content.append(renderDisplayPane());
    }
    panel.replaceChildren(tabRow, content);
  }

  function createBottomTabAction(): HTMLButtonElement | undefined {
    if (bottomTab === 'mixer') {
      const add = createButton('Create Output', '', async () => {
        const output = await window.xtream.outputs.create();
        detailPane = { type: 'output', id: output.id, returnTab: 'mixer' };
        selectedEntity = { type: 'output', id: output.id };
        options.renderState(await window.xtream.director.getState());
      });
      decorateIconButton(add, 'Plus', 'Create output');
      return add;
    }
    if (bottomTab === 'displays') {
      const add = createButton('Add Display', '', async () => {
        const display = await window.xtream.displays.create({ layout: { type: 'single' } });
        detailPane = { type: 'display', id: display.id, returnTab: 'displays' };
        selectedEntity = { type: 'display', id: display.id };
        options.renderState(await window.xtream.director.getState());
      });
      decorateIconButton(add, 'Plus', 'Add display');
      return add;
    }
    return undefined;
  }

  function createSceneEditPane(): HTMLElement {
    const stream = streamState!.stream;
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
        rail.append(createSceneSectionButton(formatSubCueLabel(sub), false));
      }
    }
    rail.append(createSceneSectionButton('Add Sub-Cue', false, true));

    const detail = document.createElement('div');
    detail.className = 'stream-scene-edit-detail';
    detail.append(createSceneForm(stream, scene));
    wrap.append(rail, detail);
    return wrap;
  }

  function createSceneForm(stream: PersistedStreamConfig, scene: PersistedSceneConfig): HTMLElement {
    const form = document.createElement('div');
    form.className = 'detail-card stream-scene-form';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'label-input';
    titleInput.value = scene.title ?? '';
    titleInput.placeholder = 'Scene title';
    titleInput.addEventListener('change', () => {
      const v = titleInput.value.trim();
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { title: v || undefined } });
    });
    form.append(createDetailField('Title', titleInput));

    const noteInput = document.createElement('textarea');
    noteInput.className = 'label-input stream-scene-note-input';
    noteInput.rows = 3;
    noteInput.value = scene.note ?? '';
    noteInput.placeholder = 'Scene note';
    noteInput.addEventListener('change', () => {
      const v = noteInput.value.trim();
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { note: v || undefined } });
    });
    form.append(createDetailField('Note', noteInput));

    const disabledLabel = document.createElement('label');
    disabledLabel.className = 'stream-checkbox-field';
    const disabledBox = document.createElement('input');
    disabledBox.type = 'checkbox';
    disabledBox.checked = !!scene.disabled;
    disabledBox.addEventListener('change', () => {
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: disabledBox.checked } });
    });
    disabledLabel.append(disabledBox, document.createTextNode(' Scene disabled'));
    form.append(disabledLabel);

    const triggerType = scene.trigger.type;
    const triggerSelect = createSelect(
      'Trigger mode',
      [
        ['manual', 'Manual'],
        ['simultaneous-start', 'Simultaneous start'],
        ['follow-end', 'Follow end'],
        ['time-offset', 'Time offset'],
        ['at-timecode', 'At timecode'],
      ],
      triggerType,
      (value) => {
        const nextType = value as SceneTrigger['type'];
        let nextTrigger: SceneTrigger;
        if (nextType === 'manual') {
          nextTrigger = { type: 'manual' };
        } else if (nextType === 'at-timecode') {
          nextTrigger = { type: 'at-timecode', timecodeMs: scene.trigger.type === 'at-timecode' ? scene.trigger.timecodeMs : 0 };
        } else if (nextType === 'time-offset') {
          const prev =
            scene.trigger.type === 'time-offset'
              ? scene.trigger
              : { offsetMs: 1000, followsSceneId: resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }) };
          nextTrigger = {
            type: 'time-offset',
            offsetMs: 'offsetMs' in prev ? prev.offsetMs : 1000,
            followsSceneId: 'followsSceneId' in prev ? prev.followsSceneId : undefined,
          };
        } else if (nextType === 'simultaneous-start') {
          nextTrigger = {
            type: 'simultaneous-start',
            followsSceneId:
              scene.trigger.type === 'simultaneous-start' ? scene.trigger.followsSceneId : resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }),
          };
        } else {
          nextTrigger = {
            type: 'follow-end',
            followsSceneId: scene.trigger.type === 'follow-end' ? scene.trigger.followsSceneId : resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }),
          };
        }
        void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: nextTrigger } });
      },
    );
    form.append(triggerSelect);

    const followOptions: Array<[string, string]> = stream.sceneOrder
      .filter((id) => id !== scene.id)
      .map((id) => [id, stream.scenes[id]?.title ?? id]);
    const needsFollow =
      triggerType === 'simultaneous-start' || triggerType === 'follow-end' || triggerType === 'time-offset';
    const explicitFollowId =
      needsFollow && (scene.trigger.type === 'simultaneous-start' || scene.trigger.type === 'follow-end' || scene.trigger.type === 'time-offset')
        ? scene.trigger.followsSceneId
        : undefined;
    const followSelect = createSelect(
      'Follow scene',
      [['', '(implicit: previous row)'], ...followOptions],
      explicitFollowId ?? '',
      (value) => {
        const id = value || undefined;
        const t = scene.trigger;
        if (t.type === 'simultaneous-start') {
          void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'simultaneous-start', followsSceneId: id } } });
        } else if (t.type === 'follow-end') {
          void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'follow-end', followsSceneId: id } } });
        } else if (t.type === 'time-offset') {
          void window.xtream.stream.edit({
            type: 'update-scene',
            sceneId: scene.id,
            update: { trigger: { type: 'time-offset', offsetMs: t.offsetMs, followsSceneId: id } },
          });
        }
      },
    );
    followSelect.hidden = !needsFollow;
    form.append(followSelect);

    const offsetWrap = document.createElement('div');
    offsetWrap.className = 'stream-scene-form-row';
    offsetWrap.hidden = triggerType !== 'time-offset';
    const offsetMs =
      scene.trigger.type === 'time-offset' ? scene.trigger.offsetMs : 0;
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number';
    offsetInput.min = '0';
    offsetInput.step = '100';
    offsetInput.className = 'label-input';
    offsetInput.value = String(offsetMs);
    offsetInput.addEventListener('change', () => {
      if (scene.trigger.type !== 'time-offset') {
        return;
      }
      const ms = Math.max(0, Number(offsetInput.value) || 0);
      void window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: scene.id,
        update: { trigger: { type: 'time-offset', offsetMs: ms, followsSceneId: scene.trigger.followsSceneId } },
      });
    });
    offsetWrap.append(createDetailField('Offset (ms)', offsetInput));
    form.append(offsetWrap);

    const tcWrap = document.createElement('div');
    tcWrap.className = 'stream-scene-form-row';
    tcWrap.hidden = triggerType !== 'at-timecode';
    const tcMs = scene.trigger.type === 'at-timecode' ? scene.trigger.timecodeMs : 0;
    const tcInput = document.createElement('input');
    tcInput.type = 'number';
    tcInput.min = '0';
    tcInput.step = '100';
    tcInput.className = 'label-input';
    tcInput.value = String(tcMs);
    tcInput.addEventListener('change', () => {
      const ms = Math.max(0, Number(tcInput.value) || 0);
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'at-timecode', timecodeMs: ms } } });
    });
    tcWrap.append(createDetailField('Timecode (ms)', tcInput));
    form.append(tcWrap);

    const loopLabel = document.createElement('label');
    loopLabel.className = 'stream-checkbox-field';
    const loopBox = document.createElement('input');
    loopBox.type = 'checkbox';
    loopBox.checked = scene.loop.enabled;
    loopBox.addEventListener('change', () => {
      const next: SceneLoopPolicy = loopBox.checked
        ? scene.loop.enabled
          ? scene.loop
          : { enabled: true, iterations: { type: 'count', count: 1 } }
        : { enabled: false };
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { loop: next } });
    });
    loopLabel.append(loopBox, document.createTextNode(' Scene loop'));
    form.append(loopLabel);

    const loopDetail = document.createElement('div');
    loopDetail.className = 'stream-scene-form-row stream-scene-loop-detail';
    loopDetail.hidden = !scene.loop.enabled;
    if (scene.loop.enabled) {
      const iterTypeSelect = createSelect(
        'Loop iterations',
        [
          ['count', 'Count'],
          ['infinite', 'Infinite'],
        ],
        scene.loop.iterations.type,
        (value) => {
          if (!scene.loop.enabled) {
            return;
          }
          const iterations =
            value === 'infinite' ? ({ type: 'infinite' } as const) : { type: 'count' as const, count: scene.loop.iterations.type === 'count' ? scene.loop.iterations.count : 1 };
          void window.xtream.stream.edit({
            type: 'update-scene',
            sceneId: scene.id,
            update: { loop: { ...scene.loop, iterations } },
          });
        },
      );
      loopDetail.append(iterTypeSelect);

      if (scene.loop.iterations.type === 'count') {
        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.step = '1';
        countInput.className = 'label-input';
        countInput.value = String(scene.loop.iterations.count);
        countInput.addEventListener('change', () => {
          if (!scene.loop.enabled || scene.loop.iterations.type !== 'count') {
            return;
          }
          const c = Math.max(1, Math.floor(Number(countInput.value) || 1));
          void window.xtream.stream.edit({
            type: 'update-scene',
            sceneId: scene.id,
            update: { loop: { ...scene.loop, iterations: { type: 'count', count: c } } },
          });
        });
        loopDetail.append(createDetailField('Loop count', countInput));
      }

      const rangeStart = document.createElement('input');
      rangeStart.type = 'number';
      rangeStart.min = '0';
      rangeStart.step = '100';
      rangeStart.className = 'label-input';
      rangeStart.value = String(scene.loop.range?.startMs ?? 0);
      rangeStart.addEventListener('change', () => {
        if (!scene.loop.enabled) {
          return;
        }
        const startMs = Math.max(0, Number(rangeStart.value) || 0);
        const endMs = scene.loop.range?.endMs;
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: { loop: { ...scene.loop, range: { startMs, endMs } } },
        });
      });
      loopDetail.append(createDetailField('Loop range start (ms)', rangeStart));

      const rangeEnd = document.createElement('input');
      rangeEnd.type = 'number';
      rangeEnd.min = '0';
      rangeEnd.step = '100';
      rangeEnd.className = 'label-input';
      rangeEnd.placeholder = 'optional end';
      rangeEnd.value = scene.loop.range?.endMs !== undefined ? String(scene.loop.range.endMs) : '';
      rangeEnd.addEventListener('change', () => {
        if (!scene.loop.enabled) {
          return;
        }
        const raw = rangeEnd.value.trim();
        const endMs = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
        const startMs = scene.loop.range?.startMs ?? 0;
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: { loop: { ...scene.loop, range: endMs !== undefined ? { startMs, endMs } : { startMs } } },
        });
      });
      loopDetail.append(createDetailField('Loop range end (ms)', rangeEnd));
    }
    form.append(loopDetail);

    const preloadLabel = document.createElement('label');
    preloadLabel.className = 'stream-checkbox-field';
    const preloadBox = document.createElement('input');
    preloadBox.type = 'checkbox';
    preloadBox.checked = scene.preload.enabled;
    preloadBox.addEventListener('change', () => {
      void window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: scene.id,
        update: { preload: { enabled: preloadBox.checked, leadTimeMs: scene.preload.leadTimeMs } },
      });
    });
    preloadLabel.append(preloadBox, document.createTextNode(' Preload'));
    form.append(preloadLabel);

    const leadWrap = document.createElement('div');
    leadWrap.className = 'stream-scene-form-row';
    leadWrap.hidden = !scene.preload.enabled;
    const leadInput = document.createElement('input');
    leadInput.type = 'number';
    leadInput.min = '0';
    leadInput.step = '100';
    leadInput.className = 'label-input';
    leadInput.value = String(scene.preload.leadTimeMs ?? 0);
    leadInput.addEventListener('change', () => {
      const ms = Math.max(0, Number(leadInput.value) || 0);
      void window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: scene.id,
        update: { preload: { enabled: true, leadTimeMs: ms } },
      });
    });
    leadWrap.append(createDetailField('Preload lead time (ms)', leadInput));
    form.append(leadWrap);

    form.append(
      createDetailLine('Trigger summary', formatTriggerSummary(stream, scene)),
      createDetailLine('Sub-cues', String(scene.subCueOrder.length)),
    );

    const actions = document.createElement('div');
    actions.className = 'button-row';
    const removeDisabled = stream.sceneOrder.length <= 1;
    actions.append(
      createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary', () =>
        void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: !scene.disabled } }),
      ),
      createButton('Duplicate', 'secondary', () => duplicateSelectedScene(scene.id)),
      createButton('Remove', 'secondary', () => removeSelectedScene(scene.id)),
    );
    const removeBtn = actions.querySelectorAll('button')[2] as HTMLButtonElement;
    removeBtn.disabled = removeDisabled;
    form.append(actions);
    return form;
  }

  function createSceneSectionButton(label: string, active: boolean, phantom = false): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stream-section-pill ${active ? 'active' : ''} ${phantom ? 'phantom' : ''}`;
    button.textContent = label;
    return button;
  }

  function renderMixerPane(): HTMLElement {
    const outputPanel = requireRef('outputPanel') as HTMLDivElement;
    const signature = mixerPanel?.createRenderSignature(currentState!) ?? '';
    if (mixerRenderSignature !== signature) {
      mixerRenderSignature = signature;
      mixerPanel?.renderOutputs(currentState!);
    }
    mixerPanel?.syncSelection(selectedEntity);
    mixerPanel?.syncOutputMeters(currentState!);
    return outputPanel;
  }

  function renderDisplayPane(): HTMLElement {
    const displayList = requireRef('displayList') as HTMLDivElement;
    const signature = displayWorkspace?.createRenderSignature(currentState!) ?? '';
    const displays = Object.values(currentState!.displays);
    if (displayRenderSignature !== signature) {
      displayRenderSignature = signature;
      displayWorkspace?.render(displays);
    } else {
      displayWorkspace?.syncCardSummaries(displays);
    }
    return displayList;
  }

  function createDetailPane(): HTMLElement {
    const detail = detailPane!;
    const state = currentState!;
    const wrap = document.createElement('section');
    wrap.className = 'stream-detail-pane';
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    title.textContent = detail.type === 'display' ? 'Display Details' : 'Output Details';
    const close = createButton('Close', 'secondary', () => {
      bottomTab = detail.returnTab;
      detailPane = undefined;
      renderCurrent();
    });
    decorateIconButton(close, 'X', 'Close details');
    header.append(title, close);
    const body = document.createElement('div');
    body.className = 'stream-detail-body';
    if (detail.type === 'display') {
      const display = state.displays[detail.id];
      body.append(display ? createDisplayDetail(display) : createHint('Display not found.'));
    } else {
      const output = state.outputs[detail.id];
      body.append(output ? createOutputDetail(output) : createHint('Output not found.'));
    }
    wrap.append(header, body);
    return wrap;
  }

  function createDisplayDetail(display: DisplayWindowState): HTMLElement {
    const card = document.createElement('div');
    card.className = 'detail-card stream-display-detail-card';
    const label = createTextInput(display.label ?? display.id, (value) => window.xtream.displays.update(display.id, { label: value }));
    const monitor = createSelect(
      'Monitor',
      [['', 'Current/default'], ...options.getDisplayMonitors().map((m): [string, string] => [m.id, m.label])],
      display.displayId ?? '',
      (displayId) => void window.xtream.displays.update(display.id, { displayId: displayId || undefined }).then(refreshDirector),
    );
    const toolbar = document.createElement('div');
    toolbar.className = 'button-row';
    toolbar.append(
      createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', () =>
        window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen }).then(refreshDirector),
      ),
      createButton(display.alwaysOnTop ? 'Normal Layer' : 'Always On Top', 'secondary', () =>
        window.xtream.displays.update(display.id, { alwaysOnTop: !display.alwaysOnTop }).then(refreshDirector),
      ),
    );
    card.append(
      createDetailField('Label', label),
      monitor,
      toolbar,
      createDetailLine('Status', displayWorkspace?.getDisplayStatusLabel(display) ?? 'Display'),
      createDetailLine('Telemetry', displayWorkspace?.getDisplayTelemetry(display) ?? display.id),
    );
    return card;
  }

  function createOutputDetail(output: VirtualOutputState): HTMLElement {
    const state = currentState!;
    const layout = document.createElement('div');
    layout.className = 'stream-output-detail-layout';
    const card = document.createElement('div');
    card.className = 'detail-card stream-output-detail-controls';
    const stripWrap = document.createElement('div');
    stripWrap.className = 'stream-output-detail-strip';
    const label = createTextInput(output.label, (value) => window.xtream.outputs.update(output.id, { label: value }));
    const sink = createSelect(
      'Physical output',
      [['', 'System default output'], ...options.getAudioDevices().map((device, index): [string, string] => [device.deviceId, device.label || `Audio output ${index + 1}`])],
      output.sinkId ?? '',
      (sinkId) => {
        const sinkLabel = options.getAudioDevices().find((device) => device.deviceId === sinkId)?.label;
        void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel }).then(refreshDirector);
      },
    );
    card.append(
      createDetailField('Label', label),
      sink,
    );
    stripWrap.append(mixerPanel?.createOutputDetailMixerStrip(output, state) ?? createHint('Output strip unavailable.'));
    layout.append(card, stripWrap);
    return layout;
  }

  function createTabBar<T extends string>(label: string, entries: Array<[T, string]>, active: T, onSelect: (value: T) => void): HTMLElement {
    const tablist = document.createElement('div');
    tablist.className = 'stream-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', label);
    entries.forEach(([value, text]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `pool-tab ${active === value ? 'active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active === value));
      tab.textContent = text;
      tab.addEventListener('click', () => onSelect(value));
      tablist.append(tab);
    });
    return tablist;
  }

  function createCell(text: string, className?: string): HTMLElement {
    const cell = document.createElement('span');
    cell.textContent = text;
    if (className) {
      cell.className = className;
    }
    return cell;
  }

  function createDetailLine(labelText: string, valueText: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'detail-line';
    const label = document.createElement('span');
    label.textContent = labelText;
    const value = document.createElement('strong');
    value.textContent = valueText;
    row.append(label, value);
    return row;
  }

  function createDetailField(labelText: string, field: HTMLElement): HTMLElement {
    const label = document.createElement('label');
    label.className = 'detail-field';
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(text, field);
    return label;
  }

  function createTextInput(value: string, onCommit: (value: string) => Promise<unknown>): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'label-input';
    input.value = value;
    input.addEventListener('change', () => {
      const next = input.value.trim() || value;
      input.value = next;
      void onCommit(next).then(refreshDirector);
    });
    return input;
  }

  function formatTriggerSummary(stream: PersistedStreamConfig, scene: PersistedSceneConfig): string {
    const t = scene.trigger;
    if (t.type === 'manual') {
      return 'Manual';
    }
    if (t.type === 'at-timecode') {
      return `At ${formatTimecode(t.timecodeMs / 1000)}`;
    }
    const pred = resolveFollowsSceneId(stream, scene.id, t);
    const predLabel = pred ? stream.scenes[pred]?.title ?? pred : 'previous';
    if (t.type === 'time-offset') {
      return `+${(t.offsetMs / 1000).toFixed(2)}s · ${predLabel}`;
    }
    if (t.type === 'simultaneous-start') {
      return `With start · ${predLabel}`;
    }
    if (t.type === 'follow-end') {
      return `After end · ${predLabel}`;
    }
    return 'Trigger';
  }

  function formatSceneDuration(scene: PersistedSceneConfig): string {
    const durations = scene.subCueOrder
      .map((id) => scene.subCues[id])
      .map((sub) => getSubCueDurationSeconds(sub))
      .filter((value): value is number => value !== undefined);
    if (durations.length === 0) {
      return '--';
    }
    return formatTimecode(Math.max(...durations));
  }

  function getSubCueDurationSeconds(sub: PersistedSubCueConfig | undefined): number | undefined {
    if (!sub || !currentState) {
      return undefined;
    }
    if (sub.kind === 'visual') {
      return currentState.visuals[sub.visualId]?.durationSeconds;
    }
    if (sub.kind === 'audio') {
      return currentState.audioSources[sub.audioSourceId]?.durationSeconds;
    }
    return 0;
  }

  function formatSubCueLabel(sub: PersistedSubCueConfig): string {
    if (sub.kind === 'visual') {
      return `Visual | ${currentState?.visuals[sub.visualId]?.label ?? sub.visualId}`;
    }
    if (sub.kind === 'audio') {
      return `Audio | ${currentState?.audioSources[sub.audioSourceId]?.label ?? sub.audioSourceId}`;
    }
    return `Control | ${sub.action.type}`;
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
    });
  }

  function removeSelectedScene(sceneId: SceneId): void {
    void window.xtream.stream.edit({ type: 'remove-scene', sceneId }).then((state) => {
      selectedSceneId = state.stream.sceneOrder[0];
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
      if ((entity.type === 'output' && detailPane?.type === 'output' && detailPane.id === entity.id) || (entity.type === 'display' && detailPane?.type === 'display' && detailPane.id === entity.id)) {
        bottomTab = detailPane.returnTab;
        detailPane = undefined;
      }
    }
  }

  function requireRef(name: string): HTMLElement {
    const ref = refs[name];
    if (!ref) {
      throw new Error(`Missing stream surface ref: ${name}`);
    }
    return ref;
  }

  function readStreamLayoutPrefs(): { mediaWidthPx?: number; bottomHeightPx?: number; assetPreviewHeightPx?: number } {
    try {
      return JSON.parse(localStorage.getItem(STREAM_LAYOUT_PREF_KEY) ?? '{}') as { mediaWidthPx?: number; bottomHeightPx?: number; assetPreviewHeightPx?: number };
    } catch {
      return {};
    }
  }

  function saveStreamLayoutPrefs(update: { mediaWidthPx?: number; bottomHeightPx?: number; assetPreviewHeightPx?: number }): void {
    const prefs = { ...readStreamLayoutPrefs(), ...update };
    localStorage.setItem(STREAM_LAYOUT_PREF_KEY, JSON.stringify(prefs));
    applyStreamLayoutPrefs(prefs);
  }

  function applyStreamLayoutPrefs(prefs: { mediaWidthPx?: number; bottomHeightPx?: number; assetPreviewHeightPx?: number }): void {
    const root = refs.root;
    if (!root) {
      return;
    }
    if (prefs.mediaWidthPx !== undefined) {
      root.style.setProperty('--stream-media-width', `${prefs.mediaWidthPx}px`);
    }
    if (prefs.bottomHeightPx !== undefined) {
      root.style.setProperty('--stream-bottom-height', `${prefs.bottomHeightPx}px`);
    }
    if (prefs.assetPreviewHeightPx !== undefined) {
      root.style.setProperty('--asset-preview-height', `${prefs.assetPreviewHeightPx}px`);
    }
    syncStreamSplitterAria();
  }

  function installSplitters(): void {
    installSplitter(requireRef('streamMiddleSplitter'), 'x', (delta) => {
      const media = requireRef('media');
      const root = requireRef('root');
      const width = clamp(media.getBoundingClientRect().width + delta, 260, Math.max(360, root.getBoundingClientRect().width - 500));
      saveStreamLayoutPrefs({ mediaWidthPx: width });
    });
    installSplitter(requireRef('streamBottomSplitter'), 'y', (delta) => {
      const bottom = requireRef('bottom');
      const root = requireRef('root');
      const height = clamp(bottom.getBoundingClientRect().height - delta, 220, Math.max(260, root.getBoundingClientRect().height - 280));
      saveStreamLayoutPrefs({ bottomHeightPx: height });
    });
    installSplitter(requireRef('streamAssetPreviewSplitter'), 'y', (delta) => {
      const assetPreview = requireRef('assetPreview');
      const current = readStreamLayoutPrefs().assetPreviewHeightPx ?? assetPreview.getBoundingClientRect().height;
      saveStreamLayoutPrefs({ assetPreviewHeightPx: clamp(current - delta, 110, 320) });
    });
    syncStreamSplitterAria();
  }

  function installSplitter(handle: HTMLElement, axis: 'x' | 'y', onDelta: (delta: number) => void): void {
    let start = 0;
    handle.addEventListener('pointerdown', (event) => {
      start = axis === 'x' ? event.clientX : event.clientY;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) {
        return;
      }
      const current = axis === 'x' ? event.clientX : event.clientY;
      onDelta(current - start);
      start = current;
    });
    const finish = (event: PointerEvent) => {
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      handle.classList.remove('dragging');
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 40 : 12;
      if (axis === 'x' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        onDelta(event.key === 'ArrowRight' ? step : -step);
      }
      if (axis === 'y' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        onDelta(event.key === 'ArrowDown' ? step : -step);
      }
    });
  }

  function syncStreamSplitterAria(): void {
    const root = refs.root;
    const media = refs.media;
    const middleSplitter = refs.streamMiddleSplitter;
    if (root && media && middleSplitter) {
      const min = 260;
      const max = Math.max(360, root.getBoundingClientRect().width - 500);
      setSeparatorValue(middleSplitter, 'vertical', min, max, clamp(media.getBoundingClientRect().width, min, max));
    }
    const bottom = refs.bottom;
    const bottomSplitter = refs.streamBottomSplitter;
    if (root && bottom && bottomSplitter) {
      const min = 220;
      const max = Math.max(260, root.getBoundingClientRect().height - 280);
      setSeparatorValue(bottomSplitter, 'horizontal', min, max, clamp(bottom.getBoundingClientRect().height, min, max));
    }
    const assetPreview = refs.assetPreview;
    const assetPreviewSplitter = refs.streamAssetPreviewSplitter;
    if (assetPreview && assetPreviewSplitter) {
      setSeparatorValue(assetPreviewSplitter, 'horizontal', 110, 320, clamp(assetPreview.getBoundingClientRect().height, 110, 320));
    }
  }

  function setSeparatorValue(el: HTMLElement, orientation: 'horizontal' | 'vertical', min: number, max: number, value: number): void {
    el.setAttribute('aria-orientation', orientation);
    el.setAttribute('aria-valuemin', String(Math.round(min)));
    el.setAttribute('aria-valuemax', String(Math.round(max)));
    el.setAttribute('aria-valuenow', String(Math.round(value)));
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
  };
}
