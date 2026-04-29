import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { SHOW_PROJECT_FILENAME, SHOW_VISUAL_ASSET_DIRECTORY } from './showConfig';
import { allocateUniqueDestinationPath, copyFilesIntoProjectAssets, resolveProjectAssetDirectory } from './mediaImport';

describe('allocateUniqueDestinationPath', () => {
  it('uses stem (1).ext pattern when basename is taken on disk', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'xtream-mi-a-'));
    try {
      await writeFile(path.join(dir, 'clip.mp4'), 'a');
      const reserved = new Set<string>();
      const first = allocateUniqueDestinationPath(dir, 'clip.mp4', reserved);
      expect(path.basename(first)).toBe('clip (1).mp4');
      const second = allocateUniqueDestinationPath(dir, 'clip.mp4', reserved);
      expect(path.basename(second)).toBe('clip (2).mp4');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('copyFilesIntoProjectAssets', () => {
  it('rejects imports when show file is not a canonical project layout', async () => {
    const bogus = '/tmp/other.json';
    expect(() => resolveProjectAssetDirectory(bogus, 'visual')).toThrow();
  });

  it('copies external files under assets/visuals and leaves in-project paths unchanged', async () => {
    const proj = await mkdtemp(path.join(os.tmpdir(), 'xtream-mi-b-'));
    const showPath = path.join(proj, SHOW_PROJECT_FILENAME);
    const visualDir = path.join(proj, SHOW_VISUAL_ASSET_DIRECTORY);
    const external = path.join(proj, 'external-a.mp4');

    await mkdir(proj, { recursive: true });
    await writeFile(showPath, '{}\n', 'utf8');
    await mkdir(visualDir, { recursive: true });
    await writeFile(external, 'video-bytes');

    await writeFile(path.join(visualDir, 'existing.mp4'), '');

    try {
      const out = await copyFilesIntoProjectAssets(showPath, [external, path.join(visualDir, 'existing.mp4')], 'visual');

      expect(out).toHaveLength(2);

      expect(path.dirname(out[0])).toBe(visualDir);
      expect(await readFile(out[0], 'utf8')).toBe('video-bytes');

      expect(out[1]).toBe(path.join(visualDir, 'existing.mp4'));
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it('resolves unique names when copying duplicates', async () => {
    const proj = await mkdtemp(path.join(os.tmpdir(), 'xtream-mi-c-'));
    const showPath = path.join(proj, SHOW_PROJECT_FILENAME);
    const visualDir = path.join(proj, SHOW_VISUAL_ASSET_DIRECTORY);
    const ext1 = path.join(proj, 'x', 'dup.mp4');
    const ext2 = path.join(proj, 'y', 'dup.mp4');

    await mkdir(path.dirname(ext1), { recursive: true });
    await mkdir(path.dirname(ext2), { recursive: true });
    await writeFile(showPath, '{}\n', 'utf8');
    await writeFile(ext1, 'one');
    await writeFile(ext2, 'two');

    try {
      const out = await copyFilesIntoProjectAssets(showPath, [ext1, ext2], 'visual');

      expect(path.basename(out[0])).toBe('dup.mp4');
      expect(path.basename(out[1])).toBe('dup (1).mp4');
      expect(await readFile(out[0], 'utf8')).toBe('one');
      expect(await readFile(out[1], 'utf8')).toBe('two');
      expect(fs.existsSync(path.join(visualDir, 'dup.mp4'))).toBe(true);
      expect(fs.existsSync(path.join(visualDir, 'dup (1).mp4'))).toBe(true);
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });
});
