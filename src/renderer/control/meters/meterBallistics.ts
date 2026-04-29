/** Display scale for mixer meters (must match audioRuntime meter display). */
export const METER_BALLISTICS_FLOOR_DB = -60;
export const METER_BALLISTICS_CEIL_DB = 0;

/** Default release when level falls; ~0.83 s from 0 dB to floor at 72 dB/s. */
export const DEFAULT_RELEASE_DB_PER_SECOND = 72;

export type MeterBallisticsOptions = {
  floorDb: number;
  ceilDb: number;
  releaseDbPerSecond: number;
};

export const DEFAULT_METER_BALLISTICS: MeterBallisticsOptions = {
  floorDb: METER_BALLISTICS_FLOOR_DB,
  ceilDb: METER_BALLISTICS_CEIL_DB,
  releaseDbPerSecond: DEFAULT_RELEASE_DB_PER_SECOND,
};

/**
 * Peak-style ballistics: snap up on attack; exponential step release toward a lower target (dB/sec).
 */
export function smoothMeterDb(
  previousDb: number,
  targetDb: number,
  deltaSeconds: number,
  opts: MeterBallisticsOptions = DEFAULT_METER_BALLISTICS,
): number {
  const floor = opts.floorDb;
  const ceil = opts.ceilDb;
  const clamp = (d: number) => Math.max(floor, Math.min(ceil, d));
  let prev = clamp(previousDb);
  const target = clamp(targetDb);
  const safeDelta = Math.max(0, Math.min(deltaSeconds, 0.25));

  if (target > prev) {
    return target;
  }
  if (target >= prev) {
    return target;
  }
  const drop = opts.releaseDbPerSecond * safeDelta;
  const next = prev - drop;
  return clamp(Math.max(target, next));
}

/**
 * Reports older than this (ms) may be treated as silence when paused or in performance mode.
 */
export const STALE_METER_REPORT_MS = 200;
