import { describe, expect, it } from 'vitest';
import type { DirectorState, MediaValidationIssue, StreamEnginePublicState } from '../../../shared/types';
import {
  buildSessionProblemStripItems,
  partitionMediaValidationIssues,
  severityForStreamEngineMessage,
} from './sessionProblems';

const minimalDirector = (issues: DirectorState['readiness']['issues']): DirectorState =>
  ({
    readiness: { ready: issues.length === 0, checkedAtWallTimeMs: 0, issues },
  }) as DirectorState;

const minimalStream = (partial: Partial<StreamEnginePublicState>): StreamEnginePublicState =>
  ({
    validationMessages: [],
    playbackTimeline: { status: 'valid', notice: undefined },
    ...partial,
  }) as StreamEnginePublicState;

describe('partitionMediaValidationIssues', () => {
  it('splits stream: targets from patch media', () => {
    const issues: MediaValidationIssue[] = [
      { severity: 'error', target: 'stream:foo', message: 'bad stream' },
      { severity: 'warning', target: 'visual:v1', message: 'missing' },
    ];
    const { patchMedia, streamMedia } = partitionMediaValidationIssues(issues);
    expect(streamMedia).toEqual([issues[0]]);
    expect(patchMedia).toEqual([issues[1]]);
  });
});

describe('severityForStreamEngineMessage', () => {
  it('treats warning/degraded copy as warning severity', () => {
    expect(severityForStreamEngineMessage('Timeline Warning: soft')).toBe('warning');
    expect(severityForStreamEngineMessage('Output degraded')).toBe('warning');
  });

  it('defaults to error', () => {
    expect(severityForStreamEngineMessage('Stream timeline has no calculable duration')).toBe('error');
  });
});

describe('buildSessionProblemStripItems', () => {
  it('adds a global chip when both patch and stream have errors', () => {
    const director = minimalDirector([
      { severity: 'error', target: 'display', message: 'Need a display' },
    ]);
    const stream = minimalStream({
      validationMessages: ['Stream timeline invalid'],
    });
    const items = buildSessionProblemStripItems({ director, mediaIssues: [], stream });
    const globalItem = items.find((i) => i.domain === 'global');
    expect(globalItem).toMatchObject({
      domain: 'global',
      severity: 'error',
      text: 'Patch and Stream both report blocking issues.',
    });
  });

  it('does not add global chip when only one workspace has errors', () => {
    const director = minimalDirector([
      { severity: 'error', target: 'display', message: 'Need a display' },
    ]);
    const stream = minimalStream({
      validationMessages: ['Degraded preview'],
    });
    const items = buildSessionProblemStripItems({ director, mediaIssues: [], stream });
    expect(items.some((i) => i.domain === 'global')).toBe(false);
  });

  it('classifies engine messages with warning heuristic', () => {
    const stream = minimalStream({ validationMessages: ['Warning: soft issue'] });
    const items = buildSessionProblemStripItems({ director: undefined, mediaIssues: [], stream });
    const engineItem = items.find((i) => i.key.startsWith('stream-engine:'));
    expect(engineItem?.severity).toBe('warning');
  });
});
