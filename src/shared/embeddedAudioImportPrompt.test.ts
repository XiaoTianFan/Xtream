import { describe, expect, it } from 'vitest';
import { buildEmbeddedAudioImportPrompt, LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS } from './embeddedAudioImportPrompt';

describe('buildEmbeddedAudioImportPrompt', () => {
  it('uses two-button layout for long videos and maps responses', () => {
    const { payload, resolveChoice } = buildEmbeddedAudioImportPrompt([
      { label: 'a', durationSeconds: LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS + 1 },
    ]);
    expect(payload.buttons).toHaveLength(2);
    expect(payload.defaultId).toBe(1);
    expect(payload.cancelId).toBe(0);
    expect(resolveChoice(0)).toBe('skip');
    expect(resolveChoice(1)).toBe('file');
  });

  it('uses three-button layout for short videos and maps responses', () => {
    const { payload, resolveChoice } = buildEmbeddedAudioImportPrompt([{ label: 'b', durationSeconds: 10 }]);
    expect(payload.buttons).toHaveLength(3);
    expect(resolveChoice(0)).toBe('skip');
    expect(resolveChoice(1)).toBe('representation');
    expect(resolveChoice(2)).toBe('file');
  });
});
