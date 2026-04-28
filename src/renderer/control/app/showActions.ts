import type { DirectorState, MediaValidationIssue } from '../../../shared/types';

type ShowActionsOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: MediaValidationIssue[]) => void;
  clearSelection: () => void;
  onShowOpened: () => void;
  onShowCreated: () => void;
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
    const result = await window.xtream.show.open();
    if (result) {
      options.renderState(result.state);
      options.setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
      options.onShowOpened();
    }
  }

  async function createShow(): Promise<void> {
    const result = await window.xtream.show.createProject();
    if (result) {
      options.clearSelection();
      options.renderState(result.state);
      options.setShowStatus(`Created show project: ${result.filePath ?? 'selected folder'}`, result.issues);
      options.onShowCreated();
    }
  }

  return {
    createShow,
    openShow,
    saveShow,
    saveShowAs,
  };
}
