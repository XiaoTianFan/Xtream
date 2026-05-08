import { describe, expect, it } from 'vitest';

import {
  isRemoteRuntimeNewer,
  parseRuntimeVersionFromVersionTsSource,
  runtimeVersionTuple,
} from './runtimeVersionRemote';

describe('parseRuntimeVersionFromVersionTsSource', () => {
  it('reads assignment from version.ts shape', () => {
    const src = `export const XTREAM_RUNTIME_VERSION = 'v0.2.4';\n`;
    expect(parseRuntimeVersionFromVersionTsSource(src)).toBe('v0.2.4');
  });

  it('allows double quotes', () => {
    const src = 'export const XTREAM_RUNTIME_VERSION = "v1.0.0";\n';
    expect(parseRuntimeVersionFromVersionTsSource(src)).toBe('v1.0.0');
  });

  it('returns undefined when missing', () => {
    expect(parseRuntimeVersionFromVersionTsSource('const x = 1')).toBeUndefined();
  });
});

describe('runtimeVersionTuple', () => {
  it('parses v-prefixed labels', () => {
    expect(runtimeVersionTuple('v0.1.10')).toEqual([0, 1, 10]);
  });
});

describe('isRemoteRuntimeNewer', () => {
  it('is true when patch is greater', () => {
    expect(isRemoteRuntimeNewer('v0.1.6', 'v0.1.5')).toBe(true);
  });

  it('is true when minor is greater', () => {
    expect(isRemoteRuntimeNewer('v0.2.0', 'v0.1.99')).toBe(true);
    expect(isRemoteRuntimeNewer('v0.2.0', 'v0.1.5')).toBe(true);
  });

  it('is false when equal or older', () => {
    expect(isRemoteRuntimeNewer('v0.1.5', 'v0.1.5')).toBe(false);
    expect(isRemoteRuntimeNewer('v0.1.4', 'v0.1.5')).toBe(false);
  });

  it('is false for invalid labels', () => {
    expect(isRemoteRuntimeNewer('v0.1', 'v0.1.5')).toBe(false);
    expect(isRemoteRuntimeNewer('v0.1.5', 'latest')).toBe(false);
  });
});
