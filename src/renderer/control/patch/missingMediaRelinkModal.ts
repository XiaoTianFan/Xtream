import type { BatchMissingMediaRelinkResult, MissingMediaListItem } from '../../../shared/types';
import { createButton, createHint } from '../shared/dom';

export type MissingMediaRelinkModalOptions = {
  /** After a successful relink or batch; refresh validation issues in the shell. */
  onRelinked: () => void;
};

function kindLabel(kind: MissingMediaListItem['kind']): string {
  switch (kind) {
    case 'visual':
      return 'Visual';
    case 'audio-external':
      return 'Audio file';
    case 'audio-embedded':
      return 'Extracted audio';
  }
}

async function pickReplacementPath(item: MissingMediaListItem): Promise<string | undefined> {
  if (item.kind === 'visual') {
    const paths = await window.xtream.visuals.chooseFiles();
    return paths[0];
  }
  return window.xtream.audioSources.chooseFile();
}

/**
 * Full-screen relink workflow for pool media that is missing on disk.
 */
export function openMissingMediaRelinkModal(options: MissingMediaRelinkModalOptions): Promise<void> {
  return new Promise((resolve) => {
    let concluded = false;
    let batchDir: string | undefined;

    function teardown(): void {
      document.removeEventListener('keydown', closeOnEscape);
      overlay.remove();
    }

    function conclude(): void {
      if (concluded) {
        return;
      }
      concluded = true;
      teardown();
      resolve();
    }

    const overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay media-import-overlay missing-media-relink-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'missingMediaRelinkHeading');

    const panel = document.createElement('div');
    panel.className = 'live-capture-panel media-import-modal-panel missing-media-relink-panel';

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (concluded || event.key !== 'Escape') {
        return;
      }
      conclude();
    };

    document.addEventListener('keydown', closeOnEscape);

    overlay.addEventListener('mousedown', (event: MouseEvent) => {
      if (concluded || event.target !== overlay) {
        return;
      }
      conclude();
    });

    panel.addEventListener('mousedown', (event: MouseEvent) => event.stopPropagation());
    overlay.append(panel);
    document.body.append(overlay);

    const listMount = document.createElement('div');
    listMount.className = 'missing-media-relink-list';

    const batchStatus = document.createElement('div');
    batchStatus.className = 'missing-media-relink-batch-status';
    batchStatus.setAttribute('aria-live', 'polite');

    function setBatchStatus(text: string): void {
      batchStatus.textContent = text;
    }

    async function refreshList(): Promise<void> {
      const items = await window.xtream.show.listMissingMedia();
      listMount.replaceChildren();
      if (items.length === 0) {
        listMount.append(createHint('All listed media files are now on disk. You can close this dialog.'));
        setBatchStatus('');
        return;
      }
      for (const item of items) {
        listMount.append(renderRow(item));
      }
      setBatchStatus(
        batchDir
          ? `Batch folder: ${batchDir}`
          : 'Pick a folder that contains the missing files (same filenames) to relink everything at once.',
      );
    }

    async function runSingle(item: MissingMediaListItem, mode: 'link' | 'copy'): Promise<void> {
      const picked = await pickReplacementPath(item);
      if (!picked) {
        return;
      }
      try {
        await window.xtream.show.relinkMissingMedia({
          kind: item.kind,
          id: item.id,
          sourcePath: picked,
          mode,
        });
        options.onRelinked();
        await refreshList();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      }
    }

    async function runBatch(mode: 'link' | 'copy'): Promise<void> {
      if (!batchDir) {
        window.alert('Choose a folder first.');
        return;
      }
      try {
        const result: BatchMissingMediaRelinkResult = await window.xtream.show.batchRelinkFromDirectory(batchDir, mode);
        options.onRelinked();
        const n = result.relinkedIds.length;
        const miss = result.notFoundFilenames.length;
        setBatchStatus(
          miss === 0
            ? `Batch ${mode === 'copy' ? 'import' : 'link'}: recovered ${n} file(s).`
            : `Batch: recovered ${n} file(s). Not found in folder (${miss}): ${result.notFoundFilenames.join(', ')}`,
        );
        await refreshList();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      }
    }

    function renderRow(item: MissingMediaListItem): HTMLElement {
      const row = document.createElement('div');
      row.className = 'missing-media-relink-row';

      const head = document.createElement('div');
      head.className = 'missing-media-relink-row__head';
      const title = document.createElement('div');
      title.className = 'missing-media-relink-row__title';
      title.textContent = item.label;
      const tag = document.createElement('span');
      tag.className = 'missing-media-relink-kind';
      tag.textContent = kindLabel(item.kind);
      head.append(title, tag);

      const pathLine = document.createElement('div');
      pathLine.className = 'missing-media-relink-row__path';
      pathLine.textContent = item.referencePath;

      const fileLine = document.createElement('div');
      fileLine.className = 'missing-media-relink-row__file';
      fileLine.textContent = `Expected filename: ${item.filename}`;

      const actions = document.createElement('div');
      actions.className = 'missing-media-relink-row__actions';
      actions.append(
        createButton('Link file…', 'secondary', () => void runSingle(item, 'link')),
        createButton('Import copy…', '', () => void runSingle(item, 'copy')),
      );

      row.append(head, pathLine, fileLine, actions);
      return row;
    }

    const headerRow = document.createElement('header');
    headerRow.className = 'live-capture-header media-import-modal__header';
    const titleWrap = document.createElement('div');
    const heading = document.createElement('h1');
    heading.id = 'missingMediaRelinkHeading';
    heading.textContent = 'Relink missing media';
    const subtitle = document.createElement('p');
    subtitle.textContent =
      'Each item points at a file that is not on disk. Link keeps the path you pick; import copy duplicates into the project assets folder.';
    titleWrap.append(heading, subtitle);
    headerRow.append(titleWrap);

    const body = document.createElement('div');
    body.className = 'live-capture-content missing-media-relink-body';

    const batchCard = document.createElement('div');
    batchCard.className = 'missing-media-relink-batch';
    batchCard.append(
      createHint(
        'Batch: choose a folder from a previous machine or backup. Files are matched by exact filename (e.g. clip.m4a).',
      ),
    );
    const batchRow = document.createElement('div');
    batchRow.className = 'missing-media-relink-batch-actions';
    batchRow.append(
      createButton('Choose folder…', 'secondary', async () => {
        batchDir = await window.xtream.show.chooseBatchRelinkDirectory();
        await refreshList();
      }),
      createButton('Link all found', 'secondary', () => void runBatch('link')),
      createButton('Import copies', '', () => void runBatch('copy')),
    );
    batchCard.append(batchRow, batchStatus);

    body.append(batchCard, listMount);

    const footer = document.createElement('div');
    footer.className = 'media-import-modal__actions';
    footer.append(createButton('Close', 'secondary', conclude));

    const modalInner = document.createElement('div');
    modalInner.className = 'live-capture-modal media-import-modal missing-media-relink-modal';
    modalInner.append(headerRow, body, footer);
    panel.append(modalInner);

    void refreshList();
  });
}
