import { describe, expect, it } from 'vitest';
import {
  applyPatchCompatibilitySceneToPersistedRouting,
  buildPatchCompatibilityScene,
  mergeShowConfigPatchRouting,
} from './streamWorkspace';
import type { PersistedShowConfigV8 } from './types';

describe('Patch compatibility projection', () => {
  it('round-trips buildPatchCompatibilityScene through applyPatchCompatibilitySceneToPersistedRouting', () => {
    const loop = { enabled: false, startSeconds: 0 };
    const displays = [
      { id: 'disp-a', layout: { type: 'single' as const, visualId: 'v1' }, fullscreen: false },
      { id: 'disp-b', layout: { type: 'split' as const, visualIds: ['v2', 'v3'] as [string, string] }, fullscreen: false },
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
    const scene = buildPatchCompatibilityScene(loop, displays, outputs);
    const { displays: outDisplays, outputs: outOutputs } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, outputs);
    expect(outDisplays).toEqual(displays);
    expect(outOutputs['output-main']?.sources).toEqual(outputs['output-main'].sources);
  });

  it('prefers patch scene over stale top-level display layout and output sources', () => {
    const scene = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [
        { id: 'disp-1', layout: { type: 'single', visualId: 'correct' }, fullscreen: false },
      ],
      {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [{ audioSourceId: 'snd-ok', levelDb: 0, pan: 0 }],
          busLevelDb: 0,
          pan: 0,
        },
      },
    );
    const v8: PersistedShowConfigV8 = {
      schemaVersion: 8,
      savedAt: '2026-01-01T00:00:00.000Z',
      audioExtractionFormat: 'm4a',
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
      displays: [{ id: 'disp-1', layout: { type: 'single', visualId: 'wrong' }, fullscreen: false }],
      streams: {},
      patchCompatibility: { scene },
    };
    const merged = mergeShowConfigPatchRouting(v8);
    expect(merged.displays[0]?.layout).toEqual({ type: 'single', visualId: 'correct' });
    expect(merged.outputs['output-main']?.sources[0]?.audioSourceId).toBe('snd-ok');
  });

  it('clears display layout when patch scene has no visual sub-cue for that display', () => {
    const scene = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [{ id: 'disp-x', layout: { type: 'single' }, fullscreen: false }],
      {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          pan: 0,
        },
      },
    );
    expect(scene.subCueOrder.length).toBe(0);
    const displays = [{ id: 'disp-x', layout: { type: 'single', visualId: 'orphan' }, fullscreen: false }];
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

  it('ignores non-audio/non-visual sub-cues in the patch scene', () => {
    const base = buildPatchCompatibilityScene(
      { enabled: false, startSeconds: 0 },
      [{ id: 'd1', layout: { type: 'single', visualId: 'v1' }, fullscreen: false }],
      {
        'output-main': {
          id: 'output-main',
          label: 'Main',
          sources: [],
          busLevelDb: 0,
          pan: 0,
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
    const displays = [{ id: 'd1', layout: { type: 'single', visualId: 'v1' }, fullscreen: false }];
    const { displays: out } = applyPatchCompatibilitySceneToPersistedRouting(scene, displays, {
      'output-main': { id: 'output-main', label: 'Main', sources: [], busLevelDb: 0, pan: 0 },
    });
    expect(out[0]?.layout).toEqual({ type: 'single', visualId: 'v1' });
  });
});
