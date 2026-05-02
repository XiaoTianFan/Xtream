import type { AudioSourceState, DirectorState, LiveDesktopSourceSummary, VisualId, VisualState } from '../../../shared/types';
import {
  getAudioPoolPlacement,
  getVisualPoolPlacement,
  POOL_PLACEMENT_ABBREV,
  type PoolPlacementKind,
} from '../../../shared/poolAssetPlacement';
import { createButton, createHint } from '../shared/dom';
import { formatAudioChannelLabel, formatDuration } from '../shared/formatters';
import { decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS } from '../../../shared/embeddedAudioImportPrompt';
import { mountVisualPoolGridPreview } from './visualPoolGridPreview';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { runUnifiedManualMediaImport, runUnifiedMediaPoolImport } from './unifiedMediaPoolImport';

type PoolTab = 'visuals' | 'audio';
type PoolSort = 'label' | 'duration' | 'status';
type VisualPoolLayout = 'list' | 'grid';

const VISUAL_POOL_LAYOUT_STORAGE_KEY = 'xtream.visualPoolLayout';

function readStoredVisualPoolLayout(): VisualPoolLayout {
  try {
    const v = localStorage.getItem(VISUAL_POOL_LAYOUT_STORAGE_KEY);
    if (v === 'grid' || v === 'list') {
      return v;
    }
  } catch {
    /* ignore */
  }
  return 'list';
}

function persistVisualPoolLayout(layout: VisualPoolLayout): void {
  try {
    localStorage.setItem(VISUAL_POOL_LAYOUT_STORAGE_KEY, layout);
  } catch {
    /* ignore */
  }
}

function isWindowsStylePath(): boolean {
  return typeof navigator !== 'undefined' && /Windows|Win32/i.test(navigator.userAgent);
}

function createPoolPlacementBadge(placement: PoolPlacementKind | undefined): HTMLElement {
  const el = document.createElement('span');
  el.className = 'asset-marker';
  if (!placement) {
    el.classList.add('asset-marker--empty');
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  el.classList.add(placement);
  el.textContent = POOL_PLACEMENT_ABBREV[placement];
  if (placement === 'representation') {
    el.title = 'Embedded playback from the video source';
  } else if (placement === 'file') {
    el.title = 'File is stored under this project’s assets folder';
  } else {
    el.title = 'Linked to the original file location';
  }
  return el;
}

export type MediaPoolController = {
  createRenderSignature: (state: DirectorState) => string;
  /** Tab/search/sort/layout chrome only — for stream surface routing; avoids asset-metadata churn. */
  createStreamSurfaceShellSignature: () => string;
  render: (state: DirectorState) => void;
  syncPoolSelectionHighlight: (state: DirectorState) => void;
  selectEntityPoolTab: (entity: SelectedEntity) => void;
  dismissContextMenu: () => void;
  /** Stops grid live-capture intervals/cleanups and invalidates pane keys; call when pool DOM is detached (e.g. stream surface unmount). */
  teardownVisualPreviews: () => void;
  install: () => void;
};

export type MediaPoolElements = {
  mediaPoolPanel: HTMLElement;
  visualList: HTMLDivElement;
  visualListListPane: HTMLDivElement;
  visualListGridPane: HTMLDivElement;
  audioPanel: HTMLDivElement;
  visualTabButton: HTMLButtonElement;
  audioTabButton: HTMLButtonElement;
  poolSearchInput: HTMLInputElement;
  poolSortSelect: HTMLSelectElement;
  addVisualsButton: HTMLButtonElement;
  visualPoolLayoutToggleButton: HTMLButtonElement;
};

type MediaPoolControllerOptions = {
  getState: () => DirectorState | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  clearSelectionIf: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  createEmbeddedAudioRepresentation: (visualId: VisualId) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: VisualId) => Promise<void>;
  /** Absolute path to loaded `show…json` — used for REP/LNK/FIL placement labels. */
  getShowConfigPath: () => string | undefined;
};

export function createMediaPoolController(elements: MediaPoolElements, options: MediaPoolControllerOptions): MediaPoolController {
  let activePoolTab: PoolTab = 'visuals';
  let poolSearchQuery = '';
  let poolSort: PoolSort = 'label';
  let activeAudioSourceMenu: HTMLElement | undefined;
  let activeLiveCaptureModal: HTMLElement | undefined;
  let activeLiveCaptureModalKeydown: ((event: KeyboardEvent) => void) | undefined;
  let activeLiveCaptureModalCleanups: Array<() => void> = [];
  let visualPoolLayout: VisualPoolLayout = readStoredVisualPoolLayout();
  let visualPoolGridCleanups: Array<() => void> = [];
  let lastListVisualsDomKey: string | undefined;
  let lastGridVisualsDomKey: string | undefined;

  function clearVisualPoolGridCleanups(): void {
    for (const fn of visualPoolGridCleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    visualPoolGridCleanups = [];
  }

  function teardownVisualPreviews(): void {
    clearVisualPoolGridCleanups();
    lastListVisualsDomKey = undefined;
    lastGridVisualsDomKey = undefined;
  }

  function visualsContentKey(state: DirectorState): string {
    return `${createVisualPoolContentSignature(state)}:${poolSearchQuery}:${poolSort}`;
  }

  function updateVisualPoolPanesVisibility(): void {
    const listMode = visualPoolLayout === 'list';
    elements.visualListListPane.hidden = !listMode;
    elements.visualListGridPane.hidden = listMode;
  }

  function paneShowsPoolItems(pane: HTMLElement): boolean {
    const first = pane.firstElementChild;
    if (!first) {
      return false;
    }
    if (first.classList.contains('hint') || first.classList.contains('media-pool-empty')) {
      return false;
    }
    return first.classList.contains('asset-row') || first.classList.contains('visual-pool-card');
  }

  function visualPoolEmptyMessage(state: DirectorState): string {
    if (Object.keys(state.visuals).length === 0) {
      return 'No visuals in the pool yet.';
    }
    return 'No visuals match this filter.';
  }

  function audioPoolEmptyMessage(state: DirectorState): string {
    if (Object.keys(state.audioSources).length === 0) {
      return 'No audio sources in the pool yet.';
    }
    return 'No audio sources match this filter.';
  }

  function createMediaPoolEmptyState(
    message: string,
    onImport: (trigger: HTMLButtonElement) => void | Promise<void>,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'media-pool-empty';
    const hint = document.createElement('p');
    hint.className = 'hint media-pool-empty__hint';
    hint.textContent = message;
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'media-pool-empty__cta';
    cta.textContent = 'Import sources';
    cta.setAttribute('aria-label', 'Import media sources');
    cta.addEventListener('click', (event) => {
      event.stopPropagation();
      void onImport(cta);
    });
    wrap.append(hint, cta);
    return wrap;
  }

  function renderVisualPoolPanes(state: DirectorState): void {
    const cKey = visualsContentKey(state);
    updateVisualPoolPanesVisibility();

    if (lastListVisualsDomKey !== cKey || !paneShowsPoolItems(elements.visualListListPane)) {
      const listRows = getFilteredVisuals(Object.values(state.visuals)).map((visual) => createVisualRow(visual));
      elements.visualListListPane.replaceChildren(
        ...(listRows.length > 0 ? listRows : [createMediaPoolEmptyState(visualPoolEmptyMessage(state), () => void runUnifiedManualMediaImport(buildUnifiedImportDeps()))]),
      );
      lastListVisualsDomKey = cKey;
    }

    if (lastGridVisualsDomKey !== cKey || !paneShowsPoolItems(elements.visualListGridPane)) {
      clearVisualPoolGridCleanups();
      const gridCards = getFilteredVisuals(Object.values(state.visuals)).map((visual) => createVisualGridCard(visual));
      elements.visualListGridPane.replaceChildren(
        ...(gridCards.length > 0 ? gridCards : [createMediaPoolEmptyState(visualPoolEmptyMessage(state), () => void runUnifiedManualMediaImport(buildUnifiedImportDeps()))]),
      );
      lastGridVisualsDomKey = cKey;
    }

    syncPoolSelectionHighlight(state);
  }

  function syncPoolSelectionHighlight(_state: DirectorState): void {
    for (const el of elements.visualList.querySelectorAll<HTMLElement>('.asset-row, .visual-pool-card')) {
      const id = el.dataset.assetId;
      if (!id) {
        continue;
      }
      el.classList.toggle('selected', options.isSelected('visual', id));
    }
    for (const el of elements.audioPanel.querySelectorAll<HTMLElement>('.asset-row')) {
      const id = el.dataset.assetId;
      if (!id) {
        continue;
      }
      el.classList.toggle('selected', options.isSelected('audio-source', id));
    }
  }

  function render(state: DirectorState): void {
    syncPoolTabs();
    if (activePoolTab === 'visuals') {
      elements.visualList.hidden = false;
      elements.audioPanel.hidden = true;
      elements.audioPanel.replaceChildren();
      renderVisualPoolPanes(state);
      return;
    }

    elements.visualList.hidden = true;
    elements.audioPanel.hidden = false;
    renderVisualPoolPanes(state);
    const audioRows = getFilteredAudioSources(Object.values(state.audioSources), state).map((source) =>
      createAudioSourceRow(source, state),
    );
    elements.audioPanel.replaceChildren(
      ...(audioRows.length > 0 ? audioRows : [createMediaPoolEmptyState(audioPoolEmptyMessage(state), () => void runUnifiedManualMediaImport(buildUnifiedImportDeps()))]),
    );
  }

  function createRenderSignature(state: DirectorState): string {
    return `${createVisualRenderSignature(state)}:${createAudioRenderSignature(state)}:${activePoolTab}:${poolSearchQuery}:${poolSort}:${visualPoolLayout}`;
  }

  /** For Stream workspace shell routing only — excludes per-visual/audio churn so pool metadata does not rebuild the scene list. */
  function createStreamSurfaceShellSignature(): string {
    return `${activePoolTab}:${poolSearchQuery}:${poolSort}:${visualPoolLayout}`;
  }

  function createVisualRow(visual: VisualState): HTMLElement {
    const row = document.createElement('article');
    row.className = `asset-row${options.isSelected('visual', visual.id) ? ' selected' : ''}`;
    row.tabIndex = 0;
    row.dataset.assetId = visual.id;
    row.addEventListener('click', () => selectPoolEntity({ type: 'visual', id: visual.id }));
    row.addEventListener('contextmenu', (event) => showVisualContextMenu(event, visual));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPoolEntity({ type: 'visual', id: visual.id });
      }
    });
    const status = document.createElement('span');
    status.className = `asset-row__status status-dot ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
    const label = document.createElement('strong');
    label.className = 'asset-row__label';
    label.textContent = visual.label;
    const meta = document.createElement('span');
    meta.className = 'asset-meta';
    meta.textContent =
      visual.kind === 'live'
        ? `live | ${visual.capture.source} | ${visual.error ?? (visual.width && visual.height ? `${visual.width}x${visual.height}` : 'standby')}`
        : `${visual.type} | ${formatDuration(visual.durationSeconds)} | ${visual.width && visual.height ? `${visual.width}x${visual.height}` : 'size --'}`;
    if (visual.error) {
      meta.title = visual.error;
      row.title = visual.error;
    }
    const placementBadge = createPoolPlacementBadge(
      getVisualPoolPlacement(visual, options.getShowConfigPath(), isWindowsStylePath()),
    );
    const remove = createButton('Remove', 'secondary row-action', async () => {
      if (!(await confirmPoolRecordRemoval(visual.label))) {
        return;
      }
      await window.xtream.visuals.remove(visual.id);
      options.clearSelectionIf({ type: 'visual', id: visual.id });
      const state = await window.xtream.director.getState();
      render(state);
      options.renderState(state);
    });
    decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
    remove.addEventListener('click', (event) => event.stopPropagation());
    const tail = document.createElement('div');
    tail.className = 'asset-row__tail';
    tail.append(placementBadge, remove);
    row.append(status, label, meta, tail);
    return row;
  }

  function createVisualGridCard(visual: VisualState): HTMLElement {
    const card = document.createElement('article');
    card.className = `visual-pool-card${options.isSelected('visual', visual.id) ? ' selected' : ''}`;
    card.tabIndex = 0;
    card.dataset.assetId = visual.id;
    card.addEventListener('click', () => selectPoolEntity({ type: 'visual', id: visual.id }));
    card.addEventListener('contextmenu', (event) => showVisualContextMenu(event, visual));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPoolEntity({ type: 'visual', id: visual.id });
      }
    });
    if (visual.error) {
      card.title = visual.error;
    }

    const preview = document.createElement('div');
    preview.className = 'visual-pool-card__preview';
    mountVisualPoolGridPreview(
      preview,
      visual,
      (cleanup) => {
        visualPoolGridCleanups.push(cleanup);
      },
      { livePoolPreviewGloballyAllowed: true },
    );

    const footer = document.createElement('div');
    footer.className = 'visual-pool-card__footer';
    const status = document.createElement('span');
    status.className = `status-dot visual-pool-card__status ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
    const label = document.createElement('strong');
    label.className = 'visual-pool-card__label';
    label.textContent = visual.label;
    const meta = document.createElement('span');
    meta.className = 'visual-pool-card__meta';
    meta.textContent =
      visual.kind === 'live'
        ? `live · ${visual.capture.source}`
        : `${visual.type} · ${formatDuration(visual.durationSeconds)}`;
    if (visual.error) {
      meta.title = visual.error;
    }
    const textCol = document.createElement('div');
    textCol.className = 'visual-pool-card__text';
    textCol.append(label, meta);
    const placementBadge = createPoolPlacementBadge(
      getVisualPoolPlacement(visual, options.getShowConfigPath(), isWindowsStylePath()),
    );
    placementBadge.classList.add('visual-pool-card__placement-marker');
    const remove = createButton('Remove', 'secondary row-action', async () => {
      if (!(await confirmPoolRecordRemoval(visual.label))) {
        return;
      }
      await window.xtream.visuals.remove(visual.id);
      options.clearSelectionIf({ type: 'visual', id: visual.id });
      const nextState = await window.xtream.director.getState();
      render(nextState);
      options.renderState(nextState);
    });
    decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
    remove.addEventListener('click', (event) => event.stopPropagation());
    const tail = document.createElement('div');
    tail.className = 'visual-pool-card__tail';
    tail.append(placementBadge, remove);
    footer.append(status, textCol, tail);
    card.append(preview, footer);
    return card;
  }

  function createAudioSourceRow(source: AudioSourceState, state: DirectorState): HTMLElement {
    const row = document.createElement('article');
    row.className = `asset-row${options.isSelected('audio-source', source.id) ? ' selected' : ''}`;
    row.dataset.assetId = source.id;
    row.tabIndex = 0;
    row.addEventListener('click', () => selectPoolEntity({ type: 'audio-source', id: source.id }));
    row.addEventListener('contextmenu', (event) => showAudioSourceContextMenu(event, source));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPoolEntity({ type: 'audio-source', id: source.id });
      }
    });
    const status = document.createElement('span');
    status.className = `asset-row__status status-dot ${source.ready ? 'ready' : source.error ? 'blocked' : 'standby'}`;
    const label = document.createElement('strong');
    label.className = 'asset-row__label';
    label.textContent = source.label;
    const origin = source.type === 'external-file' ? source.path ?? 'External file' : `Embedded from ${state.visuals[source.visualId]?.label ?? source.visualId}`;
    const metaPrimary = document.createElement('span');
    metaPrimary.textContent = `${source.type === 'external-file' ? 'external' : 'embedded'}${formatAudioChannelLabel(source)} | ${formatDuration(source.durationSeconds)}`;
    const metaOrigin = document.createElement('span');
    metaOrigin.textContent = origin;
    const meta = document.createElement('span');
    meta.className = 'asset-meta';
    meta.append(metaPrimary, metaOrigin);
    const placementBadge = createPoolPlacementBadge(
      getAudioPoolPlacement(source, options.getShowConfigPath(), isWindowsStylePath()),
    );
    const remove = createButton('Remove', 'secondary row-action', async () => {
      if (!(await confirmPoolRecordRemoval(source.label))) {
        return;
      }
      await window.xtream.audioSources.remove(source.id);
      options.clearSelectionIf({ type: 'audio-source', id: source.id });
      const state = await window.xtream.director.getState();
      render(state);
      options.renderState(state);
    });
    decorateIconButton(remove, 'X', `Remove ${source.label} from pool`);
    remove.addEventListener('click', (event) => event.stopPropagation());
    const tail = document.createElement('div');
    tail.className = 'asset-row__tail';
    tail.append(placementBadge, remove);
    row.append(status, label, meta, tail);
    return row;
  }

  function selectPoolEntity(entity: SelectedEntity): void {
    options.setSelectedEntity(entity);
    selectEntityPoolTab(entity);
    const state = options.getState();
    if (state) {
      options.renderState(state);
    }
  }

  function selectEntityPoolTab(entity: SelectedEntity): void {
    if (entity.type === 'visual') {
      activePoolTab = 'visuals';
    }
    if (entity.type === 'audio-source') {
      activePoolTab = 'audio';
    }
  }

  async function confirmPoolRecordRemoval(label: string): Promise<boolean> {
    return shellShowConfirm(
      'Remove from media pool',
      `Remove "${label}" from the media pool?`,
      'This only removes the project record from the pool. It will not erase or delete the media file from disk.',
    );
  }

  function showVisualContextMenu(event: MouseEvent, visual: VisualState): void {
    if (visual.kind === 'live' || visual.type !== 'video') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (options.getState()?.paused === false) {
      options.setShowStatus('Pause the timeline before extracting embedded audio.');
      return;
    }
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const representationButton = createButton('Extract as representation', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      await options.createEmbeddedAudioRepresentation(visual.id);
    });
    representationButton.setAttribute('role', 'menuitem');
    const fileButton = createButton('Extract audio as file', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      await options.extractEmbeddedAudioFile(visual.id);
    });
    fileButton.setAttribute('role', 'menuitem');
    if (!visual.hasEmbeddedAudio) {
      representationButton.disabled = true;
      fileButton.disabled = true;
      representationButton.title = 'No embedded audio track has been detected for this visual.';
      fileButton.title = representationButton.title;
    }
    const isLongVideo = (visual.durationSeconds ?? 0) > LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS;
    if (isLongVideo) {
      if (!fileButton.disabled) {
        fileButton.title = 'Long videos use extracted audio files for more stable playback.';
      }
      menu.append(fileButton);
    } else {
      menu.append(representationButton, fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeAudioSourceMenu = menu;
  }

  function showAudioSourceContextMenu(event: MouseEvent, source: AudioSourceState): void {
    event.preventDefault();
    event.stopPropagation();
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const splitButton = createButton('Split to mono', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      try {
        const [left] = await window.xtream.audioSources.splitStereo(source.id);
        options.setSelectedEntity({ type: 'audio-source', id: left.id });
        options.renderState(await window.xtream.director.getState());
        options.setShowStatus(`Split ${source.label} into virtual L/R mono sources.`);
      } catch (error: unknown) {
        options.setShowStatus(error instanceof Error ? error.message : 'Unable to split this audio source.');
      }
    });
    splitButton.setAttribute('role', 'menuitem');
    if (source.derivedFromAudioSourceId || source.channelMode === 'left' || source.channelMode === 'right' || source.channelCount === 1) {
      splitButton.disabled = true;
      splitButton.title = source.channelCount === 1 ? 'Mono sources cannot be split.' : 'This source is already a mono channel.';
    }
    menu.append(splitButton);
    if (source.type === 'embedded-visual' && source.extractionMode === 'representation') {
      const fileButton = createButton('Extract audio as file', 'secondary context-menu-item', async () => {
        dismissAudioSourceContextMenu();
        if (options.getState()?.paused === false) {
          options.setShowStatus('Pause the timeline before extracting embedded audio.');
          return;
        }
        await options.extractEmbeddedAudioFile(source.visualId);
      });
      fileButton.setAttribute('role', 'menuitem');
      if (options.getState()?.paused === false) {
        fileButton.disabled = true;
        fileButton.title = 'Pause the timeline before extracting embedded audio.';
      }
      menu.append(fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeAudioSourceMenu = menu;
  }

  function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
    const menuBounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, window.innerWidth - menuBounds.width - 4)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - menuBounds.height - 4)}px`;
  }

  function dismissAudioSourceContextMenu(): void {
    activeAudioSourceMenu?.remove();
    activeAudioSourceMenu = undefined;
  }

  function dismissLiveCaptureModal(): void {
    cleanupLiveCaptureModalResources();
    if (activeLiveCaptureModalKeydown) {
      document.removeEventListener('keydown', activeLiveCaptureModalKeydown);
      activeLiveCaptureModalKeydown = undefined;
    }
    activeLiveCaptureModal?.remove();
    activeLiveCaptureModal = undefined;
  }

  function cleanupLiveCaptureModalResources(): void {
    activeLiveCaptureModalCleanups.forEach((cleanup) => cleanup());
    activeLiveCaptureModalCleanups = [];
  }

  async function createWebcamLiveVisual(webcam: MediaDeviceInfo): Promise<void> {
    dismissLiveCaptureModal();
    options.setShowStatus(`Adding live webcam: ${webcam.label || 'Webcam'}.`);
    const visual = await window.xtream.liveCapture.create({
      label: webcam.label || 'Webcam',
      capture: {
        source: 'webcam',
        deviceId: webcam.deviceId,
        groupId: webcam.groupId,
        label: webcam.label || 'Webcam',
      },
    });
    options.setSelectedEntity({ type: 'visual', id: visual.id });
    options.renderState(await window.xtream.director.getState());
  }

  async function loadWebcamDevices(): Promise<MediaDeviceInfo[]> {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((device) => device.kind === 'videoinput' && device.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => undefined);
      probe?.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return devices.filter((device) => device.kind === 'videoinput');
  }

  async function createDesktopLiveVisual(source: LiveDesktopSourceSummary): Promise<void> {
    dismissLiveCaptureModal();
    const kind = source.kind;
    options.setShowStatus(`Adding live ${kind === 'screen' ? 'screen' : 'window'}: ${source.name}.`);
    const visual = await window.xtream.liveCapture.create({
      label: source.name,
      capture:
        kind === 'screen'
          ? {
              source: 'screen',
              sourceId: source.id,
              displayId: source.displayId,
              label: source.name,
            }
          : {
              source: 'window',
              sourceId: source.id,
              windowName: source.name,
              label: source.name,
            },
    });
    options.setSelectedEntity({ type: 'visual', id: visual.id });
    options.renderState(await window.xtream.director.getState());
  }

  function showAddVisualsMenu(anchor: HTMLElement = elements.addVisualsButton): void {
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const localFiles = createButton('Local static files', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      await runUnifiedManualMediaImport(buildUnifiedImportDeps());
    });
    localFiles.setAttribute('role', 'menuitem');
    const liveStream = createButton('Add Live Stream', 'secondary context-menu-item', () => showLiveSourceMenu(menu));
    liveStream.setAttribute('role', 'menuitem');
    menu.append(localFiles, liveStream);
    document.body.append(menu);
    const bounds = anchor.getBoundingClientRect();
    positionContextMenu(menu, bounds.left, bounds.bottom + 4);
    activeAudioSourceMenu = menu;
  }

  function showLiveSourceMenu(previousMenu?: HTMLElement): void {
    previousMenu?.remove();
    activeAudioSourceMenu = undefined;
    openLiveCaptureModal();
  }

  function openLiveCaptureModal(): void {
    dismissLiveCaptureModal();
    const overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'liveCaptureModalHeading');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        dismissLiveCaptureModal();
      }
    });
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissLiveCaptureModal();
      }
    };
    activeLiveCaptureModalKeydown = closeOnEscape;
    document.addEventListener('keydown', activeLiveCaptureModalKeydown);
    const panel = document.createElement('div');
    panel.className = 'live-capture-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());
    overlay.append(panel);
    document.body.append(overlay);
    activeLiveCaptureModal = overlay;
    renderLiveCaptureTypeStep(panel);
  }

  function renderLiveCaptureTypeStep(panel: HTMLElement): void {
    cleanupLiveCaptureModalResources();
    const body = createLiveCaptureModalShell('Add Live Stream', 'Choose a live source type.', false);
    const grid = document.createElement('div');
    grid.className = 'live-capture-type-grid';
    grid.append(
      createLiveCaptureTypeButton('Webcam', 'Use a connected camera device.', () => void renderWebcamSourceStep(panel)),
      createLiveCaptureTypeButton('Screen', 'Capture an entire display.', () => void renderDesktopSourceStep(panel, 'screen')),
      createLiveCaptureTypeButton('Window Capture', 'Capture a single app window.', () => void renderDesktopSourceStep(panel, 'window')),
    );
    body.content.append(grid);
    panel.replaceChildren(body.root);
  }

  function createLiveCaptureTypeButton(label: string, detail: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-capture-type-button secondary';
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('span');
    meta.textContent = detail;
    button.append(title, meta);
    button.addEventListener('click', onClick);
    return button;
  }

  async function renderWebcamSourceStep(panel: HTMLElement): Promise<void> {
    cleanupLiveCaptureModalResources();
    const shell = createLiveCaptureModalShell('Choose Webcam', 'Select a camera device to add to the visual pool.', true);
    panel.replaceChildren(shell.root);
    shell.content.append(createHint('Loading webcam devices...'));
    try {
      const webcams = await loadWebcamDevices();
      shell.content.replaceChildren();
      if (webcams.length === 0) {
        shell.content.append(createHint('No webcam devices are available.'));
        return;
      }
      const list = document.createElement('div');
      list.className = 'live-capture-source-list compact';
      webcams.forEach((webcam, index) => {
        const row = createWebcamSourceButton(webcam, webcam.label || `Webcam ${index + 1}`, () => {
          void createWebcamLiveVisual(webcam);
        });
        list.append(row);
      });
      shell.content.append(list);
    } catch (error: unknown) {
      shell.content.replaceChildren(createHint(error instanceof Error ? error.message : 'Unable to enumerate webcams.'));
    }
  }

  async function renderDesktopSourceStep(panel: HTMLElement, kind: 'screen' | 'window'): Promise<void> {
    cleanupLiveCaptureModalResources();
    const isScreen = kind === 'screen';
    const shell = createLiveCaptureModalShell(
      isScreen ? 'Choose Screen' : 'Choose Window',
      isScreen ? 'Select a display to stream into the visual pool.' : 'Select an app window to stream into the visual pool.',
      true,
    );
    panel.replaceChildren(shell.root);
    shell.content.append(createHint(`Loading ${isScreen ? 'screens' : 'windows'}...`));
    try {
      const sources = (await window.xtream.liveCapture.listDesktopSources()).filter((source) => source.kind === kind);
      shell.content.replaceChildren();
      if (sources.length === 0) {
        shell.content.append(createHint(`No ${isScreen ? 'screen' : 'window'} sources are available.`));
        return;
      }
      const list = document.createElement('div');
      list.className = 'live-capture-source-list';
      for (const source of sources) {
        const detail = isScreen ? source.displayId ? `Display ${source.displayId}` : 'Display source' : 'Window source';
        list.append(createLiveCaptureSourceButton(source.name, detail, source.thumbnailDataUrl, () => void createDesktopLiveVisual(source)));
      }
      shell.content.append(list);
    } catch (error: unknown) {
      shell.content.replaceChildren(createHint(error instanceof Error ? error.message : `Unable to enumerate ${isScreen ? 'screens' : 'windows'}.`));
    }
  }

  function createLiveCaptureModalShell(
    title: string,
    subtitle: string,
    showBack: boolean,
  ): { root: HTMLElement; content: HTMLElement } {
    const root = document.createElement('div');
    root.className = 'live-capture-modal';
    const header = document.createElement('header');
    header.className = 'live-capture-header';
    const titleWrap = document.createElement('div');
    const heading = document.createElement('h1');
    heading.id = 'liveCaptureModalHeading';
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = subtitle;
    titleWrap.append(heading, copy);
    const actions = document.createElement('div');
    actions.className = 'live-capture-header-actions';
    if (showBack) {
      actions.append(createButton('Back', 'secondary', () => {
        const panel = activeLiveCaptureModal?.querySelector<HTMLElement>('.live-capture-panel');
        if (panel) {
          renderLiveCaptureTypeStep(panel);
        }
      }));
    }
    actions.append(createButton('Close', 'secondary', dismissLiveCaptureModal));
    header.append(titleWrap, actions);
    const content = document.createElement('div');
    content.className = 'live-capture-content';
    root.append(header, content);
    return { root, content };
  }

  function createLiveCaptureSourceButton(label: string, detail: string, imageDataUrl: string | undefined, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-capture-source-button secondary';
    const preview = document.createElement('span');
    preview.className = 'live-capture-source-preview';
    if (imageDataUrl) {
      const image = document.createElement('img');
      image.src = imageDataUrl;
      image.alt = '';
      preview.append(image);
    } else {
      preview.textContent = 'LIVE';
    }
    const text = document.createElement('span');
    text.className = 'live-capture-source-text';
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('small');
    meta.textContent = detail;
    text.append(title, meta);
    button.append(preview, text);
    button.addEventListener('click', onClick);
    return button;
  }

  function createWebcamSourceButton(webcam: MediaDeviceInfo, label: string, onClick: () => void): HTMLButtonElement {
    const button = createLiveCaptureSourceButton(label, 'Camera input', undefined, onClick);
    const preview = button.querySelector<HTMLElement>('.live-capture-source-preview');
    if (!preview) {
      return button;
    }
    preview.textContent = '';
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    preview.append(video);
    navigator.mediaDevices
      .getUserMedia({ video: webcam.deviceId ? { deviceId: { exact: webcam.deviceId } } : true, audio: false })
      .then((stream) => {
        video.srcObject = stream;
        activeLiveCaptureModalCleanups.push(() => {
          stream.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
        });
        return video.play();
      })
      .catch((error: unknown) => {
        preview.textContent = error instanceof Error ? 'UNAVAILABLE' : 'NO PREVIEW';
        preview.title = error instanceof Error ? error.message : 'Webcam preview unavailable.';
      });
    return button;
  }

  function getFilteredVisuals(visuals: VisualState[]): VisualState[] {
    return visuals.filter(matchesPoolQuery).sort(comparePoolItems);
  }

  function getFilteredAudioSources(sources: AudioSourceState[], state: DirectorState): AudioSourceState[] {
    return sources
      .filter((source) => {
        const haystack =
          source.type === 'external-file'
            ? `${source.label} ${source.path ?? ''}`
            : `${source.label} ${state.visuals[source.visualId]?.label ?? source.visualId}`;
        return matchesQuery(haystack);
      })
      .sort(comparePoolItems);
  }

  function matchesPoolQuery(item: VisualState | AudioSourceState): boolean {
    const haystack = 'path' in item ? `${item.label} ${item.path ?? ''} ${item.type}` : `${item.label} ${item.type}`;
    return matchesQuery(haystack);
  }

  function matchesQuery(haystack: string): boolean {
    return haystack.toLowerCase().includes(poolSearchQuery.trim().toLowerCase());
  }

  function comparePoolItems<T extends { label: string; ready: boolean; durationSeconds?: number }>(left: T, right: T): number {
    if (poolSort === 'duration') {
      return (left.durationSeconds ?? Number.POSITIVE_INFINITY) - (right.durationSeconds ?? Number.POSITIVE_INFINITY);
    }
    if (poolSort === 'status') {
      return Number(right.ready) - Number(left.ready) || left.label.localeCompare(right.label);
    }
    return left.label.localeCompare(right.label);
  }

  function syncVisualPoolLayoutToggle(): void {
    const btn = elements.visualPoolLayoutToggleButton;
    const visualActive = activePoolTab === 'visuals';
    btn.hidden = !visualActive;
    if (!visualActive) {
      return;
    }
    const grid = visualPoolLayout === 'grid';
    btn.setAttribute('aria-pressed', String(grid));
    if (grid) {
      decorateIconButton(btn, 'List', 'Show list view');
    } else {
      decorateIconButton(btn, 'LayoutGrid', 'Show grid view');
    }
  }

  function syncPoolTabs(): void {
    const visualActive = activePoolTab === 'visuals';
    elements.visualTabButton.classList.toggle('active', visualActive);
    elements.visualTabButton.setAttribute('aria-selected', String(visualActive));
    elements.audioTabButton.classList.toggle('active', !visualActive);
    elements.audioTabButton.setAttribute('aria-selected', String(!visualActive));
    elements.addVisualsButton.title = 'Add media';
    elements.addVisualsButton.setAttribute('aria-label', 'Add media');
    syncVisualPoolLayoutToggle();
  }

  function buildUnifiedImportDeps() {
    return {
      setShowStatus: options.setShowStatus,
      queueEmbeddedAudioImportPrompt: options.queueEmbeddedAudioImportPrompt,
      probeVisualMetadata: options.probeVisualMetadata,
      setSelectedEntity: options.setSelectedEntity,
      renderState: options.renderState,
      selectPoolTab: setPoolTab,
    };
  }

  function setPoolTab(tab: PoolTab): void {
    activePoolTab = tab;
    renderCurrentState();
  }

  function renderCurrentState(): void {
    const state = options.getState();
    if (state) {
      options.renderState(state);
    }
  }

  function isFileDragEvent(event: DragEvent): boolean {
    return Boolean(event.dataTransfer?.types?.includes('Files'));
  }

  function getDroppedFilePaths(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) {
      return [];
    }
    const files = [
      ...Array.from(dataTransfer.files),
      ...Array.from(dataTransfer.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file)),
    ];
    const paths = files.map(getPathForDroppedFile).filter((path): path is string => Boolean(path));
    const uriListPaths = parseDroppedFileUriList(dataTransfer.getData('text/uri-list'));
    return Array.from(new Set([...paths, ...uriListPaths]));
  }

  function getPathForDroppedFile(file: File): string | undefined {
    const path = window.xtream.platform.getPathForFile(file) || (file as File & { path?: string }).path;
    return path || undefined;
  }

  function parseDroppedFileUriList(uriList: string): string[] {
    return uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(fileUriToPath)
      .filter((path): path is string => Boolean(path));
  }

  function fileUriToPath(uri: string): string | undefined {
    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:') {
        return undefined;
      }
      const decodedPath = decodeURIComponent(url.pathname);
      const pathWithHost = url.hostname ? `//${url.hostname}${decodedPath}` : decodedPath;
      if (navigator.platform.toLowerCase().startsWith('win')) {
        const windowsPath = pathWithHost.replace(/\//g, '\\');
        return windowsPath.replace(/^\\([A-Za-z]:\\)/, '$1');
      }
      return pathWithHost;
    } catch {
      return undefined;
    }
  }

  function clearMediaPoolDragOver(event: DragEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && elements.mediaPoolPanel.contains(next)) {
      return;
    }
    elements.mediaPoolPanel.classList.remove('drag-over');
  }

  function install(): void {
    elements.visualTabButton.addEventListener('click', () => setPoolTab('visuals'));
    elements.audioTabButton.addEventListener('click', () => setPoolTab('audio'));
    elements.poolSearchInput.addEventListener('input', () => {
      poolSearchQuery = elements.poolSearchInput.value;
      renderCurrentState();
    });
    elements.poolSortSelect.addEventListener('change', () => {
      poolSort = elements.poolSortSelect.value as PoolSort;
      renderCurrentState();
    });
    elements.mediaPoolPanel.addEventListener('dragover', (event) => {
      if (!isFileDragEvent(event)) {
        return;
      }
      event.preventDefault();
      elements.mediaPoolPanel.classList.add('drag-over');
    });
    elements.mediaPoolPanel.addEventListener('dragleave', clearMediaPoolDragOver);
    elements.mediaPoolPanel.addEventListener('drop', async (event) => {
      event.preventDefault();
      elements.mediaPoolPanel.classList.remove('drag-over');
      const paths = getDroppedFilePaths(event.dataTransfer);
      if (paths.length === 0) {
        options.setShowStatus('Drop import unavailable: no file paths were exposed by the platform.');
        return;
      }
      await runUnifiedMediaPoolImport(paths, buildUnifiedImportDeps());
    });
    elements.visualPoolLayoutToggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      visualPoolLayout = visualPoolLayout === 'list' ? 'grid' : 'list';
      persistVisualPoolLayout(visualPoolLayout);
      renderCurrentState();
    });
    elements.addVisualsButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (activePoolTab === 'audio') {
        await runUnifiedManualMediaImport(buildUnifiedImportDeps());
      } else {
        showAddVisualsMenu();
      }
    });
    document.addEventListener('click', dismissAudioSourceContextMenu);
    window.addEventListener('blur', dismissAudioSourceContextMenu);
  }

  return {
    createRenderSignature,
    createStreamSurfaceShellSignature,
    render,
    syncPoolSelectionHighlight,
    selectEntityPoolTab,
    dismissContextMenu: dismissAudioSourceContextMenu,
    teardownVisualPreviews,
    install,
  };
}

function createVisualRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) => ({
        id: visual.id,
        label: visual.label,
        type: visual.type,
        path: visual.path,
        url: visual.url,
        ready: visual.ready,
        error: visual.error,
        durationSeconds: visual.durationSeconds,
        width: visual.width,
        height: visual.height,
        hasEmbeddedAudio: visual.hasEmbeddedAudio,
        kind: visual.kind,
        capture: visual.kind === 'live' ? visual.capture : undefined,
        opacity: visual.opacity,
        brightness: visual.brightness,
        contrast: visual.contrast,
        playbackRate: visual.playbackRate,
        fileSizeBytes: visual.fileSizeBytes,
      })),
  );
}

/**
 * Key for rebuilding media pool list/grid rows. For live visuals, omits `width`, `height`, and `ready`
 * so hover pool preview metadata does not thrash the DOM (that feedback loop would detach/re-attach capture in a loop).
 */
function createVisualPoolContentSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) =>
        visual.kind === 'live'
          ? {
              id: visual.id,
              label: visual.label,
              type: visual.type,
              path: visual.path,
              url: visual.url,
              error: visual.error,
              durationSeconds: visual.durationSeconds,
              hasEmbeddedAudio: visual.hasEmbeddedAudio,
              kind: visual.kind,
              capture: visual.capture,
              opacity: visual.opacity,
              brightness: visual.brightness,
              contrast: visual.contrast,
              playbackRate: visual.playbackRate,
              fileSizeBytes: visual.fileSizeBytes,
            }
          : {
              id: visual.id,
              label: visual.label,
              type: visual.type,
              path: visual.path,
              url: visual.url,
              ready: visual.ready,
              error: visual.error,
              durationSeconds: visual.durationSeconds,
              width: visual.width,
              height: visual.height,
              hasEmbeddedAudio: visual.hasEmbeddedAudio,
              kind: visual.kind,
              capture: undefined,
              opacity: visual.opacity,
              brightness: visual.brightness,
              contrast: visual.contrast,
              playbackRate: visual.playbackRate,
              fileSizeBytes: visual.fileSizeBytes,
            },
      ),
  );
}

function createAudioRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.audioSources)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => ({
        id: source.id,
        label: source.label,
        type: source.type,
        durationSeconds: source.durationSeconds,
        ready: source.ready,
        error: source.error,
        fileSizeBytes: source.fileSizeBytes,
        playbackRate: source.playbackRate,
        levelDb: source.levelDb,
        channelCount: source.channelCount,
        channelMode: source.channelMode,
        derivedFromAudioSourceId: source.derivedFromAudioSourceId,
        ...(source.type === 'external-file'
          ? {
              path: source.path,
              url: source.url,
            }
          : {
              visualId: source.visualId,
              extractionMode: source.extractionMode,
              extractionStatus: source.extractionStatus,
              extractedPath: source.extractedPath,
              extractedUrl: source.extractedUrl,
              extractedFormat: source.extractedFormat,
              visualLabel: state.visuals[source.visualId]?.label,
            }),
      })),
  );
}
