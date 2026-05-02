import type { EmbeddedAudioImportCandidate, EmbeddedAudioImportChoice } from './types';
import type { ShellModalButtonDef } from './modalSpec';

export const LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS = 30 * 60;

export type EmbeddedAudioImportPromptPayload = {
  title: string;
  message: string;
  detail: string;
  buttons: ShellModalButtonDef[];
  defaultId: number;
  cancelId: number;
};

export function buildEmbeddedAudioImportPrompt(candidates: EmbeddedAudioImportCandidate[]): {
  payload: EmbeddedAudioImportPromptPayload;
  resolveChoice: (responseIndex: number) => EmbeddedAudioImportChoice;
} {
  const label = candidates.length === 1 ? candidates[0]?.label ?? 'video' : `${candidates.length} videos`;
  const hasLongVideo = candidates.some((candidate) => (candidate.durationSeconds ?? 0) > LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS);
  const title = 'Import video audio';
  const message = `Import audio from ${label}?`;
  if (hasLongVideo) {
    const detail = 'Videos longer than 30 minutes use extracted audio files for more stable playback.';
    const buttons: ShellModalButtonDef[] = [
      { label: 'Do not extract audio', variant: 'secondary' },
      { label: 'Extract audio into files', variant: 'primary' },
    ];
    return {
      payload: { title, message, detail, buttons, defaultId: 1, cancelId: 0 },
      resolveChoice: (idx) => (idx === 1 ? 'file' : 'skip'),
    };
  }
  const detail = 'Choose how Xtream should create audio sources for the imported video media.';
  const buttons: ShellModalButtonDef[] = [
    { label: 'Do not extract audio', variant: 'secondary' },
    { label: 'Extract into representation', variant: 'primary' },
    { label: 'Extract audio into files', variant: 'secondary' },
  ];
  return {
    payload: { title, message, detail, buttons, defaultId: 1, cancelId: 0 },
    resolveChoice: (idx) => (idx === 2 ? 'file' : idx === 1 ? 'representation' : 'skip'),
  };
}
