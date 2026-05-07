import type { AudioSourceState, DirectorState, VisualId, VisualState } from '../../../../shared/types';
import type { SelectedEntity } from '../../shared/types';

export type PoolTab = 'visuals' | 'audio';
export type VisualPoolLayout = 'list' | 'grid';

export type MediaPoolControllerOptions = {
  getState: () => DirectorState | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  clearSelectionIf: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  probeAudioMetadata: (source: AudioSourceState) => void;
  createEmbeddedAudioRepresentation: (visualId: VisualId) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: VisualId) => Promise<void>;
  /** Absolute path to loaded `show…json` — used for REP/LNK/FIL placement labels. */
  getShowConfigPath: () => string | undefined;
};
