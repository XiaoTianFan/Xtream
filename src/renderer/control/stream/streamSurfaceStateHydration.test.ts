/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../shared/types';
import type { StreamWorkspacePaneContext } from './workspacePane';

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

vi.mock('./workspacePane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspacePane')>();
  return {
    ...actual,
    renderStreamWorkspacePane: vi.fn(actual.renderStreamWorkspacePane),
  };
});

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

vi.mock('./listMode', () => ({
  scenesExplicitlyFollowing: vi.fn(() => []),
  createStreamListMode: vi.fn((_stream, ctx) => {
    const root = document.createElement('div');
    root.dataset.testMode = ctx.mode;
    root.textContent = 'STREAM WORKSPACE list';
    return root;
  }),
}));

vi.mock('./flowMode', () => ({
  createStreamFlowMode: vi.fn((_stream, ctx) => {
    const root = document.createElement('div');
    root.dataset.testMode = ctx.mode;
    root.textContent = 'STREAM WORKSPACE flow';
    return root;
  }),
  syncStreamFlowModeRuntimeChrome: vi.fn(),
}));

vi.mock('./ganttMode', () => ({
  createStreamGanttMode: vi.fn((_stream, ctx) => {
    const root = document.createElement('div');
    root.dataset.testMode = ctx.mode;
    root.textContent = 'STREAM WORKSPACE gantt';
    return root;
  }),
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

function runningStreamPublic(cursorMs = 0): StreamEnginePublicState {
  const pub = streamPublic();
  return {
    ...pub,
    runtime: {
      status: 'running',
      sceneStates: {
        'scene-a': {
          sceneId: 'scene-a',
          status: 'running',
          scheduledStartMs: 0,
          progress: cursorMs / 1000,
        },
      },
      currentStreamMs: cursorMs,
      expectedDurationMs: 1000,
    },
  } as unknown as StreamEnginePublicState;
}

function streamPublicWithFlowLayout(): StreamEnginePublicState {
  const pub = streamPublic();
  const stream = structuredClone(pub.stream);
  stream.flowViewport = { x: 120, y: -40, zoom: 1.2 };
  stream.scenes['scene-a']!.flow = { x: 440, y: 150, width: 320, height: 156 };
  return {
    ...pub,
    stream,
    playbackStream: stream,
    playbackTimeline: { ...pub.playbackTimeline, revision: ((pub.playbackTimeline as { revision?: number }).revision ?? 0) + 1 },
  };
}

describe('createStreamSurfaceController state hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    window.xtream = {
      stream: {
        onState: vi.fn(() => () => undefined),
        getState: vi.fn(() => Promise.resolve(streamPublic())),
        transport: vi.fn(),
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
      getLatestStreamState: () => undefined,
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

  it('renders dynamic panes from the cached latest stream state during surface render', async () => {
    const { elements } = await import('../shell/elements');
    const { createStreamSurfaceController } = await import('./streamSurface');
    const latest = streamPublic();
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => latest,
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());

    expect(elements.surfacePanel.textContent).toContain('STREAM HEADER');
    expect(elements.surfacePanel.textContent).toContain('STREAM WORKSPACE');
    expect(elements.surfacePanel.textContent).toContain('STREAM BOTTOM');
  });

  it('syncs runtime-only updates without rerendering the workspace pane', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { syncStreamHeaderRuntime } = await import('./streamHeader');
    const { syncStreamFlowModeRuntimeChrome } = await import('./flowMode');
    const { syncStreamGanttRuntimeChrome } = await import('./ganttMode');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => runningStreamPublic(100),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    vi.mocked(renderStreamWorkspacePane).mockClear();
    controller.applyStreamState(runningStreamPublic(500));

    expect(renderStreamWorkspacePane).not.toHaveBeenCalled();
    expect(syncStreamHeaderRuntime).toHaveBeenCalled();
    expect(syncStreamFlowModeRuntimeChrome).toHaveBeenCalled();
    expect(syncStreamGanttRuntimeChrome).toHaveBeenCalled();
  });

  it('syncs flow viewport and card geometry updates without rerendering the workspace pane', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { syncStreamFlowModeRuntimeChrome } = await import('./flowMode');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => streamPublic(),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    vi.mocked(renderStreamWorkspacePane).mockClear();
    vi.mocked(syncStreamFlowModeRuntimeChrome).mockClear();
    controller.applyStreamState(streamPublicWithFlowLayout());

    expect(renderStreamWorkspacePane).not.toHaveBeenCalled();
    expect(syncStreamFlowModeRuntimeChrome).toHaveBeenCalled();
  });

  it('rerenders the workspace when mode changes during running playback', async () => {
    const { elements } = await import('../shell/elements');
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { createStreamFlowMode } = await import('./flowMode');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => runningStreamPublic(100),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    vi.mocked(renderStreamWorkspacePane).mockClear();
    vi.mocked(createStreamFlowMode).mockClear();
    [...elements.surfacePanel.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === 'Flow')
      ?.click();

    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
    expect(createStreamFlowMode).toHaveBeenCalledTimes(1);
    expect(elements.surfacePanel.querySelector<HTMLElement>('[data-test-mode]')?.dataset.testMode).toBe('flow');
    expect(window.xtream.stream.transport).not.toHaveBeenCalled();
  });

  it('does not let a runtime-only update bypass an invalidated workspace mode switch', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => runningStreamPublic(100),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    const firstContext = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    vi.mocked(renderStreamWorkspacePane).mockClear();
    firstContext?.setMode('flow');
    controller.applyStreamState(runningStreamPublic(500));

    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
  });

  it('keeps the workspace invalidated if Flow rendering is interrupted during running playback', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { createStreamFlowMode } = await import('./flowMode');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => runningStreamPublic(100),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    const firstContext = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    vi.mocked(createStreamFlowMode).mockImplementationOnce(() => {
      throw new Error('flow render interrupted');
    });

    expect(() => firstContext?.setMode('flow')).toThrow('flow render interrupted');

    vi.mocked(renderStreamWorkspacePane).mockClear();
    controller.applyStreamState(runningStreamPublic(500));

    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
    expect((vi.mocked(createStreamFlowMode).mock.calls.at(-1)?.[1] as StreamWorkspacePaneContext | undefined)?.mode).toBe('flow');
  });
});
