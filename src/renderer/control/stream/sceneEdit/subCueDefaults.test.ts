import { describe, expect, it } from 'vitest';
import type { DirectorState } from '../../../../shared/types';
import { buildDefaultAudioSubCue, buildDefaultVisualSubCue } from './subCueDefaults';

describe('subCueDefaults', () => {
  it('routes new audio sub-cues only to the main output by default', () => {
    const subCue = buildDefaultAudioSubCue('sub-a', directorState());

    expect(subCue.outputIds).toEqual(['output-main']);
  });

  it('falls back to a main-labeled audio output when the canonical main output is absent', () => {
    const state = directorState();
    delete state.outputs['output-main'];

    const subCue = buildDefaultAudioSubCue('sub-a', state);

    expect(subCue.outputIds).toEqual(['out-main-label']);
  });

  it('targets only the main display window for new visual sub-cues by default', () => {
    const subCue = buildDefaultVisualSubCue('sub-v', directorState());

    expect(subCue.targets).toEqual([{ displayId: 'display-0' }]);
  });

  it('uses the left zone when the default main display is split', () => {
    const state = directorState();
    state.displays['display-0'] = {
      ...state.displays['display-0'],
      layout: { type: 'split', visualIds: [undefined, undefined] },
    };

    const subCue = buildDefaultVisualSubCue('sub-v', state);

    expect(subCue.targets).toEqual([{ displayId: 'display-0', zoneId: 'L' }]);
  });
});

function directorState(): DirectorState {
  return {
    audioSources: {
      aud: {
        id: 'aud',
        label: 'Audio',
        ready: true,
      },
    },
    outputs: {
      'out-a': {
        id: 'out-a',
        label: 'Aux Output',
        sources: [],
        busLevelDb: 0,
        pan: 0,
        ready: true,
      },
      'out-main-label': {
        id: 'out-main-label',
        label: 'Main Room',
        sources: [],
        busLevelDb: 0,
        pan: 0,
        ready: true,
      },
      'output-main': {
        id: 'output-main',
        label: 'Main Output',
        sources: [],
        busLevelDb: 0,
        pan: 0,
        ready: true,
      },
    },
    visuals: {
      vis: {
        id: 'vis',
        kind: 'file',
        type: 'image',
        label: 'Visual',
        ready: true,
      },
    },
    displays: {
      'display-0': {
        id: 'display-0',
        label: 'Main Display',
        fullscreen: false,
        layout: { type: 'single' },
        health: 'ready',
      },
      'display-1': {
        id: 'display-1',
        label: 'Side Display',
        fullscreen: false,
        layout: { type: 'single' },
        health: 'ready',
      },
    },
  } as unknown as DirectorState;
}
