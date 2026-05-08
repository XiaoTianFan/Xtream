import { describe, expect, it } from 'vitest';
import type { DirectorState, PersistedSceneConfig } from './types';
import {
  audioTimingPatchToVisual,
  clearTimingLinksForRemovedSubCue,
  findEligibleEmbeddedAudioTimingSubCueId,
  getActiveTimingLinkPair,
  normalizeSceneTimingLinks,
  pickLinkedTimingFields,
  visualTimingPatchToAudio,
} from './subCueTimingLink';

describe('subCueTimingLink', () => {
  it('finds exactly one embedded audio sub-cue for a video visual sub-cue', () => {
    expect(findEligibleEmbeddedAudioTimingSubCueId(scene(), directorState(), 'sub-v')).toBe('sub-a');
  });

  it('hides eligibility when matching embedded audio sub-cues are ambiguous', () => {
    const sc = scene();
    sc.subCueOrder.push('sub-a-2');
    sc.subCues['sub-a-2'] = { ...sc.subCues['sub-a'], id: 'sub-a-2' };

    expect(findEligibleEmbeddedAudioTimingSubCueId(sc, directorState(), 'sub-v')).toBeUndefined();
  });

  it('requires symmetric persisted links and eligible media pairing', () => {
    const sc = scene({
      visualLink: 'sub-a',
      audioLink: 'sub-v',
    });

    expect(getActiveTimingLinkPair(sc, directorState(), 'sub-v')).toEqual({ visualSubCueId: 'sub-v', audioSubCueId: 'sub-a' });

    const audioSub = sc.subCues['sub-a'];
    if (audioSub?.kind === 'audio') {
      sc.subCues['sub-a'] = { ...audioSub, linkedTimingSubCueId: undefined };
    }
    expect(getActiveTimingLinkPair(sc, directorState(), 'sub-v')).toBeUndefined();
  });

  it('clears a remaining link when its counterpart is removed', () => {
    const sc = scene({ visualLink: 'sub-a', audioLink: 'sub-v' });
    const next = clearTimingLinksForRemovedSubCue(sc, 'sub-a');

    expect(next['sub-a']).toBeUndefined();
    expect(next['sub-v']).toMatchObject({ linkedTimingSubCueId: undefined });
  });

  it('normalizes dangling or same-kind persisted links', () => {
    const sc = scene({ visualLink: 'missing', audioLink: 'sub-v' });
    normalizeSceneTimingLinks(sc);
    expect(sc.subCues['sub-v']).toMatchObject({ linkedTimingSubCueId: undefined });
  });

  it('includes pass and inner loop fields in linked timing patches', () => {
    const update = {
      pass: { iterations: { type: 'count' as const, count: 3 } },
      innerLoop: {
        enabled: true as const,
        range: { startMs: 1000, endMs: 2000 },
        iterations: { type: 'infinite' as const },
      },
      playbackRate: 1.25,
      targets: [{ displayId: 'other' }],
    };

    expect(pickLinkedTimingFields(update)).toEqual({
      pass: update.pass,
      innerLoop: update.innerLoop,
      playbackRate: 1.25,
    });
    expect(visualTimingPatchToAudio(update)).toEqual({
      pass: update.pass,
      innerLoop: update.innerLoop,
      playbackRate: 1.25,
    });
    expect(audioTimingPatchToVisual(update)).toEqual({
      pass: update.pass,
      innerLoop: update.innerLoop,
      playbackRate: 1.25,
    });
  });
});

function scene(options: { visualLink?: string; audioLink?: string } = {}): PersistedSceneConfig {
  return {
    id: 'scene-a',
    title: 'Scene',
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: ['sub-v', 'sub-a'],
    subCues: {
      'sub-v': {
        id: 'sub-v',
        kind: 'visual',
        visualId: 'vid',
        targets: [{ displayId: 'display-a' }],
        playbackRate: 1,
        linkedTimingSubCueId: options.visualLink,
      },
      'sub-a': {
        id: 'sub-a',
        kind: 'audio',
        audioSourceId: 'audio-source-embedded-vid',
        outputIds: ['output-a'],
        playbackRate: 1,
        linkedTimingSubCueId: options.audioLink,
      },
    },
  };
}

function directorState(): DirectorState {
  return {
    visuals: {
      vid: { id: 'vid', kind: 'file', type: 'video', label: 'Clip', url: 'file://clip.mp4', durationSeconds: 10, ready: true },
    },
    audioSources: {
      'audio-source-embedded-vid': {
        id: 'audio-source-embedded-vid',
        type: 'embedded-visual',
        visualId: 'vid',
        label: 'Clip audio',
        extractionMode: 'representation',
        ready: true,
      },
    },
  } as unknown as DirectorState;
}
