import type { DirectorState, PersistedSceneConfig, SceneLoopPolicy, SubCueId } from '../../../../shared/types';
import { createButton } from '../../shared/dom';
import { decorateIconButton } from '../../shared/icons';
import { createStreamDetailField } from '../streamDom';
import { createSubCueFieldGrid } from './subCueFormControls';
import { createDraggableNumberField } from './draggableNumberField';
import { createInfinityNumberToggle, type InfinityNumberControl, type InfinityNumberValue } from './infinityNumberControl';
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

type LoopRangeField = HTMLElement & {
  sync: (loop: SceneLoopPolicy, disabled: boolean) => void;
};

type PreloadToggleField = HTMLElement & {
  sync: (enabled: boolean, disabled: boolean) => void;
};

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

function createFitButton(root: HTMLElement): HTMLButtonElement {
  const fit = createButton('', 'icon-button stream-scene-mini-gantt-fit-button', () => fitToContent(root));
  decorateIconButton(fit, 'Maximize2', 'Fit to content');
  return fit;
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

function sceneLoopIterationsValue(loop: SceneLoopPolicy): InfinityNumberValue {
  if (!loop.enabled) {
    return { type: 'count', count: 1 };
  }
  if (loop.iterations.type === 'infinite') {
    return { type: 'infinite' };
  }
  return { type: 'count', count: Math.max(1, Math.round(loop.iterations.count)) };
}

function sceneLoopPatchForIterations(scene: PersistedSceneConfig, value: InfinityNumberValue): SceneLoopPolicy {
  if (value.type === 'infinite') {
    return scene.loop.enabled
      ? { ...scene.loop, iterations: { type: 'infinite' } }
      : { enabled: true, iterations: { type: 'infinite' } };
  }
  const count = Math.max(1, Math.round(Number.isFinite(value.count) ? value.count : 1));
  if (count <= 1) {
    return { enabled: false };
  }
  return scene.loop.enabled
    ? { ...scene.loop, iterations: { type: 'count', count } }
    : { enabled: true, iterations: { type: 'count', count } };
}

function syncToggleButton(button: HTMLButtonElement, pressed: boolean, disabled: boolean): void {
  button.classList.toggle('active', pressed);
  button.setAttribute('aria-pressed', String(pressed));
  button.disabled = disabled;
}

function createPreloadToggleField(preloadEnabled: boolean, onToggle: (enabled: boolean) => void, editsDisabled: boolean): PreloadToggleField {
  const field = document.createElement('div') as unknown as PreloadToggleField;
  field.className = 'stream-scene-mini-gantt-preload-field';

  const preloadToggle = document.createElement('button');
  preloadToggle.type = 'button';
  preloadToggle.className = 'stream-subcue-toggle';
  preloadToggle.textContent = 'Preload';
  preloadToggle.addEventListener('click', () => {
    onToggle(preloadToggle.getAttribute('aria-pressed') !== 'true');
  });

  field.sync = (enabled, disabled) => syncToggleButton(preloadToggle, enabled, disabled);
  field.sync(preloadEnabled, editsDisabled);
  field.append(preloadToggle);
  return field;
}

function createLoopRangeField(loop: SceneLoopPolicy, onChange: (loop: SceneLoopPolicy) => void, editsDisabled: boolean): LoopRangeField {
  let currentLoop = loop;
  const wrap = document.createElement('div');
  wrap.className = 'stream-scene-loop-range';

  const label = document.createElement('span');
  label.className = 'stream-scene-loop-range-label';
  label.textContent = 'Loop range';

  const start = document.createElement('input');
  start.type = 'number';
  start.inputMode = 'numeric';
  start.min = '0';
  start.step = '100';
  start.className = 'label-input stream-scene-loop-range-input';
  start.placeholder = 'start';
  start.setAttribute('aria-label', 'Loop range start');
  start.addEventListener('change', () => {
    const loop = currentLoop;
    if (!loop.enabled) {
      return;
    }
    const startMs = Math.max(0, Math.round(Number(start.value) || 0));
    start.value = String(startMs);
    onChange({ ...loop, range: { startMs, endMs: loop.range?.endMs } });
  });

  const end = document.createElement('input');
  end.type = 'number';
  end.inputMode = 'numeric';
  end.min = '0';
  end.step = '100';
  end.className = 'label-input stream-scene-loop-range-input';
  end.placeholder = 'end';
  end.setAttribute('aria-label', 'Loop range end');
  end.addEventListener('change', () => {
    const loop = currentLoop;
    if (!loop.enabled) {
      return;
    }
    const raw = end.value.trim();
    const endMs = raw === '' ? undefined : Math.max(0, Math.round(Number(raw) || 0));
    end.value = endMs === undefined ? '' : String(endMs);
    const startMs = loop.range?.startMs ?? 0;
    onChange({ ...loop, range: endMs !== undefined ? { startMs, endMs } : { startMs } });
  });

  wrap.append(label, start, end);
  const field = createStreamDetailField('Loop range', wrap) as LoopRangeField;
  field.sync = (nextLoop, disabled) => {
    currentLoop = nextLoop;
    const activeLoop = nextLoop.enabled ? nextLoop : undefined;
    start.value = activeLoop ? String(activeLoop.range?.startMs ?? 0) : '';
    end.value = activeLoop?.range?.endMs !== undefined ? String(activeLoop.range.endMs) : '';
    start.disabled = disabled || !activeLoop;
    end.disabled = disabled || !activeLoop;
  };
  field.sync(loop, editsDisabled);
  return field;
}

function setDraggableNumberFieldDisabled(field: HTMLElement, disabled: boolean): void {
  const input = field.querySelector<HTMLInputElement>('input');
  const grip = field.querySelector<HTMLButtonElement>('.stream-draggable-number-grip');
  if (input) {
    input.disabled = disabled;
  }
  if (grip) {
    grip.disabled = disabled;
  }
}

function createLoopAndPreloadControls(deps: SceneMiniGanttDeps): HTMLElement {
  const { scene, editsDisabled = false } = deps;
  let draftScene = scene;
  const controls = document.createElement('div');
  controls.className = 'stream-scene-mini-gantt-controls';

  const patchScene = (update: Partial<PersistedSceneConfig>) => {
    draftScene = { ...draftScene, ...update };
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: draftScene.id, update });
  };

  let iterations: InfinityNumberControl;
  let rangeField: LoopRangeField;
  const syncLoopControls = (loop: SceneLoopPolicy) => {
    iterations.sync(sceneLoopIterationsValue(loop), { disabled: editsDisabled });
    rangeField.sync(loop, editsDisabled);
  };

  iterations = createInfinityNumberToggle(
    'Loop iterations',
    sceneLoopIterationsValue(draftScene.loop),
    (value) => {
      const loop = sceneLoopPatchForIterations(draftScene, value);
      patchScene({ loop });
      syncLoopControls(loop);
    },
    { min: 1, step: 1, disabled: editsDisabled },
  );

  rangeField = createLoopRangeField(draftScene.loop, (loop) => {
    patchScene({ loop });
    syncLoopControls(loop);
  }, editsDisabled);

  let preloadField: PreloadToggleField;
  let leadField: HTMLElement;
  const syncPreloadControls = (preload: PersistedSceneConfig['preload']) => {
    preloadField.sync(preload.enabled, editsDisabled);
    setDraggableNumberFieldDisabled(leadField, editsDisabled || !preload.enabled);
  };

  preloadField = createPreloadToggleField(draftScene.preload.enabled, (enabled) => {
    const preload = { enabled, leadTimeMs: draftScene.preload.leadTimeMs };
    patchScene({ preload });
    syncPreloadControls(preload);
  }, editsDisabled);

  leadField = createDraggableNumberField('Lead time', draftScene.preload.leadTimeMs ?? 0, (value) => {
    const leadTimeMs = Math.max(0, Math.round(value ?? 0));
    const preload = { enabled: true, leadTimeMs };
    patchScene({ preload });
    syncPreloadControls(preload);
  }, { min: 0, step: 100, dragStep: 5, integer: true, disabled: editsDisabled || !draftScene.preload.enabled, placeholder: '0' });

  const fields = createSubCueFieldGrid(iterations, rangeField, preloadField, leadField);
  controls.append(fields);
  return controls;
}

export function createSceneMiniGantt(deps: SceneMiniGanttDeps): HTMLElement {
  const root = document.createElement('section');
  root.className = 'stream-scene-mini-gantt-root';
  root.dataset.sceneMiniGanttZoom = String(DEFAULT_SCENE_MINI_GANTT_ZOOM);

  const body = document.createElement('div');
  body.className = 'stream-scene-mini-gantt-body';
  body.addEventListener('wheel', (event) => handleWheel(root, event), { passive: false });
  root.append(createFitButton(root), body, createLoopAndPreloadControls(deps));
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
