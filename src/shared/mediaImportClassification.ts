/**
 * Shared rules for routing dropped or picked files into visual vs audio pool imports.
 * Keep in sync with main `visual:import-files` and `audio-source:import-files` filtering.
 */

export const VISUAL_IMPORT_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'ogv',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
] as const;

/** Matches add-file dialog: audio containers (excludes * catch-all in UI). */
export const AUDIO_FILE_IMPORT_EXTENSIONS = [
  'wav',
  'mp3',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  'mp4',
  'mov',
  'm4v',
  'webm',
] as const;

export const VISUAL_IMPORT_EXTENSION_SET = new Set<string>(VISUAL_IMPORT_EXTENSIONS);

export const AUDIO_FILE_IMPORT_EXTENSION_SET = new Set<string>(AUDIO_FILE_IMPORT_EXTENSIONS);

export type MediaPoolImportBucket = 'visual' | 'audio' | 'unsupported';

/**
 * @param ext Lowercase extension **without** leading dot (e.g. `mp4`).
 */
export function classifyMediaPoolExtension(ext: string): MediaPoolImportBucket {
  const inVisual = VISUAL_IMPORT_EXTENSION_SET.has(ext);
  const inAudio = AUDIO_FILE_IMPORT_EXTENSION_SET.has(ext);
  if (!inVisual && !inAudio) {
    return 'unsupported';
  }
  if (inVisual && inAudio) {
    return 'visual';
  }
  if (inVisual) {
    return 'visual';
  }
  return 'audio';
}

/** Sorted unique list for open-dialog filter groups. */
export function allMediaPoolImportDialogExtensions(): string[] {
  return Array.from(new Set([...VISUAL_IMPORT_EXTENSIONS, ...AUDIO_FILE_IMPORT_EXTENSIONS])).sort();
}
