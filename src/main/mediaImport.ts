import fs from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SHOW_AUDIO_ASSET_DIRECTORY, SHOW_PROJECT_FILENAME, SHOW_VISUAL_ASSET_DIRECTORY } from './showConfig';

/** Resolves assets/visuals or assets/audio directory for a canonical project show path. */
export function resolveProjectAssetDirectory(configPath: string, kind: 'visual' | 'audio'): string {
  if (path.basename(configPath) !== SHOW_PROJECT_FILENAME) {
    throw new Error('Save the project as show.xtream-show.json before copying media into assets.');
  }
  const relative = kind === 'visual' ? SHOW_VISUAL_ASSET_DIRECTORY : SHOW_AUDIO_ASSET_DIRECTORY;
  return path.join(path.dirname(configPath), relative);
}

function isPathInsideAssetsTree(projectRootDir: string, absoluteFile: string): boolean {
  const assetsRoot = path.join(projectRootDir, 'assets');
  const rel = path.relative(path.resolve(assetsRoot), path.resolve(absoluteFile));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Picks a unique destination path under `destDir` using "name (1).ext" style collision handling.
 * `reservedBasenames` tracks names used in the current batch (case-insensitive on Windows).
 */
export function allocateUniqueDestinationPath(
  destDir: string,
  originalBasename: string,
  reservedBasenames: Set<string>,
): string {
  const parsed = path.parse(originalBasename);
  const stem = parsed.name;
  const ext = parsed.ext;
  let n = 0;
  while (true) {
    const candidateBasename = n === 0 ? `${stem}${ext}` : `${stem} (${n})${ext}`;
    const key = candidateBasename.toLowerCase();
    const full = path.join(destDir, candidateBasename);
    if (!reservedBasenames.has(key) && !fs.existsSync(full)) {
      reservedBasenames.add(key);
      return full;
    }
    n += 1;
  }
}

/**
 * Copies each file into the project assets folder for the given kind.
 * Files already under the project's `assets/` tree are left as-is (returns the original path).
 */
export async function copyFilesIntoProjectAssets(
  configPath: string,
  absoluteSources: string[],
  kind: 'visual' | 'audio',
): Promise<string[]> {
  const destRoot = resolveProjectAssetDirectory(configPath, kind);
  await mkdir(destRoot, { recursive: true });
  const projectRoot = path.dirname(configPath);
  const reserved = new Set<string>();
  const results: string[] = [];

  for (const source of absoluteSources) {
    const absSrc = path.resolve(source);
    if (!fs.existsSync(absSrc)) {
      throw new Error(`Source file not found: ${absSrc}`);
    }
    if (isPathInsideAssetsTree(projectRoot, absSrc)) {
      results.push(absSrc);
      continue;
    }
    const destPath = allocateUniqueDestinationPath(destRoot, path.basename(absSrc), reserved);
    await copyFile(absSrc, destPath);
    results.push(destPath);
  }

  return results;
}
