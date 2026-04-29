import { describe, expect, it } from 'vitest';
import { getDefaultStreamPersistence } from '../../../shared/streamWorkspace';
import type { CalculatedStreamTimeline, StreamEnginePublicState } from '../../../shared/types';
import { createGlobalStreamPlayCommand, deriveStreamTransportUiState } from './streamHeader';

function timeline(
  status: CalculatedStreamTimeline['status'],
  entries: CalculatedStreamTimeline['entries'] = {},
): CalculatedStreamTimeline {
  return {
    revision: 1,
    status,
    entries,
    calculatedAtWallTimeMs: 0,
    issues: [],
  };
}

function addSecondScene(stream: ReturnType<typeof getDefaultStreamPersistence>['stream']): void {
  stream.sceneOrder = ['scene-1', 'scene-2'];
  stream.scenes['scene-2'] = {
    ...structuredClone(stream.scenes['scene-1']),
    id: 'scene-2',
  };
}

const playableTimeline = timeline('valid', {
  'scene-1': { sceneId: 'scene-1', startMs: 0, durationMs: 1000, endMs: 1000, triggerKnown: true },
  'scene-2': { sceneId: 'scene-2', startMs: 1000, durationMs: 1000, endMs: 2000, triggerKnown: true },
});

describe('deriveStreamTransportUiState', () => {
  it('does not disable Stream play based on Patch Director paused state', () => {
    const { stream } = getDefaultStreamPersistence();
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('valid'),
        selectedSceneId: 'scene-1',
        playbackStream: stream,
      }).playDisabled,
    ).toBe(false);
  });

  it('disables Stream play when the playback timeline is invalid', () => {
    const { stream } = getDefaultStreamPersistence();
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('invalid'),
        selectedSceneId: 'scene-1',
        playbackStream: stream,
      }).playDisabled,
    ).toBe(true);
  });

  it('keeps pause pause-only', () => {
    const { stream } = getDefaultStreamPersistence();
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
        playbackStream: stream,
      }).pauseDisabled,
    ).toBe(true);
  });

  it('disables Stream play while Patch transport is active', () => {
    const { stream } = getDefaultStreamPersistence();
    expect(
      deriveStreamTransportUiState({
        runtime: null,
        playbackTimeline: timeline('valid'),
        selectedSceneId: 'scene-1',
        playbackStream: stream,
        isPatchTransportPlaying: true,
      }).playDisabled,
    ).toBe(true);
  });
});

describe('createGlobalStreamPlayCommand', () => {
  it('resumes a paused stream when selection has not changed', () => {
    const { stream } = getDefaultStreamPersistence();
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, selectedSceneId: 'scene-1' })).toEqual({
      type: 'play',
      source: 'global',
    });
  });

  it('plays a new selected scene while paused in selection-aware mode', () => {
    const { stream } = getDefaultStreamPersistence();
    addSecondScene(stream);
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, selectedSceneId: 'scene-2' })).toEqual({
      type: 'play',
      sceneId: 'scene-2',
      source: 'global',
    });
  });

  it('preserves paused cursor when configured even if selection changed', () => {
    const { stream } = getDefaultStreamPersistence();
    addSecondScene(stream);
    stream.playbackSettings = {
      pausedPlayBehavior: 'preserve-paused-cursor',
      runningEditOrphanPolicy: 'fade-out',
      runningEditOrphanFadeOutMs: 500,
    };
    const runtime: StreamEnginePublicState['runtime'] = {
      status: 'paused',
      sceneStates: {},
      currentStreamMs: 1000,
      selectedSceneIdAtPause: 'scene-1',
    };

    expect(createGlobalStreamPlayCommand({ runtime, playbackStream: stream, playbackTimeline: playableTimeline, selectedSceneId: 'scene-2' })).toEqual({
      type: 'play',
      source: 'global',
    });
  });

  it('does not send an unpromoted selected scene id in degraded authoring state', () => {
    const { stream: playbackStream } = getDefaultStreamPersistence();

    expect(
      createGlobalStreamPlayCommand({
        runtime: null,
        playbackStream,
        playbackTimeline: playableTimeline,
        selectedSceneId: 'scene-2',
      }),
    ).toEqual({ type: 'play', source: 'global' });
  });
});
