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
  renderStreamBottomPane: vi.fn((panel, ctx) => {
    const selection = ctx.sceneEditSelection.kind === 'subcue' ? ` ${ctx.sceneEditSelection.subCueId}` : '';
    panel.textContent = `STREAM BOTTOM ${ctx.selectedSceneId ?? ''}${selection}`;
  }),
  syncStreamSceneEditPaneContent: vi.fn((panel, ctx) => {
    if (ctx.detailPane || ctx.bottomTab !== 'scene') {
      return false;
    }
    const selection = ctx.sceneEditSelection.kind === 'subcue' ? ` ${ctx.sceneEditSelection.subCueId}` : '';
    panel.textContent = `STREAM BOTTOM ${ctx.selectedSceneId ?? ''}${selection}`;
    return true;
  }),
}));

vi.mock('./streamMixerBottomRedrawDefer', () => ({
  shouldDeferStreamMixerBottomPaneRedraw: vi.fn(() => false),
}));

vi.mock('./sceneEdit/addMediaSubCueFromPool', () => ({
  addMediaSubCueFromPool: vi.fn(async ({ stream, sceneId, payload }) => {
    const subCueId = 'subcue-drop';
    const scene = stream.scenes[sceneId];
    const subCue =
      payload.type === 'audio-source'
        ? { id: subCueId, kind: 'audio', audioSourceId: payload.id, outputIds: [], playbackRate: 1 }
        : { id: subCueId, kind: 'visual', visualId: payload.id, targets: [], playbackRate: 1 };
    const nextStream = {
      ...stream,
      scenes: {
        ...stream.scenes,
        [sceneId]: {
          ...scene,
          subCueOrder: [...scene.subCueOrder, subCueId],
          subCues: { ...scene.subCues, [subCueId]: subCue },
        },
      },
    };
    return {
      streamState: {
        stream: nextStream,
        playbackStream: nextStream,
        editTimeline: { status: 'valid', entries: {}, revision: 1, calculatedAtWallTimeMs: 0, issues: [] },
        playbackTimeline: { status: 'valid', entries: {}, revision: 1, calculatedAtWallTimeMs: 0, issues: [] },
        validationMessages: [],
        runtime: null,
      },
      subCueId,
    };
  }),
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
    for (const sceneId of _stream.sceneOrder) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.flowEditSceneId = sceneId;
      edit.textContent = `Edit ${sceneId}`;
      edit.addEventListener('click', () => {
        ctx.setPlaybackAndEditFocus(sceneId);
        ctx.setBottomTab('scene');
        ctx.clearDetailPane();
        ctx.refreshSceneSelectionUi();
      });
      root.append(edit);
    }
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

function directorWithMedia(): DirectorState {
  return {
    ...director(),
    visuals: {
      'visual-a': {
        id: 'visual-a',
        kind: 'file',
        type: 'image',
        label: 'Logo Loop',
        url: 'file:///logo.png',
        ready: true,
      },
    },
    audioSources: {
      'audio-a': {
        id: 'audio-a',
        label: 'Kick Loop',
        url: 'file:///kick.wav',
        ready: true,
      },
    },
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

function twoSceneStreamPublic(): StreamEnginePublicState {
  const pub = streamPublic();
  const stream = structuredClone(pub.stream);
  stream.sceneOrder = ['scene-a', 'scene-b'];
  stream.scenes['scene-b'] = {
    ...stream.scenes['scene-a']!,
    id: 'scene-b',
    title: 'Scene B',
  };
  return {
    ...pub,
    stream,
    playbackStream: stream,
  };
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

function preloadingStreamPublic(): StreamEnginePublicState {
  const pub = streamPublic();
  return {
    ...pub,
    runtime: {
      status: 'preloading',
      sceneStates: {
        'scene-a': {
          sceneId: 'scene-a',
          status: 'preloading',
          scheduledStartMs: 0,
        },
      },
      currentStreamMs: 0,
      expectedDurationMs: 1000,
    },
  } as unknown as StreamEnginePublicState;
}

function disabledStreamPublic(): StreamEnginePublicState {
  const pub = streamPublic();
  const stream = structuredClone(pub.stream);
  stream.scenes['scene-a'] = {
    ...stream.scenes['scene-a']!,
    disabled: true,
  };
  return {
    ...pub,
    stream,
    playbackStream: stream,
  };
}

function runningTwoSceneStreamPublic(runtimeFocusSceneId = 'scene-a', cursorMs = 0): StreamEnginePublicState {
  const pub = twoSceneStreamPublic();
  return {
    ...pub,
    runtime: {
      status: 'running',
      cursorSceneId: runtimeFocusSceneId,
      playbackFocusSceneId: runtimeFocusSceneId,
      sceneStates: {
        'scene-a': {
          sceneId: 'scene-a',
          status: runtimeFocusSceneId === 'scene-a' ? 'running' : 'ready',
          scheduledStartMs: 0,
          progress: runtimeFocusSceneId === 'scene-a' ? cursorMs / 1000 : undefined,
        },
        'scene-b': {
          sceneId: 'scene-b',
          status: runtimeFocusSceneId === 'scene-b' ? 'running' : 'ready',
          scheduledStartMs: 1000,
          progress: runtimeFocusSceneId === 'scene-b' ? cursorMs / 1000 : undefined,
        },
      },
      currentStreamMs: cursorMs,
      expectedDurationMs: 2000,
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

  it('rebuilds the header command closure when playback focus changes without changing edit focus', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamHeader, syncStreamHeaderRuntime } = await import('./streamHeader');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => twoSceneStreamPublic(),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    const headerCtx = vi.mocked(renderStreamHeader).mock.calls.at(-1)?.[0] as
      | { setPlaybackFocusSceneId: (id: string | undefined) => void; requestRender: () => void }
      | undefined;
    vi.mocked(renderStreamHeader).mockClear();
    vi.mocked(syncStreamHeaderRuntime).mockClear();

    headerCtx?.setPlaybackFocusSceneId('scene-b');
    headerCtx?.requestRender();

    expect(renderStreamHeader).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderStreamHeader).mock.calls.at(-1)?.[0]).toMatchObject({
      sceneEditSceneId: 'scene-a',
      playbackFocusSceneId: 'scene-b',
    });
    expect(syncStreamHeaderRuntime).not.toHaveBeenCalled();
  });

  it('keeps manual playback focus during director renders while runtime focus is unchanged', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamHeader, syncStreamHeaderRuntime } = await import('./streamHeader');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const latest = runningTwoSceneStreamPublic('scene-a', 100);
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
    const workspaceCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    workspaceCtx?.setPlaybackAndEditFocus('scene-b');
    workspaceCtx?.refreshSceneSelectionUi();
    vi.mocked(renderStreamHeader).mockClear();
    vi.mocked(syncStreamHeaderRuntime).mockClear();

    controller.render(director());

    expect(renderStreamHeader).not.toHaveBeenCalled();
    expect(vi.mocked(syncStreamHeaderRuntime).mock.calls.at(-1)?.[4]).toBe('scene-b');
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
    const { renderStreamHeader, syncStreamHeaderRuntime } = await import('./streamHeader');
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
    vi.mocked(renderStreamHeader).mockClear();
    vi.mocked(syncStreamHeaderRuntime).mockClear();
    vi.mocked(renderStreamWorkspacePane).mockClear();
    vi.mocked(createStreamFlowMode).mockClear();
    [...elements.surfacePanel.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === 'Flow')
      ?.click();

    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
    expect(createStreamFlowMode).toHaveBeenCalledTimes(1);
    expect(renderStreamHeader).not.toHaveBeenCalled();
    expect(syncStreamHeaderRuntime).toHaveBeenCalled();
    expect(elements.surfacePanel.querySelector<HTMLElement>('[data-test-mode]')?.dataset.testMode).toBe('flow');
    expect(window.xtream.stream.transport).not.toHaveBeenCalled();
  });

  it('forces the bottom scene editor to refresh from the Flow card edit button', async () => {
    const { elements } = await import('../shell/elements');
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { shouldDeferStreamMixerBottomPaneRedraw } = await import('./streamMixerBottomRedrawDefer');
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => twoSceneStreamPublic(),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus: vi.fn(),
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(director());
    [...elements.surfacePanel.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === 'Flow')
      ?.click();
    expect(elements.surfacePanel.textContent).toContain('STREAM BOTTOM scene-a');

    vi.mocked(shouldDeferStreamMixerBottomPaneRedraw).mockReturnValue(true);
    const editSceneB = elements.surfacePanel.querySelector<HTMLButtonElement>('[data-flow-edit-scene-id="scene-b"]');
    expect(editSceneB).not.toBeNull();
    editSceneB?.click();

    expect(elements.surfacePanel.textContent).toContain('STREAM BOTTOM scene-b');
  });

  it('does not rebuild the header when switching back to List mode', async () => {
    const { elements } = await import('../shell/elements');
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamHeader, syncStreamHeaderRuntime } = await import('./streamHeader');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { createStreamFlowMode, syncStreamFlowModeRuntimeChrome } = await import('./flowMode');
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
    [...elements.surfacePanel.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === 'Flow')
      ?.click();
    expect(createStreamFlowMode).toHaveBeenCalled();

    vi.mocked(renderStreamHeader).mockClear();
    vi.mocked(syncStreamHeaderRuntime).mockClear();
    vi.mocked(renderStreamWorkspacePane).mockClear();
    vi.mocked(syncStreamFlowModeRuntimeChrome).mockClear();
    [...elements.surfacePanel.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === 'List')
      ?.click();

    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
    expect(elements.surfacePanel.querySelector<HTMLElement>('[data-test-mode]')?.dataset.testMode).toBe('list');
    expect(renderStreamHeader).not.toHaveBeenCalled();
    expect(syncStreamHeaderRuntime).toHaveBeenCalled();
  });

  it('syncs the header without rebuilding it for director-only display updates', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamHeader, syncStreamHeaderRuntime } = await import('./streamHeader');
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
    const nextDirector = {
      ...director(),
      displays: {
        display_a: {
          id: 'display_a',
          label: 'Display A',
          health: 'ready',
          layout: [],
        },
      },
    } as unknown as DirectorState;

    controller.render(director());
    vi.mocked(renderStreamHeader).mockClear();
    vi.mocked(syncStreamHeaderRuntime).mockClear();
    controller.render(nextDirector);

    expect(renderStreamHeader).not.toHaveBeenCalled();
    expect(syncStreamHeaderRuntime).toHaveBeenCalled();
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

  it('orchestrates media-pool scene drops by authoring, selecting, expanding, and reporting the new sub-cue', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { addMediaSubCueFromPool } = await import('./sceneEdit/addMediaSubCueFromPool');
    const setShowStatus = vi.fn();
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => streamPublic(),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus,
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(directorWithMedia());
    const workspaceCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    vi.mocked(renderStreamWorkspacePane).mockClear();
    await workspaceCtx?.addMediaPoolItemToScene('scene-a', { type: 'audio-source', id: 'audio-a' });

    expect(addMediaSubCueFromPool).toHaveBeenCalledWith(expect.objectContaining({
      sceneId: 'scene-a',
      payload: { type: 'audio-source', id: 'audio-a' },
    }));
    expect(setShowStatus).toHaveBeenCalledWith('Added audio sub-cue from Kick Loop to Scene A.');
    expect(renderStreamWorkspacePane).toHaveBeenCalledTimes(1);
    const nextWorkspaceCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    expect(nextWorkspaceCtx?.sceneEditSceneId).toBe('scene-a');
    expect(nextWorkspaceCtx?.expandedListSceneIds.has('scene-a')).toBe(true);
  });

  it('rejects media-pool scene drops while the target scene is running or preloading', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { addMediaSubCueFromPool } = await import('./sceneEdit/addMediaSubCueFromPool');
    const setShowStatus = vi.fn();
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => runningStreamPublic(100),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus,
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(directorWithMedia());
    const runningCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    await runningCtx?.addMediaPoolItemToScene('scene-a', { type: 'visual', id: 'visual-a' });
    controller.applyStreamState(preloadingStreamPublic());
    const preloadingCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    await preloadingCtx?.addMediaPoolItemToScene('scene-a', { type: 'audio-source', id: 'audio-a' });

    expect(addMediaSubCueFromPool).not.toHaveBeenCalled();
    expect(setShowStatus).toHaveBeenCalledWith('Scene A is running. Stop it before editing sub-cues.');
    expect(setShowStatus).toHaveBeenCalledTimes(2);
  });

  it('allows media-pool scene drops onto disabled scenes', async () => {
    const { createStreamSurfaceController } = await import('./streamSurface');
    const { renderStreamWorkspacePane } = await import('./workspacePane');
    const { addMediaSubCueFromPool } = await import('./sceneEdit/addMediaSubCueFromPool');
    const setShowStatus = vi.fn();
    const controller = createStreamSurfaceController({
      getAudioDevices: () => [],
      getDisplayMonitors: () => [],
      getPresentationState: () => undefined,
      getLatestStreamState: () => disabledStreamPublic(),
      getEngineSoloOutputIds: () => [],
      renderState: vi.fn(),
      setShowStatus,
      showActions: {} as never,
      getShowConfigPath: () => undefined,
    });

    controller.render(directorWithMedia());
    const workspaceCtx = vi.mocked(renderStreamWorkspacePane).mock.calls.at(-1)?.[2] as StreamWorkspacePaneContext | undefined;
    await workspaceCtx?.addMediaPoolItemToScene('scene-a', { type: 'visual', id: 'visual-a' });

    expect(addMediaSubCueFromPool).toHaveBeenCalledWith(expect.objectContaining({
      sceneId: 'scene-a',
      payload: { type: 'visual', id: 'visual-a' },
    }));
    expect(setShowStatus).toHaveBeenCalledWith('Added visual sub-cue from Logo Loop to Scene A.');
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
