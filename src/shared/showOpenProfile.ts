/** Correlates main + renderer timing for opening a show (observability). */
export type ShowOpenProfileFlowContext = {
  runId: string;
  /** `performance.now()` when the renderer open flow started (after IPC returned). */
  flowStartMs: number;
};

/**
 * Show-open checkpoints for the in-app log (Config → Show open profile log).
 *
 * Main checkpoints: main_open_path_enter, main_read_config_done, main_restore_enter, main_validate_media_done,
 * main_build_media_urls_done, main_display_close_all_done, main_director_restore_done, main_displays_register_done,
 * main_stream_engine_load_done, main_restore_exit, main_restore_call_done, main_add_recent_done, main_open_path_exit.
 *
 * Renderer checkpoints: renderer_open_flow_start, renderer_after_first_render_state, renderer_hydrate_*,
 * renderer_before_wait_ready, renderer_wait_ready_enter, renderer_wait_ready_blocked (reason in extra),
 * renderer_wait_ready_done, renderer_open_flow_done. Field `extra.route` is menu_open | menu_create | launch_dashboard.
 */

export type ShowOpenProfilePayload = {
  runId: string;
  checkpoint: string;
  sinceRunStartMs: number;
  segmentMs?: number;
  extra?: Record<string, unknown>;
};

/** One profile row for the in-app buffer (renderer + main via IPC). */
export type ShowOpenProfileLogEntry = ShowOpenProfilePayload & {
  loggedAt: number;
  source: 'renderer' | 'main';
};

type ShowOpenProfileUiListener = (entry: ShowOpenProfileLogEntry) => void;
const showOpenProfileUiListeners = new Set<ShowOpenProfileUiListener>();

/** Subscribe when `logShowOpenProfile` runs in a window context (control renderer). */
export function subscribeShowOpenProfileUi(listener: ShowOpenProfileUiListener): () => void {
  showOpenProfileUiListeners.add(listener);
  return () => showOpenProfileUiListeners.delete(listener);
}

function notifyShowOpenProfileUi(entry: ShowOpenProfileLogEntry): void {
  for (const listener of showOpenProfileUiListeners) {
    try {
      listener(entry);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Records a checkpoint for the Config surface log (control window only; Electron main has no `window`). */
export function logShowOpenProfile(payload: ShowOpenProfilePayload): void {
  if (typeof window !== 'undefined') {
    notifyShowOpenProfileUi({ ...payload, loggedAt: Date.now(), source: 'renderer' });
  }
}
