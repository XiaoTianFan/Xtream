import './control.css';
import type { ControlProjectUiStateV1, DirectorState, DisplayMonitorInfo, MediaValidationIssue, ShowConfigOperationResult, StreamEnginePublicState, VirtualOutputId } from '../shared/types';
import { deriveDirectorStateForStream } from './streamProjection';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import { combineVisibleIssues } from './control/app/appStatus';
import { installInteractionLock, isPanelInteractionActive } from './control/app/interactionLocks';
import { createShowActions } from './control/app/showActions';
import { createSurfaceRouter } from './control/app/surfaceRouter';
import { createConfigSurfaceController } from './control/config/configSurface';
import { createStreamSurfaceController } from './control/stream/streamSurface';
import { patchElements } from './control/patch/elements';
import { installPatchIcons } from './control/patch/patchIcons';
import { createPatchSurfaceController } from './control/patch/patchSurface';
import { createPerformanceSurfaceController } from './control/performance/performanceSurface';
import { elements } from './control/shell/elements';
import { createGlobalOperatorFooterController } from './control/shell/globalOperatorFooter';
import { createLaunchDashboardController, setLaunchDashboardLoadingUi } from './control/shell/launchDashboard';
import { setWorkspacePresentationLoadingUi } from './control/shell/presentationLoadingUi';
import { waitForLaunchPresentationReady } from './control/shell/launchPresentationReady';
import { installRailNavigation } from './control/shell/rail';
import { installShellIcons } from './control/shell/shellIcons';
import { renderIssues as renderIssueList } from './control/shared/issues';
import { installShowOpenProfileLogBridge, subscribeShowOpenProfileLogBuffer } from './control/config/showOpenProfileUi';
import { logShowOpenProfile, type ShowOpenProfileFlowContext } from '../shared/showOpenProfile';
import type { ControlSurface } from './control/shared/types';

let currentState: DirectorState | undefined;
let latestStreamState: StreamEnginePublicState | undefined;
let animationFrame: number | undefined;
let previewSyncTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let clearPatchSelection = (): void => undefined;

const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;
const STREAM_MEDIA_ISSUES_DEBOUNCE_MS = 200;
let streamMediaIssuesTimer: number | undefined;
let engineSoloOutputIds: VirtualOutputId[] = [];

function scheduleRefreshStreamMediaIssues(): void {
  if (streamMediaIssuesTimer !== undefined) {
    window.clearTimeout(streamMediaIssuesTimer);
  }
  streamMediaIssuesTimer = window.setTimeout(() => {
    streamMediaIssuesTimer = undefined;
    void window.xtream.show.getMediaValidationIssues().then((issues) => {
      currentIssues = issues;
      if (currentState) {
        renderIssueList(patchElements.issueList, combineVisibleIssues(currentState.readiness.issues, currentIssues));
      }
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
  renderIssueList(patchElements.issueList, combineVisibleIssues(state.readiness.issues, currentIssues));
}

function setShowStatus(message: string, issues: MediaValidationIssue[] = currentIssues): void {
  patchElements.showStatus.textContent = message;
  currentIssues = issues;
  renderIssueList(patchElements.issueList, combineVisibleIssues(currentState?.readiness.issues ?? [], currentIssues));
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
  animationFrame = window.requestAnimationFrame(tick);
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
  getEngineSoloOutputIds: () => engineSoloOutputIds,
  renderState,
  setShowStatus,
  showActions,
});

const globalOperatorFooter = createGlobalOperatorFooterController({
  elements: {
    globalAudioMuteButton: elements.globalAudioMuteButton,
    displayBlackoutButton: elements.displayBlackoutButton,
    performanceModeButton: elements.performanceModeButton,
    clearSoloButton: elements.clearSoloButton,
    resetMetersButton: elements.resetMetersButton,
    displayIdentifyFlashButton: elements.displayIdentifyFlashButton,
  },
  getState: () => currentState,
  renderState,
  getSoloOutputCount: () => patchSurface.getSoloOutputCount(),
  clearSoloOutputs: () => patchSurface.clearSoloOutputs(),
  resetMetersRequested: () => patchSurface.resetMetersFromOperator(),
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
      setShowStatus,
      showActions,
      getOperationIssues: () => currentIssues,
      getDisplayStatusLabel: patchSurface.getDisplayStatusLabel,
      getDisplayTelemetry: patchSurface.getDisplayTelemetry,
    }),
  ],
});

subscribeShowOpenProfileLogBuffer(() => {
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
  latestStreamState = state;
  patchSurface.syncTransportInputs();
  scheduleRefreshStreamMediaIssues();
});
void window.xtream.stream.getState().then((s) => {
  latestStreamState = s;
  patchSurface.syncTransportInputs();
});

hydrateControlShellAfterShow = async (result, ctx) => {
  const filePath = result.filePath;
  if (!filePath) {
    return;
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
  if (ctx) {
    logShowOpenProfile({
      runId: ctx.runId,
      checkpoint: 'renderer_hydrate_after_stream_get_state',
      sinceRunStartMs: performance.now() - ctx.flowStartMs,
      segmentMs: performance.now() - seg,
    });
  }
  streamSurface.applyImportedProjectUi(snapshot.stream, result.state, streamPublic);
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
installPatchIcons();
patchSurface.install();
globalOperatorFooter.install();
launchDashboard.show();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    patchSurface.dismissContextMenu();
  }
});
document.addEventListener('scroll', patchSurface.dismissContextMenu, true);
installRailNavigation(surfaceRouter.setActiveSurface);
elements.launchOpenShowButton.addEventListener('click', async () => {
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.open();
    if (result) {
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
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.createProject();
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
  setLaunchDashboardLoadingUi(true);
  try {
    const result = await window.xtream.show.openDefault();
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
installShowOpenProfileLogBridge();
void launchDashboard.load();
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then(renderState);

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
