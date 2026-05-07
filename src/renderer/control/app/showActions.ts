import type { DirectorState, MediaValidationIssue, ShowConfigOperationResult } from '../../../shared/types';
import { logSessionEvent, logShowOpenProfile, type ShowOpenProfileFlowContext } from '../../../shared/showOpenProfile';
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

function createOperationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createShowActions(options: ShowActionsOptions) {
  async function saveShow(): Promise<void> {
    const operationId = createOperationId('save');
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_save_show_clicked',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'workspace_header' },
    });
    const result = await window.xtream.show.save({ operationId, route: 'workspace_header' });
    setShownProjectPath(result.filePath);
    options.renderState(result.state);
    options.setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
  }

  async function saveShowAs(): Promise<void> {
    const operationId = createOperationId('save-as');
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_save_as_invoked',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'workspace_header' },
    });
    const result = await window.xtream.show.saveAs({ operationId, route: 'workspace_header' });
    if (result) {
      setShownProjectPath(result.filePath);
      options.renderState(result.state);
      options.setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
    }
  }

  async function openShow(): Promise<void> {
    const operationId = createOperationId('so');
    logSessionEvent({
      runId: operationId,
      checkpoint: 'ui_open_show_invoked',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'workspace_header' },
    });
    if (!(await window.xtream.show.promptUnsavedIfNeeded('open'))) {
      logSessionEvent({
        runId: operationId,
        checkpoint: 'ui_open_show_aborted_unsaved',
        domain: 'config',
        kind: 'operation',
        extra: { route: 'workspace_header' },
      });
      return;
    }
    options.beginLaunchPresentationLoad?.();
    const result = await window.xtream.show.open({ skipUnsavedPrompt: true, operationId, route: 'workspace_header' });
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
    logSessionEvent({
      runId: createOperationId('create'),
      checkpoint: 'ui_create_show_invoked',
      domain: 'config',
      kind: 'operation',
      extra: { route: 'workspace_header' },
    });
    await options.presentLaunchDashboardForCreate();
  }

  return {
    createShow,
    openShow,
    saveShow,
    saveShowAs,
  };
}
