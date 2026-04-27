import type { DirectorState, LoopState } from './types';

export function applyLoop(seconds: number, loop: LoopState): number {
  if (!loop.enabled || loop.endSeconds === undefined || loop.endSeconds <= loop.startSeconds) {
    return seconds;
  }

  if (seconds < loop.endSeconds) {
    return seconds;
  }

  return loop.startSeconds + ((seconds - loop.startSeconds) % (loop.endSeconds - loop.startSeconds));
}

export function getDirectorSeconds(
  state: Pick<DirectorState, 'paused' | 'offsetSeconds' | 'anchorWallTimeMs' | 'rate' | 'loop'>,
  now = Date.now(),
): number {
  if (state.paused) {
    return applyLoop(state.offsetSeconds, state.loop);
  }

  const elapsedSeconds = ((now - state.anchorWallTimeMs) / 1000) * state.rate;
  return applyLoop(state.offsetSeconds + elapsedSeconds, state.loop);
}

export function getMediaEffectiveTime(
  directorSeconds: number,
  durationSeconds: number | undefined,
  loop: LoopState,
): number {
  const safeSeconds = Math.max(0, directorSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds === undefined || durationSeconds <= 0) {
    return safeSeconds;
  }

  const lastFrameTime = Math.max(0, durationSeconds - 0.001);
  if (!loop.enabled) {
    return Math.min(safeSeconds, lastFrameTime);
  }

  const loopStart = Math.min(Math.max(0, loop.startSeconds), lastFrameTime);
  const loopEnd = Math.min(loop.endSeconds ?? durationSeconds, durationSeconds);
  if (loopEnd <= loopStart) {
    return Math.min(safeSeconds, lastFrameTime);
  }

  if (safeSeconds < loopEnd) {
    return Math.min(safeSeconds, lastFrameTime);
  }

  return loopStart + ((safeSeconds - loopStart) % (loopEnd - loopStart));
}

export type AudioEffectiveTime = {
  seconds: number;
  audible: boolean;
};

export function getAudioEffectiveTime(
  directorSeconds: number,
  durationSeconds: number | undefined,
  loop: LoopState,
): AudioEffectiveTime {
  const safeSeconds = Math.max(0, directorSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds === undefined || durationSeconds <= 0) {
    return { seconds: safeSeconds, audible: true };
  }

  if (!loop.enabled) {
    return safeSeconds >= durationSeconds ? { seconds: Math.max(0, durationSeconds - 0.001), audible: false } : { seconds: safeSeconds, audible: true };
  }

  return { seconds: getMediaEffectiveTime(safeSeconds, durationSeconds, loop), audible: true };
}

export function formatTimecode(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);
  const mmss = `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(
    milliseconds,
  ).padStart(3, '0')}`;

  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mmss}` : mmss;
}

export type TimecodeParseResult =
  | { ok: true; seconds: number }
  | { ok: false; error: string };

export function parseTimecodeInput(value: string): TimecodeParseResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a timecode.' };
  }
  if (trimmed.startsWith('-')) {
    return { ok: false, error: 'Timecode cannot be negative.' };
  }

  const parts = trimmed.split(':');
  if (parts.length > 3) {
    return { ok: false, error: 'Use SS, MM:SS, or HH:MM:SS.' };
  }
  if (!parts.every((part) => /^\d+(\.\d+)?$/.test(part))) {
    return { ok: false, error: 'Timecode contains invalid characters.' };
  }

  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) {
    return { ok: false, error: 'Timecode is not a valid number.' };
  }
  if (parts.length > 1 && values.slice(1).some((part) => part >= 60)) {
    return { ok: false, error: 'Minutes and seconds must be less than 60.' };
  }

  const seconds =
    values.length === 1
      ? values[0]
      : values.length === 2
        ? values[0] * 60 + values[1]
        : values[0] * 3600 + values[1] * 60 + values[2];

  return { ok: true, seconds };
}
