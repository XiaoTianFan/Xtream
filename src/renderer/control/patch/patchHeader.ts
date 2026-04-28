import { formatTimecode, getDirectorSeconds } from '../../../shared/timeline';
import type { DirectorState } from '../../../shared/types';
import { syncSliderProgress } from '../shared/dom';
import { elements } from '../shell/elements';
import { createTransportController } from './transportControls';

type PatchHeaderControllerOptions = {
  getState: () => DirectorState | undefined;
  getSoloOutputCount: () => number;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: DirectorState['readiness']['issues']) => void;
  clearSelection: () => void;
  onShowOpened: () => void;
  onShowCreated: () => void;
};

export type PatchHeaderController = ReturnType<typeof createPatchHeaderController>;

export function createPatchHeaderController(options: PatchHeaderControllerOptions) {
  const transport = createTransportController({
    getState: options.getState,
    getSoloOutputCount: options.getSoloOutputCount,
    renderState: options.renderState,
    setShowStatus: options.setShowStatus,
  });

  function install(): void {
    elements.timecode.tabIndex = 0;
    elements.timecode.title = 'Double-click to seek by timecode';
    elements.timecode.addEventListener('dblclick', transport.beginTimecodeEdit);
    elements.timecode.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        transport.beginTimecodeEdit();
      }
    });
    elements.loopToggleButton.addEventListener('click', () => {
      elements.loopPopover.hidden = !elements.loopPopover.hidden;
      elements.loopToggleButton.setAttribute('aria-expanded', String(!elements.loopPopover.hidden));
    });
    elements.rateDisplayButton.addEventListener('dblclick', transport.beginRateEdit);
    elements.rateDisplayButton.addEventListener('pointerdown', transport.beginRateDrag);
    elements.rateDisplayButton.addEventListener('pointermove', transport.updateRateDrag);
    elements.rateDisplayButton.addEventListener('pointerup', transport.finishRateDrag);
    elements.rateDisplayButton.addEventListener('pointercancel', () => {
      transport.cancelRateDrag();
    });
    elements.playButton.addEventListener('click', () => void transport.sendTransport({ type: 'play' }));
    elements.pauseButton.addEventListener('click', () => void transport.sendTransport({ type: 'pause' }));
    elements.stopButton.addEventListener('click', () => void transport.sendTransport({ type: 'stop' }));
    elements.timelineScrubber.addEventListener('input', () => syncSliderProgress(elements.timelineScrubber));
    elements.timelineScrubber.addEventListener('change', () => {
      void transport.sendTransport({ type: 'seek', seconds: Number(elements.timelineScrubber.value) || 0 });
    });
    elements.loopActivateButton.addEventListener('click', () => {
      const state = options.getState();
      if (!state) {
        return;
      }
      void transport.commitLoopDraft(!state.loop.enabled);
    });
    for (const input of [elements.loopStartInput, elements.loopEndInput]) {
      input.addEventListener('input', () => transport.markTransportDraft(input));
      input.addEventListener('change', () => void transport.commitLoopDraft());
    }
    elements.saveShowButton.addEventListener('click', async () => {
      const result = await window.xtream.show.save();
      options.renderState(result.state);
      options.setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
    });
    elements.saveShowAsButton.addEventListener('click', async () => {
      const result = await window.xtream.show.saveAs();
      if (result) {
        options.renderState(result.state);
        options.setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
      }
    });
    elements.openShowButton.addEventListener('click', async () => {
      const result = await window.xtream.show.open();
      if (result) {
        options.renderState(result.state);
        options.setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
        options.onShowOpened();
      }
    });
    elements.createShowButton.addEventListener('click', async () => {
      const result = await window.xtream.show.createProject();
      if (result) {
        options.clearSelection();
        options.renderState(result.state);
        options.setShowStatus(`Created show project: ${result.filePath ?? 'selected folder'}`, result.issues);
        options.onShowCreated();
      }
    });
    elements.globalAudioMuteButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ globalAudioMuted: !options.getState()?.globalAudioMuted }));
    });
    elements.displayBlackoutButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ globalDisplayBlackout: !options.getState()?.globalDisplayBlackout }));
    });
    elements.performanceModeButton.addEventListener('click', async () => {
      options.renderState(await window.xtream.director.updateGlobalState({ performanceMode: !options.getState()?.performanceMode }));
    });
  }

  function sync(state: DirectorState): void {
    transport.syncTransportInputs(state);
  }

  function tick(): void {
    const state = options.getState();
    if (!state) {
      return;
    }
    if (!transport.isTimecodeEditing()) {
      elements.timecode.textContent = formatTimecode(getDirectorSeconds(state));
    }
    transport.syncTimelineScrubber(state);
  }

  return {
    install,
    sync,
    tick,
  };
}
