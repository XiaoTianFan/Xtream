import type { ControlProjectUiPatchLayout, DirectorState, DisplayMonitorInfo, MediaValidationIssue } from '../../../shared/types';
import type { ShowActions } from '../app/showActions';
import { patchElements as elements } from './elements';
import type { ControlSurface, SelectedEntity } from '../shared/types';
import { createDetailsPaneController } from './detailsPane';
import { syncPreviewElements } from './displayPreview';
import { createDisplayWorkspaceController } from './displayWorkspace';
import { createEmbeddedAudioImportController } from './embeddedAudioImport';
import { getShownProjectPath } from '../app/showProjectPath';
import {
  applyLayoutPrefs,
  getMaxMixerWidth,
  installSplitters,
  mergeImportedLayoutPrefs,
  readLayoutPrefs,
  restoreTemporaryMixerExpansion,
  setTemporaryMixerWidth,
} from './layoutPrefs';
import { createMediaPoolController } from './mediaPool';
import { createMixerPanelController } from './mixerPanel';
import { createPatchHeaderController, type PatchHeaderController } from './patchHeader';
import { shellShowConfirm } from '../shell/shellModalPresenter';

type PatchSurfaceOptions = {
  getAudioDevices: () => MediaDeviceInfo[];
  getDisplayMonitors: () => DisplayMonitorInfo[];
  isPanelInteractionActive: (panel: HTMLElement) => boolean;
  /** Stream-aware director state for display previews + mixer metering (matches audio renderer). */
  getPresentationState: () => DirectorState | undefined;
  getIsStreamPlaybackActive: () => boolean;
  renderState: (state: DirectorState) => void;
  setActiveSurface: (surface: ControlSurface) => void;
  setShowStatus: (message: string, issues?: MediaValidationIssue[]) => void;
  showActions: ShowActions;
};

export type PatchSurfaceController = ReturnType<typeof createPatchSurfaceController>;

export function createPatchSurfaceController(options: PatchSurfaceOptions) {
  let currentState: DirectorState | undefined;
  let selectedEntity: SelectedEntity | undefined;
  let visualRenderSignature = '';
  let audioRenderSignature = '';
  let displayRenderSignature = '';
  let header: PatchHeaderController;

  const embeddedAudioImport = createEmbeddedAudioImportController({
    getState: () => currentState,
    getAudioExtractionFormat: () => currentState?.audioExtractionFormat,
    setSelectedEntity: (entity) => {
      selectedEntity = entity;
    },
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
  });

  const displayWorkspace = createDisplayWorkspaceController(elements, {
    getState: () => options.getPresentationState() ?? currentState,
    isSelected,
    selectEntity,
    clearSelectionIf,
    renderState: options.renderState,
  });

  let refreshDetailsPane: (state: DirectorState) => void = () => undefined;
  const mixerPanel = createMixerPanelController(elements, {
    getState: () => currentState,
    getMeteringState: () => options.getPresentationState() ?? currentState,
    getAudioDevices: options.getAudioDevices,
    isSelected,
    selectEntity,
    clearSelectionIf,
    renderState: options.renderState,
    syncTransportInputs: (state) => header.sync(state),
    refreshDetails: (state) => refreshDetailsPane(state),
  });

  const detailsPane = createDetailsPaneController({
    getSelectedEntity: () => selectedEntity,
    setSelectedEntity: (entity) => {
      selectedEntity = entity;
    },
    getDisplayMonitors: options.getDisplayMonitors,
    getAudioDevices: options.getAudioDevices,
    isPanelInteractionActive: options.isPanelInteractionActive,
    renderState: options.renderState,
    clearSelectionIf,
    confirmPoolRecordRemoval,
    queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
    probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
    getDisplayStatusLabel: displayWorkspace.getDisplayStatusLabel,
    getDisplayTelemetry: displayWorkspace.getDisplayTelemetry,
    createMappingControls: displayWorkspace.createMappingControls,
    createOutputDetailMixerStrip: mixerPanel.createOutputDetailMixerStrip,
    createOutputSourceControls: mixerPanel.createOutputSourceControls,
    reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
  });

  refreshDetailsPane = (state: DirectorState) => {
    detailsPane.render(state, true);
  };

  const mediaPool = createMediaPoolController(elements, {
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
    getShowConfigPath: () => getShownProjectPath(),
  });

  header = createPatchHeaderController({
    getState: () => currentState,
    getIsStreamPlaybackActive: options.getIsStreamPlaybackActive,
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
    showActions: options.showActions,
  });

  function render(state: DirectorState): void {
    currentState = state;
    if (mixerPanel.pruneSoloOutputIds(state)) {
      audioRenderSignature = '';
    }
    header.sync(state);
    const nextAudioRenderSignature = mixerPanel.createRenderSignature(state);
    const nextVisualRenderSignature = mediaPool.createRenderSignature(state);
    if (
      !options.isPanelInteractionActive(elements.visualList) &&
      !options.isPanelInteractionActive(elements.audioPanel) &&
      visualRenderSignature !== nextVisualRenderSignature
    ) {
      visualRenderSignature = nextVisualRenderSignature;
      mediaPool.render(state);
    }
    if (!options.isPanelInteractionActive(elements.visualList) && !options.isPanelInteractionActive(elements.audioPanel)) {
      mediaPool.syncPoolSelectionHighlight(state);
    }
    if (!options.isPanelInteractionActive(elements.outputPanel) && audioRenderSignature !== nextAudioRenderSignature) {
      audioRenderSignature = nextAudioRenderSignature;
      mixerPanel.renderOutputs(state);
    }
    mixerPanel.syncOutputMeters(state);
    const presentation = options.getPresentationState() ?? state;
    const nextDisplayRenderSignature = displayWorkspace.createRenderSignature(presentation);
    if (!options.isPanelInteractionActive(elements.displayList) && displayRenderSignature !== nextDisplayRenderSignature) {
      displayRenderSignature = nextDisplayRenderSignature;
      displayWorkspace.render(Object.values(presentation.displays));
    } else {
      displayWorkspace.syncCardSummaries(Object.values(presentation.displays));
    }
    detailsPane.render(state);
    void embeddedAudioImport.maybePromptEmbeddedAudioImport(state);
  }

  function install(): void {
    installSplitters();
    mediaPool.install();
    header.install();
    elements.createOutputButton.addEventListener('click', async () => {
      const output = await window.xtream.outputs.create();
      selectedEntity = { type: 'output', id: output.id };
      options.renderState(await window.xtream.director.getState());
    });
    elements.expandMixerButton.addEventListener('click', () => {
      setTemporaryMixerWidth(getMaxMixerWidth());
    });
    elements.createDisplayButton.addEventListener('click', async () => {
      const display = await window.xtream.displays.create({ layout: { type: 'single', visualId: Object.keys(currentState?.visuals ?? {})[0] } });
      selectedEntity = { type: 'display', id: display.id };
      options.renderState(await window.xtream.director.getState());
    });
  }

  function tick(): void {
    header.tick();
    mixerPanel.tickMeterBallistics(performance.now());
  }

  function selectEntity(entity: SelectedEntity): void {
    options.setActiveSurface('patch');
    selectedEntity = entity;
    mixerPanel.syncSelection(selectedEntity);
    restoreTemporaryMixerExpansion();
    mediaPool.selectEntityPoolTab(entity);
    if (currentState) {
      options.renderState(currentState);
    }
  }

  function clearSelection(): void {
    selectedEntity = undefined;
  }

  function clearSelectionIf(entity: SelectedEntity): void {
    if (selectedEntity?.type === entity.type && selectedEntity.id === entity.id) {
      selectedEntity = undefined;
      applyLayoutPrefs(readLayoutPrefs());
    }
  }

  function isSelected(type: SelectedEntity['type'], id: string): boolean {
    return selectedEntity?.type === type && selectedEntity.id === id;
  }

  async function confirmPoolRecordRemoval(label: string): Promise<boolean> {
    return shellShowConfirm(
      'Remove from media pool',
      `Remove "${label}" from the media pool?`,
      'This only removes the project record from the pool. It will not erase or delete the media file from disk.',
    );
  }

  function exportLayoutUiSnapshot(): ControlProjectUiPatchLayout {
    return { ...readLayoutPrefs() };
  }

  function applyImportedLayoutUi(prefs: ControlProjectUiPatchLayout | undefined): void {
    if (!prefs || Object.keys(prefs).length === 0) {
      return;
    }
    mergeImportedLayoutPrefs(prefs);
  }

  return {
    id: 'patch' as const,
    render,
    install,
    tick,
    getSoloOutputCount: mixerPanel.getSoloOutputCount,
    clearSoloOutputs: () => {
      mixerPanel.setSoloOutputIds([]);
    },
    syncPreviewElements: (presentation: DirectorState) => {
      syncPreviewElements(presentation);
    },
    dismissContextMenu: mediaPool.dismissContextMenu,
    handleWorkspaceTransportKeydown: (event: KeyboardEvent) => header.handleWorkspaceTransportKeydown(event),
    clearSelection,
    applyOutputMeterReport: mixerPanel.applyOutputMeterReport,
    applyEngineSoloOutputIds: mixerPanel.applyEngineSoloOutputIds,
    getDisplayStatusLabel: displayWorkspace.getDisplayStatusLabel,
    getDisplayTelemetry: displayWorkspace.getDisplayTelemetry,
    exportLayoutUiSnapshot,
    applyImportedLayoutUi,
    syncTransportInputs: () => {
      if (currentState) {
        header.sync(currentState);
      }
    },
  };
}
