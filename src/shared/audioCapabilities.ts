import type { AudioCapabilityStatus, AudioFallbackReason } from './types';

export type AudioCapabilityInput = {
  graphReady: boolean;
  setSinkIdSupported: boolean;
  outputDeviceCount: number;
  leftSinkId?: string;
  rightSinkId?: string;
};

export type AudioCapabilityAssessment = {
  physicalSplitAvailable: boolean;
  capabilityStatus: AudioCapabilityStatus;
  fallbackReason: AudioFallbackReason;
};

export function assessAudioCapabilities(input: AudioCapabilityInput): AudioCapabilityAssessment {
  if (!input.graphReady || !input.setSinkIdSupported) {
    return {
      physicalSplitAvailable: false,
      capabilityStatus: 'api-unavailable',
      fallbackReason: 'api-unavailable',
    };
  }

  if (input.outputDeviceCount < 2) {
    return {
      physicalSplitAvailable: false,
      capabilityStatus: 'single-sink',
      fallbackReason: 'single-sink',
    };
  }

  if (!input.leftSinkId || !input.rightSinkId) {
    return {
      physicalSplitAvailable: false,
      capabilityStatus: 'missing-selection',
      fallbackReason: 'missing-selection',
    };
  }

  if (input.leftSinkId === input.rightSinkId) {
    return {
      physicalSplitAvailable: false,
      capabilityStatus: 'duplicate-sink-selection',
      fallbackReason: 'duplicate-sink-selection',
    };
  }

  return {
    physicalSplitAvailable: true,
    capabilityStatus: 'split-available',
    fallbackReason: 'none',
  };
}
