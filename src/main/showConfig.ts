import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toRendererFileUrl } from './fileUrls';
import type {
  DiagnosticsReport,
  DirectorState,
  MediaValidationIssue,
  PersistedShowConfig,
  PersistedShowConfigV3,
  PersistedShowConfigV4,
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
  return assertShowConfig(JSON.parse(raw) as unknown);
}

export function assertShowConfig(value: unknown): PersistedShowConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Show config must be a JSON object.');
  }
  const candidate = value as Partial<PersistedShowConfigV3 | PersistedShowConfigV4>;
  if (candidate.schemaVersion !== 3 && candidate.schemaVersion !== 4) {
    throw new Error('Unsupported show config schema version. This build supports schema versions 3 and 4 only.');
  }
  if (!candidate.visuals || typeof candidate.visuals !== 'object') {
    throw new Error('Show config is missing visuals.');
  }
  if (!candidate.audioSources || typeof candidate.audioSources !== 'object') {
    throw new Error('Show config is missing audio sources.');
  }
  if (!candidate.outputs || typeof candidate.outputs !== 'object') {
    throw new Error('Show config is missing virtual outputs.');
  }
  if (!Array.isArray(candidate.displays)) {
    throw new Error('Show config is missing display mappings.');
  }
  return candidate.schemaVersion === 3 ? migrateV3ToV4(candidate as PersistedShowConfigV3) : (candidate as PersistedShowConfigV4);
}

export function migrateV3ToV4(config: PersistedShowConfigV3): PersistedShowConfigV4 {
  return {
    ...config,
    schemaVersion: 4,
    visuals: Object.fromEntries(
      Object.values(config.visuals).map((visual) => [
        visual.id,
        {
          ...visual,
          opacity: visual.opacity ?? 1,
          brightness: visual.brightness ?? 1,
          contrast: visual.contrast ?? 1,
          playbackRate: visual.playbackRate ?? 1,
        },
      ]),
    ),
    audioSources: Object.fromEntries(
      Object.values(config.audioSources).map((source) => [
        source.id,
        {
          ...source,
          playbackRate: source.playbackRate ?? 1,
          levelDb: source.levelDb ?? 0,
        },
      ]),
    ),
    displays: config.displays.map((display) => ({ ...display })),
  };
}

export function buildMediaUrls(config: PersistedShowConfig): {
  visuals: Record<string, string | undefined>;
  audioSources: Record<string, string | undefined>;
} {
  return {
    visuals: Object.fromEntries(
      Object.values(config.visuals).map((visual) => [
        visual.id,
        visual.path ? toRendererFileUrl(visual.path) : undefined,
      ]),
    ),
    audioSources: Object.fromEntries(
      Object.values(config.audioSources).map((source) => [
        source.id,
        source.type === 'external-file' && source.path ? toRendererFileUrl(source.path) : undefined,
      ]),
    ),
  };
}

export function validateShowConfigMedia(config: PersistedShowConfig): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  for (const visual of Object.values(config.visuals)) {
    if (visual.path && !fs.existsSync(visual.path)) {
      issues.push({
        severity: 'warning',
        target: `visual:${visual.id}`,
        message: `Visual file is missing: ${visual.path}`,
      });
    }
  }
  for (const source of Object.values(config.audioSources)) {
    if (source.type === 'external-file' && source.path && !fs.existsSync(source.path)) {
      issues.push({
        severity: 'warning',
        target: `audio-source:${source.id}`,
        message: `Audio file is missing: ${source.path}`,
      });
    }
  }
  return issues;
}

export function validateRuntimeState(state: DirectorState): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  for (const visual of Object.values(state.visuals)) {
    if (visual.path && !fs.existsSync(visual.path)) {
      issues.push({
        severity: 'warning',
        target: `visual:${visual.id}`,
        message: `Visual file is missing: ${visual.path}`,
      });
    }
    if (visual.error) {
      issues.push({ severity: 'warning', target: `visual:${visual.id}`, message: visual.error });
    }
  }
  for (const source of Object.values(state.audioSources)) {
    if (source.type === 'external-file' && source.path && !fs.existsSync(source.path)) {
      issues.push({
        severity: 'warning',
        target: `audio-source:${source.id}`,
        message: `Audio file is missing: ${source.path}`,
      });
    }
    if (source.error) {
      issues.push({ severity: 'warning', target: `audio-source:${source.id}`, message: source.error });
    }
  }
  for (const output of Object.values(state.outputs)) {
    if (output.error) {
      issues.push({ severity: 'warning', target: `output:${output.id}`, message: output.error });
    }
  }
  for (const issue of state.readiness.issues) {
    issues.push({ severity: issue.severity, target: issue.target, message: issue.message });
  }
  return issues;
}

export function createDiagnosticsReport(state: DirectorState, appVersion: string, runtimeVersion: string): DiagnosticsReport {
  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    runtimeVersion,
    platform: process.platform,
    versions: process.versions,
    state,
    issues: validateRuntimeState(state),
    readiness: state.readiness,
  };
}
