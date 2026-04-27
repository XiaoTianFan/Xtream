import type { DirectorState } from '../../shared/types';

export type MediaSyncState = {
  pendingSeekSeconds?: number;
  playAfterSeek?: boolean;
  lastPlayAttemptMs?: number;
  lastSyncKey?: string;
};

const mediaSyncStates = new WeakMap<HTMLMediaElement, MediaSyncState>();

export function syncTimedMediaElement(
  element: HTMLMediaElement,
  targetSeconds: number,
  shouldPlay: boolean,
  syncKey: string,
  driftSeekThresholdSeconds: number,
  beforePlay?: () => void,
): void {
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
    return;
  }
  const state = getMediaSyncState(element);
  const safeTarget = clampMediaTime(targetSeconds, element);
  if (state.pendingSeekSeconds !== undefined) {
    state.playAfterSeek = shouldPlay;
    if (!shouldPlay) {
      element.pause();
    }
    return;
  }

  const syncKeyChanged = state.lastSyncKey !== syncKey;
  state.lastSyncKey = syncKey;
  const driftSeconds = Math.abs(element.currentTime - safeTarget);
  const shouldSeek = syncKeyChanged ? driftSeconds > 0.05 : driftSeconds > driftSeekThresholdSeconds;
  if (shouldSeek) {
    state.pendingSeekSeconds = safeTarget;
    state.playAfterSeek = shouldPlay;
    const completeSeek = () => {
      element.removeEventListener('seeked', completeSeek);
      state.pendingSeekSeconds = undefined;
      if (state.playAfterSeek) {
        beforePlay?.();
        requestMediaPlay(element, state, true);
      }
    };
    element.addEventListener('seeked', completeSeek, { once: true });
    element.currentTime = safeTarget;
    window.setTimeout(() => {
      if (state.pendingSeekSeconds === safeTarget) {
        completeSeek();
      }
    }, 250);
    if (!shouldPlay) {
      element.pause();
    }
    return;
  }

  if (!shouldPlay) {
    element.pause();
    return;
  }
  beforePlay?.();
  requestMediaPlay(element, state);
}

export function createPlaybackSyncKey(state: DirectorState): string {
  return JSON.stringify({
    paused: state.paused,
    anchorWallTimeMs: state.anchorWallTimeMs,
    offsetSeconds: state.offsetSeconds,
    rate: state.rate,
    loop: state.loop,
  });
}

export function getMediaSyncState(element: HTMLMediaElement): MediaSyncState {
  let state = mediaSyncStates.get(element);
  if (!state) {
    state = {};
    mediaSyncStates.set(element, state);
  }
  return state;
}

export function requestMediaPlay(element: HTMLMediaElement, state = getMediaSyncState(element), immediate = false): void {
  const now = Date.now();
  if (!immediate && state.lastPlayAttemptMs !== undefined && now - state.lastPlayAttemptMs < 500) {
    return;
  }
  state.lastPlayAttemptMs = now;
  void element.play().catch(() => undefined);
}

function clampMediaTime(seconds: number, element: HTMLMediaElement): number {
  const safeSeconds = Math.max(0, seconds);
  if (!Number.isFinite(element.duration)) {
    return safeSeconds;
  }
  return Math.min(safeSeconds, Math.max(0, element.duration - 0.001));
}
