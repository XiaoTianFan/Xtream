/**
 * Helpers for comparing Xtream runtime version labels (e.g. v0.1.5) and parsing
 * `src/shared/version.ts` as fetched from a remote source.
 */

/** Parse XTREAM_RUNTIME_VERSION from the contents of `version.ts` as committed in the repo. */
export function parseRuntimeVersionFromVersionTsSource(source: string): string | undefined {
  const m = source.match(
    /export\s+const\s+XTREAM_RUNTIME_VERSION\s*=\s*['"](v\d+\.\d+\.\d+)['"]\s*;?/m,
  );
  return m?.[1];
}

export function runtimeVersionTuple(label: string): [number, number, number] | undefined {
  const trimmed = label.trim();
  const withoutV = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  const parts = withoutV.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  const nums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const p = parts[i]!;
    if (!/^\d+$/.test(p)) {
      return undefined;
    }
    nums[i] = Number.parseInt(p, 10);
  }
  return nums;
}

/** True when `remoteLabel` is strictly greater than `localLabel` (semver major.minor.patch). */
export function isRemoteRuntimeNewer(remoteLabel: string, localLabel: string): boolean {
  const r = runtimeVersionTuple(remoteLabel);
  const l = runtimeVersionTuple(localLabel);
  if (!r || !l) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (r[i]! > l[i]!) {
      return true;
    }
    if (r[i]! < l[i]!) {
      return false;
    }
  }
  return false;
}
