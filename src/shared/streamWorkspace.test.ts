import { describe, expect, it } from 'vitest';
import {
  applyPatchCompatibilitySceneToPersistedRouting,
  buildPatchCompatibilityScene,
  createEmptyUserScene,
  DEFAULT_STREAM_PLAYBACK_SETTINGS,
  mergeShowConfigPatchRouting,
  migrateSceneTriggerLoose,
  normalizeStreamPersistence,
  STREAM_MAIN_ID,
} from './streamWorkspace';
import type { PersistedDisplayConfigV8, PersistedShowConfig, PersistedStreamConfig } from './types';

describe('Patch compatibility projection', () => {
  it('round-trips buildPatchCompatibilityScene through applyPatchCompatibilitySceneToPersistedRouting', () => {
    const loop = { enabled: false, startSeconds: 0 };
    const patchDisplays = [
      { id: 'disp-a', layout: { type: 'single' as const, visualId: 'v1' } },
      { id: 'disp-b', layout: { type: 'split' as const, visualIds: ['v2', 'v3'] as [string, string] } },
    ];
    const displays: PersistedDisplayConfigV8[] = [
      { ...patchDisplays[0], fullscreen: false },
      { ...patchDisplays[1], fullscreen: false },
    ];
    const outputs = {
      'output-main': {
        id: 'output-main',
        label: 'Main',
        sources: [{ audioSourceId: 'a1', levelDb: -6, pan: 0.25 }],
        busLevelDb: 0,
        pan: 0,
      },
    };
    const scene = buildPatchCompatibilityScene(loop, patchDisplays, outputs);
    const { displays: outDisplays, outputs: outOutputs } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, outputs);
    expect(outDisplays).toEqual(displays);
    expect(outOutputs['output-main']?.sources).toEqual(outputs['output-main'].sources);
  });

  it('prefers patch scene over stale top-level display layout and output sources', () => {
    const scene = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [{ id: 'disp-1', layout: { type: 'single' as const, visualId: 'correct' } }],
      {
        'output-main': {
          id: 'output-main',
          sources: [{ audioSourceId: 'snd-ok', levelDb: 0, pan: 0 }],
        },
      },
    );
    const v9: PersistedShowConfig = {
      schemaVersion: 9,
      savedAt: '2026-01-01T00:00:00.000Z',
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [{ audioSourceId: 'stale', levelDb: 0, pan: 0 }],
          busLevelDb: 0,
          pan: 0,
        },
      },
      displays: [{ id: 'disp-1', layout: { type: 'single' as const, visualId: 'wrong' }, fullscreen: false }],
      stream: { id: 'stream-main', label: 'Main Stream', sceneOrder: [], scenes: {} },
      patchCompatibility: { scene },
    };
    const merged = mergeShowConfigPatchRouting(v9);
    expect(merged.displays[0]?.layout).toEqual({ type: 'single', visualId: 'correct' });
    expect(merged.outputs['output-main']?.sources[0]?.audioSourceId).toBe('snd-ok');
  });

  it('clears display layout when patch scene has no visual sub-cue for that display', () => {
    const scene = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [{ id: 'disp-x', layout: { type: 'single' as const } }],
      {
        'output-main': {
          id: 'output-main',
          sources: [],
        },
      },
    );
    expect(scene.subCueOrder.length).toBe(0);
    const displays: PersistedDisplayConfigV8[] = [{ id: 'disp-x', layout: { type: 'single' as const, visualId: 'orphan' }, fullscreen: false }];
    const { displays: next } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, {
      'output-main': {
        id: 'output-main',
        label: 'Main',
        sources: [],
        busLevelDb: 0,
        pan: 0,
      },
    });
    expect(next[0]?.layout).toEqual({ type: 'single' });
  });

  it('round-trips mute and solo on virtual output sources via the patch scene', () => {
    const loop = { enabled: false, startSeconds: 0 };
    const patchDisplays = [{ id: 'disp-a', layout: { type: 'single' as const } }];
    const displays: PersistedDisplayConfigV8[] = [{ id: 'disp-a', layout: { type: 'single' as const }, fullscreen: false }];
    const outputs = {
      'output-main': {
        id: 'output-main',
        label: 'Main',
        sources: [
          { audioSourceId: 'a1', levelDb: 0, pan: 0, muted: true },
          { audioSourceId: 'a2', levelDb: -6, pan: 0.5, solo: true },
        ],
        busLevelDb: 0,
        pan: 0,
      },
    };
    const scene = buildPatchCompatibilityScene(loop, patchDisplays, outputs);
    expect(scene.subCues['patch-aud-output-main-0']).toMatchObject({ muted: true, kind: 'audio' });
    expect(scene.subCues['patch-aud-output-main-1']).toMatchObject({ solo: true, kind: 'audio' });
    const { outputs: routed } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, outputs);
    expect(routed['output-main']?.sources).toEqual(outputs['output-main'].sources);
  });

  it('round-trips duplicate audio source routes with independent levels via the patch scene', () => {
    const loop = { enabled: false, startSeconds: 0 };
    const displays: PersistedDisplayConfigV8[] = [{ id: 'disp-a', layout: { type: 'single' as const }, fullscreen: false }];
    const outputs = {
      'output-main': {
        id: 'output-main',
        label: 'Main',
        sources: [
          { id: 'route-a', audioSourceId: 'a1', levelDb: -3, pan: 0 },
          { id: 'route-b', audioSourceId: 'a1', levelDb: -18, pan: 0.5 },
        ],
        busLevelDb: 0,
        pan: 0,
      },
    };
    const scene = buildPatchCompatibilityScene(loop, [{ id: 'disp-a', layout: { type: 'single' as const } }], outputs);
    expect(scene.subCues['patch-aud-output-main-0']).toMatchObject({ outputSourceSelectionId: 'route-a', levelDb: -3 });
    expect(scene.subCues['patch-aud-output-main-1']).toMatchObject({ outputSourceSelectionId: 'route-b', levelDb: -18 });

    const { outputs: routed } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, outputs);
    expect(routed['output-main']?.sources).toEqual(outputs['output-main'].sources);
  });

  it('ignores non-audio/non-visual sub-cues in the patch scene', () => {
    const base = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [{ id: 'd1', layout: { type: 'single' as const, visualId: 'v1' } }],
      {
        'output-main': {
          id: 'output-main',
          sources: [],
        },
      },
    );
    const scene = {
      ...base,
      subCueOrder: [...base.subCueOrder, 'ctl-1'],
      subCues: {
        ...base.subCues,
        'ctl-1': {
          id: 'ctl-1',
          kind: 'control' as const,
          action: { type: 'set-global-audio-muted' as const, muted: true },
        },
      },
    };
    const displays: PersistedDisplayConfigV8[] = [{ id: 'd1', layout: { type: 'single' as const, visualId: 'v1' }, fullscreen: false }];
    const { displays: out } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, {
      'output-main': { id: 'output-main', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
    });
    expect(out[0]?.layout).toEqual({ type: 'single', visualId: 'v1' });
  });
});

describe('Trigger migration', () => {
  it('maps legacy trigger shapes via migrateSceneTriggerLoose', () => {
    expect(migrateSceneTriggerLoose({ type: 'simultaneous-start', followsSceneId: 'p' })).toEqual({
      type: 'follow-start',
      followsSceneId: 'p',
    });
    expect(migrateSceneTriggerLoose({ type: 'time-offset', followsSceneId: 'p', offsetMs: 2500 })).toEqual({
      type: 'follow-start',
      followsSceneId: 'p',
      delayMs: 2500,
    });
    expect(migrateSceneTriggerLoose({ type: 'time-offset', followsSceneId: 'p', offsetMs: 0 })).toEqual({
      type: 'follow-start',
      followsSceneId: 'p',
    });
  });

  it('rewrites scenes when normalizing stream persistence', () => {
    const raw = {
      id: STREAM_MAIN_ID,
      label: 'Main',
      sceneOrder: ['a', 'b'],
      scenes: {
        a: createEmptyUserScene('a', 'A'),
        b: {
          ...createEmptyUserScene('b', 'B'),
          trigger: { type: 'time-offset', followsSceneId: 'a', offsetMs: 900 },
        },
      },
      playbackSettings: DEFAULT_STREAM_PLAYBACK_SETTINGS,
    } as unknown as PersistedStreamConfig;
    const next = normalizeStreamPersistence(raw);
    expect(next.scenes.b.trigger).toEqual({ type: 'follow-start', followsSceneId: 'a', delayMs: 900 });
  });

  it('normalizes missing Stream playback settings to milestone 5 defaults', () => {
    const raw = {
      id: STREAM_MAIN_ID,
      label: 'Main',
      sceneOrder: ['a'],
      scenes: { a: createEmptyUserScene('a', 'A') },
      playbackSettings: {
        pausedPlayBehavior: 'preserve-paused-cursor',
        runningEditOrphanPolicy: 'let-finish',
        runningEditOrphanFadeOutMs: 25,
      },
    } as unknown as PersistedStreamConfig;

    expect(normalizeStreamPersistence(raw).playbackSettings).toEqual({
      pausedPlayBehavior: 'preserve-paused-cursor',
      multiTimelineResumeBehavior: 'resume-all-clocks',
      parallelTimelineSeekBehavior: 'leave-running',
      canonicalSceneStateSummary: 'last-instance',
      runningEditOrphanPolicy: 'let-finish',
      runningEditOrphanFadeOutMs: 50,
    });
  });
});
