import type { DirectorState } from '../../../shared/types';

export type MediaSyncState = {
  pendingSeekSeconds?: number;
  playAfterSeek?: boolean;
  lastPlayAttemptMs?: number;
  lastSyncKey?: string;
};

export type MediaSyncOptions = {
  beforePlay?: () => void;
  clamp?: (seconds: number, element: HTMLMediaElement) => number;
  syncKeySeekThresholdSeconds?: number;
  seekFallbackMs?: number;
  onSeekStart?: (targetSeconds: number) => void;
  onSeekComplete?: (result: { targetSeconds: number; durationMs: number; usedFallback: boolean }) => void;
};

const mediaSyncStates = new WeakMap<HTMLMediaElement, MediaSyncState>();

export function syncTimedMediaElement(
  element: HTMLMediaElement,
  targetSeconds: number,
  shouldPlay: boolean,
  syncKey: string,
  driftSeekThresholdSeconds: number,
  optionsOrBeforePlay?: MediaSyncOptions | (() => void),
): void {
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
    return;
  }
  const options = typeof optionsOrBeforePlay === 'function' ? { beforePlay: optionsOrBeforePlay } : (optionsOrBeforePlay ?? {});
  const state = getMediaSyncState(element);
  const safeTarget = (options.clamp ?? clampMediaTime)(targetSeconds, element);
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
  const shouldSeek = syncKeyChanged ? driftSeconds > (options.syncKeySeekThresholdSeconds ?? 0.05) : driftSeconds > driftSeekThresholdSeconds;
  if (shouldSeek) {
    state.pendingSeekSeconds = safeTarget;
    state.playAfterSeek = shouldPlay;
    options.onSeekStart?.(safeTarget);
    const seekStartedMs = performance.now();
    let completed = false;
    const completeSeek = (usedFallback = false) => {
      if (completed) {
        return;
      }
      completed = true;
      element.removeEventListener('seeked', handleSeeked);
      state.pendingSeekSeconds = undefined;
      options.onSeekComplete?.({
        targetSeconds: safeTarget,
        durationMs: performance.now() - seekStartedMs,
        usedFallback,
      });
      if (state.playAfterSeek) {
        options.beforePlay?.();
        requestMediaPlay(element, state, true);
      }
    };
    const handleSeeked = () => completeSeek();
    element.addEventListener('seeked', handleSeeked, { once: true });
    element.currentTime = safeTarget;
    window.setTimeout(() => {
      if (state.pendingSeekSeconds === safeTarget) {
        completeSeek(true);
      }
    }, options.seekFallbackMs ?? 250);
    if (!shouldPlay) {
      element.pause();
    }
    return;
  }

  if (!shouldPlay) {
    element.pause();
    return;
  }
  options.beforePlay?.();
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
