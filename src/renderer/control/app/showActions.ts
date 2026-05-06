import type { DirectorState, MediaValidationIssue, ShowConfigOperationResult } from '../../../shared/types';
import { logShowOpenProfile, type ShowOpenProfileFlowContext } from '../../../shared/showOpenProfile';
import { setShownProjectPath } from './showProjectPath';
import { clearLiveVisualPoolThumbnailCache } from '../patch/visualPoolThumbnailCache';

type ShowActionsOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: MediaValidationIssue[]) => void;
  clearSelection: () => void;
  onShowOpened: () => void;
  onShowCreated: () => void;
  /** Presents the startup launch dashboard so the user can choose create vs open before any folder dialog. */
  presentLaunchDashboardForCreate: () => Promise<void>;
  hydrateAfterShowLoaded?: (result: ShowConfigOperationResult, ctx?: ShowOpenProfileFlowContext) => Promise<void>;
  /** Sync: show workspace + launch loading overlays before dialogs/hydrate (workspace opaque backdrop whenever opening/creating). */
  beginLaunchPresentationLoad?: () => void;
  /** Wait for presentation-ready (after hydrate); loading overlay must already be visible when applicable. */
  awaitLaunchPresentationReady?: (ctx?: ShowOpenProfileFlowContext) => Promise<void>;
  /** Clear launch loading overlay before hiding launch shell. */
  clearLaunchPresentationLoading?: () => void;
};

export type ShowActions = ReturnType<typeof createShowActions>;

function waitForUiHydrationTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function createShowActions(options: ShowActionsOptions) {
  async function saveShow(): Promise<void> {
    const result = await window.xtream.show.save();
    setShownProjectPath(result.filePath);
    options.renderState(result.state);
    options.setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
  }

  async function saveShowAs(): Promise<void> {
    const result = await window.xtream.show.saveAs();
    if (result) {
      setShownProjectPath(result.filePath);
      options.renderState(result.state);
      options.setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
    }
  }

  async function openShow(): Promise<void> {
    if (!(await window.xtream.show.promptUnsavedIfNeeded('open'))) {
      return;
    }
    options.beginLaunchPresentationLoad?.();
    const result = await window.xtream.show.open({ skipUnsavedPrompt: true });
    if (!result) {
      options.clearLaunchPresentationLoading?.();
      return;
    }
    const flowStartMs = performance.now();
    const runId = result.openProfileRunId ?? `so-local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setShownProjectPath(result.filePath);
    logShowOpenProfile({
      runId,
      checkpoint: 'renderer_open_flow_start',
      sinceRunStartMs: 0,
      extra: { route: 'menu_open', hasMainRunId: Boolean(result.openProfileRunId) },
    });
    clearLiveVisualPoolThumbnailCache();
    let workspaceExposed = false;
    const exposeWorkspace = (): void => {
      if (workspaceExposed) {
        return;
      }
      workspaceExposed = true;
      options.clearLaunchPresentationLoading?.();
      options.onShowOpened();
    };
    try {
      options.renderState(result.state);
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_after_first_render_state',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
      await options.hydrateAfterShowLoaded?.(result, { runId, flowStartMs });
      options.renderState(result.state);
      options.setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
      await waitForUiHydrationTurn();
      exposeWorkspace();
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_before_wait_ready',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
      const readinessWait = options.awaitLaunchPresentationReady?.({ runId, flowStartMs });
      if (readinessWait) {
        void readinessWait.then(() => {
          logShowOpenProfile({
            runId,
            checkpoint: 'renderer_open_flow_done',
            sinceRunStartMs: performance.now() - flowStartMs,
          });
        });
      }
    } finally {
      if (!workspaceExposed) {
        options.clearLaunchPresentationLoading?.();
      }
    }
  }

  async function createShow(): Promise<void> {
    await options.presentLaunchDashboardForCreate();
  }

  return {
    createShow,
    openShow,
    saveShow,
    saveShowAs,
  };
}
