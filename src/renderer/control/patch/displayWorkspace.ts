import { describeLayout } from '../../../shared/layouts';
import type { DirectorState, DisplayWindowId, DisplayWindowState, DisplayZoneId, VisualId, VisualLayoutProfile } from '../../../shared/types';
import {
  applyDisplayBlackoutFadeStyle,
  applyVisualStyle,
  createDisplayPreview,
  getPreviewVisualIds,
} from './displayPreview';
import { createButton, createSelect, setSelectEnabled } from '../shared/dom';
import { formatMilliseconds } from '../shared/formatters';
import type { SelectedEntity } from '../shared/types';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import { isMediaPoolDragEvent, readMediaPoolDragPayload } from './mediaPool/dragDrop';

export type DisplayWorkspaceController = {
  createRenderSignature: (state: DirectorState) => string;
  render: (displays: DisplayWindowState[]) => void;
  syncCardSummaries: (displays: DisplayWindowState[]) => void;
  getDisplayStatusLabel: (display: DisplayWindowState) => string;
  getDisplayTelemetry: (display: DisplayWindowState) => string;
  /** Single vs split layout only (no visual assignment pickers). */
  createLayoutControl: (display: DisplayWindowState, visualIds: VisualId[], enabled?: boolean) => HTMLDivElement;
  createMappingControls: (display: DisplayWindowState, visualIds: VisualId[], enabled?: boolean) => HTMLDivElement;
};

export type DisplayWorkspaceElements = {
  displayList: HTMLDivElement;
};

type DisplayWorkspaceControllerOptions = {
  getState: () => DirectorState | undefined;
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  selectEntity: (entity: SelectedEntity) => void;
  clearSelectionIf: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  setShowStatus?: (message: string) => void;
};

export function createDisplayWorkspaceController(elements: DisplayWorkspaceElements, options: DisplayWorkspaceControllerOptions): DisplayWorkspaceController {
  function render(displays: DisplayWindowState[]): void {
    elements.displayList.replaceChildren(
      ...displays.map((display) => {
        const card = document.createElement('article');
        card.className = `display-card monitor-card${options.isSelected('display', display.id) ? ' selected' : ''} ${getDisplayStatusClass(display)}`;
        card.dataset.displayCard = display.id;
        card.tabIndex = 0;
        card.addEventListener('click', () => options.selectEntity({ type: 'display', id: display.id }));
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            options.selectEntity({ type: 'display', id: display.id });
          }
        });
        const preview = createDisplayPreview(display, options.getState());
        preview.dataset.displayPreview = display.id;
        attachDisplayMediaDropHandlers(card, preview, display);
        const overlay = document.createElement('div');
        overlay.className = 'display-overlay';
        const title = document.createElement('strong');
        title.dataset.displayTitle = display.id;
        title.textContent = display.label ?? display.id;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.dataset.displayBadge = display.id;
        badge.textContent = getDisplayStatusLabel(display);
        overlay.append(title, badge);
        const telemetry = document.createElement('div');
        telemetry.className = 'display-telemetry';
        telemetry.dataset.displayDetails = display.id;
        telemetry.textContent = getDisplayCardTelemetry(display);
        const remove = createButton('Remove', 'secondary icon-button display-remove', async () => {
          if (!(await shellShowConfirm('Remove display?', `Remove ${display.id}?`))) {
            return;
          }
          await window.xtream.displays.close(display.id);
          await window.xtream.displays.remove(display.id);
          options.clearSelectionIf({ type: 'display', id: display.id });
          options.renderState(await window.xtream.director.getState());
        });
        remove.textContent = 'X';
        remove.title = `Remove ${display.id}`;
        remove.setAttribute('aria-label', `Remove ${display.id}`);
        remove.addEventListener('click', (event) => event.stopPropagation());
        card.append(preview, overlay, telemetry, remove);
        return card;
      }),
    );
  }

  function attachDisplayMediaDropHandlers(card: HTMLElement, preview: HTMLElement, display: DisplayWindowState): void {
    preview.querySelectorAll<HTMLElement>('[data-display-zone]').forEach((pane) => pane.classList.add('media-drop-target'));

    card.addEventListener('dragenter', (event) => {
      if (!isMediaPoolDragEvent(event)) {
        return;
      }
      event.preventDefault();
      syncDisplayDropOver(card, display, event);
    });
    card.addEventListener('dragover', (event) => {
      if (!isMediaPoolDragEvent(event)) {
        return;
      }
      event.preventDefault();
      const payload = readMediaPoolDragPayload(event.dataTransfer);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = payload?.type === 'visual' ? 'copy' : 'none';
      }
      syncDisplayDropOver(card, display, event);
    });
    card.addEventListener('dragleave', (event) => {
      if (!card.contains(event.relatedTarget as Node | null)) {
        clearDisplayDropOver(card);
      }
    });
    card.addEventListener('drop', (event) => {
      if (!isMediaPoolDragEvent(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const payload = readMediaPoolDragPayload(event.dataTransfer);
      const pane = resolveDisplayDropPane(card, display, event);
      clearDisplayDropOver(card);
      if (payload?.type !== 'visual') {
        options.setShowStatus?.('Drop a visual source here.');
        return;
      }
      const zoneId = getPaneDisplayZone(pane) ?? getDefaultDisplayDropZone(display, card);
      void assignVisualToDisplayZone(display.id, zoneId, payload.id);
    });
  }

  function syncDisplayDropOver(card: HTMLElement, display: DisplayWindowState, event: DragEvent): void {
    clearDisplayDropOver(card);
    const payload = readMediaPoolDragPayload(event.dataTransfer);
    if (payload?.type !== 'visual') {
      return;
    }
    const pane = resolveDisplayDropPane(card, display, event);
    pane?.classList.add('media-drop-over');
  }

  function clearDisplayDropOver(card: HTMLElement): void {
    card.querySelectorAll<HTMLElement>('.display-preview-pane.media-drop-over').forEach((pane) => pane.classList.remove('media-drop-over'));
  }

  function resolveDisplayDropPane(card: HTMLElement, display: DisplayWindowState, event: DragEvent): HTMLElement | undefined {
    const targetPane = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-display-zone]') : undefined;
    if (targetPane && card.contains(targetPane)) {
      return targetPane;
    }
    const hitElement = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? document.elementFromPoint(event.clientX, event.clientY)
      : undefined;
    const hitPane = hitElement?.closest<HTMLElement>('[data-display-zone]');
    if (hitPane && card.contains(hitPane)) {
      return hitPane;
    }
    const zoneId = getDefaultDisplayDropZone(display, card);
    return card.querySelector<HTMLElement>(`[data-display-zone="${zoneId}"]`) ?? undefined;
  }

  function getPaneDisplayZone(pane: HTMLElement | undefined): DisplayZoneId | undefined {
    const zone = pane?.dataset.displayZone;
    return zone === 'single' || zone === 'L' || zone === 'R' ? zone : undefined;
  }

  function getDefaultDisplayDropZone(display: DisplayWindowState, card: HTMLElement): DisplayZoneId {
    if (display.layout.type === 'single') {
      return 'single';
    }
    const firstEmptyPane = [...card.querySelectorAll<HTMLElement>('[data-display-zone]')].find((pane) => !pane.dataset.visualId);
    const firstEmptyZone = getPaneDisplayZone(firstEmptyPane);
    return firstEmptyZone && firstEmptyZone !== 'single' ? firstEmptyZone : 'L';
  }

  async function assignVisualToDisplayZone(displayId: DisplayWindowId, zoneId: DisplayZoneId, visualId: VisualId): Promise<void> {
    const rawState = await window.xtream.director.getState();
    const display = rawState.displays[displayId];
    if (!display) {
      options.setShowStatus?.('Display no longer exists.');
      return;
    }
    const visual = rawState.visuals[visualId];
    if (!visual) {
      options.setShowStatus?.('Visual source no longer exists.');
      return;
    }

    const layout = createDisplayLayoutForZone(display.layout, zoneId, visualId);
    await window.xtream.displays.update(displayId, { layout });
    const nextState = await window.xtream.director.getState();
    options.setShowStatus?.(`Assigned ${visual.label} to ${getDisplayAssignmentLabel(display, zoneId)}.`);
    options.renderState(nextState);
  }

  function createDisplayLayoutForZone(layout: VisualLayoutProfile, zoneId: DisplayZoneId, visualId: VisualId): VisualLayoutProfile {
    if (layout.type === 'single') {
      return { type: 'single', visualId };
    }
    const [left, right] = layout.visualIds;
    return zoneId === 'R'
      ? { type: 'split', visualIds: [left, visualId] }
      : { type: 'split', visualIds: [visualId, right] };
  }

  function getDisplayAssignmentLabel(display: DisplayWindowState, zoneId: DisplayZoneId): string {
    const label = display.label ?? display.id;
    if (display.layout.type === 'split') {
      return `${label} ${zoneId === 'R' ? 'right' : 'left'} zone`;
    }
    return label;
  }

  function createRenderSignature(state: DirectorState): string {
    const displayParts = Object.values(state.displays)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((display) => {
        const visualParts = getPreviewVisualIds(display.layout).map((visualId) => {
          const visual = state.visuals[visualId];
          return `${visualId}:${visual?.type ?? 'missing'}:${visual?.url ?? ''}:${visual?.durationSeconds ?? ''}:${visual?.playbackRate ?? 1}`;
        });
        return `${display.id}:${display.layout.type}:${JSON.stringify(display.layout)}:${visualParts.join(',')}`;
      });
    return `${state.performanceMode ? 'performance' : 'normal'}|${displayParts.join('|')}`;
  }

  function syncCardSummaries(displays: DisplayWindowState[]): void {
    for (const display of displays) {
      const card = elements.displayList.querySelector<HTMLElement>(`[data-display-card="${display.id}"]`);
      if (card) {
        card.classList.toggle('selected', options.isSelected('display', display.id));
        card.classList.remove('display-ready', 'display-standby', 'display-no-signal', 'display-degraded', 'display-closed');
        card.classList.add(getDisplayStatusClass(display));
      }
      const title = elements.displayList.querySelector<HTMLElement>(`[data-display-title="${display.id}"]`);
      if (title) {
        title.textContent = display.label ?? display.id;
      }
      const badge = elements.displayList.querySelector<HTMLElement>(`[data-display-badge="${display.id}"]`);
      if (badge) {
        badge.textContent = getDisplayStatusLabel(display);
      }
      const details = elements.displayList.querySelector<HTMLElement>(`[data-display-details="${display.id}"]`);
      if (details) {
        details.textContent = getDisplayCardTelemetry(display);
      }
      const preview = elements.displayList.querySelector<HTMLElement>(`[data-display-preview="${display.id}"]`);
      const state = options.getState();
      if (preview) {
        if (state) {
          applyDisplayBlackoutFadeStyle(preview, state.globalDisplayBlackoutFadeOutSeconds);
        }
        preview.classList.toggle('blacked-out', Boolean(state?.globalDisplayBlackout));
        for (const visualId of getPreviewVisualIds(display.layout)) {
          const visual = state?.visuals[visualId];
          if (!visual) {
            continue;
          }
          preview.querySelectorAll<HTMLElement>(`[data-visual-id="${visualId}"] img, [data-visual-id="${visualId}"] video`).forEach((element) => {
            applyVisualStyle(element, visual);
          });
        }
      }
    }
  }

  function getDisplayStatusLabel(display: DisplayWindowState): string {
    if (display.health === 'closed') {
      return 'Closed';
    }
    if (display.health === 'degraded' || display.health === 'stale') {
      return 'Degraded';
    }
    if (getPreviewVisualIds(display.layout).length > 0) {
      return options.getState()?.paused ? 'Standby' : 'Ready';
    }
    return 'No Signal';
  }

  function getDisplayStatusClass(display: DisplayWindowState): string {
    const label = getDisplayStatusLabel(display).toLowerCase().replace(/\s+/g, '-');
    return `display-${label}`;
  }

  function getDisplayTelemetry(display: DisplayWindowState): string {
    return `${describeLayout(display.layout)} | drift ${display.lastDriftSeconds?.toFixed(3) ?? '--'}s | raf ${
      display.lastFrameRateFps?.toFixed(1) ?? '--'
    } | video ${display.lastPresentedFrameRateFps?.toFixed(1) ?? '--'}fps | drop ${display.lastDroppedVideoFrames ?? '--'}/${
      display.lastTotalVideoFrames ?? '--'
    } | gap ${display.lastMaxVideoFrameGapMs?.toFixed(0) ?? '--'}ms | seeks ${display.lastMediaSeekCount ?? 0} | ${
      display.fullscreen ? 'fullscreen' : 'windowed'
    } | monitor ${display.displayId ?? 'default'}`;
  }

  function getDisplayCardTelemetry(display: DisplayWindowState): string {
    return `drift ${formatMilliseconds(display.lastDriftSeconds)} | video ${display.lastPresentedFrameRateFps?.toFixed(1) ?? '--'}fps | drop ${
      display.lastDroppedVideoFrames ?? '--'
    } | gap ${display.lastMaxVideoFrameGapMs?.toFixed(0) ?? '--'}ms | seeks ${display.lastMediaSeekCount ?? 0}`;
  }

  function createLayoutControl(display: DisplayWindowState, visualIds: VisualId[], enabled = true): HTMLDivElement {
    const layoutSelect = createSelect(
      'Layout',
      [
        ['single', 'Single visual'],
        ['split', 'Split visuals'],
      ],
      display.layout.type,
      (value) => {
        const nextLayout: VisualLayoutProfile =
          value === 'split'
            ? { type: 'split', visualIds: getSplitVisuals(display.layout, visualIds) }
            : { type: 'single', visualId: getPrimaryVisual(display.layout, visualIds) };
        void updateDisplayLayout(display.id, nextLayout);
      },
    );
    setSelectEnabled(layoutSelect, enabled);
    return layoutSelect;
  }

  function createMappingControls(display: DisplayWindowState, visualIds: VisualId[], enabled = true): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'mapping-grid';
    wrapper.append(createLayoutControl(display, visualIds, enabled));
    if (display.layout.type === 'single') {
      const visualSelect = createVisualPicker(
        'Visual',
        visualIds,
        display.layout.visualId ?? '',
        (visualId) => void updateDisplayLayout(display.id, { type: 'single', visualId }),
      );
      setVisualPickerEnabled(visualSelect, enabled);
      wrapper.append(visualSelect);
      return wrapper;
    }
    const [leftVisual, rightVisual] = display.layout.visualIds;
    const leftSelect = createVisualPicker('Left visual', visualIds, leftVisual ?? '', (visualId) => {
      void updateDisplayLayout(display.id, { type: 'split', visualIds: [visualId, rightVisual] });
    });
    const rightSelect = createVisualPicker('Right visual', visualIds, rightVisual ?? '', (visualId) => {
      void updateDisplayLayout(display.id, { type: 'split', visualIds: [leftVisual, visualId] });
    });
    setVisualPickerEnabled(leftSelect, enabled);
    setVisualPickerEnabled(rightSelect, enabled);
    wrapper.append(leftSelect, rightSelect);
    return wrapper;
  }

  function createVisualPicker(labelText: string, visualIds: VisualId[], value: string, onChange: (visualId: string) => void): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'mapping-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'search';
    const state = options.getState();
    input.value = value ? (state?.visuals[value]?.label ?? value) : '';
    input.placeholder = 'Search visuals';
    const dataList = document.createElement('datalist');
    dataList.id = `visual-picker-${labelText.toLowerCase().replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2)}`;
    for (const visualId of visualIds) {
      const option = document.createElement('option');
      option.value = state?.visuals[visualId]?.label ?? visualId;
      option.dataset.visualId = visualId;
      dataList.append(option);
    }
    input.setAttribute('list', dataList.id);
    input.addEventListener('change', () => {
      const query = input.value.trim().toLowerCase();
      const nextState = options.getState();
      const match = visualIds.find((visualId) => {
        const label = nextState?.visuals[visualId]?.label ?? visualId;
        return visualId.toLowerCase() === query || label.toLowerCase() === query;
      });
      if (match) {
        onChange(match);
      }
    });
    field.append(label, input, dataList);
    return field;
  }

  function setVisualPickerEnabled(wrapper: HTMLDivElement, enabled: boolean): void {
    const input = wrapper.querySelector('input');
    if (input) {
      input.disabled = !enabled;
    }
  }

  function getPrimaryVisual(layout: VisualLayoutProfile, visualIds: VisualId[]): VisualId | undefined {
    return layout.type === 'single' ? layout.visualId ?? visualIds[0] : layout.visualIds[0] ?? visualIds[0];
  }

  function getSplitVisuals(layout: VisualLayoutProfile, visualIds: VisualId[]): [VisualId | undefined, VisualId | undefined] {
    if (layout.type === 'split') {
      return layout.visualIds;
    }
    const left = layout.visualId ?? visualIds[0];
    const right = visualIds.find((visualId) => visualId !== left) ?? visualIds[1];
    return [left, right];
  }

  async function updateDisplayLayout(displayId: string, layout: VisualLayoutProfile): Promise<void> {
    const currentState = options.getState();
    const currentDisplay = currentState?.displays[displayId];
    if (currentDisplay) {
      syncCardSummaries(Object.values({ ...currentState.displays, [displayId]: { ...currentDisplay, layout } }));
    }
    await window.xtream.displays.update(displayId, { layout });
    options.renderState(await window.xtream.director.getState());
  }

  return {
    createRenderSignature,
    render,
    syncCardSummaries,
    getDisplayStatusLabel,
    getDisplayTelemetry,
    createLayoutControl,
    createMappingControls,
  };
}
