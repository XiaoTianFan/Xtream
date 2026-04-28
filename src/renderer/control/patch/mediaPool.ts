import type { AudioSourceState, DirectorState, LiveDesktopSourceSummary, VisualId, VisualState } from '../../../shared/types';
import { createButton, createHint } from '../shared/dom';
import { patchElements as elements } from './elements';
import { formatAudioChannelLabel, formatDuration } from '../shared/formatters';
import { decorateIconButton } from '../shared/icons';
import type { SelectedEntity } from '../shared/types';
import { LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS } from './embeddedAudioImport';

type PoolTab = 'visuals' | 'audio';
type PoolSort = 'label' | 'duration' | 'status';

export type MediaPoolController = {
  createRenderSignature: (state: DirectorState, selectedEntity: SelectedEntity | undefined) => string;
  render: (state: DirectorState) => void;
  selectEntityPoolTab: (entity: SelectedEntity) => void;
  dismissContextMenu: () => void;
  install: () => void;
};

type MediaPoolControllerOptions = {
  getState: () => DirectorState | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  clearSelectionIf: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  createEmbeddedAudioRepresentation: (visualId: VisualId) => Promise<void>;
  extractEmbeddedAudioFile: (visualId: VisualId) => Promise<void>;
};

export function createMediaPoolController(options: MediaPoolControllerOptions): MediaPoolController {
  let activePoolTab: PoolTab = 'visuals';
  let poolSearchQuery = '';
  let poolSort: PoolSort = 'label';
  let activeAudioSourceMenu: HTMLElement | undefined;
  let activeLiveCaptureModal: HTMLElement | undefined;
  let activeLiveCaptureModalKeydown: ((event: KeyboardEvent) => void) | undefined;
  let activeLiveCaptureModalCleanups: Array<() => void> = [];

  function render(state: DirectorState): void {
    syncPoolTabs();
    const rows =
      activePoolTab === 'visuals'
        ? getFilteredVisuals(Object.values(state.visuals)).map((visual) => createVisualRow(visual))
        : getFilteredAudioSources(Object.values(state.audioSources), state).map((source) => createAudioSourceRow(source, state));
    if (activePoolTab === 'audio') {
      elements.visualList.hidden = true;
      elements.audioPanel.hidden = false;
      elements.audioPanel.replaceChildren(...(rows.length > 0 ? rows : [createHint('No audio sources match this filter.')]));
    } else {
      elements.visualList.hidden = false;
      elements.audioPanel.hidden = true;
      elements.visualList.replaceChildren(...(rows.length > 0 ? rows : [createHint('No visuals match this filter.')]));
      elements.audioPanel.replaceChildren();
    }
  }

  function createRenderSignature(state: DirectorState, selectedEntity: SelectedEntity | undefined): string {
    return `${createVisualRenderSignature(state)}:${createAudioRenderSignature(state)}:${activePoolTab}:${poolSearchQuery}:${poolSort}:${selectedEntity?.type}:${selectedEntity?.id}`;
  }

  function createVisualRow(visual: VisualState): HTMLElement {
    const row = document.createElement('article');
    row.className = `asset-row${options.isSelected('visual', visual.id) ? ' selected' : ''}`;
    row.tabIndex = 0;
    row.dataset.assetId = visual.id;
    row.addEventListener('click', () => selectPoolEntity({ type: 'visual', id: visual.id }));
    row.addEventListener('contextmenu', (event) => showVisualContextMenu(event, visual));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPoolEntity({ type: 'visual', id: visual.id });
      }
    });
    const status = document.createElement('span');
    status.className = `status-dot ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
    const label = document.createElement('strong');
    label.textContent = visual.label;
    const meta = document.createElement('span');
    meta.className = 'asset-meta';
    meta.textContent =
      visual.kind === 'live'
        ? `live | ${visual.capture.source} | ${visual.error ?? (visual.width && visual.height ? `${visual.width}x${visual.height}` : 'standby')}`
        : `${visual.type} | ${formatDuration(visual.durationSeconds)} | ${visual.width && visual.height ? `${visual.width}x${visual.height}` : 'size --'}`;
    if (visual.error) {
      meta.title = visual.error;
      row.title = visual.error;
    }
    const remove = createButton('Remove', 'secondary row-action', async () => {
      if (!confirmPoolRecordRemoval(visual.label)) {
        return;
      }
      await window.xtream.visuals.remove(visual.id);
      options.clearSelectionIf({ type: 'visual', id: visual.id });
      const state = await window.xtream.director.getState();
      render(state);
      options.renderState(state);
    });
    decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
    remove.addEventListener('click', (event) => event.stopPropagation());
    row.append(status, label, meta, remove);
    return row;
  }

  function createAudioSourceRow(source: AudioSourceState, state: DirectorState): HTMLElement {
    const row = document.createElement('article');
    row.className = `asset-row audio-source-row${options.isSelected('audio-source', source.id) ? ' selected' : ''}`;
    row.tabIndex = 0;
    row.addEventListener('click', () => selectPoolEntity({ type: 'audio-source', id: source.id }));
    row.addEventListener('contextmenu', (event) => showAudioSourceContextMenu(event, source));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPoolEntity({ type: 'audio-source', id: source.id });
      }
    });
    const status = document.createElement('span');
    status.className = `status-dot ${source.ready ? 'ready' : source.error ? 'blocked' : 'standby'}`;
    const label = document.createElement('strong');
    label.textContent = source.label;
    const origin = source.type === 'external-file' ? source.path ?? 'External file' : `Embedded from ${state.visuals[source.visualId]?.label ?? source.visualId}`;
    const meta = document.createElement('span');
    meta.className = 'asset-meta';
    const marker = document.createElement('span');
    marker.className = `asset-marker ${source.type === 'embedded-visual' && source.extractionMode === 'representation' ? 'representation' : 'file'}`;
    marker.textContent = source.type === 'embedded-visual' && source.extractionMode === 'representation' ? 'REP' : 'FILE';
    const metaPrimary = document.createElement('span');
    metaPrimary.textContent = `${source.type === 'external-file' ? 'external' : 'embedded'}${formatAudioChannelLabel(source)} | ${formatDuration(source.durationSeconds)}`;
    const metaOrigin = document.createElement('span');
    metaOrigin.textContent = origin;
    meta.append(metaPrimary, metaOrigin);
    const rightMeta = document.createElement('div');
    rightMeta.className = 'asset-row-meta-cluster';
    rightMeta.append(marker, meta);
    const remove = createButton('Remove', 'secondary row-action', async () => {
      if (!confirmPoolRecordRemoval(source.label)) {
        return;
      }
      await window.xtream.audioSources.remove(source.id);
      options.clearSelectionIf({ type: 'audio-source', id: source.id });
      const state = await window.xtream.director.getState();
      render(state);
      options.renderState(state);
    });
    decorateIconButton(remove, 'X', `Remove ${source.label} from pool`);
    remove.addEventListener('click', (event) => event.stopPropagation());
    row.append(status, label, rightMeta, remove);
    return row;
  }

  function selectPoolEntity(entity: SelectedEntity): void {
    options.setSelectedEntity(entity);
    selectEntityPoolTab(entity);
    const state = options.getState();
    if (state) {
      options.renderState(state);
    }
  }

  function selectEntityPoolTab(entity: SelectedEntity): void {
    if (entity.type === 'visual') {
      activePoolTab = 'visuals';
    }
    if (entity.type === 'audio-source') {
      activePoolTab = 'audio';
    }
  }

  function confirmPoolRecordRemoval(label: string): boolean {
    return window.confirm(
      `Remove "${label}" from the media pool?\n\nThis only removes the project record from the pool. It will not erase or delete the media file from disk.`,
    );
  }

  function showVisualContextMenu(event: MouseEvent, visual: VisualState): void {
    if (visual.kind === 'live' || visual.type !== 'video') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (options.getState()?.paused === false) {
      options.setShowStatus('Pause the timeline before extracting embedded audio.');
      return;
    }
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const representationButton = createButton('Extract as representation', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      await options.createEmbeddedAudioRepresentation(visual.id);
    });
    representationButton.setAttribute('role', 'menuitem');
    const fileButton = createButton('Extract audio as file', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      await options.extractEmbeddedAudioFile(visual.id);
    });
    fileButton.setAttribute('role', 'menuitem');
    if (!visual.hasEmbeddedAudio) {
      representationButton.disabled = true;
      fileButton.disabled = true;
      representationButton.title = 'No embedded audio track has been detected for this visual.';
      fileButton.title = representationButton.title;
    }
    const isLongVideo = (visual.durationSeconds ?? 0) > LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS;
    if (isLongVideo) {
      if (!fileButton.disabled) {
        fileButton.title = 'Long videos use extracted audio files for more stable playback.';
      }
      menu.append(fileButton);
    } else {
      menu.append(representationButton, fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeAudioSourceMenu = menu;
  }

  function showAudioSourceContextMenu(event: MouseEvent, source: AudioSourceState): void {
    event.preventDefault();
    event.stopPropagation();
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const splitButton = createButton('Split to mono', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      try {
        const [left] = await window.xtream.audioSources.splitStereo(source.id);
        options.setSelectedEntity({ type: 'audio-source', id: left.id });
        options.renderState(await window.xtream.director.getState());
        options.setShowStatus(`Split ${source.label} into virtual L/R mono sources.`);
      } catch (error: unknown) {
        options.setShowStatus(error instanceof Error ? error.message : 'Unable to split this audio source.');
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
        dismissAudioSourceContextMenu();
        if (options.getState()?.paused === false) {
          options.setShowStatus('Pause the timeline before extracting embedded audio.');
          return;
        }
        await options.extractEmbeddedAudioFile(source.visualId);
      });
      fileButton.setAttribute('role', 'menuitem');
      if (options.getState()?.paused === false) {
        fileButton.disabled = true;
        fileButton.title = 'Pause the timeline before extracting embedded audio.';
      }
      menu.append(fileButton);
    }
    document.body.append(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    activeAudioSourceMenu = menu;
  }

  function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
    const menuBounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, window.innerWidth - menuBounds.width - 4)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - menuBounds.height - 4)}px`;
  }

  function dismissAudioSourceContextMenu(): void {
    activeAudioSourceMenu?.remove();
    activeAudioSourceMenu = undefined;
  }

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
    options.setShowStatus(`Adding live webcam: ${webcam.label || 'Webcam'}.`);
    const visual = await window.xtream.liveCapture.create({
      label: webcam.label || 'Webcam',
      capture: {
        source: 'webcam',
        deviceId: webcam.deviceId,
        groupId: webcam.groupId,
        label: webcam.label || 'Webcam',
      },
    });
    options.setSelectedEntity({ type: 'visual', id: visual.id });
    options.renderState(await window.xtream.director.getState());
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
    options.setShowStatus(`Adding live ${kind === 'screen' ? 'screen' : 'window'}: ${source.name}.`);
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
    options.setSelectedEntity({ type: 'visual', id: visual.id });
    options.renderState(await window.xtream.director.getState());
  }

  function showAddVisualsMenu(): void {
    dismissAudioSourceContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu audio-source-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    const localFiles = createButton('Local static files', 'secondary context-menu-item', async () => {
      dismissAudioSourceContextMenu();
      const visuals = await window.xtream.visuals.add();
      options.queueEmbeddedAudioImportPrompt(visuals);
      visuals?.forEach(options.probeVisualMetadata);
      if (visuals?.[0]) {
        options.setSelectedEntity({ type: 'visual', id: visuals[0].id });
      }
      options.renderState(await window.xtream.director.getState());
    });
    localFiles.setAttribute('role', 'menuitem');
    const liveStream = createButton('Add Live Stream', 'secondary context-menu-item', () => showLiveSourceMenu(menu));
    liveStream.setAttribute('role', 'menuitem');
    menu.append(localFiles, liveStream);
    document.body.append(menu);
    const bounds = elements.addVisualsButton.getBoundingClientRect();
    positionContextMenu(menu, bounds.left, bounds.bottom + 4);
    activeAudioSourceMenu = menu;
  }

  function showLiveSourceMenu(previousMenu?: HTMLElement): void {
    previousMenu?.remove();
    activeAudioSourceMenu = undefined;
    openLiveCaptureModal();
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

  function getFilteredVisuals(visuals: VisualState[]): VisualState[] {
    return visuals.filter(matchesPoolQuery).sort(comparePoolItems);
  }

  function getFilteredAudioSources(sources: AudioSourceState[], state: DirectorState): AudioSourceState[] {
    return sources
      .filter((source) => {
        const haystack =
          source.type === 'external-file'
            ? `${source.label} ${source.path ?? ''}`
            : `${source.label} ${state.visuals[source.visualId]?.label ?? source.visualId}`;
        return matchesQuery(haystack);
      })
      .sort(comparePoolItems);
  }

  function matchesPoolQuery(item: VisualState | AudioSourceState): boolean {
    const haystack = 'path' in item ? `${item.label} ${item.path ?? ''} ${item.type}` : `${item.label} ${item.type}`;
    return matchesQuery(haystack);
  }

  function matchesQuery(haystack: string): boolean {
    return haystack.toLowerCase().includes(poolSearchQuery.trim().toLowerCase());
  }

  function comparePoolItems<T extends { label: string; ready: boolean; durationSeconds?: number }>(left: T, right: T): number {
    if (poolSort === 'duration') {
      return (left.durationSeconds ?? Number.POSITIVE_INFINITY) - (right.durationSeconds ?? Number.POSITIVE_INFINITY);
    }
    if (poolSort === 'status') {
      return Number(right.ready) - Number(left.ready) || left.label.localeCompare(right.label);
    }
    return left.label.localeCompare(right.label);
  }

  function syncPoolTabs(): void {
    const visualActive = activePoolTab === 'visuals';
    elements.visualTabButton.classList.toggle('active', visualActive);
    elements.visualTabButton.setAttribute('aria-selected', String(visualActive));
    elements.audioTabButton.classList.toggle('active', !visualActive);
    elements.audioTabButton.setAttribute('aria-selected', String(!visualActive));
    elements.addVisualsButton.title = visualActive ? 'Add visuals' : 'Add external audio';
    elements.addVisualsButton.setAttribute('aria-label', visualActive ? 'Add visuals' : 'Add external audio');
  }

  function setPoolTab(tab: PoolTab): void {
    activePoolTab = tab;
    renderCurrentState();
  }

  function renderCurrentState(): void {
    const state = options.getState();
    if (state) {
      options.renderState(state);
    }
  }

  function isFileDragEvent(event: DragEvent): boolean {
    return Boolean(event.dataTransfer?.types?.includes('Files'));
  }

  function getDroppedFilePaths(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) {
      return [];
    }
    const files = [
      ...Array.from(dataTransfer.files),
      ...Array.from(dataTransfer.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file)),
    ];
    const paths = files.map(getPathForDroppedFile).filter((path): path is string => Boolean(path));
    const uriListPaths = parseDroppedFileUriList(dataTransfer.getData('text/uri-list'));
    return Array.from(new Set([...paths, ...uriListPaths]));
  }

  function getPathForDroppedFile(file: File): string | undefined {
    const path = window.xtream.platform.getPathForFile(file) || (file as File & { path?: string }).path;
    return path || undefined;
  }

  function parseDroppedFileUriList(uriList: string): string[] {
    return uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(fileUriToPath)
      .filter((path): path is string => Boolean(path));
  }

  function fileUriToPath(uri: string): string | undefined {
    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:') {
        return undefined;
      }
      const decodedPath = decodeURIComponent(url.pathname);
      const pathWithHost = url.hostname ? `//${url.hostname}${decodedPath}` : decodedPath;
      if (navigator.platform.toLowerCase().startsWith('win')) {
        const windowsPath = pathWithHost.replace(/\//g, '\\');
        return windowsPath.replace(/^\\([A-Za-z]:\\)/, '$1');
      }
      return pathWithHost;
    } catch {
      return undefined;
    }
  }

  function clearMediaPoolDragOver(event: DragEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && elements.mediaPoolPanel.contains(next)) {
      return;
    }
    elements.mediaPoolPanel.classList.remove('drag-over');
  }

  function install(): void {
    elements.visualTabButton.addEventListener('click', () => setPoolTab('visuals'));
    elements.audioTabButton.addEventListener('click', () => setPoolTab('audio'));
    elements.poolSearchInput.addEventListener('input', () => {
      poolSearchQuery = elements.poolSearchInput.value;
      renderCurrentState();
    });
    elements.poolSortSelect.addEventListener('change', () => {
      poolSort = elements.poolSortSelect.value as PoolSort;
      renderCurrentState();
    });
    elements.mediaPoolPanel.addEventListener('dragover', (event) => {
      if (!isFileDragEvent(event)) {
        return;
      }
      event.preventDefault();
      elements.mediaPoolPanel.classList.add('drag-over');
    });
    elements.mediaPoolPanel.addEventListener('dragleave', clearMediaPoolDragOver);
    elements.mediaPoolPanel.addEventListener('drop', async (event) => {
      event.preventDefault();
      elements.mediaPoolPanel.classList.remove('drag-over');
      const paths = getDroppedFilePaths(event.dataTransfer);
      if (paths.length === 0) {
        options.setShowStatus('Drop import unavailable: no file paths were exposed by the platform.');
        return;
      }
      if (activePoolTab === 'visuals') {
        const visuals = await window.xtream.visuals.addDropped(paths);
        options.queueEmbeddedAudioImportPrompt(visuals);
        visuals.forEach(options.probeVisualMetadata);
        if (visuals[0]) {
          options.setSelectedEntity({ type: 'visual', id: visuals[0].id });
        }
      } else {
        const sources = await window.xtream.audioSources.addDropped(paths);
        if (sources[0]) {
          options.setSelectedEntity({ type: 'audio-source', id: sources[0].id });
        }
      }
      options.renderState(await window.xtream.director.getState());
    });
    elements.addVisualsButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (activePoolTab === 'audio') {
        const source = await window.xtream.audioSources.addFile();
        if (source) {
          options.setSelectedEntity({ type: 'audio-source', id: source.id });
        }
        options.renderState(await window.xtream.director.getState());
      } else {
        showAddVisualsMenu();
      }
    });
    document.addEventListener('click', dismissAudioSourceContextMenu);
    window.addEventListener('blur', dismissAudioSourceContextMenu);
  }

  return {
    createRenderSignature,
    render,
    selectEntityPoolTab,
    dismissContextMenu: dismissAudioSourceContextMenu,
    install,
  };
}

function createVisualRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) => ({
        id: visual.id,
        label: visual.label,
        type: visual.type,
        path: visual.path,
        url: visual.url,
        ready: visual.ready,
        error: visual.error,
        durationSeconds: visual.durationSeconds,
        width: visual.width,
        height: visual.height,
        hasEmbeddedAudio: visual.hasEmbeddedAudio,
        kind: visual.kind,
        capture: visual.kind === 'live' ? visual.capture : undefined,
        opacity: visual.opacity,
        brightness: visual.brightness,
        contrast: visual.contrast,
        playbackRate: visual.playbackRate,
        fileSizeBytes: visual.fileSizeBytes,
      })),
  );
}

function createAudioRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.audioSources)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => ({
        id: source.id,
        label: source.label,
        type: source.type,
        durationSeconds: source.durationSeconds,
        ready: source.ready,
        error: source.error,
        fileSizeBytes: source.fileSizeBytes,
        playbackRate: source.playbackRate,
        levelDb: source.levelDb,
        channelCount: source.channelCount,
        channelMode: source.channelMode,
        derivedFromAudioSourceId: source.derivedFromAudioSourceId,
        ...(source.type === 'external-file'
          ? {
              path: source.path,
              url: source.url,
            }
          : {
              visualId: source.visualId,
              extractionMode: source.extractionMode,
              extractionStatus: source.extractionStatus,
              extractedPath: source.extractedPath,
              extractedUrl: source.extractedUrl,
              extractedFormat: source.extractedFormat,
              visualLabel: state.visuals[source.visualId]?.label,
            }),
      })),
  );
}
