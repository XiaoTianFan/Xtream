import { formatTimecode } from '../../../shared/timeline';
import type { AudioSourceState } from '../../../shared/types';

export function formatDuration(seconds: number | undefined): string {
  return seconds === undefined ? 'duration --' : formatTimecode(seconds);
}

export function formatAudioChannelLabel(source: AudioSourceState): string {
  if (source.channelMode === 'left') {
    return ' | L mono';
  }
  if (source.channelMode === 'right') {
    return ' | R mono';
  }
  if (source.channelCount !== undefined) {
    return ` | ${source.channelCount} ch`;
  }
  return '';
}

export function formatAudioChannelDetail(source: AudioSourceState): string {
  if (source.channelMode === 'left') {
    return `mono L${source.derivedFromAudioSourceId ? ` from ${source.derivedFromAudioSourceId}` : ''}`;
  }
  if (source.channelMode === 'right') {
    return `mono R${source.derivedFromAudioSourceId ? ` from ${source.derivedFromAudioSourceId}` : ''}`;
  }
  if (source.channelCount !== undefined) {
    return source.channelCount >= 2 ? `${source.channelCount} channels (stereo)` : `${source.channelCount} channel`;
  }
  return 'unknown';
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return '--';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMilliseconds(seconds: number | undefined): string {
  return seconds === undefined ? '--' : `${Math.round(seconds * 1000)}ms`;
}
