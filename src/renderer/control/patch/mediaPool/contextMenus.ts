import type { AudioSourceState, VisualState } from '../../../../shared/types';
import { LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS } from '../../../../shared/embeddedAudioImportPrompt';
import { createButton } from '../../shared/dom';
import type { SelectedEntity } from '../../shared/types';

export type MediaPoolContextMenuDeps = {
  getStatePaused: () => boolean | undefined;
  setShowStatus: (message: string) => void;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  renderDirectorState: () => Promise<void>;
  createEmbeddedAudioRepresentation: (visualId: string) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: string) => Promise<void>;
  runManualImport: () => Promise<void>;
  openLiveCaptureModal: () => void;
};

export type MediaPoolContextMenuController = {
  dismiss: () => void;
  showVisualContextMenu: (event: MouseEvent, visual: VisualState) => void;
  showAudioSourceContextMenu: (event: MouseEvent, source: AudioSourceState) => void;
  showAddVisualsMenu: (anchor: HTMLElement) => void;
};

export function createMediaPoolContextMenuController(deps: MediaPoolContextMenuDeps): MediaPoolContextMenuController {
  let activeMenu: HTMLElement | undefined;

  function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
    const menuBounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, window.innerWidth - menuBounds.width - 4)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - menuBounds.height - 4)}px`;
  }

  function dismiss(): void {
    activeMenu?.remove();
    activeMenu = undefined;
  }

  function showVisualContextMenu(event: MouseEvent, visual: VisualState): void {
    if (visual.kind === 'live' || visual.type !== 'video') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (deps.getStatePaused() === false) {
      deps.setShowStatus('Pause the timeline before extracting embedded audio.');
      return;
    }
    dismiss();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const representationButton = createButton('Add embedded audio track', 'secondary context-menu-item', async () => {
      dismiss();
      await deps.createEmbeddedAudioRepresentation(visual.id);
    });
    representationButton.setAttribute('role', 'menuitem');
    const fileButton = createButton('Extract audio as file', 'secondary context-menu-item', async () => {
      dismiss();
      await deps.extractEmbeddedAudioFile(visual.id);
    });
    fileButton.setAttribute('role', 'menuitem');
    if ((visual.durationSeconds ?? 0) >= LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS) {
      representationButton.disabled = true;
      representationButton.title = 'Long videos use extracted audio files for more stable playback.';
      menu.append(fileButton);
    } else {
      menu.append(representationButton, fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeMenu = menu;
  }

  function showAudioSourceContextMenu(event: MouseEvent, source: AudioSourceState): void {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const splitButton = createButton('Split to mono', 'secondary context-menu-item', async () => {
      dismiss();
      try {
        const [left] = await window.xtream.audioSources.splitStereo(source.id);
        deps.setSelectedEntity({ type: 'audio-source', id: left.id });
        await deps.renderDirectorState();
        deps.setShowStatus(`Split ${source.label} into virtual L/R mono sources.`);
      } catch (error: unknown) {
        deps.setShowStatus(error instanceof Error ? error.message : 'Unable to split this audio source.');
      }
    });
    splitButton.setAttribute('role', 'menuitem');
    if (source.derivedFromAudioSourceId || source.channelMode === 'left' || source.channelMode === 'right' || source.channelCount === 1) {
      splitButton.disabled = true;
      splitButton.title = source.channelCount === 1 ? 'Mono sources cannot be split.' : 'This source is already a mono channel.';
    }
    menu.append(splitButton);
    if (source.type === 'embedded-visual' && source.extractionMode === 'representation') {
      const fileButton = createButton('Extract audio as file', 'secondary context-menu-item', async () => {
        dismiss();
        if (deps.getStatePaused() === false) {
          deps.setShowStatus('Pause the timeline before extracting embedded audio.');
          return;
        }
        await deps.extractEmbeddedAudioFile(source.visualId);
      });
      fileButton.setAttribute('role', 'menuitem');
      if (deps.getStatePaused() === false) {
        fileButton.disabled = true;
        fileButton.title = 'Pause the timeline before extracting embedded audio.';
      }
      menu.append(fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeMenu = menu;
  }

  function showAddVisualsMenu(anchor: HTMLElement): void {
    dismiss();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const localFiles = createButton('Local static files', 'secondary context-menu-item', async () => {
      dismiss();
      await deps.runManualImport();
    });
    localFiles.setAttribute('role', 'menuitem');
    const liveStream = createButton('Add Live Stream', 'secondary context-menu-item', () => {
      dismiss();
      deps.openLiveCaptureModal();
    });
    liveStream.setAttribute('role', 'menuitem');
    menu.append(localFiles, liveStream);
    document.body.append(menu);
    const bounds = anchor.getBoundingClientRect();
    positionContextMenu(menu, bounds.left, bounds.bottom + 4);
    activeMenu = menu;
  }

  return {
    dismiss,
    showVisualContextMenu,
    showAudioSourceContextMenu,
    showAddVisualsMenu,
  };
}
