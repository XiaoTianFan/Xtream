/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';

vi.mock('../shell/elements', () => ({
  elements: {
    appFrame: document.createElement('div'),
    surfacePanel: document.createElement('section'),
  },
}));

vi.mock('../patch/displayPreview', () => ({
  syncPreviewElements: vi.fn(),
}));

vi.mock('../patch/displayWorkspace', () => ({
  createDisplayWorkspaceController: vi.fn(() => ({
    createRenderSignature: () => 'display',
    syncPreviewElements: vi.fn(),
  })),
}));

vi.mock('../patch/embeddedAudioImport', () => ({
  createEmbeddedAudioImportController: vi.fn(() => ({
    queueEmbeddedAudioImportPrompt: vi.fn(),
    probeVisualMetadata: vi.fn(),
    createEmbeddedAudioRepresentation: vi.fn(),
    extractEmbeddedAudioFile: vi.fn(),
    maybePromptEmbeddedAudioImport: vi.fn(),
  })),
}));

vi.mock('../patch/mediaPool', () => ({
  createMediaPoolController: vi.fn(() => ({
    install: vi.fn(),
    render: vi.fn(),
    syncPoolSelectionHighlight: vi.fn(),
    createStreamSurfaceShellSignature: () => 'pool',
    dismissContextMenu: vi.fn(),
    teardownVisualPreviews: vi.fn(),
  })),
}));

vi.mock('../patch/mixerPanel', () => ({
  createMixerPanelController: vi.fn(() => ({
    applyEngineSoloOutputIds: vi.fn(),
    pruneSoloOutputIds: () => false,
    syncOutputMeters: vi.fn(),
    createRenderSignature: () => 'mixer',
    applyOutputMeterReport: vi.fn(),
    tickMeterBallistics: vi.fn(),
  })),
}));

vi.mock('../app/interactionLocks', () => ({
  installInteractionLock: vi.fn(),
  isPanelInteractionActive: vi.fn(() => false),
}));

vi.mock('./layoutPrefs', () => ({
  applyStreamLayoutPrefs: vi.fn(),
  createStreamLayoutController: vi.fn(() => ({
    syncSplitterAria: vi.fn(),
    installSplitters: vi.fn(),
  })),
  mergeStreamLayoutFromSnapshot: vi.fn(),
  readStreamLayoutPrefs: vi.fn(() => ({})),
}));

vi.mock('./streamHeader', () => ({
  createGlobalStreamPlayCommand: vi.fn(() => ({ type: 'play' })),
  deriveStreamTransportUiState: vi.fn(() => ({ playDisabled: false, pauseDisabled: false, backDisabled: false })),
  renderStreamHeader: vi.fn(({ headerEl }) => {
    headerEl.textContent = 'STREAM HEADER';
  }),
  syncStreamHeaderRuntime: vi.fn(),
}));

vi.mock('./workspacePane', () => ({
  renderStreamWorkspacePane: vi.fn((panel) => {
    panel.textContent = 'STREAM WORKSPACE';
  }),
}));

vi.mock('./workspacePaneSignature', () => ({
  createStreamWorkspacePaneSignature: vi.fn(() => 'workspace'),
}));

vi.mock('./bottomPane', () => ({
  renderStreamBottomPane: vi.fn((panel) => {
    panel.textContent = 'STREAM BOTTOM';
  }),
}));

vi.mock('./streamMixerBottomRedrawDefer', () => ({
  shouldDeferStreamMixerBottomPaneRedraw: vi.fn(() => false),
}));

vi.mock('./flowMode', () => ({
  syncStreamFlowModeRuntimeChrome: vi.fn(),
}));

vi.mock('./ganttMode', () => ({
  syncStreamGanttRuntimeChrome: vi.fn(),
}));

vi.mock('./streamSignature', () => ({
  snapshotDisplaysForStreamSignature: vi.fn(() => []),
}));

vi.mock('../shell/shellModalPresenter', () => ({
  shellShowConfirm: vi.fn(() => Promise.resolve(true)),
}));

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}

function streamConfig(): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Show stream',
    sceneOrder: ['scene-a'],
    scenes: {
      'scene-a': {
        id: 'scene-a',
        title: 'Scene A',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false, leadTimeMs: 0 },
        subCueOrder: [],
        subCues: {},
      },
    },
  };
}

function streamPublic(): StreamEnginePublicState {
  const stream = streamConfig();
  const timeline = {
    status: 'valid',
    expectedDurationMs: 0,
    entries: {},
    validationMessages: [],
    mainSegments: [],
  };
  return {
    stream,
    playbackStream: stream,
    editTimeline: timeline,
    playbackTimeline: timeline,
    validationMessages: [],
    runtime: null,
  } as unknown as StreamEnginePublicState;
}

describe('createStreamSurfaceController state hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    window.xtream = {
      stream: {
        onState: vi.fn(() => () => undefined),
        getState: vi.fn(() => Promise.resolve(streamPublic())),
      },
    } as unknown as typeof window.xtream;
  });

  it('renders the dynamic stream panes when stream state is primed before mount', async () => {
    const { elements } = await import('../shell/elements');
    const { createStreamSurfaceController } = await import('./streamSurface');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.applyStreamState(streamPublic());
    controller.render(director());

    expect(elements.surfacePanel.textContent).toContain('STREAM HEADER');
    expect(elements.surfacePanel.textContent).toContain('STREAM WORKSPACE');
    expect(elements.surfacePanel.textContent).toContain('STREAM BOTTOM');
  });
});
