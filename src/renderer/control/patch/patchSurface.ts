import type { DirectorState, DisplayMonitorInfo, MediaValidationIssue } from '../../../shared/types';
import type { ShowActions } from '../app/showActions';
import { patchElements as elements } from './elements';
import type { ControlSurface, SelectedEntity } from '../shared/types';
import { createAssetPreviewController } from './assetPreview';
import { createDetailsPaneController } from './detailsPane';
import { syncPreviewElements } from './displayPreview';
import { createDisplayWorkspaceController } from './displayWorkspace';
import { createEmbeddedAudioImportController } from './embeddedAudioImport';
import {
  applyLayoutPrefs,
  getMaxMixerWidth,
  installSplitters,
  readLayoutPrefs,
  restoreTemporaryMixerExpansion,
  setTemporaryMixerWidth,
} from './layoutPrefs';
import { createMediaPoolController } from './mediaPool';
import { createMixerPanelController } from './mixerPanel';
import { createPatchHeaderController, type PatchHeaderController } from './patchHeader';

type PatchSurfaceOptions = {
  getAudioDevices: () => MediaDeviceInfo[];
  getDisplayMonitors: () => DisplayMonitorInfo[];
  isPanelInteractionActive: (panel: HTMLElement) => boolean;
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

  const assetPreview = createAssetPreviewController(elements, {
    reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
  });

  const displayWorkspace = createDisplayWorkspaceController(elements, {
    getState: () => currentState,
    isSelected,
    selectEntity,
    clearSelectionIf,
    renderState: options.renderState,
  });

  let refreshDetailsPane = (state: DirectorState) => {
    detailsPane.render(state, true);
  };
  const mixerPanel = createMixerPanelController(elements, {
    getState: () => currentState,
    getAudioDevices: options.getAudioDevices,
    isSelected,
    selectEntity,
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
  });

  header = createPatchHeaderController({
    getState: () => currentState,
    getSoloOutputCount: mixerPanel.getSoloOutputCount,
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
    const nextVisualRenderSignature = mediaPool.createRenderSignature(state, selectedEntity);
    if (
      !options.isPanelInteractionActive(elements.visualList) &&
      !options.isPanelInteractionActive(elements.audioPanel) &&
      visualRenderSignature !== nextVisualRenderSignature
    ) {
      visualRenderSignature = nextVisualRenderSignature;
      mediaPool.render(state);
    }
    if (!options.isPanelInteractionActive(elements.outputPanel) && audioRenderSignature !== nextAudioRenderSignature) {
      audioRenderSignature = nextAudioRenderSignature;
      mixerPanel.renderOutputs(state);
    }
    mixerPanel.syncOutputMeters(state);
    const nextDisplayRenderSignature = displayWorkspace.createRenderSignature(state);
    if (!options.isPanelInteractionActive(elements.displayList) && displayRenderSignature !== nextDisplayRenderSignature) {
      displayRenderSignature = nextDisplayRenderSignature;
      displayWorkspace.render(Object.values(state.displays));
    } else {
      displayWorkspace.syncCardSummaries(Object.values(state.displays));
    }
    detailsPane.render(state);
    assetPreview.render(state, selectedEntity);
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
    elements.clearSoloButton.addEventListener('click', () => {
      mixerPanel.setSoloOutputIds([]);
    });
    elements.resetMetersButton.addEventListener('click', () => {
      mixerPanel.resetMeters(currentState);
    });
    elements.createDisplayButton.addEventListener('click', async () => {
      const display = await window.xtream.displays.create({ layout: { type: 'single', visualId: Object.keys(currentState?.visuals ?? {})[0] } });
      selectedEntity = { type: 'display', id: display.id };
      options.renderState(await window.xtream.director.getState());
    });
  }

  function tick(): void {
    header.tick();
  }

  function selectEntity(entity: SelectedEntity): void {
    options.setActiveSurface('patch');
    selectedEntity = entity;
    mixerPanel.syncSelection(selectedEntity);
    restoreTemporaryMixerExpansion();
    mediaPool.selectEntityPoolTab(entity);
    if (currentState) {
      visualRenderSignature = '';
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

  function confirmPoolRecordRemoval(label: string): boolean {
    return window.confirm(
      `Remove "${label}" from the media pool?\n\nThis only removes the project record from the pool. It will not erase or delete the media file from disk.`,
    );
  }

  return {
    id: 'patch' as const,
    render,
    install,
    tick,
    syncPreviewElements: () => {
      if (currentState) {
        syncPreviewElements(currentState);
      }
    },
    dismissContextMenu: mediaPool.dismissContextMenu,
    clearSelection,
    applyOutputMeterReport: mixerPanel.applyOutputMeterReport,
    getDisplayStatusLabel: displayWorkspace.getDisplayStatusLabel,
    getDisplayTelemetry: displayWorkspace.getDisplayTelemetry,
  };
}
