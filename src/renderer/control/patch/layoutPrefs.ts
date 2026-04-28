import { patchElements as elements } from './elements';
import type { LayoutPrefs } from '../shared/types';

const UI_PREF_KEY = 'xtream.control.layout.v1';

let mixerExpandedTemporarily = false;

export function installSplitters(): void {
  applyLayoutPrefs(readLayoutPrefs());
  window.addEventListener('resize', syncSplitterAria);
  installSplitter(elements.workspaceSplitter, 'x', (delta) => {
    const workspace = elements.workspaceSplitter.parentElement!;
    const current = readLayoutPrefs().mediaWidthPx ?? workspace.querySelector<HTMLElement>('.media-pool')!.getBoundingClientRect().width;
    saveLayoutPrefs({ mediaWidthPx: clamp(current + delta, 260, Math.max(320, workspace.getBoundingClientRect().width - 420)) });
  });
  installSplitter(elements.mainFooterSplitter, 'y', (delta) => {
    const frame = elements.mainFooterSplitter.parentElement!;
    const current = readLayoutPrefs().footerHeightPx ?? frame.querySelector<HTMLElement>('.operator-footer')!.getBoundingClientRect().height;
    saveLayoutPrefs({ footerHeightPx: clamp(current - delta, 180, Math.max(220, frame.getBoundingClientRect().height - 280)) });
  });
  installSplitter(elements.footerSplitter, 'x', (delta) => {
    const footer = elements.footerSplitter.parentElement!;
    const current = readLayoutPrefs().mixerWidthPx ?? footer.querySelector<HTMLElement>('.mixer-panel')!.getBoundingClientRect().width;
    saveLayoutPrefs({ mixerWidthPx: clamp(current + delta, 260, getMaxMixerWidth()) });
  });
  syncSplitterAria();
}

/** Focusable `role="separator"` splitters require aria-valuenow/min/max (ARIA 1.2). */
export function syncSplitterAria(): void {
  const workspace = elements.workspaceSplitter.parentElement;
  const mediaPool = workspace?.querySelector<HTMLElement>('.media-pool');
  if (workspace && mediaPool) {
    const frameW = workspace.getBoundingClientRect().width;
    const minW = 260;
    const maxW = Math.max(320, frameW - 420);
    const wNow = clamp(mediaPool.getBoundingClientRect().width, minW, maxW);
    setSeparatorValue(elements.workspaceSplitter, 'vertical', minW, maxW, wNow);
  }

  const mainFrame = elements.mainFooterSplitter.parentElement;
  const footer = mainFrame?.querySelector<HTMLElement>('.operator-footer');
  if (mainFrame && footer) {
    const frameH = mainFrame.getBoundingClientRect().height;
    const minH = 180;
    const maxH = Math.max(220, frameH - 280);
    const hNow = clamp(footer.getBoundingClientRect().height, minH, maxH);
    setSeparatorValue(elements.mainFooterSplitter, 'horizontal', minH, maxH, hNow);
  }

  const footerRow = elements.footerSplitter.parentElement;
  const mixer = footerRow?.querySelector<HTMLElement>('.mixer-panel');
  if (footerRow && mixer) {
    const minM = 260;
    const maxM = getMaxMixerWidth();
    const mNow = clamp(mixer.getBoundingClientRect().width, minM, maxM);
    setSeparatorValue(elements.footerSplitter, 'vertical', minM, maxM, mNow);
  }
}

function setSeparatorValue(
  el: HTMLElement,
  orientation: 'horizontal' | 'vertical',
  min: number,
  max: number,
  value: number,
): void {
  el.setAttribute('aria-orientation', orientation);
  el.setAttribute('aria-valuemin', String(Math.round(min)));
  el.setAttribute('aria-valuemax', String(Math.round(max)));
  el.setAttribute('aria-valuenow', String(Math.round(value)));
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

export function getMaxMixerWidth(): number {
  const footerWidth = elements.operatorFooter.getBoundingClientRect().width;
  return Math.max(320, footerWidth - 360);
}

export function readLayoutPrefs(): LayoutPrefs {
  try {
    return JSON.parse(localStorage.getItem(UI_PREF_KEY) ?? '{}') as LayoutPrefs;
  } catch {
    return {};
  }
}

function saveLayoutPrefs(update: LayoutPrefs): void {
  mixerExpandedTemporarily = false;
  const prefs = { ...readLayoutPrefs(), ...update };
  localStorage.setItem(UI_PREF_KEY, JSON.stringify(prefs));
  applyLayoutPrefs(prefs);
}

export function setTemporaryMixerWidth(widthPx: number): void {
  mixerExpandedTemporarily = true;
  document.documentElement.style.setProperty('--mixer-width', `${widthPx}px`);
}

export function restoreTemporaryMixerExpansion(): void {
  if (!mixerExpandedTemporarily) {
    return;
  }
  mixerExpandedTemporarily = false;
  const prefs = readLayoutPrefs();
  if (prefs.mixerWidthPx === undefined) {
    document.documentElement.style.removeProperty('--mixer-width');
    return;
  }
  applyLayoutPrefs(prefs);
}

/** Merge project-saved layout prefs with current storage and apply CSS variables. */
export function mergeImportedLayoutPrefs(imported: LayoutPrefs): void {
  const merged = { ...readLayoutPrefs(), ...imported };
  localStorage.setItem(UI_PREF_KEY, JSON.stringify(merged));
  applyLayoutPrefs(merged);
}

export function applyLayoutPrefs(prefs: LayoutPrefs): void {
  const root = document.documentElement;
  if (prefs.mediaWidthPx !== undefined) {
    root.style.setProperty('--media-pool-width', `${prefs.mediaWidthPx}px`);
  }
  if (prefs.footerHeightPx !== undefined) {
    root.style.setProperty('--operator-footer-height', `${prefs.footerHeightPx}px`);
  }
  if (prefs.mixerWidthPx !== undefined) {
    root.style.setProperty('--mixer-width', `${prefs.mixerWidthPx}px`);
  }
  syncSplitterAria();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
