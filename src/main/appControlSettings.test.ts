import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS } from '../shared/types';
import { getAppControlSettingsPath, mergeAppControlSettings, readAppControlSettings } from './appControlSettings';

const DEFAULT_FULL_SNAPSHOT = {
  v: 1 as const,
  performanceMode: false,
  audioExtractionFormat: 'm4a' as const,
  controlDisplayPreviewMaxFps: DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS,
};

describe('appControlSettings', () => {
  it('returns defaults when file missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      expect(readAppControlSettings(dir)).toEqual(DEFAULT_FULL_SNAPSHOT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates corrupt JSON and defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      writeFileSync(getAppControlSettingsPath(dir), 'not json {{{', 'utf8');
      expect(readAppControlSettings(dir)).toEqual(DEFAULT_FULL_SNAPSHOT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges performance mode without dropping audio and FPS fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      mergeAppControlSettings(dir, { performanceMode: true });
      const raw = JSON.parse(readFileSync(getAppControlSettingsPath(dir), 'utf8'));
      expect(raw).toMatchObject({ v: 1, performanceMode: true, audioExtractionFormat: 'm4a' });
      expect(readAppControlSettings(dir).performanceMode).toBe(true);
      mergeAppControlSettings(dir, { performanceMode: false });
      expect(readAppControlSettings(dir).performanceMode).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges audio format and preview FPS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      mergeAppControlSettings(dir, { audioExtractionFormat: 'wav', controlDisplayPreviewMaxFps: 30 });
      const s = readAppControlSettings(dir);
      expect(s.audioExtractionFormat).toBe('wav');
      expect(s.controlDisplayPreviewMaxFps).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
