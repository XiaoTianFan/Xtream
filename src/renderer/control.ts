import './control.css';
import type { DirectorState, DisplayMonitorInfo, MediaValidationIssue } from '../shared/types';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import { combineVisibleIssues } from './control/app/appStatus';
import { installInteractionLock, isPanelInteractionActive } from './control/app/interactionLocks';
import { createShowActions } from './control/app/showActions';
import { createSurfaceRouter } from './control/app/surfaceRouter';
import { createConfigSurfaceController } from './control/config/configSurface';
import { createStreamSurfaceController } from './control/stream/streamSurface';
import { createLogsSurfaceController } from './control/logs/logsSurface';
import { patchElements } from './control/patch/elements';
import { installPatchIcons } from './control/patch/patchIcons';
import { createPatchSurfaceController } from './control/patch/patchSurface';
import { createPerformanceSurfaceController } from './control/performance/performanceSurface';
import { elements } from './control/shell/elements';
import { createLaunchDashboardController } from './control/shell/launchDashboard';
import { installRailNavigation } from './control/shell/rail';
import { installShellIcons } from './control/shell/shellIcons';
import { renderIssues as renderIssueList } from './control/shared/issues';

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let previewSyncTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let clearPatchSelection = (): void => undefined;

const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;

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

const showActions = createShowActions({
  renderState,
  setShowStatus,
  clearSelection: () => clearPatchSelection(),
  onShowOpened: () => {
    if (launchDashboard.isVisible()) {
      launchDashboard.hide();
    }
  },
  onShowCreated: () => {
    if (launchDashboard.isVisible()) {
      launchDashboard.hide();
    }
  },
});

const patchSurface = createPatchSurfaceController({
  getAudioDevices: () => audioDevices,
  getDisplayMonitors: () => displayMonitors,
  isPanelInteractionActive,
  renderState,
  setActiveSurface: (surface) => surfaceRouter.setActiveSurface(surface),
  setShowStatus,
  showActions,
});

clearPatchSelection = patchSurface.clearSelection;

const streamSurface = createStreamSurfaceController({
  getAudioDevices: () => audioDevices,
  getDisplayMonitors: () => displayMonitors,
  renderState,
  setShowStatus,
  showActions,
});

const surfaceRouter = createSurfaceRouter({
  getCurrentState: () => currentState,
  surfaces: [
    patchSurface,
    streamSurface,
    createPerformanceSurfaceController(),
    createConfigSurfaceController({ renderState, setShowStatus, showActions }),
    createLogsSurfaceController({
      getOperationIssues: () => currentIssues,
      getDisplayStatusLabel: patchSurface.getDisplayStatusLabel,
      getDisplayTelemetry: patchSurface.getDisplayTelemetry,
    }),
  ],
});

const launchDashboard = createLaunchDashboardController({
  renderState,
  setShowStatus,
  clearSelection: patchSurface.clearSelection,
});

installInteractionLock(patchElements.visualList);
installInteractionLock(patchElements.audioPanel);
installInteractionLock(patchElements.displayList);
installInteractionLock(patchElements.outputPanel);
installInteractionLock(patchElements.detailsContent);
patchElements.runtimeVersionLabel.textContent = `Xtream runtime ${XTREAM_RUNTIME_VERSION}`;
installShellIcons();
installPatchIcons();
patchSurface.install();
launchDashboard.show();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    patchSurface.dismissContextMenu();
  }
});
document.addEventListener('scroll', patchSurface.dismissContextMenu, true);
installRailNavigation(surfaceRouter.setActiveSurface);
elements.launchOpenShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.open();
  if (result) {
    launchDashboard.complete(result, `Opened show config: ${result.filePath ?? 'selected file'}`);
    return;
  }
  await launchDashboard.load();
});
elements.launchCreateShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.createProject();
  if (result) {
    launchDashboard.complete(result, `Created show project: ${result.filePath ?? 'selected folder'}`);
    return;
  }
  await launchDashboard.load();
});
elements.launchOpenDefaultButton.addEventListener('click', async () => {
  const result = await window.xtream.show.openDefault();
  launchDashboard.complete(result, `Opened default show: ${result.filePath ?? 'default location'}`);
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
void launchDashboard.load();
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then(renderState);

animationFrame = window.requestAnimationFrame(tick);
previewSyncTimer = window.setInterval(() => {
  patchSurface.syncPreviewElements();
  streamSurface.syncPreviewElements();
}, DISPLAY_PREVIEW_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
  }
  if (previewSyncTimer !== undefined) {
    window.clearInterval(previewSyncTimer);
  }
});
