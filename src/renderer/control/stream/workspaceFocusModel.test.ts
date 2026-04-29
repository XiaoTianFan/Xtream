import { describe, expect, it } from 'vitest';
import { sceneWorkspaceFocusFlags } from './workspaceFocusModel';

describe('sceneWorkspaceFocusFlags', () => {
  it('flags playback only for the playback focus id', () => {
    expect(sceneWorkspaceFocusFlags('a', 'a', 'b')).toEqual({ playback: true, edit: false });
    expect(sceneWorkspaceFocusFlags('b', 'a', 'b')).toEqual({ playback: false, edit: true });
  });

  it('flags both when playback and edit target the same scene', () => {
    expect(sceneWorkspaceFocusFlags('a', 'a', 'a')).toEqual({ playback: true, edit: true });
  });

  it('treats undefined playback focus as no playback chrome', () => {
    expect(sceneWorkspaceFocusFlags('a', undefined, 'a')).toEqual({ playback: false, edit: true });
  });

  it('treats undefined edit focus as no edit chrome', () => {
    expect(sceneWorkspaceFocusFlags('a', 'a', undefined)).toEqual({ playback: true, edit: false });
  });

  it('decouples edit from playback when they differ (operator editing X while playback on Y)', () => {
    expect(sceneWorkspaceFocusFlags('scene-x', 'scene-y', 'scene-x')).toEqual({ playback: false, edit: true });
    expect(sceneWorkspaceFocusFlags('scene-y', 'scene-y', 'scene-x')).toEqual({ playback: true, edit: false });
    expect(sceneWorkspaceFocusFlags('scene-z', 'scene-y', 'scene-x')).toEqual({ playback: false, edit: false });
  });
});
