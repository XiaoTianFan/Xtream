import type { DirectorState, VisualState } from '../../../shared/types';
import { decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { runUnifiedManualMediaImport, runUnifiedMediaPoolImport } from './unifiedMediaPoolImport';
import { createMediaPoolContextMenuController } from './mediaPool/contextMenus';
import { getDroppedFilePaths, isFileDragEvent } from './mediaPool/dragDrop';
import { getFilteredAudioSources, getFilteredVisuals, type PoolSort } from './mediaPool/filtering';
import { readStoredVisualPoolLayout, persistVisualPoolLayout } from './mediaPool/layoutPrefs';
import { createLiveCaptureModalController } from './mediaPool/liveCaptureModal';
import { createAudioSourceRow, createVisualGridCard, createVisualRow } from './mediaPool/rows';
import {
  createAudioRenderSignature,
  createVisualPoolContentSignature,
  createVisualRenderSignature,
} from './mediaPool/signatures';
import type { MediaPoolControllerOptions, PoolTab, VisualPoolLayout } from './mediaPool/types';

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

export function createMediaPoolController(elements: MediaPoolElements, options: MediaPoolControllerOptions): MediaPoolController {
  let activePoolTab: PoolTab = 'visuals';
  let poolSearchQuery = '';
  let poolSort: PoolSort = 'label';
  let visualPoolLayout: VisualPoolLayout = readStoredVisualPoolLayout();
  let visualPoolGridCleanups: Array<() => void> = [];
  let lastListVisualsDomKey: string | undefined;
  let lastGridVisualsDomKey: string | undefined;

  const liveCaptureModal = createLiveCaptureModalController({
    setShowStatus: options.setShowStatus,
    setSelectedEntity: options.setSelectedEntity,
    renderState: options.renderState,
  });
  const contextMenus = createMediaPoolContextMenuController({
    getStatePaused: () => options.getState()?.paused,
    setShowStatus: options.setShowStatus,
    setSelectedEntity: options.setSelectedEntity,
    renderDirectorState: async () => {
      options.renderState(await window.xtream.director.getState());
    },
    createEmbeddedAudioRepresentation: options.createEmbeddedAudioRepresentation,
    extractEmbeddedAudioFile: options.extractEmbeddedAudioFile,
    runManualImport: () => runUnifiedManualMediaImport(buildUnifiedImportDeps()),
    openLiveCaptureModal: liveCaptureModal.open,
  });

  const rowDeps = {
    isSelected: options.isSelected,
    selectPoolEntity,
    showVisualContextMenu: contextMenus.showVisualContextMenu,
    showAudioSourceContextMenu: contextMenus.showAudioSourceContextMenu,
    getShowConfigPath: options.getShowConfigPath,
    confirmPoolRecordRemoval,
    clearSelectionIf: options.clearSelectionIf,
    renderPool: render,
    renderState: options.renderState,
    registerVisualPreviewCleanup: (cleanup: () => void) => {
      visualPoolGridCleanups.push(cleanup);
    },
  };

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
      const listRows = getFilteredVisuals(Object.values(state.visuals), poolSearchQuery, poolSort).map((visual) => createVisualRow(visual, rowDeps));
      elements.visualListListPane.replaceChildren(
        ...(listRows.length > 0 ? listRows : [createMediaPoolEmptyState(visualPoolEmptyMessage(state), () => void runUnifiedManualMediaImport(buildUnifiedImportDeps()))]),
      );
      lastListVisualsDomKey = cKey;
    }

    if (lastGridVisualsDomKey !== cKey || !paneShowsPoolItems(elements.visualListGridPane)) {
      clearVisualPoolGridCleanups();
      const gridCards = getFilteredVisuals(Object.values(state.visuals), poolSearchQuery, poolSort).map((visual) => createVisualGridCard(visual, rowDeps));
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
    const audioRows = getFilteredAudioSources(Object.values(state.audioSources), state, poolSearchQuery, poolSort).map((source) =>
      createAudioSourceRow(source, state, rowDeps),
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
      probeAudioMetadata: options.probeAudioMetadata,
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
      if (!isFileDragEvent(event)) {
        return;
      }
      event.preventDefault();
      elements.mediaPoolPanel.classList.remove('drag-over');
      const paths = getDroppedFilePaths(event.dataTransfer, window.xtream.platform.getPathForFile);
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
        contextMenus.showAddVisualsMenu(elements.addVisualsButton);
      }
    });
    document.addEventListener('click', contextMenus.dismiss);
    window.addEventListener('blur', contextMenus.dismiss);
  }

  return {
    createRenderSignature,
    createStreamSurfaceShellSignature,
    render,
    syncPoolSelectionHighlight,
    selectEntityPoolTab,
    dismissContextMenu: contextMenus.dismiss,
    teardownVisualPreviews,
    install,
  };
}
