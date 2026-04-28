import type { DirectorState, MediaValidationIssue, ShowConfigOperationResult } from '../../../shared/types';

type ShowActionsOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: MediaValidationIssue[]) => void;
  clearSelection: () => void;
  onShowOpened: () => void;
  onShowCreated: () => void;
  hydrateAfterShowLoaded?: (result: ShowConfigOperationResult) => Promise<void>;
  /** Sync: show workspace + launch loading overlays before dialogs/hydrate (workspace opaque backdrop whenever opening/creating). */
  beginLaunchPresentationLoad?: () => void;
  /** Wait for presentation-ready (after hydrate); loading overlay must already be visible when applicable. */
  awaitLaunchPresentationReady?: () => Promise<void>;
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
    try {
      options.renderState(result.state);
      await options.hydrateAfterShowLoaded?.(result);
      options.renderState(result.state);
      options.setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
      await options.awaitLaunchPresentationReady?.();
    } finally {
      options.clearLaunchPresentationLoading?.();
    }
    options.onShowOpened();
  }

  async function createShow(): Promise<void> {
    options.beginLaunchPresentationLoad?.();
    const result = await window.xtream.show.createProject();
    if (!result) {
      options.clearLaunchPresentationLoading?.();
      return;
    }
    try {
      options.clearSelection();
      options.renderState(result.state);
      await options.hydrateAfterShowLoaded?.(result);
      options.renderState(result.state);
      options.setShowStatus(`Created show project: ${result.filePath ?? 'selected folder'}`, result.issues);
      await options.awaitLaunchPresentationReady?.();
    } finally {
      options.clearLaunchPresentationLoading?.();
    }
    options.onShowCreated();
  }

  return {
    createShow,
    openShow,
    saveShow,
    saveShowAs,
  };
}
