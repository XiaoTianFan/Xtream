import { describe, expect, it } from 'vitest';
import { assertShowConfig, migrateV7ToV8, migrateV9ToV10 } from './showConfig';
import type { PersistedShowConfigV7, PersistedShowConfigV9 } from '../shared/types';

describe('v7 onward migration', () => {
  it('projects Patch routing into patchCompatibility.scene sub-cues', () => {
    const v7: PersistedShowConfigV7 = {
      schemaVersion: 7,
      savedAt: '2026-01-01T00:00:00.000Z',
      audioExtractionFormat: 'm4a',
      loop: { enabled: false, startSeconds: 0 },
      visuals: {
        v1: {
          id: 'v1',
          label: 'V',
          kind: 'file',
          type: 'video',
          path: 'C:\\media\\a.mp4',
          opacity: 1,
          brightness: 1,
          contrast: 1,
          playbackRate: 1,
        },
      },
      audioSources: {},
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          pan: 0,
        },
      },
      displays: [
        { id: 'disp-1', layout: { type: 'split', visualIds: ['v1', undefined] }, fullscreen: false },
      ],
    };
    const v9 = migrateV7ToV8(v7);
    expect(v9.schemaVersion).toBe(10);
    expect(v9.patchCompatibility.scene.subCues['patch-vis-disp-1-L']).toMatchObject({
      kind: 'visual',
      visualId: 'v1',
      targets: [{ displayId: 'disp-1', zoneId: 'L' }],
    });
    expect(v9.stream.sceneOrder).toContain('scene-1');
  });

  it('round-trips migrated show through assertShowConfig', () => {
    const v7base: PersistedShowConfigV7 = {
      schemaVersion: 7,
      savedAt: '2026-01-01T00:00:00.000Z',
      audioExtractionFormat: 'm4a',
      loop: { enabled: true, startSeconds: 1, endSeconds: 9 },
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': { id: 'output-main', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
      },
      displays: [],
    };
    const v9 = migrateV7ToV8(v7base);
    const parsed = JSON.parse(JSON.stringify(v9)) as unknown;
    expect(assertShowConfig(parsed)).toEqual(v9);
  });

  it('migrates legacy sub-cue play-times count to pass count', () => {
    const v9 = showV9WithSubCue({
      id: 'a1',
      kind: 'audio',
      audioSourceId: 'aud',
      outputIds: ['output-main'],
      loop: { enabled: true, iterations: { type: 'count', count: 3 } },
    });

    const migrated = migrateV9ToV10(v9);
    const sub = migrated.stream.scenes.s1.subCues.a1;
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'count', count: 3 } },
      innerLoop: { enabled: false },
    });
    expect('loop' in sub).toBe(false);
    expect(assertShowConfig(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('migrates legacy full-range infinite sub-cue loop to infinite pass', () => {
    const v9 = showV9WithSubCue({
      id: 'a1',
      kind: 'audio',
      audioSourceId: 'aud',
      outputIds: ['output-main'],
      loop: { enabled: true, iterations: { type: 'infinite' } },
    });

    const sub = migrateV9ToV10(v9).stream.scenes.s1.subCues.a1;
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'infinite' } },
      innerLoop: { enabled: false },
    });
  });

  it('migrates legacy custom-range counted loops to inner-loop extra repeats', () => {
    const v9 = showV9WithSubCue({
      id: 'v1',
      kind: 'visual',
      visualId: 'vid',
      targets: [{ displayId: 'display-1' }],
      loop: { enabled: true, range: { startMs: 2000, endMs: 5000 }, iterations: { type: 'count', count: 4 } },
    });

    const sub = migrateV9ToV10(v9).stream.scenes.s1.subCues.v1;
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'count', count: 1 } },
      innerLoop: {
        enabled: true,
        range: { startMs: 2000, endMs: 5000 },
        iterations: { type: 'count', count: 3 },
      },
    });
  });

  it('migrates legacy custom-range infinite loops to infinite inner loop', () => {
    const v9 = showV9WithSubCue({
      id: 'v1',
      kind: 'visual',
      visualId: 'vid',
      targets: [{ displayId: 'display-1' }],
      loop: { enabled: true, range: { startMs: 2000, endMs: 5000 }, iterations: { type: 'infinite' } },
    });

    const sub = migrateV9ToV10(v9).stream.scenes.s1.subCues.v1;
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'count', count: 1 } },
      innerLoop: {
        enabled: true,
        range: { startMs: 2000, endMs: 5000 },
        iterations: { type: 'infinite' },
      },
    });
  });

  it('migrates legacy audio custom loops with omitted ends without collapsing the range', () => {
    const v9 = showV9WithSubCue({
      id: 'a1',
      kind: 'audio',
      audioSourceId: 'aud',
      outputIds: ['output-main'],
      loop: { enabled: true, range: { startMs: 2000 }, iterations: { type: 'count', count: 2 } },
    });

    const sub = migrateV9ToV10(v9).stream.scenes.s1.subCues.a1;
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'count', count: 1 } },
      innerLoop: {
        enabled: true,
        range: { startMs: 2000 },
        iterations: { type: 'count', count: 1 },
      },
    });
  });

  it('migrates legacy patch-compatibility sub-cue loops too', () => {
    const v9 = showV9WithSubCue({
      id: 'a1',
      kind: 'audio',
      audioSourceId: 'aud',
      outputIds: ['output-main'],
    });
    v9.patchCompatibility.scene.subCueOrder = ['patch-aud'];
    v9.patchCompatibility.scene.subCues = {
      'patch-aud': {
        id: 'patch-aud',
        kind: 'audio',
        audioSourceId: 'aud',
        outputIds: ['output-main'],
        loop: { enabled: true, iterations: { type: 'count', count: 5 } },
      },
    };

    const sub = migrateV9ToV10(v9).patchCompatibility.scene.subCues['patch-aud'];
    expect(sub).toMatchObject({
      pass: { iterations: { type: 'count', count: 5 } },
      innerLoop: { enabled: false },
    });
    expect('loop' in sub).toBe(false);
  });
});

function showV9WithSubCue(subCue: PersistedShowConfigV9['stream']['scenes'][string]['subCues'][string]): PersistedShowConfigV9 {
  return {
    schemaVersion: 9,
    savedAt: '2026-01-01T00:00:00.000Z',
    visuals: {
      vid: {
        id: 'vid',
        label: 'Video',
        kind: 'file',
        type: 'video',
        opacity: 1,
        brightness: 1,
        contrast: 1,
        playbackRate: 1,
      },
    },
    audioSources: {
      aud: {
        id: 'aud',
        label: 'Audio',
        type: 'external-file',
        playbackRate: 1,
        levelDb: 0,
      },
    },
    outputs: {
      'output-main': { id: 'output-main', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
    },
    displays: [{ id: 'display-1', layout: { type: 'single' }, fullscreen: false }],
    stream: {
      id: 'stream-main',
      label: 'Main',
      sceneOrder: ['s1'],
      scenes: {
        s1: {
          id: 's1',
          title: 'Scene',
          trigger: { type: 'manual' },
          loop: { enabled: false },
          preload: { enabled: false },
          subCueOrder: [subCue.id],
          subCues: { [subCue.id]: subCue },
        },
      },
    },
    patchCompatibility: {
      scene: {
        id: 'patch-compat-scene',
        title: 'Patch Compatibility',
        trigger: { type: 'manual' },
        loop: { enabled: false },
        preload: { enabled: false },
        subCueOrder: [],
        subCues: {},
      },
    },
  };
}
