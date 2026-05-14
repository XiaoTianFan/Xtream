import { describe, expect, it } from 'vitest';
import type { DirectorState, PersistedStreamConfig, StreamEnginePublicState } from '../../../../shared/types';
import { createSceneEditRenderModel, createStructuralStreamRenderModel } from './signatures';

describe('stream surface signatures', () => {
  it('includes pass and inner-loop timing in structural render signatures for duration updates', () => {
    const base = streamPublic(audioStream());
    const passInfinite = streamPublic(audioStream({
      pass: { iterations: { type: 'infinite' } },
    }));
    const loopInfinite = streamPublic(audioStream({
      innerLoop: { enabled: true, range: { startMs: 0, endMs: 5000 }, iterations: { type: 'infinite' } },
    }));

    expect(JSON.stringify(createStructuralStreamRenderModel(base))).not.toBe(JSON.stringify(createStructuralStreamRenderModel(passInfinite)));
    expect(JSON.stringify(createStructuralStreamRenderModel(base))).not.toBe(JSON.stringify(createStructuralStreamRenderModel(loopInfinite)));
  });

  it('includes edit timeline duration changes in structural render signatures', () => {
    const base = streamPublic(audioStream());
    const edited = streamPublic(audioStream());
    edited.editTimeline = {
      ...edited.editTimeline,
      expectedDurationMs: 10_000,
      entries: {
        'scene-a': { sceneId: 'scene-a', durationMs: 10_000, startMs: 0, endMs: 10_000, triggerKnown: true },
      },
    } as never;

    expect(JSON.stringify(createStructuralStreamRenderModel(base))).not.toBe(JSON.stringify(createStructuralStreamRenderModel(edited)));
  });

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
      pass: { iterations: { type: 'infinite' } },
      innerLoop: { enabled: false, range: { startMs: 0, endMs: 5000 } },
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

  it('ignores visual preview-lane timing edits in the scene edit render signature', () => {
    const base = streamPublic(visualStream());
    const edited = streamPublic(visualStream({
      startOffsetMs: 1500,
      sourceStartMs: 2000,
      sourceEndMs: 9000,
      durationOverrideMs: 8000,
      loop: { enabled: true, iterations: { type: 'count', count: 3 } },
      pass: { iterations: { type: 'count', count: 2 } },
      innerLoop: { enabled: true, range: { startMs: 1000, endMs: 4000 }, iterations: { type: 'count', count: 1 } },
      fadeIn: { durationMs: 1200, curve: 'equal-power' },
      fadeOut: { durationMs: 900, curve: 'log' },
      freezeFrameMs: 4000,
      playbackRate: 1.25,
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

  it('ignores scene playback-control edits in the scene edit render signature', () => {
    const base = streamPublic(audioStream());
    const edited = streamPublic(audioStream());
    edited.stream = {
      ...edited.stream,
      scenes: {
        ...edited.stream.scenes,
        'scene-a': {
          ...edited.stream.scenes['scene-a'],
          loop: { enabled: true, iterations: { type: 'infinite' } },
          preload: { enabled: true, leadTimeMs: 750 },
        },
      },
    } as PersistedStreamConfig;

    expect(JSON.stringify(createSceneEditRenderModel({
      streamState: base,
      sceneEditSceneId: 'scene-a',
      sceneEditSelection: { kind: 'scene' },
      currentState: directorState(),
      selectedSceneRunning: false,
    }))).toBe(JSON.stringify(createSceneEditRenderModel({
      streamState: edited,
      sceneEditSceneId: 'scene-a',
      sceneEditSelection: { kind: 'scene' },
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

function visualStream(visualOverrides: Record<string, unknown> = {}): PersistedStreamConfig {
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
        subCueOrder: ['visual-a'],
        subCues: {
          'visual-a': {
            id: 'visual-a',
            kind: 'visual',
            visualId: 'vid-a',
            targets: [{ displayId: 'display-a' }],
            ...visualOverrides,
          },
        },
      },
    },
  } as PersistedStreamConfig;
}

function directorState(): DirectorState {
  return {
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
  } as unknown as DirectorState;
}
