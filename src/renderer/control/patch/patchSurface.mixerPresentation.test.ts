/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState } from '../../../shared/types';

const mocks = vi.hoisted(() => {
  const patchElements = {
    visualList: document.createElement('div') as HTMLDivElement,
    audioPanel: document.createElement('div') as HTMLDivElement,
    displayList: document.createElement('div') as HTMLDivElement,
    outputPanel: document.createElement('div') as HTMLDivElement,
    detailsContent: document.createElement('div') as HTMLDivElement,
    createOutputButton: document.createElement('button') as HTMLButtonElement,
    expandMixerButton: document.createElement('button') as HTMLButtonElement,
    createDisplayButton: document.createElement('button') as HTMLButtonElement,
  };
  const mixerPanel = {
    createRenderSignature: vi.fn((state: DirectorState) =>
      JSON.stringify(
        Object.values(state.outputs)
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((output) => ({
            id: output.id,
            sources: output.sources.map((source) => source.audioSourceId),
          })),
      ),
    ),
    pruneSoloOutputIds: vi.fn(() => false),
    setSoloOutputIds: vi.fn(),
    applyEngineSoloOutputIds: vi.fn(),
    getSoloOutputCount: vi.fn(() => 0),
    renderOutputs: vi.fn(),
    syncSelection: vi.fn(),
    syncOutputMeters: vi.fn(),
    applyOutputMeterReport: vi.fn(),
    tickMeterBallistics: vi.fn(),
    createOutputDetailMixerStrip: vi.fn(() => document.createElement('div')),
    createOutputSourceControls: vi.fn(() => document.createElement('div')),
  };
  return { patchElements, mixerPanel };
});

vi.mock('./elements', () => ({
  patchElements: mocks.patchElements,
}));

vi.mock('./mixerPanel', () => ({
  createMixerPanelController: vi.fn(() => mocks.mixerPanel),
}));

vi.mock('./detailsPane', () => ({
  createDetailsPaneController: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

vi.mock('./displayPreview', () => ({
  syncPreviewElements: vi.fn(),
}));

vi.mock('./displayWorkspace', () => ({
  createDisplayWorkspaceController: vi.fn(() => ({
    createRenderSignature: vi.fn((state: DirectorState) => JSON.stringify(Object.keys(state.displays).sort())),
    render: vi.fn(),
    syncCardSummaries: vi.fn(),
    getDisplayStatusLabel: vi.fn(),
    getDisplayTelemetry: vi.fn(),
    createMappingControls: vi.fn(),
  })),
}));

vi.mock('./embeddedAudioImport', () => ({
  createEmbeddedAudioImportController: vi.fn(() => ({
    queueEmbeddedAudioImportPrompt: vi.fn(),
    probeVisualMetadata: vi.fn(),
    createEmbeddedAudioRepresentation: vi.fn(),
    extractEmbeddedAudioFile: vi.fn(),
    reportVisualMetadataFromVideo: vi.fn(),
    maybePromptEmbeddedAudioImport: vi.fn(),
  })),
}));

vi.mock('../app/showProjectPath', () => ({
  getShownProjectPath: vi.fn(() => undefined),
}));

vi.mock('./layoutPrefs', () => ({
  applyLayoutPrefs: vi.fn(),
  getMaxMixerWidth: vi.fn(() => 480),
  installSplitters: vi.fn(),
  mergeImportedLayoutPrefs: vi.fn(),
  readLayoutPrefs: vi.fn(() => ({})),
  restoreTemporaryMixerExpansion: vi.fn(),
  setTemporaryMixerWidth: vi.fn(),
}));

vi.mock('./mediaPool', () => ({
  createMediaPoolController: vi.fn(() => ({
    install: vi.fn(),
    render: vi.fn(),
    syncPoolSelectionHighlight: vi.fn(),
    createRenderSignature: vi.fn(() => 'media'),
    selectEntityPoolTab: vi.fn(),
    dismissContextMenu: vi.fn(),
  })),
}));

vi.mock('./patchHeader', () => ({
  createPatchHeaderController: vi.fn(() => ({
    sync: vi.fn(),
    install: vi.fn(),
    tick: vi.fn(),
    handleWorkspaceTransportKeydown: vi.fn(),
  })),
}));

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(() => Promise.resolve(true)),
}));

function directorWithSource(audioSourceId: string): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: false,
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    controlDisplayPreviewMaxFps: 15,
    visuals: {},
    audioSources: {
      [audioSourceId]: {
        id: audioSourceId,
        label: audioSourceId,
        type: 'external-file',
        ready: true,
        channelCount: 2,
      },
    },
    outputs: {
      'output-main': {
        id: 'output-main',
        label: 'Main',
        sources: [{ audioSourceId, levelDb: 0 }],
        busLevelDb: 0,
        ready: true,
        physicalRoutingAvailable: true,
        fallbackReason: 'none',
      },
    },
    displays: {},
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [audioSourceId] },
    audioRendererReady: true,
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  } as unknown as DirectorState;
}

describe('createPatchSurfaceController presentation mixer sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses presentation state for the initial mixer render signature', async () => {
    const { createPatchSurfaceController } = await import('./patchSurface');
    const raw = directorWithSource('patch-audio');
    const presentation = directorWithSource('stream-audio:scene-a:sub-a:output-main');
    const controller = createPatchSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      isPanelInteractionActive: () => false,
      getPresentationState: () => presentation,
      getIsStreamPlaybackActive: () => true,
      renderState: vi.fn(),
      setActiveSurface: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
    });

    controller.render(raw);

    expect(mocks.mixerPanel.createRenderSignature).toHaveBeenCalledWith(presentation);
    expect(mocks.mixerPanel.renderOutputs).toHaveBeenCalledWith(raw);
  });

  it('rebuilds Patch mixer strips when Stream presentation topology changes without a director render', async () => {
    const { createPatchSurfaceController } = await import('./patchSurface');
    const raw = directorWithSource('patch-audio');
    let presentation = directorWithSource('stream-audio:scene-a:sub-a:output-main');
    const controller = createPatchSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      isPanelInteractionActive: () => false,
      getPresentationState: () => presentation,
      getIsStreamPlaybackActive: () => true,
      renderState: vi.fn(),
      setActiveSurface: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
    });

    controller.render(raw);
    expect(mocks.mixerPanel.renderOutputs).toHaveBeenCalledTimes(1);

    presentation = directorWithSource('stream-audio:scene-b:sub-b:output-main');
    controller.syncPresentationMixer();

    expect(mocks.mixerPanel.renderOutputs).toHaveBeenCalledTimes(2);
    expect(mocks.mixerPanel.renderOutputs).toHaveBeenLastCalledWith(raw);
    expect(mocks.mixerPanel.syncOutputMeters).toHaveBeenCalledTimes(2);

    controller.syncPresentationMixer();

    expect(mocks.mixerPanel.renderOutputs).toHaveBeenCalledTimes(2);
    expect(mocks.mixerPanel.syncOutputMeters).toHaveBeenCalledTimes(3);
  });
});
