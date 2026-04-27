import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  assertShowConfig,
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  readShowConfig,
  validateRuntimeState,
  writeShowConfig,
} from './showConfig';
import type { DirectorState, PersistedShowConfig } from '../shared/types';

const config: PersistedShowConfig = {
  schemaVersion: 3,
  savedAt: '2026-04-26T00:00:00.000Z',
  rate: 1,
  loop: { enabled: true, startSeconds: 0, endSeconds: 10 },
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
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
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
  };
}

describe('show config persistence helpers', () => {
  it('validates schema v3 config shape and rejects older versions', () => {
    expect(assertShowConfig(config)).toEqual(config);
    expect(() => assertShowConfig({ ...config, schemaVersion: 2 })).toThrow(/version 3 only/i);
  });

  it('builds renderer-safe file URLs from persisted media paths', () => {
    expect(buildMediaUrls(config)).toMatchObject({
      visuals: {
        'visual-a': 'file:///F:/media/a.mp4',
      },
      audioSources: {
        'audio-source-main': 'file:///F:/media/mix.wav',
      },
    });
  });

  it('uses the userData path for the default show config', () => {
    expect(getDefaultShowConfigPath('F:\\XtreamData')).toContain('default.xtream-show.json');
  });

  it('creates diagnostics with current runtime state and issues', () => {
    const state = createRuntimeState();
    state.readiness.issues = [{ severity: 'error', target: 'display', message: 'At least one active display window is required.' }];
    const report = createDiagnosticsReport(state, '1.0.0');
    expect(report.appVersion).toBe('1.0.0');
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
