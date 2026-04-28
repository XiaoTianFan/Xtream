/**
 * Virtual output bus fader: linear UI travel (0…1) maps to dB with a
 * sub-linear exponent so more physical throw is used near unity, similar
 * in spirit to an audio-taper / console main fader.
 */
export const BUS_FADER_DB_MIN = -60;
export const BUS_FADER_DB_MAX = 12;
const DB_RANGE = BUS_FADER_DB_MAX - BUS_FADER_DB_MIN;

/** Quantization step for bus fader dB (UI + state updates). */
export const BUS_FADER_DB_STEP = 0.1;

/**
 * Exponent in (0, 1): smaller ⇒ more fader range spent in the upper dB
 * region (finer level changes when approaching 0 dB and above).
 */
const TAPER = 0.6;

const FADER_STEPS = 10_000;

/**
 * `t` in [0, 1] → bus level dB, monotonic, endpoints match min/max.
 */
export function busNormToDb(t: number): number {
  const p = Math.min(1, Math.max(0, t));
  return BUS_FADER_DB_MIN + DB_RANGE * p ** TAPER;
}

/**
 * dB in [min, max] → `t` in [0, 1] (inverse of {@link busNormToDb}).
 */
export function busDbToNorm(db: number): number {
  const d = Math.min(BUS_FADER_DB_MAX, Math.max(BUS_FADER_DB_MIN, db));
  return ((d - BUS_FADER_DB_MIN) / DB_RANGE) ** (1 / TAPER);
}

/**
 * Integer slider 0…{@link FADER_STEPS} for a native `range` input.
 */
export function busDbToFaderSliderValue(db: number): number {
  return Math.round(busDbToNorm(db) * FADER_STEPS);
}

export function faderSliderValueToBusDb(v: number): number {
  const t = v / FADER_STEPS;
  return busNormToDb(t);
}

export function faderSliderMin(): string {
  return '0';
}

export function faderSliderMax(): string {
  return String(FADER_STEPS);
}

/**
 * Normalized 0 dB: used for e.g. Alt+reset on the fader.
 */
export function faderZeroSliderValue(): number {
  return busDbToFaderSliderValue(0);
}

export function faderMaxSteps(): number {
  return FADER_STEPS;
}

/**
 * Rounds the bus level to the nearest 0.1 dB, clamped to the bus fader range.
 */
export function quantizeBusFaderDb(db: number): number {
  if (!Number.isFinite(db)) {
    return BUS_FADER_DB_MIN;
  }
  const inv = 1 / BUS_FADER_DB_STEP;
  const q = Math.round(db * inv) / inv;
  return Math.min(BUS_FADER_DB_MAX, Math.max(BUS_FADER_DB_MIN, q));
}
