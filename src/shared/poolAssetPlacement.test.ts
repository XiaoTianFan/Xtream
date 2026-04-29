import { describe, expect, it } from 'vitest';
import {
  canonicalShowProjectDirectory,
  CANONICAL_SHOW_CONFIG_BASENAME,
  getAudioPoolPlacement,
  getVisualPoolPlacement,
  poolPlacementKindForImportedPath,
} from './poolAssetPlacement';
import type { AudioSourceState, VisualState } from './types';

const projectShowWin = `C:/Projects/MyShow/${CANONICAL_SHOW_CONFIG_BASENAME}`;

describe('canonicalShowProjectDirectory', () => {
  it('returns parent folder for canonical show paths', () => {
    expect(canonicalShowProjectDirectory(projectShowWin)).toBe('C:/Projects/MyShow');
  });

  it('returns undefined for non-canonical basenames', () => {
    expect(canonicalShowProjectDirectory('C:/x/other.json')).toBeUndefined();
  });
});

describe('poolPlacementKindForImportedPath', () => {
  it('marks files under assets/visuals as file', () => {
    const p = 'C:/Projects/MyShow/assets/visuals/a.mp4';
    expect(poolPlacementKindForImportedPath(projectShowWin, p, 'visual', true)).toBe('file');
  });

  it('marks paths outside project assets as link', () => {
    expect(poolPlacementKindForImportedPath(projectShowWin, 'D:/media/x.mp4', 'visual', false)).toBe('link');
  });

  it('treats unknown show path as link', () => {
    expect(poolPlacementKindForImportedPath(undefined, 'C:/Projects/MyShow/assets/visuals/a.mp4', 'visual', false)).toBe('link');
  });
});

describe('getAudioPoolPlacement', () => {
  it('representation mode is REP', () => {
    const s = {
      type: 'embedded-visual',
      extractionMode: 'representation',
      visualId: 'v1',
    } as AudioSourceState;
    expect(getAudioPoolPlacement(s, projectShowWin, false)).toBe('representation');
  });

  it('file extraction mode is FIL', () => {
    const s = {
      type: 'embedded-visual',
      extractionMode: 'file',
      visualId: 'v1',
    } as AudioSourceState;
    expect(getAudioPoolPlacement(s, projectShowWin, false)).toBe('file');
  });

  it('external file uses path vs project', () => {
    const s: AudioSourceState = {
      id: 'a1',
      type: 'external-file',
      label: 'A',
      path: 'C:/Projects/MyShow/assets/audio/b.wav',
      url: '',
      playbackRate: 1,
      levelDb: 0,
      channelCount: 1,
      ready: false,
      error: '',
    };
    expect(getAudioPoolPlacement(s, projectShowWin, true)).toBe('file');
  });
});

describe('getVisualPoolPlacement', () => {
  it('returns undefined for live sources', () => {
    const v = {
      id: 'l',
      kind: 'live',
      label: 'L',
      type: 'video',
      ready: true,
      capture: { source: 'webcam', deviceId: 'd' },
    } as VisualState;
    expect(getVisualPoolPlacement(v, projectShowWin, false)).toBeUndefined();
  });

  it('detects FIL for file visuals in project assets folder', () => {
    const v = {
      id: 'f',
      kind: 'file',
      label: 'F',
      type: 'image',
      path: `C:/Projects/MyShow/assets/visuals/p.png`,
      ready: true,
    } as VisualState;
    expect(getVisualPoolPlacement(v, projectShowWin, false)).toBe('file');
  });
});
