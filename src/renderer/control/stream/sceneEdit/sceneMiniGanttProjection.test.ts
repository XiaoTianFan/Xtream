import { describe, expect, it } from 'vitest';
import type { DirectorState, PersistedSceneConfig } from '../../../../shared/types';
import { deriveSceneMiniGanttProjection } from './sceneMiniGanttProjection';

function scene(subCueOrder: string[], subCues: PersistedSceneConfig['subCues']): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Scene A',
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder,
    subCues,
  };
}

function director(): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    visuals: {
      vid: { id: 'vid', kind: 'file', type: 'video', label: 'Clip', ready: true, durationSeconds: 10 },
    },
    audioSources: {
      aud: { id: 'aud', label: 'Kick', type: 'audio', ready: true, durationSeconds: 3 },
      live: { id: 'live', label: 'Live', type: 'audio', ready: true },
    },
    outputs: {},
    displays: {},
    previews: {},
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
  } as unknown as DirectorState;
}

describe('deriveSceneMiniGanttProjection', () => {
  it('preserves authored sub-cue lane order and projects local placement', () => {
    const projection = deriveSceneMiniGanttProjection({
      currentState: director(),
      scene: scene(['vis', 'aud', 'ctl'], {
        vis: { id: 'vis', kind: 'visual', visualId: 'vid', targets: [{ displayId: 'display-a' }], startOffsetMs: 500, durationOverrideMs: 2000 },
        aud: { id: 'aud', kind: 'audio', audioSourceId: 'aud', outputIds: ['out'], startOffsetMs: 1000 },
        ctl: { id: 'ctl', kind: 'control', startOffsetMs: 250, action: { type: 'set-global-display-blackout', blackout: true } },
      }),
    });

    expect(projection.status).toBe('ready');
    expect(projection.rows.map((row) => row.subCueId)).toEqual(['vis', 'aud', 'ctl']);
    expect(projection.rows.map((row) => [row.subCueId, row.startMs, row.durationMs])).toEqual([
      ['vis', 500, 2000],
      ['aud', 1000, 3000],
      ['ctl', 250, 0],
    ]);
    expect(projection.rows.find((row) => row.subCueId === 'aud')?.leftPercent).toBe(10);
    expect(projection.rows.find((row) => row.subCueId === 'aud')?.widthPercent).toBe(30);
  });

  it('renders an infinite-only sub-cue in the fallback local range with an overflowing end', () => {
    const projection = deriveSceneMiniGanttProjection({
      currentState: director(),
      scene: scene(['aud'], {
        aud: { id: 'aud', kind: 'audio', audioSourceId: 'aud', outputIds: ['out'], pass: { iterations: { type: 'infinite' } } },
      }),
    });

    const row = projection.rows[0];
    expect(projection.scaleDurationMs).toBe(10_000);
    expect(row.unbounded).toBe(true);
    expect(row.leftPercent).toBe(0);
    expect(row.widthPercent).toBeGreaterThan(100);
    expect(row.timeLabel).toBe('00:00.000 - live');
  });

  it('keeps mixed infinite sub-cue starts local and overflows their end beyond the track', () => {
    const projection = deriveSceneMiniGanttProjection({
      currentState: director(),
      scene: scene(['finite', 'forever'], {
        finite: { id: 'finite', kind: 'audio', audioSourceId: 'aud', outputIds: ['out'], startOffsetMs: 0 },
        forever: {
          id: 'forever',
          kind: 'audio',
          audioSourceId: 'aud',
          outputIds: ['out'],
          startOffsetMs: 2500,
          pass: { iterations: { type: 'infinite' } },
        },
      }),
    });

    const forever = projection.rows.find((row) => row.subCueId === 'forever')!;
    expect(projection.scaleDurationMs).toBe(12_500);
    expect(forever.leftPercent).toBe(20);
    expect(forever.widthPercent).toBeGreaterThan(80);
  });

  it('returns an empty projection for scenes without sub-cues', () => {
    const projection = deriveSceneMiniGanttProjection({ currentState: director(), scene: scene([], {}) });

    expect(projection.status).toBe('empty');
    expect(projection.rows).toEqual([]);
  });
});
