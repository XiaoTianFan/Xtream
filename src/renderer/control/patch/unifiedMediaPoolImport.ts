import type { AudioSourceState, DirectorState, VisualState } from '../../../shared/types';
import type { SelectedEntity } from '../shared/types';
import { shellMountBlockingBusy, shellShowAlert, shellShowChoiceModal } from '../shell/shellModalPresenter';

export type UnifiedMediaPoolImportDeps = {
  setShowStatus: (message: string) => void;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  renderState: (state: DirectorState) => void;
  selectPoolTab: (tab: 'visuals' | 'audio') => void;
};

function fileBasename(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function importSummaryPhrase(visualCount: number, audioCount: number): string {
  const parts: string[] = [];
  if (visualCount > 0) {
    parts.push(visualCount === 1 ? '1 visual asset' : `${visualCount} visual assets`);
  }
  if (audioCount > 0) {
    parts.push(audioCount === 1 ? '1 audio file' : `${audioCount} audio files`);
  }
  return parts.join(' and ');
}

function formatUnsupportedDetail(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }
  const max = 18;
  const names = paths.map(fileBasename);
  const lines = names.slice(0, max);
  const extra = names.length - max;
  if (extra > 0) {
    lines.push(`…and ${extra} more`);
  }
  return lines.join('\n');
}

export async function runUnifiedMediaPoolImport(
  filePaths: string[],
  deps: UnifiedMediaPoolImportDeps,
): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }

  const classified = await window.xtream.mediaPool.classifyImportPaths(filePaths);
  const { visualPaths, audioPaths, unsupportedPaths } = classified;

  if (visualPaths.length === 0 && audioPaths.length === 0) {
    await shellShowAlert(
      'Nothing to import',
      'No supported media files were found.',
      formatUnsupportedDetail(unsupportedPaths),
    );
    return;
  }

  const summary = importSummaryPhrase(visualPaths.length, audioPaths.length);
  const choiceIdx = await shellShowChoiceModal({
    title: 'Import media',
    message: `Import ${summary}.`,
    detail:
      'Link references files in their current location. If you move or rename linked files later, the project may lose track of them.\nCopy stores files under this project’s assets/visuals and assets/audio folders.',
    buttons: [
      { label: 'Cancel', variant: 'secondary' },
      { label: 'Link originals', variant: 'secondary' },
      { label: 'Copy into project', variant: 'primary' },
    ],
    defaultId: 2,
    cancelId: 0,
  });

  if (choiceIdx === 0) {
    return;
  }

  const mode = choiceIdx === 1 ? 'link' : 'copy';

  let dismissBusy: (() => void) | undefined;
  let newVisuals: VisualState[] = [];
  let newAudio: AudioSourceState[] = [];

  try {
    if (mode === 'copy') {
      dismissBusy = shellMountBlockingBusy('Importing media', 'Copying into project…');
    }

    if (visualPaths.length > 0) {
      newVisuals = await window.xtream.visuals.importFiles({ filePaths: visualPaths, mode });
    }
    if (audioPaths.length > 0) {
      newAudio = await window.xtream.audioSources.importFiles({ filePaths: audioPaths, mode });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await shellShowAlert('Import failed', message);
    return;
  } finally {
    dismissBusy?.();
  }

  const expectedAny = visualPaths.length > 0 || audioPaths.length > 0;
  const gotAny = newVisuals.length > 0 || newAudio.length > 0;
  if (expectedAny && !gotAny) {
    await shellShowAlert(
      'Import did not add media',
      'No media was added to the project.',
      formatUnsupportedDetail(unsupportedPaths),
    );
    return;
  }

  deps.queueEmbeddedAudioImportPrompt(newVisuals.length > 0 ? newVisuals : undefined);
  newVisuals.forEach(deps.probeVisualMetadata);

  if (newVisuals[0]) {
    deps.setSelectedEntity({ type: 'visual', id: newVisuals[0].id });
  } else if (newAudio[0]) {
    deps.setSelectedEntity({ type: 'audio-source', id: newAudio[0].id });
  }

  if (newVisuals.length > 0) {
    deps.selectPoolTab('visuals');
  } else if (newAudio.length > 0) {
    deps.selectPoolTab('audio');
  }

  deps.renderState(await window.xtream.director.getState());

  if (unsupportedPaths.length > 0) {
    await shellShowAlert(
      'Some files were not imported',
      'One or more files are not supported, could not be read, or were skipped.',
      formatUnsupportedDetail(unsupportedPaths),
    );
  }
}

export async function runUnifiedManualMediaImport(deps: UnifiedMediaPoolImportDeps): Promise<void> {
  const paths = await window.xtream.mediaPool.chooseImportFiles();
  if (paths.length === 0) {
    return;
  }
  await runUnifiedMediaPoolImport(paths, deps);
}
