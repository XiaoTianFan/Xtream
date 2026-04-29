import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAppControlSettingsPath,
  persistAppPerformanceMode,
  readAppControlSettings,
} from './appControlSettings';

describe('appControlSettings', () => {
  it('returns defaults when file missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      expect(readAppControlSettings(dir)).toEqual({ v: 1, performanceMode: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates corrupt JSON and defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      writeFileSync(getAppControlSettingsPath(dir), 'not json {{{', 'utf8');
      expect(readAppControlSettings(dir)).toEqual({ v: 1, performanceMode: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists and reloads performance mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-app-cfg-'));
    try {
      persistAppPerformanceMode(dir, true);
      const raw = JSON.parse(readFileSync(getAppControlSettingsPath(dir), 'utf8'));
      expect(raw).toMatchObject({ v: 1, performanceMode: true });
      expect(readAppControlSettings(dir).performanceMode).toBe(true);
      persistAppPerformanceMode(dir, false);
      expect(readAppControlSettings(dir).performanceMode).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
