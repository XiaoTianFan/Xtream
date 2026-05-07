import { describe, expect, it } from 'vitest';
import type { DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../../shared/types';
import { createSceneEditRenderModel, createStructuralStreamRenderModel } from './signatures';

describe('stream surface signatures', () => {
  it('ignores waveform-only audio sub-cue edits in structural render signatures', () => {
    const base = streamPublic(audioStream());
    const edited = streamPublic(audioStream({
      sourceStartMs: 2000,
      sourceEndMs: 7000,
      fadeIn: { durationMs: 1000, curve: 'linear' },
      fadeOut: { durationMs: 500, curve: 'equal-power' },
      levelAutomation: [{ timeMs: 1000, value: -12 }],
      panAutomation: [{ timeMs: 2000, value: 0.5 }],
    }));

    expect(JSON.stringify(createStructuralStreamRenderModel(base))).toBe(JSON.stringify(createStructuralStreamRenderModel(edited)));
    expect(JSON.stringify(createSceneEditRenderModel({
      streamState: base,
      sceneEditSceneId: 'scene-a',
      currentState: directorState(),
      selectedSceneRunning: false,
    }))).toBe(JSON.stringify(createSceneEditRenderModel({
      streamState: edited,
      sceneEditSceneId: 'scene-a',
      currentState: directorState(),
      selectedSceneRunning: false,
    })));
  });

  it('ignores audio timing control edits in the scene edit render signature', () => {
    const base = streamPublic(audioStream());
    const edited = streamPublic(audioStream({
      startOffsetMs: 2000,
      loop: { enabled: true, iterations: { type: 'infinite' } },
      playbackRate: 0.75,
      pitchShiftSemitones: -3,
      durationOverrideMs: 5000,
    }));

    expect(JSON.stringify(createSceneEditRenderModel({
      streamState: base,
      sceneEditSceneId: 'scene-a',
      currentState: directorState(),
      selectedSceneRunning: false,
    }))).toBe(JSON.stringify(createSceneEditRenderModel({
      streamState: edited,
      sceneEditSceneId: 'scene-a',
      currentState: directorState(),
      selectedSceneRunning: false,
    })));
  });
});

function audioStream(audioOverrides: Record<string, unknown> = {}): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: ['scene-a'],
    scenes: {
      'scene-a': {
        id: 'scene-a',
        title: 'Scene A',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false, leadTimeMs: 0 },
        subCueOrder: ['audio-a'],
        subCues: {
          'audio-a': {
            id: 'audio-a',
            kind: 'audio',
            audioSourceId: 'aud-a',
            outputIds: ['out-a'],
            playbackRate: 1,
            ...audioOverrides,
          },
        },
      },
    },
  } as PersistedStreamConfig;
}

function streamPublic(stream: PersistedStreamConfig): StreamEnginePublicState {
  const timeline = {
    status: 'valid',
    expectedDurationMs: 0,
    entries: {},
    validationMessages: [],
    mainSegments: [],
  };
  return {
    stream,
    playbackStream: stream,
    editTimeline: timeline,
    playbackTimeline: timeline,
    validationMessages: [],
    runtime: null,
  } as unknown as StreamEnginePublicState;
}

function directorState(): DirectorState {
  return {
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
  } as unknown as DirectorState;
}
