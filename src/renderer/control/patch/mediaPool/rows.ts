import type { AudioSourceState, DirectorState, VisualState } from '../../../../shared/types';
import {
  getAudioPoolPlacement,
  getVisualPoolPlacement,
  POOL_PLACEMENT_ABBREV,
  type PoolPlacementKind,
} from '../../../../shared/poolAssetPlacement';
import { createButton } from '../../shared/dom';
import { formatAudioChannelLabel, formatDuration } from '../../shared/formatters';
import { decorateIconButton } from '../../shared/icons';
import type { SelectedEntity } from '../../shared/types';
import { mountVisualPoolGridPreview } from '../visualPoolGridPreview';

type MediaPoolRowDeps = {
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  selectPoolEntity: (entity: SelectedEntity) => void;
  showVisualContextMenu: (event: MouseEvent, visual: VisualState) => void;
  showAudioSourceContextMenu: (event: MouseEvent, source: AudioSourceState) => void;
  getShowConfigPath: () => string | undefined;
  confirmPoolRecordRemoval: (label: string) => Promise<boolean>;
  clearSelectionIf: (entity: SelectedEntity) => void;
  renderPool: (state: DirectorState) => void;
  renderState: (state: DirectorState) => void;
  registerVisualPreviewCleanup: (cleanup: () => void) => void;
};

function isWindowsStylePath(): boolean {
  return typeof navigator !== 'undefined' && /Windows|Win32/i.test(navigator.userAgent);
}

function createPoolPlacementBadge(placement: PoolPlacementKind | undefined): HTMLElement {
  const el = document.createElement('span');
  el.className = 'asset-marker';
  if (!placement) {
    el.classList.add('asset-marker--empty');
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  el.classList.add(placement);
  el.textContent = POOL_PLACEMENT_ABBREV[placement];
  if (placement === 'representation') {
    el.title = 'Embedded playback from the video source';
  } else if (placement === 'file') {
    el.title = 'File is stored under this project’s assets folder';
  } else {
    el.title = 'Linked to the original file location';
  }
  return el;
}

export function createVisualRow(visual: VisualState, deps: MediaPoolRowDeps): HTMLElement {
  const row = document.createElement('article');
  row.className = `asset-row${deps.isSelected('visual', visual.id) ? ' selected' : ''}`;
  row.tabIndex = 0;
  row.dataset.assetId = visual.id;
  row.addEventListener('click', () => deps.selectPoolEntity({ type: 'visual', id: visual.id }));
  row.addEventListener('contextmenu', (event) => deps.showVisualContextMenu(event, visual));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      deps.selectPoolEntity({ type: 'visual', id: visual.id });
    }
  });
  const status = document.createElement('span');
  status.className = `asset-row__status status-dot ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
  const label = document.createElement('strong');
  label.className = 'asset-row__label';
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
  const placementBadge = createPoolPlacementBadge(
    getVisualPoolPlacement(visual, deps.getShowConfigPath(), isWindowsStylePath()),
  );
  const remove = createButton('Remove', 'secondary row-action', async () => {
    if (!(await deps.confirmPoolRecordRemoval(visual.label))) {
      return;
    }
    await window.xtream.visuals.remove(visual.id);
    deps.clearSelectionIf({ type: 'visual', id: visual.id });
    const state = await window.xtream.director.getState();
    deps.renderPool(state);
    deps.renderState(state);
  });
  decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
  remove.addEventListener('click', (event) => event.stopPropagation());
  const tail = document.createElement('div');
  tail.className = 'asset-row__tail';
  tail.append(placementBadge, remove);
  row.append(status, label, meta, tail);
  return row;
}

export function createVisualGridCard(visual: VisualState, deps: MediaPoolRowDeps): HTMLElement {
  const card = document.createElement('article');
  card.className = `visual-pool-card${deps.isSelected('visual', visual.id) ? ' selected' : ''}`;
  card.tabIndex = 0;
  card.dataset.assetId = visual.id;
  card.addEventListener('click', () => deps.selectPoolEntity({ type: 'visual', id: visual.id }));
  card.addEventListener('contextmenu', (event) => deps.showVisualContextMenu(event, visual));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      deps.selectPoolEntity({ type: 'visual', id: visual.id });
    }
  });
  if (visual.error) {
    card.title = visual.error;
  }

  const preview = document.createElement('div');
  preview.className = 'visual-pool-card__preview';
  mountVisualPoolGridPreview(
    preview,
    visual,
    deps.registerVisualPreviewCleanup,
    { livePoolPreviewGloballyAllowed: true },
  );

  const footer = document.createElement('div');
  footer.className = 'visual-pool-card__footer';
  const status = document.createElement('span');
  status.className = `status-dot visual-pool-card__status ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
  const label = document.createElement('strong');
  label.className = 'visual-pool-card__label';
  label.textContent = visual.label;
  const meta = document.createElement('span');
  meta.className = 'visual-pool-card__meta';
  meta.textContent =
    visual.kind === 'live'
      ? `live · ${visual.capture.source}`
      : `${visual.type} · ${formatDuration(visual.durationSeconds)}`;
  if (visual.error) {
    meta.title = visual.error;
  }
  const textCol = document.createElement('div');
  textCol.className = 'visual-pool-card__text';
  textCol.append(label, meta);
  const placementBadge = createPoolPlacementBadge(
    getVisualPoolPlacement(visual, deps.getShowConfigPath(), isWindowsStylePath()),
  );
  placementBadge.classList.add('visual-pool-card__placement-marker');
  const remove = createButton('Remove', 'secondary row-action', async () => {
    if (!(await deps.confirmPoolRecordRemoval(visual.label))) {
      return;
    }
    await window.xtream.visuals.remove(visual.id);
    deps.clearSelectionIf({ type: 'visual', id: visual.id });
    const nextState = await window.xtream.director.getState();
    deps.renderPool(nextState);
    deps.renderState(nextState);
  });
  decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
  remove.addEventListener('click', (event) => event.stopPropagation());
  const tail = document.createElement('div');
  tail.className = 'visual-pool-card__tail';
  tail.append(placementBadge, remove);
  footer.append(status, textCol, tail);
  card.append(preview, footer);
  return card;
}

export function createAudioSourceRow(source: AudioSourceState, state: DirectorState, deps: MediaPoolRowDeps): HTMLElement {
  const row = document.createElement('article');
  row.className = `asset-row${deps.isSelected('audio-source', source.id) ? ' selected' : ''}`;
  row.dataset.assetId = source.id;
  row.tabIndex = 0;
  row.addEventListener('click', () => deps.selectPoolEntity({ type: 'audio-source', id: source.id }));
  row.addEventListener('contextmenu', (event) => deps.showAudioSourceContextMenu(event, source));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      deps.selectPoolEntity({ type: 'audio-source', id: source.id });
    }
  });
  const status = document.createElement('span');
  status.className = `asset-row__status status-dot ${source.ready ? 'ready' : source.error ? 'blocked' : 'standby'}`;
  const label = document.createElement('strong');
  label.className = 'asset-row__label';
  label.textContent = source.label;
  const origin = source.type === 'external-file' ? source.path ?? 'External file' : `Embedded from ${state.visuals[source.visualId]?.label ?? source.visualId}`;
  const metaPrimary = document.createElement('span');
  metaPrimary.textContent = `${source.type === 'external-file' ? 'external' : 'embedded'}${formatAudioChannelLabel(source)} | ${formatDuration(source.durationSeconds)}`;
  const metaOrigin = document.createElement('span');
  metaOrigin.textContent = origin;
  const meta = document.createElement('span');
  meta.className = 'asset-meta';
  meta.append(metaPrimary, metaOrigin);
  const placementBadge = createPoolPlacementBadge(
    getAudioPoolPlacement(source, deps.getShowConfigPath(), isWindowsStylePath()),
  );
  const remove = createButton('Remove', 'secondary row-action', async () => {
    if (!(await deps.confirmPoolRecordRemoval(source.label))) {
      return;
    }
    await window.xtream.audioSources.remove(source.id);
    deps.clearSelectionIf({ type: 'audio-source', id: source.id });
    const nextState = await window.xtream.director.getState();
    deps.renderPool(nextState);
    deps.renderState(nextState);
  });
  decorateIconButton(remove, 'X', `Remove ${source.label} from pool`);
  remove.addEventListener('click', (event) => event.stopPropagation());
  const tail = document.createElement('div');
  tail.className = 'asset-row__tail';
  tail.append(placementBadge, remove);
  row.append(status, label, meta, tail);
  return row;
}
