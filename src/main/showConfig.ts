import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toRendererFileUrl } from './fileUrls';
import { buildPatchCompatibilityScene, getDefaultStreamPersistence } from '../shared/streamWorkspace';
import type {
  DiagnosticsReport,
  DirectorState,
  DisplayWindowId,
  MediaValidationIssue,
  PersistedShowConfig,
  PersistedShowConfigV3,
  PersistedShowConfigV4,
  PersistedShowConfigV5,
  PersistedShowConfigV6,
  PersistedShowConfigV7,
  PersistedShowConfigV8,
  RecentShowEntry,
} from '../shared/types';

export const SHOW_CONFIG_EXTENSION = 'xtream-show.json';
export const SHOW_PROJECT_FILENAME = `show.${SHOW_CONFIG_EXTENSION}`;
export const DEFAULT_SHOW_PROJECT_FOLDER = 'default-show';
export const SHOW_AUDIO_ASSET_DIRECTORY = path.join('assets', 'audio');
export const RECENT_SHOWS_FILENAME = 'recent-shows.json';
export const RECENT_SHOWS_LIMIT = 8;

export function getDefaultShowConfigPath(userDataPath: string): string {
  return path.join(userDataPath, DEFAULT_SHOW_PROJECT_FOLDER, SHOW_PROJECT_FILENAME);
}

export function getRecentShowsPath(userDataPath: string): string {
  return path.join(userDataPath, RECENT_SHOWS_FILENAME);
}

export function getShowDisplayName(filePath: string): string {
  return path.basename(filePath) === SHOW_PROJECT_FILENAME ? path.basename(path.dirname(filePath)) : path.basename(filePath);
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

export async function readRecentShows(userDataPath: string): Promise<RecentShowEntry[]> {
  const recentShowsPath = getRecentShowsPath(userDataPath);
  let entries: RecentShowEntry[] = [];
  try {
    entries = normalizeRecentShows(JSON.parse(await readFile(recentShowsPath, 'utf8')) as unknown);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) {
      console.error('Failed to read recent shows.', error);
    }
  }
  const validEntries = filterExistingRecentShows(entries).slice(0, RECENT_SHOWS_LIMIT);
  if (validEntries.length !== entries.length) {
    await writeJsonFile(recentShowsPath, validEntries);
  }
  return validEntries;
}

export async function addRecentShow(userDataPath: string, filePath: string, lastOpenedAt = new Date().toISOString()): Promise<RecentShowEntry[]> {
  if (!isExistingShowFile(filePath)) {
    return readRecentShows(userDataPath);
  }
  const recentShowsPath = getRecentShowsPath(userDataPath);
  const current = await readRecentShows(userDataPath);
  const nextEntry: RecentShowEntry = {
    filePath,
    displayName: getShowDisplayName(filePath),
    lastOpenedAt,
  };
  const next = [nextEntry, ...current.filter((entry) => getRecentShowPathKey(entry.filePath) !== getRecentShowPathKey(filePath))]
    .filter((entry) => isExistingShowFile(entry.filePath))
    .slice(0, RECENT_SHOWS_LIMIT);
  await writeJsonFile(recentShowsPath, next);
  return next;
}

function normalizeRecentShows(value: unknown): RecentShowEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: RecentShowEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Partial<RecentShowEntry>;
    if (typeof candidate.filePath !== 'string' || typeof candidate.lastOpenedAt !== 'string') {
      continue;
    }
    const key = getRecentShowPathKey(candidate.filePath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      filePath: candidate.filePath,
      displayName: typeof candidate.displayName === 'string' && candidate.displayName.trim()
        ? candidate.displayName
        : getShowDisplayName(candidate.filePath),
      lastOpenedAt: candidate.lastOpenedAt,
    });
  }
  return entries.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

function filterExistingRecentShows(entries: RecentShowEntry[]): RecentShowEntry[] {
  return entries.filter((entry) => isExistingShowFile(entry.filePath));
}

function isExistingShowFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getRecentShowPathKey(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function assertCommonShowFields(candidate: {
  visuals?: unknown;
  audioSources?: unknown;
  outputs?: unknown;
  displays?: unknown;
}): void {
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
}

function assertV8Fields(candidate: Partial<PersistedShowConfigV8>): void {
  assertCommonShowFields(candidate);
  if (candidate.audioExtractionFormat !== 'm4a' && candidate.audioExtractionFormat !== 'wav') {
    throw new Error('Show config is missing or invalid audioExtractionFormat.');
  }
  if (!candidate.streams || typeof candidate.streams !== 'object') {
    throw new Error('Show config is missing streams.');
  }
  if (!candidate.patchCompatibility || typeof candidate.patchCompatibility.scene !== 'object') {
    throw new Error('Show config is missing patchCompatibility.scene.');
  }
}

function migrateDiskConfigToV7(
  candidate: Partial<PersistedShowConfigV3 | PersistedShowConfigV4 | PersistedShowConfigV5 | PersistedShowConfigV6 | PersistedShowConfigV7>,
): PersistedShowConfigV7 {
  assertCommonShowFields(candidate);
  if (candidate.schemaVersion === 3) {
    return migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(candidate as PersistedShowConfigV3))));
  }
  if (candidate.schemaVersion === 4) {
    return migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(candidate as PersistedShowConfigV4)));
  }
  if (candidate.schemaVersion === 5) {
    return migrateV6ToV7(migrateV5ToV6(candidate as PersistedShowConfigV5));
  }
  if (candidate.schemaVersion === 6) {
    return migrateV6ToV7(candidate as PersistedShowConfigV6);
  }
  return candidate as PersistedShowConfigV7;
}

export function migrateV7ToV8(config: PersistedShowConfigV7): PersistedShowConfigV8 {
  const displays = config.displays.map((d, index) => ({
    ...d,
    id: (d.id ?? (`display-${index}` as DisplayWindowId)) as DisplayWindowId,
  }));
  const patchScene = buildPatchCompatibilityScene(
    config.loop,
    displays.map((d) => ({ id: d.id, layout: d.layout })),
    config.outputs,
  );
  const { streams, activeStreamId } = getDefaultStreamPersistence();
  return {
    schemaVersion: 8,
    savedAt: config.savedAt,
    rate: config.rate,
    audioExtractionFormat: config.audioExtractionFormat,
    globalAudioMuteFadeOutSeconds: config.globalAudioMuteFadeOutSeconds,
    globalDisplayBlackoutFadeOutSeconds: config.globalDisplayBlackoutFadeOutSeconds,
    visuals: config.visuals,
    audioSources: config.audioSources,
    outputs: config.outputs,
    displays,
    streams,
    activeStreamId,
    patchCompatibility: { scene: patchScene, migratedFromSchemaVersion: 7 },
  };
}

export function assertShowConfig(value: unknown): PersistedShowConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Show config must be a JSON object.');
  }
  const candidate = value as Partial<
    PersistedShowConfigV3 | PersistedShowConfigV4 | PersistedShowConfigV5 | PersistedShowConfigV6 | PersistedShowConfigV7 | PersistedShowConfigV8
  >;
  if (candidate.schemaVersion === 8) {
    assertV8Fields(candidate);
    return candidate as PersistedShowConfigV8;
  }
  if (
    candidate.schemaVersion !== 3 &&
    candidate.schemaVersion !== 4 &&
    candidate.schemaVersion !== 5 &&
    candidate.schemaVersion !== 6 &&
    candidate.schemaVersion !== 7
  ) {
    throw new Error('Unsupported show config schema version. This build supports schema versions 3 through 8 only.');
  }
  return migrateV7ToV8(migrateDiskConfigToV7(candidate));
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

export function migrateV4ToV5(config: PersistedShowConfigV4): PersistedShowConfigV5 {
  return {
    ...config,
    schemaVersion: 5,
    audioExtractionFormat: 'm4a',
    audioSources: Object.fromEntries(
      Object.values(config.audioSources).map((source) => [
        source.id,
        source.type === 'embedded-visual'
          ? {
              ...source,
              extractionMode: source.extractionMode ?? 'representation',
              extractionStatus: source.extractionStatus,
            }
          : source,
      ]),
    ),
  };
}

export function migrateV5ToV6(config: PersistedShowConfigV5): PersistedShowConfigV6 {
  return {
    ...config,
    schemaVersion: 6,
    outputs: Object.fromEntries(
      Object.values(config.outputs).map((output) => [
        output.id,
        {
          ...output,
          pan: output.pan ?? 0,
          sources: output.sources.map((s) => ({
            ...s,
            pan: s.pan ?? 0,
          })),
        },
      ]),
    ),
  };
}

export function migrateV6ToV7(config: PersistedShowConfigV6): PersistedShowConfigV7 {
  return {
    ...config,
    schemaVersion: 7,
    visuals: Object.fromEntries(
      Object.values(config.visuals).map((visual) => [
        visual.id,
        {
          id: visual.id,
          label: visual.label,
          kind: 'file',
          type: visual.type,
          path: visual.kind === 'live' ? undefined : visual.path,
          opacity: visual.opacity,
          brightness: visual.brightness,
          contrast: visual.contrast,
          playbackRate: visual.playbackRate,
          fileSizeBytes: visual.kind === 'live' ? undefined : visual.fileSizeBytes,
        },
      ]),
    ),
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
        visual.kind !== 'live' && visual.path ? toRendererFileUrl(visual.path) : undefined,
      ]),
    ),
    audioSources: Object.fromEntries(
      Object.values(config.audioSources).map((source) => [
        source.id,
        source.type === 'external-file' && source.path
          ? toRendererFileUrl(source.path)
          : source.type === 'embedded-visual' && source.extractedPath
            ? toRendererFileUrl(source.extractedPath)
            : undefined,
      ]),
    ),
  };
}

export function validateShowConfigMedia(config: PersistedShowConfig): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  for (const visual of Object.values(config.visuals)) {
    if (visual.kind !== 'live' && visual.path && !fs.existsSync(visual.path)) {
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
    if (source.type === 'embedded-visual' && source.extractedPath && !fs.existsSync(source.extractedPath)) {
      issues.push({
        severity: 'warning',
        target: `audio-source:${source.id}`,
        message: `Extracted audio file is missing: ${source.extractedPath}`,
      });
    }
  }
  return issues;
}

export function validateRuntimeState(state: DirectorState): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  for (const visual of Object.values(state.visuals)) {
    if (visual.kind !== 'live' && visual.path && !fs.existsSync(visual.path)) {
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
    if (source.type === 'embedded-visual' && source.extractedPath && !fs.existsSync(source.extractedPath)) {
      issues.push({
        severity: 'warning',
        target: `audio-source:${source.id}`,
        message: `Extracted audio file is missing: ${source.extractedPath}`,
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
