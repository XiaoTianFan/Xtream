import { formatTimecode, getDirectorSeconds } from '../../../shared/timeline';
import type { DirectorState } from '../../../shared/types';
import type { ShowActions } from '../app/showActions';
import { syncSliderProgress } from '../shared/dom';
import { patchElements as elements } from './elements';
import { createTransportController } from './transportControls';

type PatchHeaderControllerOptions = {
  getState: () => DirectorState | undefined;
  getIsStreamPlaybackActive: () => boolean;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string, issues?: DirectorState['readiness']['issues']) => void;
  showActions: ShowActions;
};

export type PatchHeaderController = ReturnType<typeof createPatchHeaderController>;

export function createPatchHeaderController(options: PatchHeaderControllerOptions) {
  const transport = createTransportController({
    getState: options.getState,
    getIsStreamPlaybackActive: options.getIsStreamPlaybackActive,
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
    elements.timelineScrubber.addEventListener('pointerdown', () => {
      transport.beginTimelineScrub();
    });
    elements.timelineScrubber.addEventListener('pointerup', () => {
      transport.finishTimelineScrub();
      transport.holdTimelineScrubDraft();
    });
    elements.timelineScrubber.addEventListener('pointercancel', transport.finishTimelineScrub);
    elements.timelineScrubber.addEventListener('input', () => {
      transport.holdTimelineScrubDraft();
      syncSliderProgress(elements.timelineScrubber);
    });
    elements.timelineScrubber.addEventListener('change', () => {
      transport.holdTimelineScrubDraft(1000);
      void transport.sendTransport({ type: 'seek', seconds: Number(elements.timelineScrubber.value) || 0 }).finally(transport.finishTimelineScrub);
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
    elements.saveShowButton.addEventListener('click', () => void options.showActions.saveShow());
    elements.saveShowAsButton.addEventListener('click', () => void options.showActions.saveShowAs());
    elements.openShowButton.addEventListener('click', () => void options.showActions.openShow());
    elements.createShowButton.addEventListener('click', () => void options.showActions.createShow());
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
