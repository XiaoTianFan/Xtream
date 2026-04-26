import { describe, expect, it } from 'vitest';
import {
  assertShowConfig,
  buildMediaUrls,
  createDiagnosticsReport,
  getDefaultShowConfigPath,
  validateRuntimeState,
} from './showConfig';
import type { DirectorState, PersistedShowConfig } from '../shared/types';

const config: PersistedShowConfig = {
  schemaVersion: 1,
  savedAt: '2026-04-26T00:00:00.000Z',
  mode: 3,
  durationPolicy: 'audio',
  loop: { enabled: true, startSeconds: 0, endSeconds: 10 },
  slots: [{ id: 'A', videoPath: 'F:\\media\\a.mp4' }, { id: 'B' }],
  audio: {
    path: 'F:\\media\\mix.wav',
    sinkId: 'main',
    sinkLabel: 'Main',
    leftSinkId: 'left',
    leftSinkLabel: 'Left',
    rightSinkId: 'right',
    rightSinkLabel: 'Right',
    fallbackAccepted: false,
  },
  displays: [
    {
      layout: { type: 'single', slot: 'A' },
      fullscreen: true,
    },
  ],
};

describe('show config persistence helpers', () => {
  it('validates supported show config shape', () => {
    expect(assertShowConfig(config)).toEqual(config);
    expect(() => assertShowConfig({ ...config, schemaVersion: 99 })).toThrow(/schema version/i);
  });

  it('builds renderer-safe file URLs from persisted media paths', () => {
    expect(buildMediaUrls(config)).toMatchObject({
      slots: {
        A: 'file:///F:/media/a.mp4',
        B: undefined,
      },
      audio: 'file:///F:/media/mix.wav',
    });
  });

  it('uses the userData path for the default show config', () => {
    expect(getDefaultShowConfigPath('F:\\XtreamData')).toContain('default.xtream-show.json');
  });

  it('reports Mode 3 fallback as a runtime issue until accepted', () => {
    const state: DirectorState = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      durationPolicy: 'audio',
      loop: { enabled: false, startSeconds: 0 },
      mode: 3,
      slots: {},
      audio: {
        ready: true,
        physicalSplitAvailable: false,
        fallbackAccepted: false,
      },
      displays: {},
    };

    expect(validateRuntimeState(state)).toContainEqual(
      expect.objectContaining({
        target: 'audio:mode3',
      }),
    );
  });

  it('creates diagnostics with current runtime state and issues', () => {
    const state: DirectorState = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: 0,
      offsetSeconds: 0,
      durationPolicy: 'longest-video',
      loop: { enabled: false, startSeconds: 0 },
      mode: 1,
      slots: {},
      audio: {
        ready: false,
        physicalSplitAvailable: false,
        fallbackAccepted: false,
      },
      displays: {},
    };

    const report = createDiagnosticsReport(state, '1.0.0');

    expect(report.appVersion).toBe('1.0.0');
    expect(report.state).toEqual(state);
  });
});
