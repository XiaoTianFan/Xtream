import type { AudioSourceState, VisualState } from './types';

/** Basename required for resolving project folder from a show JSON path (`show.xtream-show.json`). */
export const CANONICAL_SHOW_CONFIG_BASENAME = 'show.xtream-show.json';

export type PoolPlacementKind = 'representation' | 'link' | 'file';

/** Short labels used in dense pool UI (REP = embedded playback from video source). */
export const POOL_PLACEMENT_ABBREV: Record<PoolPlacementKind, string> = {
  representation: 'REP',
  link: 'LNK',
  file: 'FIL',
};

function normalizeComparablePath(p: string): string {
  return p.trim().replace(/\\/g, '/');
}

/** Returns project root dirname when config path follows the canonical `show…json` convention. */
export function canonicalShowProjectDirectory(showConfigPath: string): string | undefined {
  const norm = normalizeComparablePath(showConfigPath);
  const lastSlash = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  const base =
    lastSlash >= 0
      ? norm.slice(lastSlash + 1).trim().toLowerCase()
      : norm.trim().toLowerCase().replace(/^\/+/, '');
  if (base !== CANONICAL_SHOW_CONFIG_BASENAME.toLowerCase()) {
    return undefined;
  }
  const dirOnly = lastSlash >= 0 ? norm.slice(0, lastSlash) : '';
  return dirOnly.replace(/\\/g, '/');
}

/** Project-relative subdirectory for copied media (`assets/visuals` / `assets/audio`). */
function assetsDirFor(kind: 'visual' | 'audio'): string {
  return kind === 'visual' ? 'assets/visuals' : 'assets/audio';
}

/** True when resolved media path sits under `{projectRoot}/assets/{visuals|audio}`. */
export function isResolvedPathUnderProjectAssets(
  projectRootDir: string,
  mediaAbsolutePath: string,
  bucket: 'visual' | 'audio',
  caseInsensitive: boolean,
): boolean {
  const root = normalizeComparablePath(projectRootDir).replace(/\/+$/, '');
  const sub = normalizeComparablePath(`${root}/${assetsDirFor(bucket)}`);
  let candidate = normalizeComparablePath(mediaAbsolutePath).replace(/\/+$/, '');
  const compare = caseInsensitive ? (v: string) => v.toLowerCase() : (v: string) => v;
  const pref = `${compare(sub)}/`;
  const cCand = compare(candidate);
  const cSub = compare(sub);
  return cCand === cSub || cCand.startsWith(pref);
}

/**
 * Deduces whether imported media references the project's asset folder or stays linked elsewhere.
 */
export function poolPlacementKindForImportedPath(
  showConfigAbsolutePath: string | undefined,
  mediaAbsolutePath: string | undefined,
  bucket: 'visual' | 'audio',
  caseInsensitive: boolean,
): PoolPlacementKind {
  const root = showConfigAbsolutePath ? canonicalShowProjectDirectory(showConfigAbsolutePath) : undefined;
  if (!root || !mediaAbsolutePath) {
    return 'link';
  }
  return isResolvedPathUnderProjectAssets(root, mediaAbsolutePath, bucket, caseInsensitive) ? 'file' : 'link';
}

export function getVisualPoolPlacement(
  visual: VisualState,
  showConfigAbsolutePath: string | undefined,
  /** Windows UNC / drive-letter paths usually need case-insensitive prefix checks */
  filesystemCaseInsensitive: boolean,
): PoolPlacementKind | undefined {
  if (visual.kind === 'live') {
    return undefined;
  }
  return poolPlacementKindForImportedPath(showConfigAbsolutePath, visual.path, 'visual', filesystemCaseInsensitive);
}

export function getAudioPoolPlacement(
  source: AudioSourceState,
  showConfigAbsolutePath: string | undefined,
  filesystemCaseInsensitive: boolean,
): PoolPlacementKind | undefined {
  if (source.type === 'embedded-visual') {
    if (source.extractionMode === 'representation') {
      return 'representation';
    }
    return 'file';
  }
  return poolPlacementKindForImportedPath(showConfigAbsolutePath, source.path, 'audio', filesystemCaseInsensitive);
}
