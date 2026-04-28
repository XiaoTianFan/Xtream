import { formatTimecode } from '../../../shared/timeline';
import type {
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  OutputMeterReport,
  PersistedSceneConfig,
  PersistedSubCueConfig,
  SceneId,
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
import { decorateIconButton } from '../shared/icons';
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
    content.append(mode === 'list' ? createListMode(stream.sceneOrder.map((id) => stream.scenes[id]).filter(Boolean)) : createFlowMode());
    panel.replaceChildren(tabs, content);
  }

  function createListMode(scenes: PersistedSceneConfig[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'stream-scene-list';
    const header = document.createElement('div');
    header.className = 'stream-scene-row stream-scene-row--header';
    header.append(createCell('#'), createCell('Title'), createCell('Trigger'), createCell('Duration'), createCell('State'));
    list.append(header);
    scenes.forEach((scene, index) => list.append(createSceneRow(scene, index + 1)));
    return list;
  }

  function createSceneRow(scene: PersistedSceneConfig, number: number): HTMLElement {
    const runtimeState = streamState?.runtime?.sceneStates[scene.id];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `stream-scene-row ${scene.id === selectedSceneId ? 'selected' : ''} ${runtimeState?.status ?? (scene.disabled ? 'disabled' : 'ready')}`;
    row.addEventListener('click', () => {
      selectedSceneId = scene.id;
      bottomTab = 'scene';
      detailPane = undefined;
      renderCurrent();
    });
    row.append(
      createCell(String(number).padStart(2, '0')),
      createCell(scene.title ?? `Scene ${number}`),
      createCell(formatTrigger(scene)),
      createCell(formatSceneDuration(scene)),
      createCell(runtimeState?.status ?? (scene.disabled ? 'disabled' : 'ready')),
    );
    return row;
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
      meta.textContent = `${formatTrigger(scene)} | ${formatSceneDuration(scene)}`;
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
    detail.append(createSceneForm(scene));
    wrap.append(rail, detail);
    return wrap;
  }

  function createSceneForm(scene: PersistedSceneConfig): HTMLElement {
    const form = document.createElement('div');
    form.className = 'detail-card stream-scene-form';
    form.append(
      createDetailLine('Scene', scene.title ?? scene.id),
      createDetailLine('Trigger', formatTrigger(scene)),
      createDetailLine('Loop', scene.loop.enabled ? scene.loop.iterations.type : 'off'),
      createDetailLine('Preload', scene.preload.enabled ? `${scene.preload.leadTimeMs ?? 0}ms` : 'off'),
      createDetailLine('Sub-Cues', String(scene.subCueOrder.length)),
    );
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(
      createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary', () => updateSelectedScene({ disabled: !scene.disabled })),
      createButton('Duplicate', 'secondary', () => duplicateSelectedScene(scene.id)),
      createButton('Remove', 'secondary', () => removeSelectedScene(scene.id)),
    );
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

  function createCell(text: string): HTMLElement {
    const cell = document.createElement('span');
    cell.textContent = text;
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

  function formatTrigger(scene: PersistedSceneConfig): string {
    if (scene.trigger.type === 'time-offset') {
      return `offset ${Math.round(scene.trigger.offsetMs / 1000)}s`;
    }
    if (scene.trigger.type === 'at-timecode') {
      return formatTimecode(scene.trigger.timecodeMs / 1000);
    }
    return scene.trigger.type;
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
