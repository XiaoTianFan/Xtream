import fs from 'node:fs';
import path from 'node:path';
import type { AppControlSettingsV1 } from '../shared/types';

export const APP_CONTROL_SETTINGS_FILENAME = 'app-control-settings.json';

export function getAppControlSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, APP_CONTROL_SETTINGS_FILENAME);
}

const DEFAULT_APP_CONTROL_SETTINGS: AppControlSettingsV1 = { v: 1, performanceMode: false };

export function readAppControlSettings(userDataPath: string): AppControlSettingsV1 {
  try {
    const raw = fs.readFileSync(getAppControlSettingsPath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_APP_CONTROL_SETTINGS;
    }
    const performanceMode = (parsed as { performanceMode?: unknown }).performanceMode;
    if (typeof performanceMode !== 'boolean') {
      return DEFAULT_APP_CONTROL_SETTINGS;
    }
    return { v: 1, performanceMode };
  } catch {
    return DEFAULT_APP_CONTROL_SETTINGS;
  }
}

export function writeAppControlSettings(userDataPath: string, next: AppControlSettingsV1): void {
  const filePath = getAppControlSettingsPath(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/** Persists merged settings and returns the stored value. */
export function persistAppPerformanceMode(userDataPath: string, performanceMode: boolean): AppControlSettingsV1 {
  const next: AppControlSettingsV1 = { v: 1, performanceMode };
  writeAppControlSettings(userDataPath, next);
  return next;
}
