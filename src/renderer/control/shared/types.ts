import type { AudioSourceId, DisplayWindowId, VisualId, VirtualOutputId } from '../../../shared/types';

export type SelectedEntity =
  | { type: 'visual'; id: VisualId }
  | { type: 'audio-source'; id: AudioSourceId }
  | { type: 'display'; id: DisplayWindowId }
  | { type: 'output'; id: VirtualOutputId };

export type ControlSurface = 'patch' | 'stream' | 'performance' | 'config';

export type DisplayPreviewProgressEdge = {
  visualId: VisualId;
  durationSeconds: number;
  playbackRate: number;
};

export type LayoutPrefs = {
  mediaWidthPx?: number;
  footerHeightPx?: number;
  mixerWidthPx?: number;
  assetPreviewHeightPx?: number;
};
