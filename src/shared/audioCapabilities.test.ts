import { describe, expect, it } from 'vitest';
import { assessAudioCapabilities } from './audioCapabilities';

describe('assessAudioCapabilities', () => {
  it('reports split available only with API support and two distinct selected sinks', () => {
    expect(
      assessAudioCapabilities({
        graphReady: true,
        setSinkIdSupported: true,
        outputDeviceCount: 2,
        leftSinkId: 'left',
        rightSinkId: 'right',
      }),
    ).toEqual({
      physicalSplitAvailable: true,
      capabilityStatus: 'split-available',
      fallbackReason: 'none',
    });
  });

  it('classifies deterministic fallback reasons', () => {
    expect(
      assessAudioCapabilities({
        graphReady: false,
        setSinkIdSupported: true,
        outputDeviceCount: 2,
        leftSinkId: 'left',
        rightSinkId: 'right',
      }).fallbackReason,
    ).toBe('api-unavailable');

    expect(
      assessAudioCapabilities({
        graphReady: true,
        setSinkIdSupported: true,
        outputDeviceCount: 1,
        leftSinkId: 'left',
        rightSinkId: 'right',
      }).fallbackReason,
    ).toBe('single-sink');
  });
});
