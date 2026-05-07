import './control.css';
import type { ControlProjectUiStateV1, DirectorState, DisplayMonitorInfo, MediaValidationIssue, ShowConfigOperationResult, StreamEnginePublicState, VirtualOutputId } from '../shared/types';
import { deriveDirectorStateForStream } from './streamProjection';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import { installInteractionLock, isPanelInteractionActive } from './control/app/interactionLocks';
import { createShowActions } from './control/app/showActions';
import { createSurfaceRouter } from './control/app/surfaceRouter';
import { isWorkspaceTransportShortcutSuppressedTarget } from './control/app/workspaceTransportKeys';
import { createConfigSurfaceController } from './control/config/configSurface';
import { createStreamSurfaceController } from './control/stream/streamSurface';
import { mergeStoredStreamLayoutTwinFromPatch } from './control/stream/layoutPrefs';
import {
  reconcileHydratedWorkspacePaneTwin,
  registerWorkspacePaneTwinSync,
} from './control/shared/workspacePaneTwinSync';
import { applyPatchLayoutTwinFromStream } from './control/patch/layoutPrefs';
import { patchElements } from './control/patch/elements';
import { installPatchIcons } from './control/patch/patchIcons';
import { createPatchSurfaceController } from './control/patch/patchSurface';
import { openMissingMediaRelinkModal, isMissingMediaRelinkModalOpen } from './control/patch/missingMediaRelinkModal';
import {
  shouldAutoOpenMissingRelinkPrompt,
  markDismissedMissingSignatureIfStillMissing,
  resetMissingRelinkDismissState,
} from './control/patch/missingMediaRelinkAutoOpen';
import { createPerformanceSurfaceController } from './control/performance/performanceSurface';
import { elements } from './control/shell/elements';
import { createGlobalOperatorFooterController } from './control/shell/globalOperatorFooter';
import { renderGlobalSessionProblems, setGlobalSessionHint, bumpGlobalSessionHintAfterShellRefresh } from './control/shell/globalSessionShell';
import { buildSessionProblemStripItems } from './control/shell/sessionProblems';
import {
  installSessionLogBridge,
  onSessionLogBufferClear,
  subscribeSessionLogBuffer,
} from './control/shell/sessionLogUi';
import { createLaunchDashboardController, setLaunchDashboardLoadingUi } from './control/shell/launchDashboard';
import { setWorkspacePresentationLoadingUi } from './control/shell/presentationLoadingUi';
import { waitForLaunchPresentationReady } from './control/shell/launchPresentationReady';
import { installRailNavigation } from './control/shell/rail';
import { installShellIcons } from './control/shell/shellIcons';
import { logSessionEvent, logShowOpenProfile, type ShowOpenProfileFlowContext } from '../shared/showOpenProfile';
import { getShownProjectPath, setShownProjectPath } from './control/app/showProjectPath';
import type { ControlSurface } from './control/shared/types';
import { installShellModalPresenter } from './control/shell/shellModalPresenter';
import { installThemeToggle } from './control/shell/themeToggle';
import { probeAllMedia } from './control/app/mediaProber';

installShellModalPresenter();

let currentState: DirectorState | undefined;
let latestStreamState: StreamEnginePublicState | undefined;
let animationFrame: number | undefined;
let previewSyncTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let clearPatchSelection = (): void => undefined;

let lastReadinessReadyFlag: boolean | undefined;
let lastStreamValidationFingerprint = '';
/** Suppresses duplicate consecutive `operation_status` session rows (same text + issue count). */
let lastOperationStatusLogKey: string | undefined;

onSessionLogBufferClear(() => {
  lastOperationStatusLogKey = undefined;
});

function emitSessionLogTransitionEdges(): void {
  if (!currentState) {
    lastReadinessReadyFlag = undefined;
    lastStreamValidationFingerprint = '';
    return;
  }
  const ready = currentState.readiness.ready;
  if (lastReadinessReadyFlag !== undefined && lastReadinessReadyFlag !== ready) {
    logSessionEvent({
      checkpoint: ready ? 'patch_readiness_cleared' : 'patch_readiness_blocked',
      domain: 'patch',
      kind: 'validation',
      extra: { issueCount: currentState.readiness.issues.length },
    });
  }
  lastReadinessReadyFlag = ready;

  const stream = latestStreamState;
  if (!stream) {
    lastStreamValidationFingerprint = '';
    return;
  }
  const fingerprint = JSON.stringify({
    v: stream.validationMessages,
    st: stream.playbackTimeline.status,
    n: stream.playbackTimeline.notice,
  });
  if (lastStreamValidationFingerprint !== '' && fingerprint !== lastStreamValidationFingerprint) {
    logSessionEvent({
      checkpoint: 'stream_validation_changed',
      domain: 'stream',
      kind: 'validation',
      extra: {
        messageCount: stream.validationMessages.length,
        timelineStatus: stream.playbackTimeline.status,
      },
    });
  }
  lastStreamValidationFingerprint = fingerprint;
}

let flushGlobalSessionShell: () => void = () => undefined;

const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;
const STREAM_MEDIA_ISSUES_DEBOUNCE_MS = 200;
const MISSING_RELINK_AUTO_DEBOUNCE_MS = 500;
let streamMediaIssuesTimer: number | undefined;
let missingRelinkAutoTimer: number | undefined;
let engineSoloOutputIds: VirtualOutputId[] = [];

function scheduleMaybeAutoOpenMissingRelink(): void {
  if (missingRelinkAutoTimer !== undefined) {
    window.clearTimeout(missingRelinkAutoTimer);
  }
  missingRelinkAutoTimer = window.setTimeout(() => {
    missingRelinkAutoTimer = undefined;
    void maybeAutoOpenMissingRelink();
  }, MISSING_RELINK_AUTO_DEBOUNCE_MS);
}

async function maybeAutoOpenMissingRelink(): Promise<void> {
  try {
    if (launchShellRef.controller?.isVisible()) {
      return;
    }
    if (!getShownProjectPath()) {
      return;
    }
    if (isMissingMediaRelinkModalOpen()) {
      return;
    }
    const items = await window.xtream.show.listMissingMedia();
    if (!shouldAutoOpenMissingRelinkPrompt(items)) {
      return;
    }
    void openMissingMediaRelinkModal({
      onRelinked: () => {
        scheduleRefreshStreamMediaIssues();
      },
      onClose: (still) => {
        markDismissedMissingSignatureIfStillMissing(still);
      },
    });
  } catch {
    /* ignore */
  }
}

function scheduleRefreshStreamMediaIssues(): void {
  if (streamMediaIssuesTimer !== undefined) {
    window.clearTimeout(streamMediaIssuesTimer);
  }
  streamMediaIssuesTimer = window.setTimeout(() => {
    streamMediaIssuesTimer = undefined;
    void window.xtream.show.getMediaValidationIssues().then((issues) => {
      currentIssues = issues;
      flushGlobalSessionShell();
    });
  }, STREAM_MEDIA_ISSUES_DEBOUNCE_MS);
}

function getPresentationState(): DirectorState | undefined {
  if (!currentState) {
    return undefined;
  }
  return deriveDirectorStateForStream(currentState, latestStreamState);
}

function isStreamPlaybackActive(): boolean {
  const status = latestStreamState?.runtime?.status;
  return status === 'running' || status === 'preloading' || status === 'paused';
}

function renderState(state: DirectorState): void {
  currentState = state;
  surfaceRouter.render(state);
  flushGlobalSessionShell();
  scheduleMaybeAutoOpenMissingRelink();
}

function setShowStatus(message: string, issues: MediaValidationIssue[] = currentIssues): void {
  currentIssues = issues;
  const trimmed = message.trim();
  setGlobalSessionHint(elements.globalSessionHint, trimmed.length > 0 ? message : undefined);
  if (trimmed.length > 0) {
    const logKey = `${trimmed}\0${issues.length}`;
    if (logKey !== lastOperationStatusLogKey) {
      logSessionEvent({
        checkpoint: 'operation_status',
        domain: 'global',
        kind: 'operation',
        extra: { message, issueCount: issues.length },
      });
      lastOperationStatusLogKey = logKey;
    }
  } else {
    lastOperationStatusLogKey = undefined;
  }
  flushGlobalSessionShell();
}

async function loadAudioDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    audioDevices = [];
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  audioDevices = devices.filter((device) => device.kind === 'audiooutput');
}

async function loadDisplayMonitors(): Promise<void> {
  displayMonitors = await window.xtream.displays.listMonitors();
}

function tick(): void {
  patchSurface.tick();
  streamSurface.tickMixerBallistics();
  animationFrame = window.requestAnimationFrame(tick);
}

function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Replaced after surfaces exist; always called only after full init. */
let hydrateControlShellAfterShow: (result: ShowConfigOperationResult, ctx?: ShowOpenProfileFlowContext) => Promise<void> = async () => undefined;

/** Set before launchDashboard init; used so menu-driven open/create can gate on presentation readiness. */
const launchShellRef: {
  controller?: ReturnType<typeof createLaunchDashboardController>;
} = {};

const showActions = createShowActions({
  renderState,
  setShowStatus,
  clearSelection: () => clearPatchSelection(),
  onShowOpened: () => {
    if (launchShellRef.controller?.isVisible()) {
      launchShellRef.controller.hide();
    }
  },
  onShowCreated: () => {
    if (launchShellRef.controller?.isVisible()) {
      launchShellRef.controller.hide();
    }
  },
  hydrateAfterShowLoaded: (result, ctx) => hydrateControlShellAfterShow(result, ctx),
  beginLaunchPresentationLoad: () => {
    setWorkspacePresentationLoadingUi(true);
    if (launchShellRef.controller?.isVisible()) {
      setLaunchDashboardLoadingUi(true);
    }
  },
  awaitLaunchPresentationReady: async (ctx) => {
    await waitForLaunchPresentationReady({
      getActiveSurface: () => surfaceRouter.getActiveSurface(),
      setShowStatus,
      showOpenProfile: ctx,
    });
  },
  clearLaunchPresentationLoading: () => {
    setWorkspacePresentationLoadingUi(false);
    setLaunchDashboardLoadingUi(false);
  },
  presentLaunchDashboardForCreate: async () => {
    if (!(await window.xtream.show.promptUnsavedIfNeeded('create'))) {
      return;
    }
    setLaunchDashboardLoadingUi(false);
    launchShellRef.controller!.show({ unsavedAlreadyCleared: true });
    await launchShellRef.controller!.load();
  },
});

const patchSurface = createPatchSurfaceController({
  getAudioDevices: () => audioDevices,
  getDisplayMonitors: () => displayMonitors,
  isPanelInteractionActive,
  getPresentationState,
  getIsStreamPlaybackActive: isStreamPlaybackActive,
  renderState,
  setActiveSurface: (surface) => surfaceRouter.setActiveSurface(surface),
  setShowStatus,
  showActions,
});

clearPatchSelection = patchSurface.clearSelection;

const streamSurface = createStreamSurfaceController({
  getAudioDevices: () => audioDevices,
  getDisplayMonitors: () => displayMonitors,
  getPresentationState,
  getLatestStreamState: () => latestStreamState,
  getEngineSoloOutputIds: () => engineSoloOutputIds,
  renderState,
  setShowStatus,
  showActions,
  getShowConfigPath: () => getShownProjectPath(),
});

registerWorkspacePaneTwinSync({
  applyStreamTwinFromPatchDimensions(mediaWidthPx, footerHeightAsBottomPx) {
    const prefs = mergeStoredStreamLayoutTwinFromPatch(mediaWidthPx, footerHeightAsBottomPx);
    streamSurface.applyStoredTwinLayoutPrefs(prefs);
  },
  applyPatchTwinFromStreamDimensions: applyPatchLayoutTwinFromStream,
});

const globalOperatorFooter = createGlobalOperatorFooterController({
  elements: {
    globalAudioMuteButton: elements.globalAudioMuteButton,
    displayBlackoutButton: elements.displayBlackoutButton,
    clearSoloButton: elements.clearSoloButton,
    displayIdentifyFlashButton: elements.displayIdentifyFlashButton,
  },
  getState: () => currentState,
  renderState,
  getSoloOutputCount: () => patchSurface.getSoloOutputCount(),
  clearSoloOutputs: () => patchSurface.clearSoloOutputs(),
});

const surfaceRouter = createSurfaceRouter({
  getCurrentState: () => currentState,
  syncGlobalOperator: (state) => globalOperatorFooter.sync(state),
  surfaces: [
    patchSurface,
    streamSurface,
    createPerformanceSurfaceController(),
    createConfigSurfaceController({
      renderState,
      getDirectorState: () => currentState,
      setShowStatus,
      getOperationIssues: () => currentIssues,
      getDisplayStatusLabel: patchSurface.getDisplayStatusLabel,
      getDisplayTelemetry: patchSurface.getDisplayTelemetry,
    }),
  ],
});

flushGlobalSessionShell = (): void => {
  emitSessionLogTransitionEdges();
  const items = buildSessionProblemStripItems({
    director: currentState,
    mediaIssues: currentIssues,
    stream: latestStreamState,
  });
  renderGlobalSessionProblems(elements.globalSessionProblems, items, surfaceRouter.getActiveSurface());
  bumpGlobalSessionHintAfterShellRefresh(elements.globalSessionHint);
};

subscribeSessionLogBuffer(() => {
  const s = currentState;
  if (s && surfaceRouter.getActiveSurface() === 'config') {
    surfaceRouter.render(s);
  }
});

window.xtream.audioRuntime.onSoloOutputIds((ids) => {
  engineSoloOutputIds = ids;
  patchSurface.applyEngineSoloOutputIds(ids);
  streamSurface.applyEngineSoloOutputIds(ids);
  globalOperatorFooter.sync(currentState);
});

window.xtream.stream.onState((state) => {
  const previousValidation = latestStreamState ? JSON.stringify(latestStreamState.validationMessages) : '';
  latestStreamState = state;
  streamSurface.applyStreamState(state);
  patchSurface.syncPresentationMixer();
  const newValidation = JSON.stringify(state.validationMessages);
  if (previousValidation !== newValidation && currentState) {
    surfaceRouter.render(currentState);
  }
  patchSurface.syncTransportInputs();
  scheduleRefreshStreamMediaIssues();
  flushGlobalSessionShell();
});
void window.xtream.stream.getState().then((s) => {
  latestStreamState = s;
  streamSurface.applyStreamState(s);
  patchSurface.syncPresentationMixer();
  patchSurface.syncTransportInputs();
  flushGlobalSessionShell();
});

hydrateControlShellAfterShow = async (result, ctx) => {
  const filePath = result.filePath;
  setShownProjectPath(filePath);
  if (filePath) {
    resetMissingRelinkDismissState();
  }
  if (!filePath) {
    return;
  }
  if (currentState) {
    probeAllMedia(currentState);
  }
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_enter',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
    });
  }
  let seg = performance.now();
  const snapshot = await window.xtream.controlUi.getForPath(filePath);
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_after_control_ui_get',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
      segmentMs: performance.now() - seg,
      extra: { hasSnapshot: Boolean(snapshot) },
    });
  }
  seg = performance.now();
  if (!snapshot || snapshot.v !== 1) {
    if (ctx) {
      logShowOpenProfile({
        runId: ctx.runId,
        checkpoint: 'renderer_hydrate_skip_no_snapshot',
        sinceRunStartMs: performance.now() - ctx.flowStartMs,
        extra: { hasSnapshot: Boolean(snapshot), v: snapshot?.v },
      });
    }
    scheduleMaybeAutoOpenMissingRelink();
    return;
  }
  if (snapshot.patch && Object.keys(snapshot.patch).length > 0) {
    patchSurface.applyImportedLayoutUi(snapshot.patch);
  }
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_after_patch_apply',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
      segmentMs: performance.now() - seg,
    });
  }
  seg = performance.now();
  const streamPublic = await window.xtream.stream.getState();
  latestStreamState = streamPublic;
  streamSurface.applyStreamState(streamPublic);
  patchSurface.syncTransportInputs();
  flushGlobalSessionShell();
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_after_stream_get_state',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
      segmentMs: performance.now() - seg,
    });
  }
  streamSurface.applyImportedProjectUi(snapshot.stream, result.state, streamPublic);
  reconcileHydratedWorkspacePaneTwin(snapshot.patch, snapshot.stream?.layout);
  const rawSurface = snapshot.activeSurface as ControlSurface | 'logs';
  const surfaceId: ControlSurface = rawSurface === 'logs' ? 'config' : rawSurface;
  if (surfaceId === 'patch' || surfaceId === 'stream' || surfaceId === 'performance' || surfaceId === 'config') {
    surfaceRouter.setPersistedActiveSurface(surfaceId);
  }
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_exit',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
    });
  }
  scheduleMaybeAutoOpenMissingRelink();
};

window.__xtreamGetControlUiSnapshot = (): ControlProjectUiStateV1 | null => {
  if (!currentState) {
    return null;
  }
  const snap: ControlProjectUiStateV1 = {
    v: 1,
    activeSurface: surfaceRouter.getActiveSurface(),
    patch: patchSurface.exportLayoutUiSnapshot(),
    stream: streamSurface.exportProjectUiSnapshot(),
  };
  return snap;
};

launchShellRef.controller = createLaunchDashboardController({
  renderState,
  setShowStatus,
  clearSelection: patchSurface.clearSelection,
  hydrateAfterShowLoaded: (result, ctx) => hydrateControlShellAfterShow(result, ctx),
  getActiveSurface: () => surfaceRouter.getActiveSurface(),
});
const launchDashboard = launchShellRef.controller;

installInteractionLock(patchElements.visualList);
installInteractionLock(patchElements.audioPanel);
installInteractionLock(patchElements.displayList);
installInteractionLock(patchElements.outputPanel);
installInteractionLock(patchElements.detailsContent);
elements.runtimeVersionLabel.textContent = `Xtream runtime ${XTREAM_RUNTIME_VERSION}`;
installShellIcons();
installThemeToggle(elements.themeToggleButton);
installPatchIcons();
patchSurface.install();
globalOperatorFooter.install();
elements.missingMediaRelinkButton.addEventListener('click', () => {
  void openMissingMediaRelinkModal({
    onRelinked: () => {
      scheduleRefreshStreamMediaIssues();
    },
    onClose: (still) => {
      markDismissedMissingSignatureIfStillMissing(still);
    },
  });
});
launchDashboard.show();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    patchSurface.dismissContextMenu();
    return;
  }
  if (launchShellRef.controller?.isVisible()) {
    return;
  }
  if (isWorkspaceTransportShortcutSuppressedTarget(event.target)) {
    return;
  }
  const surface = surfaceRouter.getActiveSurface();
  if (surface === 'patch') {
    patchSurface.handleWorkspaceTransportKeydown(event);
  } else if (surface === 'stream') {
    streamSurface.handleWorkspaceTransportKeydown(event);
  }
});
document.addEventListener('scroll', patchSurface.dismissContextMenu, true);
installRailNavigation(surfaceRouter.setActiveSurface);
elements.launchOpenShowButton.addEventListener('click', async () => {
  const operationId = createOperationId('so');
  logSessionEvent({
    runId: operationId,
    checkpoint: 'ui_open_show_invoked',
    domain: 'config',
    kind: 'operation',
    extra: { route: 'launch_dashboard' },
  });
  if (!launchDashboard.consumeUnsavedClearedFlag() && !(await window.xtream.show.promptUnsavedIfNeeded('open'))) {
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_open_show_aborted_unsaved',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'launch_dashboard' },
    });
    return;
  }
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.open({ skipUnsavedPrompt: true, operationId, route: 'launch_dashboard' });
    if (result) {
      setShownProjectPath(result.filePath);
      await launchDashboard.complete(result, `Opened show config: ${result.filePath ?? 'selected file'}`);
      return;
    }
    setLaunchDashboardLoadingUi(false);
    await launchDashboard.load();
  } catch (error) {
    setLaunchDashboardLoadingUi(false);
    throw error;
  }
});
elements.launchCreateShowButton.addEventListener('click', async () => {
  const operationId = createOperationId('create');
  logSessionEvent({
    runId: operationId,
    checkpoint: 'ui_create_show_invoked',
    domain: 'config',
    kind: 'operation',
    extra: { route: 'launch_dashboard' },
  });
  if (!launchDashboard.consumeUnsavedClearedFlag() && !(await window.xtream.show.promptUnsavedIfNeeded('create'))) {
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_create_show_aborted_unsaved',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'launch_dashboard' },
    });
    return;
  }
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.createProject({ skipUnsavedPrompt: true, operationId, route: 'launch_dashboard' });
    if (result) {
      await launchDashboard.complete(result, `Created show project: ${result.filePath ?? 'selected folder'}`);
      return;
    }
    setLaunchDashboardLoadingUi(false);
    await launchDashboard.load();
  } catch (error) {
    setLaunchDashboardLoadingUi(false);
    throw error;
  }
});
elements.launchOpenDefaultButton.addEventListener('click', async () => {
  const operationId = createOperationId('so');
  logSessionEvent({
    runId: operationId,
    checkpoint: 'ui_open_default_invoked',
    domain: 'config',
    kind: 'operation',
    extra: { route: 'launch_dashboard' },
  });
  if (!launchDashboard.consumeUnsavedClearedFlag() && !(await window.xtream.show.promptUnsavedIfNeeded('openDefault'))) {
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_open_default_aborted_unsaved',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'launch_dashboard' },
    });
    return;
  }
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.openDefault({ skipUnsavedPrompt: true, operationId, route: 'launch_dashboard' });
    if (!result) {
      setLaunchDashboardLoadingUi(false);
      await launchDashboard.load();
      return;
    }
    await launchDashboard.complete(result, `Opened default show: ${result.filePath ?? 'default location'}`);
  } catch (error) {
    setLaunchDashboardLoadingUi(false);
    throw error;
  }
});
patchElements.refreshOutputsButton.addEventListener('click', async () => {
  await loadAudioDevices();
  renderState(await window.xtream.director.getState());
});
window.xtream.director.onState(renderState);
window.xtream.audioRuntime.onMeterLanes((report) => {
  if (currentState?.outputs[report.outputId]) {
    currentState.outputs[report.outputId] = {
      ...currentState.outputs[report.outputId],
      meterDb: report.peakDb,
      meterLanes: report.lanes,
    };
  }
  patchSurface.applyOutputMeterReport(report);
  streamSurface.applyOutputMeterReport(report);
});
void window.xtream.renderer.ready({ kind: 'control' });
installSessionLogBridge();
void launchDashboard.load();
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then((state) => {
  renderState(state);
  void window.xtream.show.getCurrentPath().then((p) => {
    setShownProjectPath(p);
  });
});

animationFrame = window.requestAnimationFrame(tick);
previewSyncTimer = window.setInterval(() => {
  const presentation = getPresentationState();
  if (!presentation) {
    return;
  }
  patchSurface.syncPreviewElements(presentation);
  streamSurface.syncPreviewElements(presentation);
}, DISPLAY_PREVIEW_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
  }
  if (previewSyncTimer !== undefined) {
    window.clearInterval(previewSyncTimer);
  }
});
