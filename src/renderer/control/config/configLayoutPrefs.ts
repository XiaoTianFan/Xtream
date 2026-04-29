import { setSeparatorAriaValue } from '../stream/layoutPrefs';

export const CONFIG_LAYOUT_PREF_KEY = 'xtream.control.config.layout.v1';

export type ConfigLayoutPrefs = {
  logPaneHeightPx?: number;
};

export type ConfigLayoutRefs = Partial<{
  root: HTMLElement;
  logPane: HTMLElement;
  configBottomSplitter: HTMLElement;
}>;

export function clampConfigLayout(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readConfigLayoutPrefs(): ConfigLayoutPrefs {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_LAYOUT_PREF_KEY) ?? '{}') as ConfigLayoutPrefs;
  } catch {
    return {};
  }
}

export function saveConfigLayoutPrefs(update: Partial<ConfigLayoutPrefs>): void {
  const prefs = { ...readConfigLayoutPrefs(), ...update };
  localStorage.setItem(CONFIG_LAYOUT_PREF_KEY, JSON.stringify(prefs));
}

export function applyConfigLayoutPrefs(refs: ConfigLayoutRefs, prefs: ConfigLayoutPrefs): void {
  const root = refs.root;
  if (!root) {
    return;
  }
  if (prefs.logPaneHeightPx !== undefined) {
    root.style.setProperty('--config-log-height', `${prefs.logPaneHeightPx}px`);
  }
}

/** Bottom pane height clamps (aligned with Stream bottom splitter). */
function configLogHeightBounds(root: HTMLElement): { min: number; max: number } {
  const frameH = root.getBoundingClientRect().height;
  const min = 220;
  const max = Math.max(260, frameH - 280);
  return { min, max };
}

export function syncConfigSplitterAria(refs: ConfigLayoutRefs): void {
  const root = refs.root;
  const bottom = refs.logPane;
  const splitter = refs.configBottomSplitter;
  if (!root || !bottom || !splitter) {
    return;
  }
  const { min, max } = configLogHeightBounds(root);
  const h = clampConfigLayout(bottom.getBoundingClientRect().height, min, max);
  setSeparatorAriaValue(splitter, 'horizontal', min, max, h);
}

function installSplitter(handle: HTMLElement, axis: 'x' | 'y', onDelta: (delta: number) => void): void {
  let start = 0;
  handle.addEventListener('pointerdown', (event) => {
    start = axis === 'x' ? event.clientX : event.clientY;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }
    const current = axis === 'x' ? event.clientX : event.clientY;
    onDelta(current - start);
    start = current;
  });
  const finish = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (axis === 'x' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowRight' ? step : -step);
    }
    if (axis === 'y' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowDown' ? step : -step);
    }
  });
}

export type ConfigLayoutController = {
  installSplitters: (requireRef: (name: string) => HTMLElement) => void;
  syncSplitterAria: () => void;
  savePrefs: (update: Partial<ConfigLayoutPrefs>) => void;
};

export function createConfigLayoutController(refs: ConfigLayoutRefs): ConfigLayoutController {
  function savePrefs(update: Partial<ConfigLayoutPrefs>): void {
    saveConfigLayoutPrefs(update);
    applyConfigLayoutPrefs(refs, readConfigLayoutPrefs());
    syncConfigSplitterAria(refs);
  }

  function installSplitters(requireRef: (name: string) => HTMLElement): void {
    installSplitter(requireRef('configBottomSplitter'), 'y', (delta) => {
      const bottom = requireRef('logPane');
      const root = requireRef('root');
      const { min, max } = configLogHeightBounds(root);
      const height = clampConfigLayout(bottom.getBoundingClientRect().height - delta, min, max);
      savePrefs({ logPaneHeightPx: height });
    });
    syncConfigSplitterAria(refs);
  }

  return {
    installSplitters,
    syncSplitterAria: () => syncConfigSplitterAria(refs),
    savePrefs,
  };
}
