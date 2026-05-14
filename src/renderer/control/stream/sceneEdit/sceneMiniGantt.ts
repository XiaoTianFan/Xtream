import type { DirectorState, PersistedSceneConfig, SceneLoopPolicy, SubCueId } from '../../../../shared/types';
import { createButton, createSelect } from '../../shared/dom';
import { decorateIconButton } from '../../shared/icons';
import { createStreamDetailField } from '../streamDom';
import {
  createSubCueFieldGrid,
  createSubCueToggleButton,
  createSubCueToggleRow,
} from './subCueFormControls';
import { deriveSceneMiniGanttProjection, type SceneMiniGanttProjection, type SceneMiniGanttRowProjection } from './sceneMiniGanttProjection';

export type SceneMiniGanttDeps = {
  scene: PersistedSceneConfig;
  currentState: DirectorState | undefined;
  removeSubCue: (subCueId: SubCueId) => void;
  requestRender: () => void;
  editsDisabled?: boolean;
};

const DEFAULT_SCENE_MINI_GANTT_ZOOM = 1;
const MIN_SCENE_MINI_GANTT_ZOOM = 0.05;
const MAX_SCENE_MINI_GANTT_ZOOM = 4;
const SCENE_MINI_GANTT_WHEEL_ZOOM_FACTOR = 1.12;

let activeSceneMiniGanttMenu: HTMLElement | undefined;

function dismissSceneMiniGanttMenu(): void {
  activeSceneMiniGanttMenu?.remove();
  activeSceneMiniGanttMenu = undefined;
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - bounds.width - 4)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - bounds.height - 4)}px`;
}

function ensureMenuDismissListeners(): void {
  document.addEventListener('click', dismissSceneMiniGanttMenu, { once: true });
  window.addEventListener('blur', dismissSceneMiniGanttMenu, { once: true });
}

function clampZoom(value: number, minZoom = MIN_SCENE_MINI_GANTT_ZOOM): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCENE_MINI_GANTT_ZOOM;
  }
  return Math.max(minZoom, Math.min(MAX_SCENE_MINI_GANTT_ZOOM, value));
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function selectControl(wrapper: HTMLElement): HTMLSelectElement | undefined {
  return wrapper.querySelector('select') ?? undefined;
}

function setDisabled(control: HTMLElement, disabled: boolean): void {
  for (const el of control.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
    el.disabled = disabled;
  }
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'stream-scene-mini-gantt-empty';
  const title = document.createElement('strong');
  title.textContent = 'No sub-cues';
  const detail = document.createElement('span');
  detail.textContent = 'Add audio, visual, or control sub-cues to build this scene.';
  empty.append(title, detail);
  return empty;
}

function showBlockContextMenu(event: MouseEvent, row: SceneMiniGanttRowProjection, deps: SceneMiniGanttDeps): void {
  event.preventDefault();
  event.stopPropagation();
  dismissSceneMiniGanttMenu();
  ensureMenuDismissListeners();

  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu stream-scene-mini-gantt-menu';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('click', (e) => e.stopPropagation());

  const remove = createButton('Remove', 'secondary context-menu-item', () => {
    if (deps.editsDisabled) {
      return;
    }
    dismissSceneMiniGanttMenu();
    deps.removeSubCue(row.subCueId);
  });
  remove.setAttribute('role', 'menuitem');
  remove.disabled = deps.editsDisabled === true;
  menu.append(remove);
  document.body.append(menu);
  positionMenu(menu, event.clientX, event.clientY);
  activeSceneMiniGanttMenu = menu;
}

function createBar(row: SceneMiniGanttRowProjection, deps: SceneMiniGanttDeps): HTMLElement {
  const bar = document.createElement('div');
  bar.className = `stream-scene-mini-gantt-bar kind-${row.kind}${row.unbounded ? ' is-infinite' : ''}`;
  bar.dataset.subCueId = row.subCueId;
  bar.style.left = `${row.leftPercent.toFixed(3)}%`;
  bar.style.width = `${row.widthPercent.toFixed(3)}%`;
  bar.title = `${row.title} | ${row.timeLabel}${row.unbounded ? ' | infinite' : ''}`;
  bar.addEventListener('contextmenu', (event) => showBlockContextMenu(event, row, deps));

  const title = document.createElement('span');
  title.className = 'stream-scene-mini-gantt-bar-title';
  title.textContent = row.title;
  const meta = document.createElement('span');
  meta.className = 'stream-scene-mini-gantt-bar-meta';
  meta.textContent = row.timeLabel;
  bar.append(title, meta);
  return bar;
}

function createRow(row: SceneMiniGanttRowProjection, projection: SceneMiniGanttProjection, deps: SceneMiniGanttDeps): HTMLElement {
  const el = document.createElement('section');
  el.className = `stream-scene-mini-gantt-row kind-${row.kind}${row.unbounded ? ' is-infinite' : ''}`;
  el.dataset.sceneMiniGanttRow = row.id;
  el.dataset.baseMinWidthPx = String(projection.minWidthPx);
  el.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  el.style.minWidth = `${projection.minWidthPx}px`;

  const header = document.createElement('div');
  header.className = 'stream-scene-mini-gantt-row-header';
  const title = document.createElement('strong');
  title.textContent = row.title;
  const meta = document.createElement('span');
  meta.className = 'stream-scene-mini-gantt-row-meta';
  meta.textContent = row.metaLabel;
  const time = document.createElement('span');
  time.className = 'stream-scene-mini-gantt-row-time';
  time.textContent = row.timeLabel;
  header.append(title, meta, time);

  const track = document.createElement('div');
  track.className = 'stream-scene-mini-gantt-track';
  track.dataset.baseTrackWidthPx = String(projection.trackMinWidthPx);
  track.style.minWidth = `${projection.trackMinWidthPx}px`;
  track.append(createBar(row, deps));
  el.append(header, track);
  return el;
}

function measureFit(root: HTMLElement): { zoom: number; fixedWidth: number } | undefined {
  const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body');
  if (!body || body.clientWidth <= 0) {
    return undefined;
  }
  let longestTrackWidth = 0;
  let fixedWidth = 0;
  for (const row of root.querySelectorAll<HTMLElement>('.stream-scene-mini-gantt-row')) {
    const baseMinWidth = Number(row.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(row.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    longestTrackWidth = Math.max(longestTrackWidth, baseTrackWidth);
    fixedWidth = Math.max(fixedWidth, baseMinWidth - baseTrackWidth);
  }
  if (longestTrackWidth <= 0) {
    return undefined;
  }
  return {
    zoom: Math.max(1, body.clientWidth - fixedWidth) / longestTrackWidth,
    fixedWidth,
  };
}

function getMinimumZoom(root: HTMLElement): number {
  const fit = measureFit(root);
  return fit ? clampZoom(fit.zoom, MIN_SCENE_MINI_GANTT_ZOOM) : MIN_SCENE_MINI_GANTT_ZOOM;
}

function getRootZoom(root: HTMLElement): number {
  return clampZoom(Number(root.dataset.sceneMiniGanttZoom ?? DEFAULT_SCENE_MINI_GANTT_ZOOM), getMinimumZoom(root));
}

function applyZoom(root: HTMLElement, zoom = getRootZoom(root)): void {
  const nextZoom = clampZoom(zoom, getMinimumZoom(root));
  root.dataset.sceneMiniGanttZoom = String(nextZoom);
  for (const row of root.querySelectorAll<HTMLElement>('.stream-scene-mini-gantt-row')) {
    const baseMinWidth = Number(row.dataset.baseMinWidthPx);
    const baseTrackWidth = Number(row.dataset.baseTrackWidthPx);
    if (!Number.isFinite(baseMinWidth) || !Number.isFinite(baseTrackWidth)) {
      continue;
    }
    const fixedWidth = Math.max(0, baseMinWidth - baseTrackWidth);
    const zoomedTrackWidth = baseTrackWidth * nextZoom;
    row.style.minWidth = px(fixedWidth + zoomedTrackWidth);
    const track = row.querySelector<HTMLElement>('.stream-scene-mini-gantt-track');
    if (track) {
      track.style.minWidth = px(zoomedTrackWidth);
    }
  }
}

function fitToContent(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return;
  }
  root.dataset.sceneMiniGanttUserZoomed = 'true';
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
}

function autoFitFullRange(root: HTMLElement): boolean {
  if (root.dataset.sceneMiniGanttUserZoomed === 'true') {
    return false;
  }
  const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body');
  const fit = measureFit(root);
  if (!body || !fit) {
    return false;
  }
  applyZoom(root, fit.zoom);
  body.scrollLeft = 0;
  return true;
}

function queueAutoFitFullRange(root: HTMLElement): void {
  if (root.dataset.sceneMiniGanttUserZoomed === 'true' || root.dataset.sceneMiniGanttFitScheduled === 'true') {
    return;
  }
  root.dataset.sceneMiniGanttFitScheduled = 'true';
  requestAnimationFrame(() => {
    delete root.dataset.sceneMiniGanttFitScheduled;
    if (root.isConnected) {
      autoFitFullRange(root);
    }
  });
}

function handleWheel(root: HTMLElement, event: WheelEvent): void {
  if (!event.ctrlKey) {
    return;
  }
  event.preventDefault();
  const body = event.currentTarget instanceof HTMLElement ? event.currentTarget : root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body');
  if (!body) {
    return;
  }
  const previousZoom = getRootZoom(root);
  const nextZoom = clampZoom(
    previousZoom * (event.deltaY < 0 ? SCENE_MINI_GANTT_WHEEL_ZOOM_FACTOR : 1 / SCENE_MINI_GANTT_WHEEL_ZOOM_FACTOR),
    getMinimumZoom(root),
  );
  if (nextZoom === previousZoom) {
    return;
  }
  const bounds = body.getBoundingClientRect();
  const pointerX = Math.max(0, Math.min(body.clientWidth || bounds.width, event.clientX - bounds.left));
  const logicalX = (body.scrollLeft + pointerX) / previousZoom;
  root.dataset.sceneMiniGanttUserZoomed = 'true';
  applyZoom(root, nextZoom);
  body.scrollLeft = Math.max(0, logicalX * nextZoom - pointerX);
}

function createToolbar(root: HTMLElement): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'stream-scene-mini-gantt-toolbar';
  const title = document.createElement('h3');
  title.textContent = 'Scene Timeline';
  const fit = createButton('', 'icon-button stream-scene-mini-gantt-fit-button', () => fitToContent(root));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  toolbar.append(title, fit);
  return toolbar;
}

function setFitButtonEnabled(root: HTMLElement): void {
  const fit = root.querySelector<HTMLButtonElement>('.stream-scene-mini-gantt-fit-button');
  if (fit) {
    fit.disabled = root.querySelector('.stream-scene-mini-gantt-row') === null;
  }
}

function renderBody(root: HTMLElement, deps: SceneMiniGanttDeps): void {
  const body = root.querySelector<HTMLElement>('.stream-scene-mini-gantt-body');
  if (!body) {
    return;
  }
  const projection = deriveSceneMiniGanttProjection({ scene: deps.scene, currentState: deps.currentState });
  if (projection.status === 'empty') {
    body.classList.add('stream-scene-mini-gantt-body--empty');
    body.replaceChildren(createEmptyState());
    setFitButtonEnabled(root);
    return;
  }
  body.classList.remove('stream-scene-mini-gantt-body--empty');
  body.replaceChildren(...projection.rows.map((row) => createRow(row, projection, deps)));
  if (!autoFitFullRange(root)) {
    applyZoom(root);
  }
  queueAutoFitFullRange(root);
  setFitButtonEnabled(root);
}

function updateSceneLoop(scene: PersistedSceneConfig, loop: SceneLoopPolicy): void {
  void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { loop } });
}

function createLoopAndPreloadControls(deps: SceneMiniGanttDeps): HTMLElement {
  const { scene, editsDisabled = false } = deps;
  const controls = document.createElement('div');
  controls.className = 'stream-scene-mini-gantt-controls';

  const loopEnabled = scene.loop.enabled;
  const preloadEnabled = scene.preload.enabled;
  const iterationType = loopEnabled ? scene.loop.iterations.type : 'count';
  const loopCount = loopEnabled && scene.loop.iterations.type === 'count' ? scene.loop.iterations.count : 1;

  const loopToggle = createSubCueToggleButton('Scene loop', loopEnabled, (enabled) => {
    const next: SceneLoopPolicy = enabled
      ? scene.loop.enabled
        ? scene.loop
        : { enabled: true, iterations: { type: 'count', count: 1 } }
      : { enabled: false };
    updateSceneLoop(scene, next);
  });
  loopToggle.disabled = editsDisabled;

  const preloadToggle = createSubCueToggleButton('Preload', preloadEnabled, (enabled) => {
    void window.xtream.stream.edit({
      type: 'update-scene',
      sceneId: scene.id,
      update: { preload: { enabled, leadTimeMs: scene.preload.leadTimeMs } },
    });
  });
  preloadToggle.disabled = editsDisabled;

  const iterTypeSelect = createSelect(
    'Loop iterations',
    [
      ['count', 'Count'],
      ['infinite', 'Infinite'],
    ],
    iterationType,
    (value) => {
      if (!scene.loop.enabled) {
        return;
      }
      const iterations =
        value === 'infinite'
          ? ({ type: 'infinite' } as const)
          : { type: 'count' as const, count: scene.loop.iterations.type === 'count' ? scene.loop.iterations.count : 1 };
      updateSceneLoop(scene, { ...scene.loop, iterations });
    },
  );
  selectControl(iterTypeSelect)!.disabled = editsDisabled || !loopEnabled;

  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '1';
  countInput.step = '1';
  countInput.className = 'label-input';
  countInput.value = String(loopCount);
  countInput.disabled = editsDisabled || !loopEnabled || iterationType !== 'count';
  countInput.addEventListener('change', () => {
    if (!scene.loop.enabled || scene.loop.iterations.type !== 'count') {
      return;
    }
    const count = Math.max(1, Math.floor(Number(countInput.value) || 1));
    updateSceneLoop(scene, { ...scene.loop, iterations: { type: 'count', count } });
  });
  const countField = createStreamDetailField('Loop count', countInput);

  const rangeStart = document.createElement('input');
  rangeStart.type = 'number';
  rangeStart.min = '0';
  rangeStart.step = '100';
  rangeStart.className = 'label-input';
  rangeStart.value = String(loopEnabled ? (scene.loop.range?.startMs ?? 0) : 0);
  rangeStart.disabled = editsDisabled || !loopEnabled;
  rangeStart.addEventListener('change', () => {
    if (!scene.loop.enabled) {
      return;
    }
    const startMs = Math.max(0, Number(rangeStart.value) || 0);
    updateSceneLoop(scene, { ...scene.loop, range: { startMs, endMs: scene.loop.range?.endMs } });
  });
  const rangeStartField = createStreamDetailField('Loop range start (ms)', rangeStart);

  const rangeEnd = document.createElement('input');
  rangeEnd.type = 'number';
  rangeEnd.min = '0';
  rangeEnd.step = '100';
  rangeEnd.className = 'label-input';
  rangeEnd.placeholder = 'optional end';
  rangeEnd.value = loopEnabled && scene.loop.range?.endMs !== undefined ? String(scene.loop.range.endMs) : '';
  rangeEnd.disabled = editsDisabled || !loopEnabled;
  rangeEnd.addEventListener('change', () => {
    if (!scene.loop.enabled) {
      return;
    }
    const raw = rangeEnd.value.trim();
    const endMs = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
    const startMs = scene.loop.range?.startMs ?? 0;
    updateSceneLoop(scene, { ...scene.loop, range: endMs !== undefined ? { startMs, endMs } : { startMs } });
  });
  const rangeEndField = createStreamDetailField('Loop range end (ms)', rangeEnd);

  const leadInput = document.createElement('input');
  leadInput.type = 'number';
  leadInput.min = '0';
  leadInput.step = '100';
  leadInput.className = 'label-input';
  leadInput.value = String(scene.preload.leadTimeMs ?? 0);
  leadInput.disabled = editsDisabled || !preloadEnabled;
  leadInput.addEventListener('change', () => {
    const leadTimeMs = Math.max(0, Number(leadInput.value) || 0);
    void window.xtream.stream.edit({
      type: 'update-scene',
      sceneId: scene.id,
      update: { preload: { enabled: true, leadTimeMs } },
    });
  });
  const leadField = createStreamDetailField('Preload lead time (ms)', leadInput);

  const toggleRow = createSubCueToggleRow(loopToggle, preloadToggle);
  const fields = createSubCueFieldGrid(iterTypeSelect, countField, rangeStartField, rangeEndField, leadField);
  if (editsDisabled) {
    setDisabled(fields, true);
  }
  controls.append(toggleRow, fields);
  return controls;
}

export function createSceneMiniGantt(deps: SceneMiniGanttDeps): HTMLElement {
  const root = document.createElement('section');
  root.className = 'stream-scene-mini-gantt-root';
  root.dataset.sceneMiniGanttZoom = String(DEFAULT_SCENE_MINI_GANTT_ZOOM);

  const body = document.createElement('div');
  body.className = 'stream-scene-mini-gantt-body';
  body.addEventListener('wheel', (event) => handleWheel(root, event), { passive: false });
  root.append(createToolbar(root), body, createLoopAndPreloadControls(deps));
  renderBody(root, deps);

  const destroyObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      dismissSceneMiniGanttMenu();
      destroyObserver.disconnect();
    }
  });
  destroyObserver.observe(document.body, { childList: true, subtree: true });

  return root;
}
