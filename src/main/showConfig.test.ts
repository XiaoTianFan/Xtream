import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  assertShowConfig,
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  SHOW_AUDIO_ASSET_DIRECTORY,
  SHOW_PROJECT_FILENAME,
  migrateV3ToV4,
  migrateV4ToV5,
  readShowConfig,
  validateRuntimeState,
  writeShowConfig,
} from './showConfig';
import { toRendererFileUrl } from './fileUrls';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import type { DirectorState, PersistedShowConfig } from '../shared/types';
import { SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS } from '../shared/types';

const config: PersistedShowConfig = {
  schemaVersion: 5,
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
      sources: [{ audioSourceId: 'audio-source-main', levelDb: 0 }],
      sinkId: 'main',
      sinkLabel: 'Main',
      busLevelDb: 0,
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
  it('validates schema v5 config shape and rejects older versions', () => {
    expect(assertShowConfig(config)).toEqual(config);
    expect(() => assertShowConfig({ ...config, schemaVersion: 2 })).toThrow(/schema versions 3, 4, and 5/i);
  });

  it('migrates schema v3 configs to schema v4 defaults', () => {
    const v3Config = {
      ...config,
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
      ...config,
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
});
