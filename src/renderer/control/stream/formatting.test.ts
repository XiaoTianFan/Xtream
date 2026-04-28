import { describe, expect, it } from 'vitest';
import { createEmptyUserScene } from '../../../shared/streamWorkspace';
import type { DirectorState } from '../../../shared/types';
import { formatSceneDuration } from './formatting';

function stateWithVisualDuration(durationSeconds: number): DirectorState {
  return {
    visuals: {
      vid: { id: 'vid', durationSeconds },
    },
    audioSources: {},
  } as unknown as DirectorState;
}

describe('stream formatting', () => {
  it('formats scene duration with the same finite estimate used by the scheduler', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
          startOffsetMs: 5000,
        },
      },
    };

    expect(formatSceneDuration(stateWithVisualDuration(10), scene)).toBe('00:15.000');
  });

  it('does not show a finite media duration for an indefinite scene', () => {
    const scene = {
      ...createEmptyUserScene('s1', 'S'),
      loop: { enabled: true as const, iterations: { type: 'infinite' as const } },
      subCueOrder: ['v1'],
      subCues: {
        v1: {
          id: 'v1',
          kind: 'visual' as const,
          visualId: 'vid',
          targets: [{ displayId: 'd0' }],
        },
      },
    };

    expect(formatSceneDuration(stateWithVisualDuration(10), scene)).toBe('-- / live');
  });
});
