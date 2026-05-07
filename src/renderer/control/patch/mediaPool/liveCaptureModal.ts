import type { DirectorState, LiveDesktopSourceSummary } from '../../../../shared/types';
import { createButton, createHint } from '../../shared/dom';
import type { SelectedEntity } from '../../shared/types';

type LiveCaptureModalDeps = {
  setShowStatus: (message: string) => void;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  renderState: (state: DirectorState) => void;
};

export type LiveCaptureModalController = {
  dismiss: () => void;
  open: () => void;
};

export function createLiveCaptureModalController(deps: LiveCaptureModalDeps): LiveCaptureModalController {
  let activeLiveCaptureModal: HTMLElement | undefined;
  let activeLiveCaptureModalKeydown: ((event: KeyboardEvent) => void) | undefined;
  let activeLiveCaptureModalCleanups: Array<() => void> = [];

  function dismissLiveCaptureModal(): void {
    cleanupLiveCaptureModalResources();
    if (activeLiveCaptureModalKeydown) {
      document.removeEventListener('keydown', activeLiveCaptureModalKeydown);
      activeLiveCaptureModalKeydown = undefined;
    }
    activeLiveCaptureModal?.remove();
    activeLiveCaptureModal = undefined;
  }

  function cleanupLiveCaptureModalResources(): void {
    activeLiveCaptureModalCleanups.forEach((cleanup) => cleanup());
    activeLiveCaptureModalCleanups = [];
  }

  async function createWebcamLiveVisual(webcam: MediaDeviceInfo): Promise<void> {
    dismissLiveCaptureModal();
    deps.setShowStatus(`Adding live webcam: ${webcam.label || 'Webcam'}.`);
    const visual = await window.xtream.liveCapture.create({
      label: webcam.label || 'Webcam',
      capture: {
        source: 'webcam',
        deviceId: webcam.deviceId,
        groupId: webcam.groupId,
        label: webcam.label || 'Webcam',
      },
    });
    deps.setSelectedEntity({ type: 'visual', id: visual.id });
    deps.renderState(await window.xtream.director.getState());
  }

  async function loadWebcamDevices(): Promise<MediaDeviceInfo[]> {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((device) => device.kind === 'videoinput' && device.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => undefined);
      probe?.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return devices.filter((device) => device.kind === 'videoinput');
  }

  async function createDesktopLiveVisual(source: LiveDesktopSourceSummary): Promise<void> {
    dismissLiveCaptureModal();
    const kind = source.kind;
    deps.setShowStatus(`Adding live ${kind === 'screen' ? 'screen' : 'window'}: ${source.name}.`);
    const visual = await window.xtream.liveCapture.create({
      label: source.name,
      capture:
        kind === 'screen'
          ? {
              source: 'screen',
              sourceId: source.id,
              displayId: source.displayId,
              label: source.name,
            }
          : {
              source: 'window',
              sourceId: source.id,
              windowName: source.name,
              label: source.name,
            },
    });
    deps.setSelectedEntity({ type: 'visual', id: visual.id });
    deps.renderState(await window.xtream.director.getState());
  }

  function openLiveCaptureModal(): void {
    dismissLiveCaptureModal();
    const overlay = document.createElement('section');
    overlay.className = 'live-capture-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'liveCaptureModalHeading');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        dismissLiveCaptureModal();
      }
    });
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissLiveCaptureModal();
      }
    };
    activeLiveCaptureModalKeydown = closeOnEscape;
    document.addEventListener('keydown', activeLiveCaptureModalKeydown);
    const panel = document.createElement('div');
    panel.className = 'live-capture-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());
    overlay.append(panel);
    document.body.append(overlay);
    activeLiveCaptureModal = overlay;
    renderLiveCaptureTypeStep(panel);
  }

  function renderLiveCaptureTypeStep(panel: HTMLElement): void {
    cleanupLiveCaptureModalResources();
    const body = createLiveCaptureModalShell('Add Live Stream', 'Choose a live source type.', false);
    const grid = document.createElement('div');
    grid.className = 'live-capture-type-grid';
    grid.append(
      createLiveCaptureTypeButton('Webcam', 'Use a connected camera device.', () => void renderWebcamSourceStep(panel)),
      createLiveCaptureTypeButton('Screen', 'Capture an entire display.', () => void renderDesktopSourceStep(panel, 'screen')),
      createLiveCaptureTypeButton('Window Capture', 'Capture a single app window.', () => void renderDesktopSourceStep(panel, 'window')),
    );
    body.content.append(grid);
    panel.replaceChildren(body.root);
  }

  function createLiveCaptureTypeButton(label: string, detail: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-capture-type-button secondary';
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('span');
    meta.textContent = detail;
    button.append(title, meta);
    button.addEventListener('click', onClick);
    return button;
  }

  async function renderWebcamSourceStep(panel: HTMLElement): Promise<void> {
    cleanupLiveCaptureModalResources();
    const shell = createLiveCaptureModalShell('Choose Webcam', 'Select a camera device to add to the visual pool.', true);
    panel.replaceChildren(shell.root);
    shell.content.append(createHint('Loading webcam devices...'));
    try {
      const webcams = await loadWebcamDevices();
      shell.content.replaceChildren();
      if (webcams.length === 0) {
        shell.content.append(createHint('No webcam devices are available.'));
        return;
      }
      const list = document.createElement('div');
      list.className = 'live-capture-source-list compact';
      webcams.forEach((webcam, index) => {
        const row = createWebcamSourceButton(webcam, webcam.label || `Webcam ${index + 1}`, () => {
          void createWebcamLiveVisual(webcam);
        });
        list.append(row);
      });
      shell.content.append(list);
    } catch (error: unknown) {
      shell.content.replaceChildren(createHint(error instanceof Error ? error.message : 'Unable to enumerate webcams.'));
    }
  }

  async function renderDesktopSourceStep(panel: HTMLElement, kind: 'screen' | 'window'): Promise<void> {
    cleanupLiveCaptureModalResources();
    const isScreen = kind === 'screen';
    const shell = createLiveCaptureModalShell(
      isScreen ? 'Choose Screen' : 'Choose Window',
      isScreen ? 'Select a display to stream into the visual pool.' : 'Select an app window to stream into the visual pool.',
      true,
    );
    panel.replaceChildren(shell.root);
    shell.content.append(createHint(`Loading ${isScreen ? 'screens' : 'windows'}...`));
    try {
      const sources = (await window.xtream.liveCapture.listDesktopSources()).filter((source) => source.kind === kind);
      shell.content.replaceChildren();
      if (sources.length === 0) {
        shell.content.append(createHint(`No ${isScreen ? 'screen' : 'window'} sources are available.`));
        return;
      }
      const list = document.createElement('div');
      list.className = 'live-capture-source-list';
      for (const source of sources) {
        const detail = isScreen ? source.displayId ? `Display ${source.displayId}` : 'Display source' : 'Window source';
        list.append(createLiveCaptureSourceButton(source.name, detail, source.thumbnailDataUrl, () => void createDesktopLiveVisual(source)));
      }
      shell.content.append(list);
    } catch (error: unknown) {
      shell.content.replaceChildren(createHint(error instanceof Error ? error.message : `Unable to enumerate ${isScreen ? 'screens' : 'windows'}.`));
    }
  }

  function createLiveCaptureModalShell(
    title: string,
    subtitle: string,
    showBack: boolean,
  ): { root: HTMLElement; content: HTMLElement } {
    const root = document.createElement('div');
    root.className = 'live-capture-modal';
    const header = document.createElement('header');
    header.className = 'live-capture-header';
    const titleWrap = document.createElement('div');
    const heading = document.createElement('h1');
    heading.id = 'liveCaptureModalHeading';
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = subtitle;
    titleWrap.append(heading, copy);
    const actions = document.createElement('div');
    actions.className = 'live-capture-header-actions';
    if (showBack) {
      actions.append(createButton('Back', 'secondary', () => {
        const panel = activeLiveCaptureModal?.querySelector<HTMLElement>('.live-capture-panel');
        if (panel) {
          renderLiveCaptureTypeStep(panel);
        }
      }));
    }
    actions.append(createButton('Close', 'secondary', dismissLiveCaptureModal));
    header.append(titleWrap, actions);
    const content = document.createElement('div');
    content.className = 'live-capture-content';
    root.append(header, content);
    return { root, content };
  }

  function createLiveCaptureSourceButton(label: string, detail: string, imageDataUrl: string | undefined, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-capture-source-button secondary';
    const preview = document.createElement('span');
    preview.className = 'live-capture-source-preview';
    if (imageDataUrl) {
      const image = document.createElement('img');
      image.src = imageDataUrl;
      image.alt = '';
      preview.append(image);
    } else {
      preview.textContent = 'LIVE';
    }
    const text = document.createElement('span');
    text.className = 'live-capture-source-text';
    const title = document.createElement('strong');
    title.textContent = label;
    const meta = document.createElement('small');
    meta.textContent = detail;
    text.append(title, meta);
    button.append(preview, text);
    button.addEventListener('click', onClick);
    return button;
  }

  function createWebcamSourceButton(webcam: MediaDeviceInfo, label: string, onClick: () => void): HTMLButtonElement {
    const button = createLiveCaptureSourceButton(label, 'Camera input', undefined, onClick);
    const preview = button.querySelector<HTMLElement>('.live-capture-source-preview');
    if (!preview) {
      return button;
    }
    preview.textContent = '';
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    preview.append(video);
    navigator.mediaDevices
      .getUserMedia({ video: webcam.deviceId ? { deviceId: { exact: webcam.deviceId } } : true, audio: false })
      .then((stream) => {
        video.srcObject = stream;
        activeLiveCaptureModalCleanups.push(() => {
          stream.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
        });
        return video.play();
      })
      .catch((error: unknown) => {
        preview.textContent = error instanceof Error ? 'UNAVAILABLE' : 'NO PREVIEW';
        preview.title = error instanceof Error ? error.message : 'Webcam preview unavailable.';
      });
    return button;
  }

  return {
    dismiss: dismissLiveCaptureModal,
    open: openLiveCaptureModal,
  };
}
