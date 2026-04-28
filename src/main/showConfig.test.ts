import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  assertShowConfig,
  addRecentShow,
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  getRecentShowsPath,
  SHOW_AUDIO_ASSET_DIRECTORY,
  SHOW_PROJECT_FILENAME,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  readRecentShows,
  readShowConfig,
  validateShowConfigMedia,
  validateRuntimeState,
  writeJsonFile,
  writeShowConfig,
} from './showConfig';
import { toRendererFileUrl } from './fileUrls';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import type { DirectorState, PersistedShowConfig, PersistedShowConfigV5, PersistedShowConfigV7 } from '../shared/types';
import { SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS } from '../shared/types';

const configV7: PersistedShowConfigV7 = {
  schemaVersion: 7,
  savedAt: '2026-04-26T00:00:00.000Z',
  rate: 1,
  audioExtractionFormat: 'm4a',
  globalAudioMuteFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
  globalDisplayBlackoutFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
  loop: { enabled: true, startSeconds: 0, endSeconds: 10 },
  visuals: {
    'visual-a': {
      id: 'visual-a',
      label: 'Visual A',
      kind: 'file',
      type: 'video',
      path: 'F:\\media\\a.mp4',
      opacity: 0.9,
      brightness: 1.1,
      contrast: 1.2,
      playbackRate: 0.8,
      fileSizeBytes: 1234,
    },
  },
  audioSources: {
    'audio-source-main': {
      id: 'audio-source-main',
      label: 'Audio Source 1',
      type: 'external-file',
      path: 'F:\\media\\mix.wav',
      playbackRate: 1.2,
      levelDb: -3,
      channelCount: 2,
      channelMode: 'stereo',
      fileSizeBytes: 5678,
    },
    'audio-source-main-left': {
      id: 'audio-source-main-left',
      label: 'Audio Source 1 L',
      type: 'external-file',
      path: 'F:\\media\\mix.wav',
      playbackRate: 1.2,
      levelDb: -3,
      channelCount: 1,
      channelMode: 'left',
      derivedFromAudioSourceId: 'audio-source-main',
      fileSizeBytes: 5678,
    },
  },
  outputs: {
    'output-main': {
      id: 'output-main',
      label: 'Main Output',
      sources: [{ audioSourceId: 'audio-source-main', levelDb: 0, pan: 0 }],
      sinkId: 'main',
      sinkLabel: 'Main',
      busLevelDb: 0,
      pan: 0,
    },
  },
  displays: [
    {
      id: 'display-0',
      layout: { type: 'single', visualId: 'visual-a' },
      fullscreen: true,
    },
  ],
};

const config: PersistedShowConfig = migrateV7ToV8(configV7);

function createRuntimeState(): DirectorState {
  return {
    paused: true,
    rate: 1,
    audioExtractionFormat: 'm4a',
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
    globalDisplayBlackoutFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
    performanceMode: false,
    visuals: {},
    audioSources: {},
    outputs: {},
    displays: {},
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: {
      ready: false,
      checkedAtWallTimeMs: 0,
      issues: [],
    },
    corrections: {
      displays: {},
    },
    previews: {},
  };
}

describe('show config persistence helpers', () => {
  it('migrates schema v7 to v8 and rejects unsupported versions', () => {
    expect(assertShowConfig(configV7)).toEqual(config);
    expect(() => assertShowConfig({ ...configV7, schemaVersion: 2 })).toThrow(/schema versions 3 through 8/i);
  });

  it('normalizes legacy v8 streams records to the single stream field', () => {
    const { stream, ...rest } = config;
    const legacy = {
      ...rest,
      streams: { [stream.id]: stream },
      activeStreamId: stream.id,
    };
    expect(assertShowConfig(legacy)).toEqual(config);
  });

  it('validates stream media and target references in show files', () => {
    const invalid = structuredClone(config);
    invalid.stream.scenes['scene-1'].subCueOrder = ['bad-visual'];
    invalid.stream.scenes['scene-1'].subCues = {
      'bad-visual': {
        id: 'bad-visual',
        kind: 'visual',
        visualId: 'missing-visual',
        targets: [{ displayId: 'display-0', zoneId: 'R' }],
        playbackRate: 0,
      },
    };
    expect(validateShowConfigMedia(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'stream:stream-main', message: expect.stringContaining('missing visual') }),
        expect.objectContaining({ target: 'stream:stream-main', message: expect.stringContaining('missing display zone display-0:R') }),
        expect.objectContaining({ target: 'stream:stream-main', message: expect.stringContaining('non-positive playback rate') }),
      ]),
    );
  });

  it('migrates schema v5 outputs to v6 with centered pan for bus and each source', () => {
    const v5: PersistedShowConfigV5 = {
      schemaVersion: 5,
      savedAt: '2026-01-01T00:00:00.000Z',
      rate: 1,
      audioExtractionFormat: 'm4a',
      globalAudioMuteFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      globalDisplayBlackoutFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      loop: { enabled: false, startSeconds: 0 },
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [{ audioSourceId: 'a', levelDb: -3 }, { audioSourceId: 'b', levelDb: 0 }],
          busLevelDb: -6,
        },
      },
      displays: [],
    };
    const v6 = migrateV5ToV6(v5);
    expect(v6.schemaVersion).toBe(6);
    expect(v6.outputs['output-main']).toMatchObject({
      pan: 0,
      busLevelDb: -6,
      sources: [
        { audioSourceId: 'a', levelDb: -3, pan: 0 },
        { audioSourceId: 'b', levelDb: 0, pan: 0 },
      ],
    });
  });

  it('migrates schema v6 visuals to schema v7 file visuals', () => {
    const v6 = {
      ...configV7,
      schemaVersion: 6,
      visuals: {
        'visual-a': {
          id: 'visual-a',
          label: 'Visual A',
          type: 'video',
          path: 'F:\\media\\a.mp4',
        },
      },
    } as const;
    expect(migrateV6ToV7(v6)).toMatchObject({
      schemaVersion: 7,
      visuals: {
        'visual-a': {
          kind: 'file',
          path: 'F:\\media\\a.mp4',
        },
      },
    });
  });

  it('migrates schema v3 configs to schema v4 defaults', () => {
    const v3Config = {
      ...configV7,
      schemaVersion: 3,
      visuals: {
        'visual-a': {
          id: 'visual-a',
          label: 'Visual A',
          type: 'video',
          path: 'F:\\media\\a.mp4',
        },
      },
      audioSources: {
        'audio-source-main': {
          id: 'audio-source-main',
          label: 'Audio Source 1',
          type: 'external-file',
          path: 'F:\\media\\mix.wav',
        },
      },
    } as const;
    expect(migrateV3ToV4(v3Config)).toMatchObject({
      schemaVersion: 4,
      visuals: {
        'visual-a': {
          opacity: 1,
          brightness: 1,
          contrast: 1,
          playbackRate: 1,
        },
      },
      audioSources: {
        'audio-source-main': {
          playbackRate: 1,
          levelDb: 0,
        },
      },
    });
  });

  it('migrates schema v4 embedded audio sources to representation mode in schema v5', () => {
    const v4Config = {
      ...configV7,
      schemaVersion: 4,
      audioSources: {
        'audio-source-embedded-visual-a': {
          id: 'audio-source-embedded-visual-a',
          label: 'Embedded Audio Visual A',
          type: 'embedded-visual',
          visualId: 'visual-a',
        },
      },
    } as const;
    expect(migrateV4ToV5(v4Config)).toMatchObject({
      schemaVersion: 5,
      audioExtractionFormat: 'm4a',
      audioSources: {
        'audio-source-embedded-visual-a': {
          extractionMode: 'representation',
        },
      },
    });
  });

  it('builds renderer-safe file URLs from persisted media paths', () => {
    expect(buildMediaUrls(config)).toMatchObject({
      visuals: {
        'visual-a': 'file:///F:/media/a.mp4',
      },
      audioSources: {
        'audio-source-main': 'file:///F:/media/mix.wav',
        'audio-source-main-left': 'file:///F:/media/mix.wav',
      },
    });
  });

  it('does not build file URLs or file-missing warnings for live visuals', () => {
    const liveConfig: PersistedShowConfig = {
      ...config,
      visuals: {
        camera: {
          id: 'camera',
          label: 'Camera',
          kind: 'live',
          type: 'video',
          capture: { source: 'webcam', deviceId: 'camera-a', label: 'Camera A' },
          opacity: 1,
          brightness: 1,
          contrast: 1,
          playbackRate: 1,
        },
      },
    };
    expect(buildMediaUrls(liveConfig).visuals.camera).toBeUndefined();
    expect(validateRuntimeState({
      ...createRuntimeState(),
      visuals: {
        camera: {
          id: 'camera',
          label: 'Camera',
          kind: 'live',
          type: 'video',
          capture: { source: 'webcam', deviceId: 'camera-a', label: 'Camera A' },
          ready: false,
        },
      },
    })).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('Visual file is missing') }));
  });

  it('builds URLs and validation warnings for extracted embedded audio files', () => {
    const extractedConfig: PersistedShowConfig = {
      ...config,
      audioSources: {
        'audio-source-embedded-visual-a': {
          id: 'audio-source-embedded-visual-a',
          label: 'Embedded Audio Visual A',
          type: 'embedded-visual',
          visualId: 'visual-a',
          extractionMode: 'file',
          extractedPath: 'F:\\project\\assets\\audio\\visual-a.m4a',
          extractedFormat: 'm4a',
          extractionStatus: 'ready',
        },
      },
    };
    expect(buildMediaUrls(extractedConfig).audioSources['audio-source-embedded-visual-a']).toBe(
      'file:///F:/project/assets/audio/visual-a.m4a',
    );
    expect(validateRuntimeState({
      ...createRuntimeState(),
      audioSources: {
        'audio-source-embedded-visual-a': {
          id: 'audio-source-embedded-visual-a',
          label: 'Embedded Audio Visual A',
          type: 'embedded-visual',
          visualId: 'visual-a',
          extractionMode: 'file',
          extractedPath: 'F:\\missing\\visual-a.m4a',
          extractedFormat: 'm4a',
          extractionStatus: 'ready',
          ready: true,
        },
      },
    })).toContainEqual(expect.objectContaining({ message: 'Extracted audio file is missing: F:\\missing\\visual-a.m4a' }));
  });

  it('keeps Windows absolute paths absolute when building file URLs on any host OS', () => {
    expect(toRendererFileUrl('F:\\media\\folder with spaces\\a.mp4')).toBe('file:///F:/media/folder%20with%20spaces/a.mp4');
    expect(toRendererFileUrl('F:/media/a.mp4')).toBe('file:///F:/media/a.mp4');
    expect(toRendererFileUrl('\\\\media-server\\share\\show mix.wav')).toBe('file://media-server/share/show%20mix.wav');
  });

  it('uses the userData path for the default show config', () => {
    expect(getDefaultShowConfigPath('F:\\XtreamData')).toBe(`F:\\XtreamData\\default-show\\${SHOW_PROJECT_FILENAME}`);
    expect(SHOW_AUDIO_ASSET_DIRECTORY).toBe(path.join('assets', 'audio'));
  });

  it('creates diagnostics with current runtime state and issues', () => {
    const state = createRuntimeState();
    state.readiness.issues = [{ severity: 'error', target: 'display', message: 'At least one active display window is required.' }];
    const report = createDiagnosticsReport(state, '1.0.0', XTREAM_RUNTIME_VERSION);
    expect(report.appVersion).toBe('1.0.0');
    expect(report.runtimeVersion).toBe(XTREAM_RUNTIME_VERSION);
    expect(report.state).toEqual(state);
    expect(report.issues).toContainEqual(expect.objectContaining({ target: 'display' }));
  });

  it('validates runtime pool-native issues', () => {
    const state = createRuntimeState();
    state.visuals['visual-a'] = {
      id: 'visual-a',
      label: 'Visual A',
      kind: 'file',
      type: 'video',
      path: 'F:\\missing\\a.mp4',
      ready: false,
      error: 'Video failed to load.',
    };
    expect(validateRuntimeState(state)).toContainEqual(
      expect.objectContaining({ target: 'visual:visual-a', message: 'Video failed to load.' }),
    );
  });

  it('round-trips show config JSON', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-show-'));
    const filePath = path.join(directory, 'show.json');
    try {
      await writeShowConfig(filePath, config);
      expect(await readShowConfig(filePath)).toEqual(config);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds a show to the top of the recent list', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-recents-'));
    try {
      const first = path.join(directory, 'first', SHOW_PROJECT_FILENAME);
      const second = path.join(directory, 'second', SHOW_PROJECT_FILENAME);
      await writeShowConfig(first, config);
      await writeShowConfig(second, config);
      await addRecentShow(directory, first, '2026-04-26T00:00:00.000Z');
      const recents = await addRecentShow(directory, second, '2026-04-27T00:00:00.000Z');
      expect(recents.map((entry) => entry.filePath)).toEqual([second, first]);
      expect(recents[0]).toMatchObject({ displayName: 'second' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('deduplicates recent shows by path', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-recents-'));
    try {
      const showPath = path.join(directory, 'project', SHOW_PROJECT_FILENAME);
      await writeShowConfig(showPath, config);
      await addRecentShow(directory, showPath, '2026-04-26T00:00:00.000Z');
      const recents = await addRecentShow(directory, showPath, '2026-04-27T00:00:00.000Z');
      expect(recents).toHaveLength(1);
      expect(recents[0]).toMatchObject({ filePath: showPath, lastOpenedAt: '2026-04-27T00:00:00.000Z' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('caps recent shows at 8 entries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-recents-'));
    try {
      for (let index = 0; index < 10; index += 1) {
        const showPath = path.join(directory, `project-${index}`, SHOW_PROJECT_FILENAME);
        await writeShowConfig(showPath, config);
        await addRecentShow(directory, showPath, `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`);
      }
      const recents = await readRecentShows(directory);
      expect(recents).toHaveLength(8);
      expect(recents[0].filePath).toBe(path.join(directory, 'project-9', SHOW_PROJECT_FILENAME));
      expect(recents[7].filePath).toBe(path.join(directory, 'project-2', SHOW_PROJECT_FILENAME));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes missing files from recent shows', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-recents-'));
    try {
      const valid = path.join(directory, 'valid', SHOW_PROJECT_FILENAME);
      const missing = path.join(directory, 'missing', SHOW_PROJECT_FILENAME);
      await writeShowConfig(valid, config);
      await mkdir(path.dirname(getRecentShowsPath(directory)), { recursive: true });
      await writeJsonFile(getRecentShowsPath(directory), [
        { filePath: missing, displayName: 'missing', lastOpenedAt: '2026-04-27T00:00:00.000Z' },
        { filePath: valid, displayName: 'valid', lastOpenedAt: '2026-04-26T00:00:00.000Z' },
      ]);
      expect(await readRecentShows(directory)).toEqual([
        { filePath: valid, displayName: 'valid', lastOpenedAt: '2026-04-26T00:00:00.000Z' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves valid recent entries across read and write', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'xtream-recents-'));
    try {
      const first = path.join(directory, 'first', SHOW_PROJECT_FILENAME);
      const second = path.join(directory, 'second.xtream-show.json');
      await writeShowConfig(first, config);
      await writeShowConfig(second, config);
      await writeJsonFile(getRecentShowsPath(directory), [
        { filePath: first, displayName: 'first', lastOpenedAt: '2026-04-26T00:00:00.000Z' },
        { filePath: second, displayName: 'second.xtream-show.json', lastOpenedAt: '2026-04-25T00:00:00.000Z' },
      ]);
      expect(await readRecentShows(directory)).toEqual([
        { filePath: first, displayName: 'first', lastOpenedAt: '2026-04-26T00:00:00.000Z' },
        { filePath: second, displayName: 'second.xtream-show.json', lastOpenedAt: '2026-04-25T00:00:00.000Z' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
