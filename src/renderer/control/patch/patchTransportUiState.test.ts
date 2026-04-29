import { describe, expect, it } from 'vitest';
import { derivePatchTransportUiState } from './patchTransportUiState';

describe('derivePatchTransportUiState', () => {
  it('disables Patch play while Stream playback is active', () => {
    expect(
      derivePatchTransportUiState({
        ready: true,
        patchPaused: true,
        currentSeconds: 0,
        streamPlaybackActive: true,
      }).playDisabled,
    ).toBe(true);
  });

  it('does not disable Patch pause just because Stream playback is active', () => {
    expect(
      derivePatchTransportUiState({
        ready: true,
        patchPaused: false,
        currentSeconds: 1,
        streamPlaybackActive: true,
      }).pauseDisabled,
    ).toBe(false);
  });

  it('keeps Patch play enabled when ready, paused, and Stream is inactive', () => {
    expect(
      derivePatchTransportUiState({
        ready: true,
        patchPaused: true,
        currentSeconds: 0,
        streamPlaybackActive: false,
      }).playDisabled,
    ).toBe(false);
  });

  it('keeps Patch play enabled when ready, playing, and Stream is inactive', () => {
    expect(
      derivePatchTransportUiState({
        ready: true,
        patchPaused: false,
        currentSeconds: 12,
        streamPlaybackActive: false,
      }).playDisabled,
    ).toBe(false);
  });

  it('disables Patch play when not ready even if playing', () => {
    expect(
      derivePatchTransportUiState({
        ready: false,
        patchPaused: false,
        currentSeconds: 1,
        streamPlaybackActive: false,
      }).playDisabled,
    ).toBe(true);
  });
});
