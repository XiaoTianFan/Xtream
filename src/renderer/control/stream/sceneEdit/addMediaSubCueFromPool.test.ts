/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorState, PersistedSceneConfig, PersistedStreamConfig, StreamEnginePublicState } from '../../../../shared/types';
import { addMediaSubCueFromPool } from './addMediaSubCueFromPool';

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {
      'visual-a': {
        id: 'visual-a',
        kind: 'file',
        type: 'image',
        label: 'Logo Loop',
        url: 'file:///logo.png',
        ready: true,
      },
    },
    audioSources: {
      'audio-a': {
        id: 'audio-a',
        label: 'Kick Loop',
        url: 'file:///kick.wav',
        ready: true,
      },
    },
    outputs: {
      'out-a': {
        id: 'out-a',
        label: 'Main Output',
        sources: [],
        busLevelDb: 0,
        pan: 0,
        muted: false,
        ready: true,
      },
    },
    displays: {
      'display-a': {
        id: 'display-a',
        label: 'Display 1',
        displayId: 1,
        fullscreen: false,
        alwaysOnTop: false,
        layout: { type: 'single' },
        health: 'ok',
      },
    },
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}

function scene(): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Intro',
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: ['existing'],
    subCues: {
      existing: {
        id: 'existing',
        kind: 'control',
        action: { type: 'stop-scene', sceneId: 'scene-a' },
      },
    },
  };
}

function stream(sceneConfig = scene()): PersistedStreamConfig {
  return {
    id: 'stream',
    label: 'Stream',
    sceneOrder: [sceneConfig.id],
    scenes: { [sceneConfig.id]: sceneConfig },
  };
}

function publicState(s: PersistedStreamConfig): StreamEnginePublicState {
  return {
    stream: s,
    playbackStream: s,
    runtime: null,
    editTimeline: { status: 'valid', entries: {}, revision: 1, calculatedAtWallTimeMs: 0, issues: [] },
    playbackTimeline: { status: 'valid', entries: {}, revision: 1, calculatedAtWallTimeMs: 0, issues: [] },
    validationMessages: [],
  } as unknown as StreamEnginePublicState;
}

describe('addMediaSubCueFromPool', () => {
  beforeEach(() => {
    window.xtream = {
      stream: {
        edit: vi.fn((command) => Promise.resolve(publicState(stream({ ...scene(), ...command.update })))),
      },
    } as unknown as typeof window.xtream;
  });

  it('creates an audio sub-cue using the dropped source and appends it', async () => {
    const s = stream();

    const result = await addMediaSubCueFromPool({
      stream: s,
      sceneId: 'scene-a',
      directorState: director(),
      payload: { type: 'audio-source', id: 'audio-a' },
    });

    const edit = vi.mocked(window.xtream.stream.edit);
    const update = edit.mock.calls[0]?.[0].type === 'update-scene' ? edit.mock.calls[0][0].update : undefined;
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ type: 'update-scene', sceneId: 'scene-a' }));
    expect(update?.subCueOrder).toEqual(['existing', result.subCueId]);
    expect(update?.subCues?.[result.subCueId]).toMatchObject({
      id: result.subCueId,
      kind: 'audio',
      audioSourceId: 'audio-a',
      outputIds: ['out-a'],
    });
  });

  it('creates a visual sub-cue using the dropped visual and appends it', async () => {
    const s = stream();

    const result = await addMediaSubCueFromPool({
      stream: s,
      sceneId: 'scene-a',
      directorState: director(),
      payload: { type: 'visual', id: 'visual-a' },
    });

    const edit = vi.mocked(window.xtream.stream.edit);
    const update = edit.mock.calls[0]?.[0].type === 'update-scene' ? edit.mock.calls[0][0].update : undefined;
    expect(update?.subCueOrder).toEqual(['existing', result.subCueId]);
    expect(update?.subCues?.[result.subCueId]).toMatchObject({
      id: result.subCueId,
      kind: 'visual',
      visualId: 'visual-a',
      targets: [{ displayId: 'display-a' }],
    });
  });

  it('rejects an unknown scene without mutating stream state', async () => {
    await expect(
      addMediaSubCueFromPool({
        stream: stream(),
        sceneId: 'missing',
        directorState: director(),
        payload: { type: 'audio-source', id: 'audio-a' },
      }),
    ).rejects.toThrow('Unknown stream scene');

    expect(window.xtream.stream.edit).not.toHaveBeenCalled();
  });

  it('rejects unknown media ids without mutating stream state', async () => {
    await expect(
      addMediaSubCueFromPool({
        stream: stream(),
        sceneId: 'scene-a',
        directorState: director(),
        payload: { type: 'visual', id: 'missing-visual' },
      }),
    ).rejects.toThrow('Unknown visual');

    expect(window.xtream.stream.edit).not.toHaveBeenCalled();
  });
});
