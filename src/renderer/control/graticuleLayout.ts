import { meterVisualUToDb } from './audioRuntime';
import { busNormToDb } from './busFaderLaw';

/** Minimum vertical gap between graticule tick marks (px). */
export const GRATICULE_MIN_PITCH_PX = 12;
/** Clamped number of graticule labels. */
export const GRATICULE_LABELS_MIN = 2;
export const GRATICULE_LABELS_MAX = 8;

export type GraticuleLabelCountOptions = {
  minPitchPx?: number;
  nMin?: number;
  nMax?: number;
};

/**
 * Picks a label count from track height: roughly one tick per `minPitchPx`, clamped to [nMin, nMax].
 */
export function labelCountFromHeight(heightPx: number, options?: GraticuleLabelCountOptions): number {
  const minPitch = options?.minPitchPx ?? GRATICULE_MIN_PITCH_PX;
  const nMin = options?.nMin ?? GRATICULE_LABELS_MIN;
  const nMax = options?.nMax ?? GRATICULE_LABELS_MAX;
  if (heightPx <= 0) {
    return nMin;
  }
  const n = Math.max(nMin, Math.min(nMax, Math.round(heightPx / minPitch)));
  return n;
}

/** dB value at tick for graticule readouts (integers only). */
export function formatScaleDbLabel(db: number): string {
  return String(Math.round(db));
}

export function observeElementHeight(
  el: HTMLElement,
  onHeight: (heightCssPx: number) => void,
): () => void {
  const ro = new ResizeObserver((entries) => {
    const h = entries[0]?.contentRect.height ?? 0;
    onHeight(h);
  });
  ro.observe(el);
  onHeight(el.getBoundingClientRect().height);
  return () => ro.disconnect();
}

/**
 * u = 0 at top (0 dB), 1 at bottom (floor); same as meter graticule.
 */
export function renderOutputMeterGraticule(scale: HTMLElement, labelCount: number): void {
  scale.replaceChildren();
  if (labelCount < 2) {
    return;
  }
  for (let i = 0; i < labelCount; i += 1) {
    const u = i / (labelCount - 1);
    const tick = document.createElement('span');
    tick.className = 'output-meter-scale-tick';
    tick.style.top = `${u * 100}%`;
    tick.textContent = formatScaleDbLabel(meterVisualUToDb(u));
    scale.append(tick);
  }
}

/**
 * t = 0 at bottom (min dB), 1 at top (max dB), matching bus fader slider space.
 */
export function renderAudioFaderGraticule(scale: HTMLElement, labelCount: number): void {
  scale.replaceChildren();
  if (labelCount < 2) {
    return;
  }
  for (let i = 0; i < labelCount; i += 1) {
    const t = i / (labelCount - 1);
    const tick = document.createElement('span');
    tick.className = 'audio-fader-scale-tick';
    tick.style.top = `${(1 - t) * 100}%`;
    tick.textContent = formatScaleDbLabel(busNormToDb(t));
    scale.append(tick);
  }
}
