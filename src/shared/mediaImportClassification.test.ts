import { describe, it, expect } from 'vitest';
import { classifyMediaPoolExtension } from './mediaImportClassification';

describe('classifyMediaPoolExtension', () => {
  it('routes images and ogv to visual', () => {
    expect(classifyMediaPoolExtension('png')).toBe('visual');
    expect(classifyMediaPoolExtension('jpg')).toBe('visual');
    expect(classifyMediaPoolExtension('jpeg')).toBe('visual');
    expect(classifyMediaPoolExtension('webp')).toBe('visual');
    expect(classifyMediaPoolExtension('gif')).toBe('visual');
    expect(classifyMediaPoolExtension('ogv')).toBe('visual');
  });

  it('routes audio-only extensions to audio', () => {
    expect(classifyMediaPoolExtension('wav')).toBe('audio');
    expect(classifyMediaPoolExtension('mp3')).toBe('audio');
    expect(classifyMediaPoolExtension('flac')).toBe('audio');
    expect(classifyMediaPoolExtension('opus')).toBe('audio');
  });

  it('prefers visual for overlapping video containers', () => {
    expect(classifyMediaPoolExtension('mp4')).toBe('visual');
    expect(classifyMediaPoolExtension('mov')).toBe('visual');
    expect(classifyMediaPoolExtension('m4v')).toBe('visual');
    expect(classifyMediaPoolExtension('webm')).toBe('visual');
  });

  it('marks unknown extensions unsupported', () => {
    expect(classifyMediaPoolExtension('txt')).toBe('unsupported');
    expect(classifyMediaPoolExtension('doc')).toBe('unsupported');
  });
});
