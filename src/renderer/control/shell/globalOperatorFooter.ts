import type { DirectorState } from '../../../shared/types';
import type { ControlElements } from './elements';

export type GlobalOperatorFooterElements = Pick<
  ControlElements,
  'globalAudioMuteButton' | 'displayBlackoutButton' | 'performanceModeButton' | 'clearSoloButton' | 'resetMetersButton'
>;

export function syncGlobalOperatorFooter(
  state: DirectorState,
  els: GlobalOperatorFooterElements,
  getSoloOutputCount: () => number,
): void {
  els.globalAudioMuteButton.classList.toggle('active', state.globalAudioMuted);
  els.globalAudioMuteButton.textContent = state.globalAudioMuted ? 'Audio Muted' : 'Audio Mute';
  els.globalAudioMuteButton.setAttribute('aria-pressed', String(state.globalAudioMuted));
  const soloOutputCount = getSoloOutputCount();
  els.clearSoloButton.disabled = soloOutputCount === 0;
  els.clearSoloButton.classList.toggle('active', soloOutputCount > 0);
  els.clearSoloButton.setAttribute('aria-pressed', String(soloOutputCount > 0));
  els.clearSoloButton.title = soloOutputCount > 0 ? 'Clear all soloed outputs' : 'No soloed outputs';
  els.displayBlackoutButton.classList.toggle('active', state.globalDisplayBlackout);
  els.displayBlackoutButton.textContent = state.globalDisplayBlackout ? 'Display Blackout On' : 'Display Blackout';
  els.displayBlackoutButton.setAttribute('aria-pressed', String(state.globalDisplayBlackout));
  els.performanceModeButton.classList.toggle('active', state.performanceMode);
  els.performanceModeButton.textContent = state.performanceMode ? 'Performance Mode On' : 'Performance Mode';
  els.performanceModeButton.setAttribute('aria-pressed', String(state.performanceMode));
  els.performanceModeButton.title = state.performanceMode
    ? 'Performance mode disables control-window video previews and live meter sampling.'
    : 'Disable control-window preview and meter workloads for weaker playback machines.';
}

type GlobalOperatorFooterControllerOptions = {
  elements: GlobalOperatorFooterElements;
  getState: () => DirectorState | undefined;
  renderState: (state: DirectorState) => void;
  getSoloOutputCount: () => number;
  clearSoloOutputs: () => void;
  resetMetersRequested: () => void;
};

export function createGlobalOperatorFooterController(options: GlobalOperatorFooterControllerOptions) {
  function install(): void {
    options.elements.globalAudioMuteButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ globalAudioMuted: !options.getState()?.globalAudioMuted }));
    });
    options.elements.displayBlackoutButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ globalDisplayBlackout: !options.getState()?.globalDisplayBlackout }));
    });
    options.elements.performanceModeButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ performanceMode: !options.getState()?.performanceMode }));
    });
    options.elements.clearSoloButton.addEventListener('click', () => {
      options.clearSoloOutputs();
      sync(options.getState());
    });
    options.elements.resetMetersButton.addEventListener('click', () => {
      options.resetMetersRequested();
    });
  }

  function sync(state: DirectorState | undefined): void {
    if (!state) {
      return;
    }
    syncGlobalOperatorFooter(state, options.elements, options.getSoloOutputCount);
  }

  return { install, sync };
}

export type GlobalOperatorFooterController = ReturnType<typeof createGlobalOperatorFooterController>;
