import { describe, expect, it } from 'vitest';
import type { DirectorState, OutputMeterReport, VirtualOutputState } from '../../../shared/types';
import { deriveOutputMeterLanes } from './meterLanes';

function testState(output: VirtualOutputState): DirectorState {
  return {
    paused: true,
    rate: 1,
    audioExtractionFormat: 'm4a',
    anchorWallTimeMs: 0,
    offsetSeconds: 0,
    loop: { enabled: false, startSeconds: 0 },
    globalAudioMuted: false,
    globalDisplayBlackout: false,
    globalAudioMuteFadeOutSeconds: 1,
    globalDisplayBlackoutFadeOutSeconds: 1,
    performanceMode: false,
    visuals: {},
    audioSources: {
      sourceA: {
        id: 'sourceA',
        label: 'A',
        type: 'external-file',
        ready: true,
        channelCount: 2,
        channelMode: 'stereo',
      },
      sourceB: {
        id: 'sourceB',
        label: 'B',
        type: 'external-file',
        ready: true,
        channelCount: 1,
      },
    },
    outputs: {
      [output.id]: output,
    },
    displays: {},
    activeTimeline: { assignedVideoIds: [], activeAudioSourceIds: [] },
    readiness: { ready: true, checkedAtWallTimeMs: 0, issues: [] },
    corrections: { displays: {} },
    previews: {},
  };
}

describe('deriveOutputMeterLanes', () => {
  it('uses current output routes for lane topology even when the latest report is stale', () => {
    const output: VirtualOutputState = {
      id: 'output-main',
      label: 'Main',
      sources: [{ audioSourceId: 'sourceB', levelDb: 0 }],
      busLevelDb: 0,
      ready: true,
      physicalRoutingAvailable: true,
      fallbackReason: 'none',
    };
    const staleReport: OutputMeterReport = {
      outputId: output.id,
      lanes: [
        {
          id: 'output-main:sourceA:ch-1',
          label: 'L',
          audioSourceId: 'sourceA',
          channelIndex: 0,
          db: -12,
          clipped: false,
        },
        {
          id: 'output-main:sourceA:ch-2',
          label: 'R',
          audioSourceId: 'sourceA',
          channelIndex: 1,
          db: -10,
          clipped: false,
        },
      ],
      peakDb: -10,
      reportedAtWallTimeMs: 0,
    };

    expect(deriveOutputMeterLanes(output, testState(output), staleReport)).toEqual([
      {
        id: 'output-main:sourceB:ch-1',
        label: 'C1',
        audioSourceId: 'sourceB',
        channelIndex: 0,
        db: -60,
        clipped: false,
      },
    ]);
  });

  it('preserves live meter values for lanes that still match the current route', () => {
    const output: VirtualOutputState = {
      id: 'output-main',
      label: 'Main',
      sources: [{ audioSourceId: 'sourceA', levelDb: 0 }],
      busLevelDb: 0,
      ready: true,
      physicalRoutingAvailable: true,
      fallbackReason: 'none',
    };
    const report: OutputMeterReport = {
      outputId: output.id,
      lanes: [
        {
          id: 'output-main:sourceA:ch-1',
          label: 'L',
          audioSourceId: 'sourceA',
          channelIndex: 0,
          db: -9,
          clipped: false,
        },
        {
          id: 'output-main:sourceA:ch-2',
          label: 'R',
          audioSourceId: 'sourceA',
          channelIndex: 1,
          db: 0,
          clipped: true,
        },
      ],
      peakDb: 0,
      reportedAtWallTimeMs: 0,
    };

    expect(deriveOutputMeterLanes(output, testState(output), report).map((lane) => [lane.id, lane.db, lane.clipped])).toEqual([
      ['output-main:sourceA:ch-1', -9, false],
      ['output-main:sourceA:ch-2', 0, true],
    ]);
  });
});
