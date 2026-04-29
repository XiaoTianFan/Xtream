import fs from 'node:fs';
import path from 'node:path';
import type { AppControlSettingsV1, AudioExtractionFormat } from '../shared/types';
import { DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS } from '../shared/types';

export const APP_CONTROL_SETTINGS_FILENAME = 'app-control-settings.json';

export function getAppControlSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, APP_CONTROL_SETTINGS_FILENAME);
}

function normalizePerformanceMode(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : false;
}

function normalizeAudioFormat(raw: unknown): AudioExtractionFormat {
  if (raw === 'm4a' || raw === 'wav') {
    return raw;
  }
  return 'm4a';
}

function normalizePreviewFps(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS;
  }
  return Math.min(60, Math.max(1, Math.round(raw)));
}

/** Baseline merged state when file missing or malformed. */
function defaultAppControlSettings(): AppControlSettingsV1 {
  return {
    v: 1,
    performanceMode: false,
    audioExtractionFormat: 'm4a',
    controlDisplayPreviewMaxFps: DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS,
  };
}

/** Parse JSON blob into a complete snapshot (per-field defaults). */
export function readAppControlSettings(userDataPath: string): AppControlSettingsV1 {
  const base = defaultAppControlSettings();
  try {
    const raw = fs.readFileSync(getAppControlSettingsPath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return base;
    }
    const o = parsed as Record<string, unknown>;
    return {
      v: 1,
      performanceMode: normalizePerformanceMode(o.performanceMode),
      audioExtractionFormat: normalizeAudioFormat(o.audioExtractionFormat),
      controlDisplayPreviewMaxFps: normalizePreviewFps(o.controlDisplayPreviewMaxFps),
    };
  } catch {
    return base;
  }
}

export function writeAppControlSettings(userDataPath: string, next: AppControlSettingsV1): void {
  const filePath = getAppControlSettingsPath(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/** Read, merge patch, write, return merged snapshot (only defined patch keys apply; values normalized). */
export function mergeAppControlSettings(userDataPath: string, patch: Partial<AppControlSettingsV1>): AppControlSettingsV1 {
  const prev = readAppControlSettings(userDataPath);
  const next: AppControlSettingsV1 = {
    v: 1,
    performanceMode: patch.performanceMode !== undefined ? normalizePerformanceMode(patch.performanceMode) : prev.performanceMode,
    audioExtractionFormat:
      patch.audioExtractionFormat !== undefined ? normalizeAudioFormat(patch.audioExtractionFormat) : prev.audioExtractionFormat,
    controlDisplayPreviewMaxFps:
      patch.controlDisplayPreviewMaxFps !== undefined
        ? normalizePreviewFps(patch.controlDisplayPreviewMaxFps)
        : prev.controlDisplayPreviewMaxFps,
  };
  writeAppControlSettings(userDataPath, next);
  return next;
}
