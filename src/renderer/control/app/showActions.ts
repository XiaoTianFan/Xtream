import type { DirectorState, MediaValidationIssue, ShowConfigOperationResult } from '../../../shared/types';
import { logShowOpenProfile, type ShowOpenProfileFlowContext } from '../../../shared/showOpenProfile';
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

export function createShowActions(options: ShowActionsOptions) {
  async function saveShow(): Promise<void> {
    const result = await window.xtream.show.save();
    options.renderState(result.state);
    options.setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
  }

  async function saveShowAs(): Promise<void> {
    const result = await window.xtream.show.saveAs();
    if (result) {
      options.renderState(result.state);
      options.setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
    }
  }

  async function openShow(): Promise<void> {
    options.beginLaunchPresentationLoad?.();
    const result = await window.xtream.show.open();
    if (!result) {
      options.clearLaunchPresentationLoading?.();
      return;
    }
    const flowStartMs = performance.now();
    const runId = result.openProfileRunId ?? `so-local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    logShowOpenProfile({
      runId,
      checkpoint: 'renderer_open_flow_start',
      sinceRunStartMs: 0,
      extra: { route: 'menu_open', hasMainRunId: Boolean(result.openProfileRunId) },
    });
    clearLiveVisualPoolThumbnailCache();
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
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_before_wait_ready',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
      await options.awaitLaunchPresentationReady?.({ runId, flowStartMs });
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_open_flow_done',
        sinceRunStartMs: performance.now() - flowStartMs,
      });
    } finally {
      options.clearLaunchPresentationLoading?.();
    }
    options.onShowOpened();
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
