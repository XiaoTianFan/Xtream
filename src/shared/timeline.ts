import type { DirectorState, LoopState } from './types';

export function applyLoop(seconds: number, loop: LoopState): number {
  if (!loop.enabled || loop.endSeconds === undefined || loop.endSeconds <= loop.startSeconds) {
    return seconds;
  }

  const loopDuration = loop.endSeconds - loop.startSeconds;
  if (seconds < loop.endSeconds) {
    return seconds;
  }

  return loop.startSeconds + ((seconds - loop.startSeconds) % loopDuration);
}

export function getDirectorSeconds(state: Pick<DirectorState, 'paused' | 'offsetSeconds' | 'anchorWallTimeMs' | 'rate' | 'loop'>, now = Date.now()): number {
  if (state.paused) {
    return applyLoop(state.offsetSeconds, state.loop);
  }

  const elapsedSeconds = ((now - state.anchorWallTimeMs) / 1000) * state.rate;
  return applyLoop(state.offsetSeconds + elapsedSeconds, state.loop);
}
