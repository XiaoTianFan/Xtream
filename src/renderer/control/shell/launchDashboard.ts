import type { DirectorState, LaunchShowData, RecentShowEntry, ShowConfigOperationResult } from '../../../shared/types';
import type { ControlSurface } from '../shared/types';
import { elements } from './elements';
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

type LaunchDashboardOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: ShowConfigOperationResult['issues']) => void;
  clearSelection: () => void;
  hydrateAfterShowLoaded?: (result: ShowConfigOperationResult) => Promise<void>;
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

  const show = (): void => {
    visible = true;
    elements.launchDashboard.hidden = false;
    elements.appFrame.classList.add('launch-blocked');
  };

  const hide = (): void => {
    visible = false;
    elements.launchDashboard.hidden = true;
    elements.appFrame.classList.remove('launch-blocked');
  };

  const load = async (): Promise<void> => {
    render(await window.xtream.show.getLaunchData());
  };

  const complete = async (result: ShowConfigOperationResult, message: string): Promise<void> => {
    setLaunchDashboardLoadingUi(true);
    try {
      clearSelection();
      renderState(result.state);
      await hydrateAfterShowLoaded?.(result);
      renderState(result.state);
      await waitForLaunchPresentationReady({
        getActiveSurface,
        setShowStatus,
      });
    } finally {
      setLaunchDashboardLoadingUi(false);
    }
    setShowStatus(message, result.issues);
    hide();
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
      setLaunchDashboardLoadingUi(true);
      try {
        const result = await window.xtream.show.openRecent(entry.filePath);
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
  };
}
