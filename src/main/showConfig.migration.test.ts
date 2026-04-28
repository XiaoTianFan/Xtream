import { describe, expect, it } from 'vitest';
import { assertShowConfig, migrateV7ToV8 } from './showConfig';
import type { PersistedShowConfigV7 } from '../shared/types';

describe('v7 to v8 migration', () => {
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
    const v8 = migrateV7ToV8(v7);
    expect(v8.schemaVersion).toBe(8);
    expect(v8.patchCompatibility.scene.subCues['patch-vis-disp-1-split-left']).toMatchObject({
      kind: 'visual',
      visualId: 'v1',
      targets: [{ displayId: 'disp-1', zoneId: 'split-left' }],
    });
    expect(v8.streams['stream-main']?.sceneOrder).toContain('scene-1');
  });

  it('round-trips native v8 through assertShowConfig', () => {
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
    const v8 = migrateV7ToV8(v7base);
    const parsed = JSON.parse(JSON.stringify(v8)) as unknown;
    expect(assertShowConfig(parsed)).toEqual(v8);
  });
});
