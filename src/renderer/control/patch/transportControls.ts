import { formatTimecode, getDirectorSeconds, parseTimecodeInput } from '../../../shared/timeline';
import type { DirectorState, TransportCommand } from '../../../shared/types';
import { decorateIconButton, type ControlIcon } from '../shared/icons';
import { syncSliderProgress } from '../shared/dom';
import { patchElements as elements } from './elements';
import { derivePatchTransportUiState } from './patchTransportUiState';
import { sendLoggedPatchTransport } from '../shared/sessionTransportLog';

type TransportControllerOptions = {
  getState: () => DirectorState | undefined;
  getIsStreamPlaybackActive: () => boolean;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
};

export type TransportController = ReturnType<typeof createTransportController>;

export function createTransportController({ getState, getIsStreamPlaybackActive, renderState, setShowStatus }: TransportControllerOptions) {
  let timecodeEditor: HTMLInputElement | undefined;
  let rateDragStart: { clientX: number; rate: number } | undefined;
  let timelineScrubPointerActive = false;
  let timelineScrubDraftUntil = 0;
  let lastPlayButtonChrome: { icon: ControlIcon; label: string } | undefined;
  const transportDraftElements = new Set<HTMLInputElement>([elements.loopStartInput, elements.loopEndInput]);

  const isTransportDraftActive = (input: HTMLInputElement): boolean =>
    document.activeElement === input || (transportDraftElements.has(input) && input.dataset.dirty === 'true');

  const isTimelineScrubDraftActive = (): boolean => timelineScrubPointerActive || performance.now() < timelineScrubDraftUntil;

  const syncTransportInputs = (state: DirectorState): void => {
    const ready = state.readiness.ready;
    const seconds = getDirectorSeconds(state);
    const transportUi = derivePatchTransportUiState({
      ready,
      patchPaused: state.paused,
      currentSeconds: seconds,
      streamPlaybackActive: getIsStreamPlaybackActive(),
    });
    elements.playButton.disabled = transportUi.playDisabled;
    const streamActive = getIsStreamPlaybackActive();
    const playLabel = streamActive
      ? 'Stream playback is active'
      : !state.paused
        ? 'Restart from beginning'
        : 'Play / resume Patch timeline';
    const playIcon: ControlIcon = streamActive || state.paused ? 'Play' : 'SkipBack';
    if (!lastPlayButtonChrome || lastPlayButtonChrome.icon !== playIcon || lastPlayButtonChrome.label !== playLabel) {
      decorateIconButton(elements.playButton, playIcon, playLabel);
      lastPlayButtonChrome = { icon: playIcon, label: playLabel };
    }
    elements.pauseButton.disabled = transportUi.pauseDisabled;
    elements.stopButton.disabled = transportUi.stopDisabled;
    elements.rateDisplayButton.disabled = transportUi.rateDisabled;
    elements.rateDisplayButton.textContent = `${state.rate.toFixed(2)}x`;
    const liveState = getLiveStateLabel(state);
    elements.liveState.textContent = liveState;
    elements.liveState.dataset.state = liveState.toLowerCase();
    elements.loopToggleButton.classList.toggle('active', state.loop.enabled);
    elements.loopToggleButton.setAttribute('aria-expanded', String(!elements.loopPopover.hidden));
    elements.loopActivateButton.textContent = state.loop.enabled ? 'Deactivate' : 'Activate';
    elements.loopActivateButton.setAttribute('aria-pressed', String(state.loop.enabled));
    elements.loopActivateButton.classList.toggle('active', state.loop.enabled);
    elements.loopActivateButton.title = state.loop.enabled ? 'Turn loop playback off' : 'Turn loop playback on';
    if (!isTransportDraftActive(elements.loopStartInput)) {
      elements.loopStartInput.value = formatTimecode(state.loop.startSeconds);
    }
    if (!isTransportDraftActive(elements.loopEndInput)) {
      elements.loopEndInput.value = state.loop.endSeconds === undefined ? '' : formatTimecode(state.loop.endSeconds);
    }
  };

  const syncTimelineScrubber = (state: DirectorState): void => {
    const duration = state.activeTimeline.durationSeconds;
    const currentSeconds = getDirectorSeconds(state);
    if (duration === undefined) {
      elements.timelineScrubber.disabled = true;
      elements.timelineScrubber.max = '0';
      elements.timelineScrubber.value = '0';
      elements.timelineSummaryPrimary.textContent = 'No active timeline duration';
      elements.timelineLoopLimitLine.textContent = '';
      elements.timelineLoopLimitLine.hidden = true;
      elements.timelineScrubber.style.setProperty('--progress', '0%');
      elements.timelineScrubber.style.removeProperty('--loop-start');
      elements.timelineScrubber.style.removeProperty('--loop-end');
      return;
    }
    elements.timelineScrubber.disabled = false;
    elements.timelineScrubber.max = String(duration);
    const timelineScrubDraftActive = isTimelineScrubDraftActive();
    if (!timelineScrubDraftActive) {
      elements.timelineScrubber.value = String(Math.min(currentSeconds, duration));
    }
    const displaySeconds = timelineScrubDraftActive ? Number(elements.timelineScrubber.value) || 0 : currentSeconds;
    const clampedDisplaySeconds = Math.min(duration, Math.max(0, displaySeconds));
    elements.timelineScrubber.style.setProperty('--progress', `${Math.min(100, Math.max(0, (clampedDisplaySeconds / duration) * 100))}%`);
    if (state.loop.enabled) {
      elements.timelineScrubber.style.setProperty('--loop-start', `${Math.min(100, Math.max(0, (state.loop.startSeconds / duration) * 100))}%`);
      elements.timelineScrubber.style.setProperty(
        '--loop-end',
        `${Math.min(100, Math.max(0, ((state.loop.endSeconds ?? duration) / duration) * 100))}%`,
      );
    } else {
      elements.timelineScrubber.style.removeProperty('--loop-start');
      elements.timelineScrubber.style.removeProperty('--loop-end');
    }
    const loopLimit = state.activeTimeline.loopRangeLimit;
    elements.timelineSummaryPrimary.textContent = `Timeline ${formatTimecode(clampedDisplaySeconds)} / ${formatTimecode(duration)}`;
    if (loopLimit) {
      elements.timelineLoopLimitLine.textContent = `loop range limit: ${formatTimecode(loopLimit.startSeconds)}-${formatTimecode(loopLimit.endSeconds)}`;
      elements.timelineLoopLimitLine.hidden = false;
    } else {
      elements.timelineLoopLimitLine.textContent = '';
      elements.timelineLoopLimitLine.hidden = true;
    }
  };

  const sendTransport = async (command: TransportCommand): Promise<DirectorState> => {
    const state = await sendLoggedPatchTransport(command, 'patch');
    renderState(state);
    return state;
  };

  const beginTimecodeEdit = (): void => {
    const state = getState();
    if (!state || timecodeEditor) {
      return;
    }
    const input = document.createElement('input');
    input.className = 'timecode-input';
    input.type = 'text';
    input.value = formatTimecode(getDirectorSeconds(state));
    input.setAttribute('aria-label', 'Seek timecode');
    timecodeEditor = input;
    elements.timecode.replaceChildren(input);
    input.focus();
    input.select();
    let finishing = false;

    const finish = async (commit: boolean) => {
      const latestState = getState();
      if (timecodeEditor !== input || finishing || !latestState) {
        return;
      }
      finishing = true;
      if (commit) {
        const result = parseTimecodeInput(input.value);
        if (!result.ok) {
          setShowStatus(`Seek timecode rejected: ${result.error}`);
          timecodeEditor = undefined;
          elements.timecode.textContent = formatTimecode(getDirectorSeconds(latestState));
        } else {
          input.disabled = true;
          try {
            const nextState = await sendTransport({ type: 'seek', seconds: result.seconds, seekKind: 'manual', seekSource: 'timecode' });
            if (timecodeEditor === input) {
              timecodeEditor = undefined;
              elements.timecode.textContent = formatTimecode(getDirectorSeconds(nextState));
            }
          } catch (error) {
            const fallbackState = getState();
            if (timecodeEditor === input && fallbackState) {
              timecodeEditor = undefined;
              setShowStatus(error instanceof Error ? `Seek failed: ${error.message}` : 'Seek failed.');
              elements.timecode.textContent = formatTimecode(getDirectorSeconds(fallbackState));
            }
          }
        }
      } else {
        timecodeEditor = undefined;
        elements.timecode.textContent = formatTimecode(getDirectorSeconds(latestState));
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => void finish(true));
  };

  const beginRateEdit = (): void => {
    const state = getState();
    if (!state) {
      return;
    }
    const input = document.createElement('input');
    input.className = 'rate-input-inline';
    input.type = 'number';
    input.min = '0.1';
    input.step = '0.01';
    input.value = String(state.rate);
    elements.rateDisplayButton.replaceChildren(input);
    input.focus();
    input.select();
    const finish = (commit: boolean) => {
      if (commit) {
        const rate = Number(input.value);
        if (Number.isFinite(rate) && rate > 0) {
          void sendTransport({ type: 'set-rate', rate });
        }
      }
      const latestState = getState();
      elements.rateDisplayButton.textContent = latestState ? `${latestState.rate.toFixed(2)}x` : '1.00x';
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        finish(true);
      }
      if (event.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  };

  const beginRateDrag = (event: PointerEvent): void => {
    const state = getState();
    if (!state || event.button !== 0) {
      return;
    }
    rateDragStart = { clientX: event.clientX, rate: state.rate };
    elements.rateDisplayButton.setPointerCapture(event.pointerId);
  };

  const updateRateDrag = (event: PointerEvent): void => {
    if (!rateDragStart) {
      return;
    }
    const delta = event.clientX - rateDragStart.clientX;
    const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
    elements.rateDisplayButton.textContent = `${nextRate.toFixed(2)}x`;
  };

  const finishRateDrag = (event: PointerEvent): void => {
    if (!rateDragStart) {
      return;
    }
    const delta = event.clientX - rateDragStart.clientX;
    const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
    rateDragStart = undefined;
    if (Math.abs(delta) > 2) {
      void sendTransport({ type: 'set-rate', rate: Number(nextRate.toFixed(2)) });
    }
  };

  const readLoopDraft = (enabledOverride?: boolean): DirectorState['loop'] => {
    const enabled = enabledOverride !== undefined ? enabledOverride : (getState()?.loop.enabled ?? false);
    const start = parseTimecodeInput(elements.loopStartInput.value);
    const end = elements.loopEndInput.value.trim() === '' ? undefined : parseTimecodeInput(elements.loopEndInput.value);
    return {
      enabled,
      startSeconds: start.ok ? start.seconds : 0,
      endSeconds: end === undefined ? undefined : end.ok ? end.seconds : undefined,
    };
  };

  const clearTransportDrafts = (inputs: HTMLInputElement[]): void => {
    for (const input of inputs) {
      input.dataset.dirty = 'false';
    }
  };

  const commitLoopDraft = async (enabledOverride?: boolean): Promise<void> => {
    await sendTransport({ type: 'set-loop', loop: readLoopDraft(enabledOverride) });
    clearTransportDrafts([elements.loopStartInput, elements.loopEndInput]);
  };

  return {
    beginRateDrag,
    beginRateEdit,
    beginTimelineScrub: () => {
      timelineScrubPointerActive = true;
    },
    beginTimecodeEdit,
    cancelRateDrag: () => {
      rateDragStart = undefined;
    },
    commitLoopDraft,
    finishRateDrag,
    finishTimelineScrub: () => {
      timelineScrubPointerActive = false;
      timelineScrubDraftUntil = 0;
    },
    holdTimelineScrubDraft: (milliseconds = 300) => {
      timelineScrubDraftUntil = Math.max(timelineScrubDraftUntil, performance.now() + milliseconds);
    },
    isTimecodeEditing: () => Boolean(timecodeEditor),
    markTransportDraft: (input: HTMLInputElement) => {
      input.dataset.dirty = 'true';
    },
    sendTransport,
    syncTimelineScrubber,
    syncTransportInputs,
    updateRateDrag,
  };
}

function getLiveStateLabel(state: DirectorState): 'LIVE' | 'STANDBY' | 'BLOCKED' | 'DEGRADED' {
  if (state.readiness.issues.some((issue) => issue.severity === 'error')) {
    return 'BLOCKED';
  }
  if (state.readiness.issues.some((issue) => issue.severity === 'warning') || Object.values(state.displays).some((display) => display.health === 'degraded')) {
    return 'DEGRADED';
  }
  return state.paused ? 'STANDBY' : 'LIVE';
}
