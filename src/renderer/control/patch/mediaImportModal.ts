import type { AudioSourceState, VisualState } from '../../../shared/types';
import { createButton, createHint } from '../shared/dom';

export type MediaImportModalKind = 'visual' | 'audio';

export type MediaImportModalResult =
  | { kind: 'canceled' }
  | { kind: 'visual'; visuals: VisualState[] }
  | { kind: 'audio'; sources: AudioSourceState[] };

export type MediaImportModeChoice =
  | { kind: 'canceled' }
  | { kind: 'mode'; mode: 'link' | 'copy' };

function importSummary(kind: MediaImportModalKind, count: number): string {
  if (kind === 'visual') {
    return count === 1 ? `${count} visual asset` : `${count} visual assets`;
  }
  return count === 1 ? `${count} audio file` : `${count} audio files`;
}

/** Subtitle copy when files are known (drop / picker already ran). */
function subtitleKnownFiles(kind: MediaImportModalKind, fileCount: number): string {
  return `Import ${importSummary(kind, fileCount)}`;
}

/** Subtitle when user still needs to choose files via the system picker. */
function subtitlePickNext(kind: MediaImportModalKind): string {
  return kind === 'visual'
    ? 'You will choose local files next.'
    : 'You will choose a file next.';
}

async function finalizeImport(
  kind: MediaImportModalKind,
  filePaths: string[],
  mode: 'link' | 'copy',
): Promise<Exclude<MediaImportModalResult, { kind: 'canceled' }>> {
  if (kind === 'visual') {
    const visuals = await window.xtream.visuals.importFiles({ filePaths, mode });
    return { kind: 'visual', visuals };
  }
  const sources = await window.xtream.audioSources.importFiles({ filePaths, mode });
  return { kind: 'audio', sources };
}

/** Link vs copy modal only — intended before opening the OS file picker. */
export function chooseMediaImportMode(kind: MediaImportModalKind): Promise<MediaImportModeChoice> {
  return new Promise((resolve) => {
    let concluded = false;

    function conclude(kindResult: MediaImportModeChoice): void {
      if (concluded) {
        return;
      }
      concluded = true;
      teardown();
      resolve(kindResult);
    }

    function teardown(): void {
      document.removeEventListener('keydown', closeOnEscape);
      overlay.remove();
    }

    const overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay media-import-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mediaImportModalHeading');

    const panel = document.createElement('div');
    panel.className = 'live-capture-panel media-import-modal-panel';

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (concluded) {
        return;
      }
      if (event.key === 'Escape') {
        conclude({ kind: 'canceled' });
      }
    };

    document.addEventListener('keydown', closeOnEscape);

    overlay.addEventListener('mousedown', (event: MouseEvent) => {
      if (concluded || event.target !== overlay) {
        return;
      }
      conclude({ kind: 'canceled' });
    });

    panel.addEventListener('mousedown', (event: MouseEvent) => event.stopPropagation());
    overlay.append(panel);
    document.body.append(overlay);

    function renderChoice(): void {
      const modalInner = document.createElement('div');
      modalInner.className = 'live-capture-modal media-import-modal';

      const headerRow = document.createElement('header');
      headerRow.className = 'live-capture-header media-import-modal__header';

      const titleWrap = document.createElement('div');
      const heading = document.createElement('h1');
      heading.id = 'mediaImportModalHeading';
      heading.textContent = kind === 'visual' ? 'Import visuals' : 'Import audio';
      const subtitle = document.createElement('p');
      subtitle.textContent = subtitlePickNext(kind);

      titleWrap.append(heading, subtitle);
      headerRow.append(titleWrap);

      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'live-capture-content';

      const assetsPath = kind === 'visual' ? 'assets/visuals' : 'assets/audio';
      bodyWrap.append(
        createHint(
          'Link references files in their current location. Copy stores copies under this project\'s assets folder.',
        ),
        createHint(`Copy uses the project\'s ${assetsPath} folder.`),
      );

      const footer = document.createElement('div');
      footer.className = 'media-import-modal__actions';

      footer.append(
        createButton('Cancel', 'secondary', () => conclude({ kind: 'canceled' })),
        createButton('Link originals', 'secondary', () => conclude({ kind: 'mode', mode: 'link' })),
        createButton('Copy into project', '', () => conclude({ kind: 'mode', mode: 'copy' })),
      );

      modalInner.append(headerRow, bodyWrap, footer);
      panel.replaceChildren(modalInner);
    }

    renderChoice();
  });
}

/** Run import after picker + chosen mode — shows spinner only when mode is copy (errors show retry/dismiss). */
export async function runMediaImportAfterPickerChoice(
  kind: MediaImportModalKind,
  filePaths: string[],
  mode: 'link' | 'copy',
): Promise<MediaImportModalResult> {
  if (filePaths.length === 0) {
    return { kind: 'canceled' };
  }

  if (mode === 'link') {
    try {
      return await finalizeImport(kind, filePaths, mode);
    } catch {
      return { kind: 'canceled' };
    }
  }

  return await new Promise((resolve) => {
    let concluded = false;
    let overlay: HTMLElement;

    function teardown(): void {
      document.removeEventListener('keydown', closeOnEscape);
      overlay.remove();
    }

    function concludeCanceled(): void {
      if (concluded) {
        return;
      }
      concluded = true;
      teardown();
      resolve({ kind: 'canceled' });
    }

    function concludeDone(payload: Exclude<MediaImportModalResult, { kind: 'canceled' }>): void {
      if (concluded) {
        return;
      }
      concluded = true;
      teardown();
      resolve(payload);
    }

    overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay media-import-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-busy', 'true');

    const panel = document.createElement('div');
    panel.className = 'live-capture-panel media-import-modal-panel';

    function renderBusyBody(): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'media-import-modal media-import-modal--busy';
      const status = document.createElement('div');
      status.className = 'media-import-modal__status';
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Copying into project…';
      const spinner = document.createElement('div');
      spinner.className = 'media-import-modal__spinner';
      spinner.setAttribute('aria-hidden', 'true');
      wrap.append(spinner, status);
      return wrap;
    }

    function renderErrorBody(message: string): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'media-import-modal media-import-modal--error';

      const heading = document.createElement('h2');
      heading.className = 'media-import-modal__error-title';
      heading.textContent = 'Import failed';

      const pre = document.createElement('pre');
      pre.className = 'media-import-modal__error-pre';
      pre.textContent = message;

      const footer = document.createElement('div');
      footer.className = 'media-import-modal__actions';
      footer.append(createButton('Dismiss', '', concludeCanceled));

      wrap.append(heading, pre, footer);
      return wrap;
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (concluded || overlay.getAttribute('aria-busy') === 'true') {
        return;
      }
      if (event.key === 'Escape') {
        concludeCanceled();
      }
    };

    document.addEventListener('keydown', closeOnEscape);

    overlay.addEventListener('mousedown', (event: MouseEvent) => {
      if (concluded || overlay.getAttribute('aria-busy') === 'true') {
        return;
      }
      if (event.target === overlay) {
        concludeCanceled();
      }
    });

    panel.addEventListener('mousedown', (event: MouseEvent) => event.stopPropagation());
    panel.replaceChildren(renderBusyBody());
    overlay.append(panel);
    document.body.append(overlay);

    void finalizeImport(kind, filePaths, mode)
      .then((payload) => {
        overlay.setAttribute('aria-busy', 'false');
        concludeDone(payload);
      })
      .catch((error: unknown) => {
        overlay.setAttribute('aria-busy', 'false');
        const message = error instanceof Error ? error.message : String(error);
        panel.replaceChildren(renderErrorBody(message));
      });
  });
}

/**
 * Link vs copy into project assets. Copy mode shows an in-modal loading state until IPC completes.
 * Use when paths are already known (e.g. drag-and-drop).
 */
export function openMediaImportModal(kind: MediaImportModalKind, filePaths: string[]): Promise<MediaImportModalResult> {
  if (filePaths.length === 0) {
    return Promise.resolve({ kind: 'canceled' });
  }

  return new Promise((resolve) => {
    let concluded = false;
    let loading = false;

    function concludeCanceled(): void {
      if (concluded || loading) {
        return;
      }
      concluded = true;
      teardown();
      resolve({ kind: 'canceled' });
    }

    function concludeDone(payload: Exclude<MediaImportModalResult, { kind: 'canceled' }>): void {
      if (concluded) {
        return;
      }
      concluded = true;
      teardown();
      resolve(payload);
    }

    const overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay media-import-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mediaImportModalHeading');

    const panel = document.createElement('div');
    panel.className = 'live-capture-panel media-import-modal-panel';

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (loading || concluded) {
        return;
      }
      if (event.key === 'Escape') {
        concludeCanceled();
      }
    };

    function teardown(): void {
      document.removeEventListener('keydown', closeOnEscape);
      overlay.remove();
    }

    document.addEventListener('keydown', closeOnEscape);

    overlay.addEventListener('mousedown', (event: MouseEvent) => {
      if (loading || concluded || event.target !== overlay) {
        return;
      }
      concludeCanceled();
    });

    panel.addEventListener('mousedown', (event: MouseEvent) => event.stopPropagation());
    overlay.append(panel);
    document.body.append(overlay);

    function renderChoice(): void {
      const modalInner = document.createElement('div');
      modalInner.className = 'live-capture-modal media-import-modal';

      const headerRow = document.createElement('header');
      headerRow.className = 'live-capture-header media-import-modal__header';

      const titleWrap = document.createElement('div');
      const heading = document.createElement('h1');
      heading.id = 'mediaImportModalHeading';
      heading.textContent = kind === 'visual' ? 'Import visuals' : 'Import audio';
      const subtitle = document.createElement('p');
      subtitle.textContent = subtitleKnownFiles(kind, filePaths.length);

      titleWrap.append(heading, subtitle);
      headerRow.append(titleWrap);

      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'live-capture-content';

      const assetsPath = kind === 'visual' ? 'assets/visuals' : 'assets/audio';
      bodyWrap.append(
        createHint(
          'Link references the files in their current location. If you move or rename them later, the project may lose track of them.',
        ),
        createHint(`Copy duplicates files under the project's ${assetsPath} folder.`),
      );

      const footer = document.createElement('div');
      footer.className = 'media-import-modal__actions';

      footer.append(
        createButton('Cancel', 'secondary', () => concludeCanceled()),
        createButton('Link originals', 'secondary', () => void runImport('link')),
        createButton('Copy into project', '', () => void runImport('copy')),
      );

      modalInner.append(headerRow, bodyWrap, footer);
      panel.replaceChildren(modalInner);
    }

    async function runImport(mode: 'link' | 'copy'): Promise<void> {
      if (loading || concluded) {
        return;
      }
      loading = true;
      overlay.setAttribute('aria-busy', 'true');
      if (mode === 'copy') {
        panel.replaceChildren(renderBusyBodyInline());
      }

      try {
        const payload = await finalizeImport(kind, filePaths, mode);
        concludeDone(payload);
      } catch (error: unknown) {
        loading = false;
        overlay.setAttribute('aria-busy', 'false');
        const message = error instanceof Error ? error.message : String(error);
        panel.replaceChildren(renderErrorBodyInline(message));
      }
    }

    function renderBusyBodyInline(): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'media-import-modal media-import-modal--busy';
      const status = document.createElement('div');
      status.className = 'media-import-modal__status';
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Copying into project…';
      const spinner = document.createElement('div');
      spinner.className = 'media-import-modal__spinner';
      spinner.setAttribute('aria-hidden', 'true');
      wrap.append(spinner, status);
      return wrap;
    }

    function renderErrorBodyInline(message: string): HTMLElement {
      const wrap = document.createElement('div');
      wrap.className = 'media-import-modal media-import-modal--error';

      const heading = document.createElement('h2');
      heading.className = 'media-import-modal__error-title';
      heading.textContent = 'Import failed';

      const pre = document.createElement('pre');
      pre.className = 'media-import-modal__error-pre';
      pre.textContent = message;

      const footer = document.createElement('div');
      footer.className = 'media-import-modal__actions';
      footer.append(createButton('Dismiss', '', () => concludeCanceled()));

      wrap.append(heading, pre, footer);
      return wrap;
    }

    renderChoice();
  });
}
