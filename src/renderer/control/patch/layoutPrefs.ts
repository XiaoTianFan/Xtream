import { patchElements as elements } from './elements';
import type { LayoutPrefs } from '../shared/types';

const UI_PREF_KEY = 'xtream.control.layout.v1';

let mixerExpandedTemporarily = false;

export function installSplitters(): void {
  applyLayoutPrefs(readLayoutPrefs());
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
  installSplitter(elements.assetPreviewSplitter, 'y', (delta) => {
    const current = readLayoutPrefs().assetPreviewHeightPx ?? elements.assetPreview.getBoundingClientRect().height;
    saveLayoutPrefs({ assetPreviewHeightPx: clamp(current - delta, 110, 320) });
  });
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
  if (prefs.assetPreviewHeightPx !== undefined) {
    root.style.setProperty('--asset-preview-height', `${prefs.assetPreviewHeightPx}px`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
