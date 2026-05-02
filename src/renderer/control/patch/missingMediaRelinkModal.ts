import type { BatchMissingMediaRelinkResult, MissingMediaListItem } from '../../../shared/types';
import { createButton, createHint } from '../shared/dom';
import { shellShowAlert, shellShowConfirm } from '../shell/shellModalPresenter';

export type MissingMediaRelinkModalOptions = {
  /** After a successful relink, remove, or batch; refresh validation issues in the shell. */
  onRelinked: () => void;
  /** Invoked when the dialog fully closes (Cancel, Escape, backdrop). */
  onClose?: (stillMissing: MissingMediaListItem[]) => void;
};

let activeMissingRelinkPromise: Promise<void> | undefined;

export function isMissingMediaRelinkModalOpen(): boolean {
  return activeMissingRelinkPromise !== undefined;
}

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

async function pickReplacementFile(item: MissingMediaListItem): Promise<string | undefined> {
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
  if (activeMissingRelinkPromise) {
    return activeMissingRelinkPromise;
  }

  activeMissingRelinkPromise = new Promise((resolve) => {
    let concluded = false;
    const selectedIds = new Set<string>();
    let latestItems: MissingMediaListItem[] = [];

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
      void window.xtream.show.listMissingMedia().then((still) => {
        options.onClose?.(still);
        activeMissingRelinkPromise = undefined;
        resolve();
      });
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
    listMount.setAttribute('role', 'listbox');
    listMount.setAttribute('aria-multiselectable', 'true');

    const resultStatus = document.createElement('div');
    resultStatus.className = 'missing-media-relink-result-status';
    resultStatus.setAttribute('aria-live', 'polite');

    function setResultStatus(text: string): void {
      resultStatus.textContent = text;
    }

    function renderRow(item: MissingMediaListItem): HTMLElement {
      const row = document.createElement('div');
      row.className = 'missing-media-relink-row';
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      row.dataset.itemId = item.id;
      row.setAttribute('aria-selected', selectedIds.has(item.id) ? 'true' : 'false');
      if (selectedIds.has(item.id)) {
        row.classList.add('missing-media-relink-row--selected');
      }

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

      row.append(head, pathLine, fileLine);

      const toggle = (): void => {
        if (selectedIds.has(item.id)) {
          selectedIds.delete(item.id);
        } else {
          selectedIds.add(item.id);
        }
        renderList();
      };

      row.addEventListener('click', (event) => {
        event.preventDefault();
        toggle();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });

      return row;
    }

    function renderList(): void {
      listMount.replaceChildren();
      if (latestItems.length === 0) {
        listMount.append(createHint('All listed media files are now on disk. You can close this dialog.'));
        return;
      }
      for (const item of latestItems) {
        listMount.append(renderRow(item));
      }
    }

    async function reloadListFromServer(): Promise<void> {
      latestItems = await window.xtream.show.listMissingMedia();
      for (const id of [...selectedIds]) {
        if (!latestItems.some((i) => i.id === id)) {
          selectedIds.delete(id);
        }
      }
      renderList();
    }

    async function runRelink(): Promise<void> {
      if (latestItems.length === 0) {
        return;
      }

      if (selectedIds.size === 1) {
        const id = [...selectedIds][0]!;
        const item = latestItems.find((i) => i.id === id);
        if (!item) {
          return;
        }
        const picked = await pickReplacementFile(item);
        if (!picked) {
          return;
        }
        try {
          await window.xtream.show.relinkMissingMedia({
            kind: item.kind,
            id: item.id,
            sourcePath: picked,
            mode: 'link',
          });
          options.onRelinked();
          setResultStatus('Relinked 1 file successfully.');
          selectedIds.delete(id);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          setResultStatus(`Relink failed: ${message}`);
        }
        await reloadListFromServer();
        return;
      }

      const dir = await window.xtream.show.chooseBatchRelinkDirectory();
      if (!dir) {
        return;
      }

      const onlyIds = selectedIds.size > 1 ? [...selectedIds] : undefined;
      try {
        const result: BatchMissingMediaRelinkResult = await window.xtream.show.batchRelinkFromDirectory({
          directory: dir,
          mode: 'link',
          onlyIds,
        });
        options.onRelinked();
        const ok = result.relinkedIds.length;
        const miss = result.notFoundFilenames.length;
        if (miss === 0) {
          setResultStatus(`Relinked ${ok} file(s) successfully.`);
        } else {
          setResultStatus(
            `Relinked ${ok} file(s) successfully. Could not find ${miss} file(s) in the folder (by exact filename).`,
          );
        }
        for (const id of result.relinkedIds) {
          selectedIds.delete(id);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setResultStatus(`Batch relink failed: ${message}`);
      }
      await reloadListFromServer();
    }

    async function runRemove(): Promise<void> {
      if (selectedIds.size === 0) {
        await shellShowAlert('Remove', 'Select one or more items in the list, then click Remove.');
        return;
      }
      const ids = [...selectedIds];
      const confirmed = await shellShowConfirm(
        'Remove missing media',
        `Remove ${ids.length} asset(s) from the project? References to them may break in cues and the timeline.`,
      );
      if (!confirmed) {
        return;
      }

      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        const item = latestItems.find((i) => i.id === id);
        if (!item) {
          continue;
        }
        try {
          if (item.kind === 'visual') {
            await window.xtream.visuals.remove(id);
          } else {
            await window.xtream.audioSources.remove(id);
          }
          ok += 1;
          selectedIds.delete(id);
        } catch {
          failed += 1;
        }
      }
      options.onRelinked();
      setResultStatus(
        failed === 0 ? `Removed ${ok} asset(s) from the project.` : `Removed ${ok} asset(s). ${failed} could not be removed.`,
      );
      await reloadListFromServer();
    }

    const headerRow = document.createElement('header');
    headerRow.className = 'live-capture-header media-import-modal__header';
    const titleWrap = document.createElement('div');
    const heading = document.createElement('h1');
    heading.id = 'missingMediaRelinkHeading';
    heading.textContent = 'Relink missing media';
    const subtitle = document.createElement('p');
    subtitle.textContent =
      'Click rows to select or deselect. Relink with one row selected picks a replacement file; with none or several selected, choose a folder—we match by exact filename. This dialog stays open until you click Cancel.';
    titleWrap.append(heading, subtitle);
    headerRow.append(titleWrap);

    const body = document.createElement('div');
    body.className = 'live-capture-content missing-media-relink-body';

    body.append(listMount, resultStatus);

    const footer = document.createElement('div');
    footer.className = 'media-import-modal__actions missing-media-relink-footer';
    footer.append(
      createButton('Relink', '', () => void runRelink()),
      createButton('Remove', 'secondary', () => void runRemove()),
      createButton('Cancel', 'secondary', conclude),
    );

    const modalInner = document.createElement('div');
    modalInner.className = 'live-capture-modal media-import-modal missing-media-relink-modal';
    modalInner.append(headerRow, body, footer);
    panel.append(modalInner);

    void reloadListFromServer();
  });

  return activeMissingRelinkPromise;
}
