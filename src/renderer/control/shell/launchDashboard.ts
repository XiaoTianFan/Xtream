import type { DirectorState, LaunchShowData, RecentShowEntry, ShowConfigOperationResult } from '../../../shared/types';
import { logSessionEvent, logShowOpenProfile, type ShowOpenProfileFlowContext } from '../../../shared/showOpenProfile';
import type { ControlSurface } from '../shared/types';
import { clearLiveVisualPoolThumbnailCache } from '../patch/visualPoolThumbnailCache';
import { elements } from './elements';
import { setShownProjectPath } from '../app/showProjectPath';
import { waitForLaunchPresentationReady } from './launchPresentationReady';

/** Shows centered loading overlay + scrim on the launch modal (immediate, synchronous). */
export function setLaunchDashboardLoadingUi(active: boolean): void {
  if (active) {
    elements.launchDashboard.dataset.phase = 'loading';
    elements.launchLoadingOverlay.setAttribute('aria-hidden', 'false');
  } else {
    delete elements.launchDashboard.dataset.phase;
    elements.launchLoadingOverlay.setAttribute('aria-hidden', 'true');
  }
}

function waitForUiHydrationTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isHydratedSurfaceMounted(surface: ControlSurface): boolean {
  if (surface === 'patch') {
    return !elements.patchSurface.hidden && elements.patchSurface.querySelector('.workspace, .operator-footer') !== null;
  }
  if (surface === 'stream') {
    return (
      !elements.surfacePanel.hidden &&
      elements.surfacePanel.querySelector('.stream-surface') !== null &&
      elements.surfacePanel.querySelector('.stream-header') !== null &&
      elements.surfacePanel.querySelector('.stream-workspace-pane') !== null
    );
  }
  return !elements.surfacePanel.hidden && elements.surfacePanel.childElementCount > 0;
}

type LaunchDashboardOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: ShowConfigOperationResult['issues']) => void;
  clearSelection: () => void;
  hydrateAfterShowLoaded?: (result: ShowConfigOperationResult, ctx?: ShowOpenProfileFlowContext) => Promise<void>;
  getActiveSurface: () => ControlSurface;
};

export type LaunchDashboardController = ReturnType<typeof createLaunchDashboardController>;

export function createLaunchDashboardController({
  renderState,
  setShowStatus,
  clearSelection,
  hydrateAfterShowLoaded,
  getActiveSurface,
}: LaunchDashboardOptions) {
  let visible = true;
  /** Set when the dashboard was shown after already clearing the unsaved-changes prompt (e.g. via the header \"New\" button). */
  let unsavedClearedForSession = false;

  const show = (opts?: { unsavedAlreadyCleared?: boolean }): void => {
    visible = true;
    unsavedClearedForSession = opts?.unsavedAlreadyCleared ?? false;
    elements.launchDashboard.hidden = false;
    elements.appFrame.classList.add('launch-blocked');
  };

  const hide = (): void => {
    visible = false;
    unsavedClearedForSession = false;
    elements.launchDashboard.hidden = true;
    elements.appFrame.classList.remove('launch-blocked');
  };

  const load = async (): Promise<void> => {
    render(await window.xtream.show.getLaunchData());
  };

  const complete = async (result: ShowConfigOperationResult, message: string): Promise<void> => {
    const flowStartMs = performance.now();
    const runId = result.openProfileRunId ?? `so-local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    logShowOpenProfile({
      runId,
      checkpoint: 'renderer_open_flow_start',
      sinceRunStartMs: 0,
      extra: { route: 'launch_dashboard', hasMainRunId: Boolean(result.openProfileRunId) },
    });
    setLaunchDashboardLoadingUi(true);
    let workspaceExposed = false;
    const finishLaunchLoading = (): void => {
      if (workspaceExposed) {
        return;
      }
      workspaceExposed = true;
      setLaunchDashboardLoadingUi(false);
      hide();
    };
    const exposeWorkspace = (): void => {
      setShowStatus(message, result.issues);
      finishLaunchLoading();
    };
    try {
      clearSelection();
      clearLiveVisualPoolThumbnailCache();
      setShownProjectPath(result.filePath);
      renderState(result.state);
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_after_first_render_state',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
      await hydrateAfterShowLoaded?.(result, { runId, flowStartMs });
      renderState(result.state);
      await waitForUiHydrationTurn();
      if (!isHydratedSurfaceMounted(getActiveSurface())) {
        logShowOpenProfile({
          runId,
          checkpoint: 'renderer_hydrated_surface_not_mounted',
          sinceRunStartMs: performance.now() - flowStartMs,
          extra: { activeSurface: getActiveSurface() },
        });
      }
      exposeWorkspace();
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_before_wait_ready',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
      void waitForLaunchPresentationReady({
        getActiveSurface,
        setShowStatus,
        showOpenProfile: { runId, flowStartMs },
      }).then(() => {
        logShowOpenProfile({
          runId,
          checkpoint: 'renderer_open_flow_done',
          sinceRunStartMs: performance.now() - flowStartMs,
        });
      });
    } finally {
      if (!workspaceExposed) {
        finishLaunchLoading();
      }
    }
  };

  const render = (data: LaunchShowData): void => {
    elements.launchOpenDefaultButton.title = data.defaultShow.exists
      ? `Open default show: ${data.defaultShow.filePath}`
      : `Create and open default show: ${data.defaultShow.filePath}`;
    if (data.recentShows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'launch-empty';
      empty.textContent = 'No recent shows yet.';
      elements.launchRecentList.replaceChildren(empty);
      return;
    }
    elements.launchRecentList.replaceChildren(...data.recentShows.map(createRecentShowRow));
  };

  const createRecentShowRow = (entry: RecentShowEntry): HTMLButtonElement => {
    const row = document.createElement('button');
    row.className = 'launch-recent-row';
    row.type = 'button';
    row.title = entry.filePath;
    const name = document.createElement('span');
    name.className = 'launch-recent-name';
    name.textContent = entry.displayName;
    const filePath = document.createElement('span');
    filePath.className = 'launch-recent-path';
    filePath.textContent = entry.filePath;
    row.replaceChildren(name, filePath);
    row.addEventListener('click', async () => {
      const operationId = createOperationId('so');
      logSessionEvent({
        runId: operationId,
        checkpoint: 'ui_open_recent_invoked',
        domain: 'config',
        kind: 'operation',
        extra: { route: 'launch_dashboard', filePath: entry.filePath },
      });
      // If the unsaved-changes check was already done before showing the dashboard, skip it here.
      const skipPrompt = unsavedClearedForSession;
      if (!skipPrompt && !(await window.xtream.show.promptUnsavedIfNeeded('openRecent'))) {
        logSessionEvent({
          runId: operationId,
          checkpoint: 'ui_open_recent_aborted_unsaved',
          domain: 'config',
          kind: 'operation',
          extra: { route: 'launch_dashboard', filePath: entry.filePath },
        });
        return;
      }
      unsavedClearedForSession = false;
      setLaunchDashboardLoadingUi(true);
      try {
        const result = await window.xtream.show.openRecent(entry.filePath, { skipUnsavedPrompt: true, operationId, route: 'launch_dashboard' });
        if (result) {
          await complete(result, `Opened show config: ${result.filePath ?? entry.filePath}`);
          return;
        }
        setLaunchDashboardLoadingUi(false);
        setShowStatus(`Recent show is no longer available: ${entry.filePath}`);
        await load();
      } catch (error) {
        setLaunchDashboardLoadingUi(false);
        throw error;
      }
    });
    return row;
  };

  return {
    complete,
    hide,
    isVisible: () => visible,
    load,
    show,
    /** Consumes the unsaved-cleared flag; returns true if the unsaved prompt can be skipped. */
    consumeUnsavedClearedFlag: (): boolean => {
      const v = unsavedClearedForSession;
      unsavedClearedForSession = false;
      return v;
    },
  };
}
