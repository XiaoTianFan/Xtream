import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  DiagnosticsReport,
  DirectorState,
  MediaValidationIssue,
  PersistedShowConfig,
} from '../shared/types';

export const SHOW_CONFIG_EXTENSION = 'xtream-show.json';

export function getDefaultShowConfigPath(userDataPath: string): string {
  return path.join(userDataPath, `default.${SHOW_CONFIG_EXTENSION}`);
}

export async function writeShowConfig(filePath: string, config: PersistedShowConfig): Promise<void> {
  await writeJsonFile(filePath, config);
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readShowConfig(filePath: string): Promise<PersistedShowConfig> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return assertShowConfig(parsed);
}

export function assertShowConfig(value: unknown): PersistedShowConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Show config must be a JSON object.');
  }

  const candidate = value as Partial<PersistedShowConfig>;
  if (candidate.schemaVersion !== 1) {
    throw new Error('Unsupported show config schema version.');
  }
  if (![1, 2, 3].includes(candidate.mode as number)) {
    throw new Error('Show config has an invalid playback mode.');
  }
  if (!Array.isArray(candidate.slots)) {
    throw new Error('Show config is missing slots.');
  }
  if (!candidate.audio || typeof candidate.audio !== 'object') {
    throw new Error('Show config is missing audio settings.');
  }
  if (!Array.isArray(candidate.displays)) {
    throw new Error('Show config is missing display mappings.');
  }

  return candidate as PersistedShowConfig;
}

export function buildMediaUrls(config: PersistedShowConfig): {
  slots: Record<string, string | undefined>;
  audio?: string;
} {
  return {
    slots: Object.fromEntries(
      config.slots.map((slot) => [slot.id, slot.videoPath ? pathToFileURL(slot.videoPath).toString() : undefined]),
    ),
    audio: config.audio.path ? pathToFileURL(config.audio.path).toString() : undefined,
  };
}

export function validateShowConfigMedia(config: PersistedShowConfig): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];

  for (const slot of config.slots) {
    if (slot.videoPath && !fs.existsSync(slot.videoPath)) {
      issues.push({
        severity: 'warning',
        target: `slot:${slot.id}`,
        message: `Video file is missing: ${slot.videoPath}`,
      });
    }
  }

  if (config.audio.path && !fs.existsSync(config.audio.path)) {
    issues.push({
      severity: 'warning',
      target: 'audio',
      message: `Audio file is missing: ${config.audio.path}`,
    });
  }

  return issues;
}

export function validateRuntimeState(state: DirectorState): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];

  for (const slot of Object.values(state.slots)) {
    if (slot.videoPath && !fs.existsSync(slot.videoPath)) {
      issues.push({
        severity: 'warning',
        target: `slot:${slot.id}`,
        message: `Video file is missing: ${slot.videoPath}`,
      });
    }
    if (slot.error) {
      issues.push({
        severity: 'warning',
        target: `slot:${slot.id}`,
        message: slot.error,
      });
    }
  }

  if (state.audio.path && !fs.existsSync(state.audio.path)) {
    issues.push({
      severity: 'warning',
      target: 'audio',
      message: `Audio file is missing: ${state.audio.path}`,
    });
  }
  if (state.audio.error) {
    issues.push({
      severity: 'warning',
      target: 'audio',
      message: state.audio.error,
    });
  }
  if (state.mode === 3 && !state.audio.physicalSplitAvailable && !state.audio.fallbackAccepted) {
    issues.push({
      severity: 'warning',
      target: 'audio:mode3',
      message: 'Mode 3 physical split routing is unavailable and fallback has not been accepted.',
    });
  }

  return issues;
}

export function createDiagnosticsReport(state: DirectorState, appVersion: string): DiagnosticsReport {
  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    platform: process.platform,
    versions: process.versions,
    state,
    issues: validateRuntimeState(state),
  };
}
