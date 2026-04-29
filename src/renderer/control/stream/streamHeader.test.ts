import { describe, expect, it } from 'vitest';
import type { CalculatedStreamTimeline, StreamEnginePublicState } from '../../../shared/types';
import { deriveStreamTransportUiState } from './streamHeader';

function timeline(status: CalculatedStreamTimeline['status']): CalculatedStreamTimeline {
  return {
    revision: 1,
    status,
    entries: {},
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

describe('deriveStreamTransportUiState', () => {
  it('does not disable Stream play based on Patch Director paused state', () => {
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('valid'),
        selectedSceneId: 'scene-1',
      }).playDisabled,
    ).toBe(false);
  });

  it('disables Stream play when the playback timeline is invalid', () => {
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('invalid'),
        selectedSceneId: 'scene-1',
      }).playDisabled,
    ).toBe(true);
  });

  it('keeps pause pause-only', () => {
    const pausedRuntime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
    };
    expect(
      deriveStreamTransportUiState({
        runtime: pausedRuntime,
        playbackTimeline: timeline('valid'),
        selectedSceneId: 'scene-1',
      }).pauseDisabled,
    ).toBe(true);
  });
});
