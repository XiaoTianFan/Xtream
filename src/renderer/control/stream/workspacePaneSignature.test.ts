import { describe, expect, it } from 'vitest';
import { getDefaultStreamPersistence } from '../../../shared/streamWorkspace';
import type { CalculatedStreamTimeline, DirectorState, SubCueId, VisualId } from '../../../shared/types';
import { createStreamWorkspacePaneSignature } from './workspacePaneSignature';

function minimalDirector(overrides: Partial<DirectorState> & Pick<DirectorState, 'visuals' | 'audioSources'>): DirectorState {
  return {
    rate: 1,
    paused: true,
    performanceMode: 'full',
    loop: { enabled: false, startSeconds: 0 },
    outputs: {},
    displays: {},
    ...overrides,
  } as DirectorState;
}

function streamWithVisualSubCue(stream: ReturnType<typeof getDefaultStreamPersistence>['stream']) {
  const s = structuredClone(stream);
  const vId = 'vis-ref-1' as VisualId;
  const scId = 'sub-1' as SubCueId;
  const scene = s.scenes[s.sceneOrder[0]!]!;
  scene.subCueOrder = [scId];
  scene.subCues[scId] = {
    id: scId,
    kind: 'visual',
    visualId: vId,
    targets: [{ displayId: 'dw-1' }],
  };
  return s;
}

function timelineWithSceneDuration(sceneId: string, durationMs: number | undefined): CalculatedStreamTimeline {
  return {
    revision: 1,
    status: 'valid',
    entries: {
      [sceneId]: { sceneId, durationMs, triggerKnown: true },
    },
    expectedDurationMs: durationMs,
    threadPlan: {
      threads: [
        {
          threadId: `thread:${sceneId}`,
          rootSceneId: sceneId,
          rootTriggerType: 'manual',
          sceneIds: [sceneId],
          sceneTimings: {
            [sceneId]: { sceneId, threadLocalStartMs: 0, threadLocalEndMs: durationMs },
          },
          branches: [{ sceneIds: [sceneId], durationMs }],
          durationMs,
          detachedReason: durationMs === undefined ? 'infinite-loop' : undefined,
        },
      ],
      threadBySceneId: { [sceneId]: `thread:${sceneId}` },
      issues: [],
      temporarilyDisabledSceneIds: [],
    },
    mainSegments: durationMs === undefined ? [] : [{ threadId: `thread:${sceneId}`, rootSceneId: sceneId, startMs: 0, durationMs, endMs: durationMs, proportion: 1 }],
    calculatedAtWallTimeMs: 0,
    issues: [],
  } as unknown as CalculatedStreamTimeline;
}

describe('createStreamWorkspacePaneSignature', () => {
  it('is stable for identical inputs', () => {
    const { stream } = getDefaultStreamPersistence();
    const dir = minimalDirector({ visuals: {}, audioSources: {} });
    const a = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    const b = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    expect(a).toBe(b);
  });

  it('changes when stream workspace mode changes', () => {
    const { stream } = getDefaultStreamPersistence();
    const dir = minimalDirector({ visuals: {}, audioSources: {} });
    const listSig = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    const flowSig = createStreamWorkspacePaneSignature({
      mode: 'flow',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    const ganttSig = createStreamWorkspacePaneSignature({
      mode: 'gantt',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    expect(listSig).not.toBe(flowSig);
    expect(ganttSig).not.toBe(flowSig);
  });

  it('changes when expanded scene set changes', () => {
    const { stream } = getDefaultStreamPersistence();
    const dir = minimalDirector({ visuals: {}, audioSources: {} });
    const sid = stream.sceneOrder[0]!;
    const collapsed = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
    });
    const expanded = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [sid],
      directorState: dir,
    });
    expect(collapsed).not.toBe(expanded);
  });

  it('changes when referenced media duration metadata changes', () => {
    const { stream: base } = getDefaultStreamPersistence();
    const stream = streamWithVisualSubCue(base);
    const vId = 'vis-ref-1' as VisualId;
    const dir10 = minimalDirector({
      visuals: {
        [vId]: { id: vId, label: 'Clips', kind: 'file', type: 'video', ready: true, durationSeconds: 10 },
      },
      audioSources: {},
    });
    const dir99 = minimalDirector({
      visuals: {
        [vId]: { id: vId, label: 'Clips', kind: 'file', type: 'video', ready: true, durationSeconds: 99 },
      },
      audioSources: {},
    });
    const a = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir10,
    });
    const b = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir99,
    });
    expect(a).not.toBe(b);
  });

  it('changes when referenced media playback rate metadata changes', () => {
    const { stream: base } = getDefaultStreamPersistence();
    const stream = streamWithVisualSubCue(base);
    const vId = 'vis-ref-1' as VisualId;
    const dir1 = minimalDirector({
      visuals: {
        [vId]: { id: vId, label: 'Clips', kind: 'file', type: 'video', ready: true, durationSeconds: 10, playbackRate: 1 },
      },
      audioSources: {},
    });
    const dir2 = minimalDirector({
      visuals: {
        [vId]: { id: vId, label: 'Clips', kind: 'file', type: 'video', ready: true, durationSeconds: 10, playbackRate: 2 },
      },
      audioSources: {},
    });
    const a = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir1,
    });
    const b = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dir2,
    });
    expect(a).not.toBe(b);
  });

  it('changes when the authoring timeline scene duration or thread classification changes', () => {
    const { stream } = getDefaultStreamPersistence();
    const dir = minimalDirector({ visuals: {}, audioSources: {} });
    const sceneId = stream.sceneOrder[0]!;
    const finite = createStreamWorkspacePaneSignature({
      mode: 'flow',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
      timeline: timelineWithSceneDuration(sceneId, 5000),
    });
    const infinite = createStreamWorkspacePaneSignature({
      mode: 'flow',
      stream,
      expandedListSceneIds: [],
      directorState: dir,
      timeline: timelineWithSceneDuration(sceneId, undefined),
    });
    expect(finite).not.toBe(infinite);
  });

  it('ignores director visuals not referenced by the stream', () => {
    const { stream: base } = getDefaultStreamPersistence();
    const stream = streamWithVisualSubCue(base);
    const vId = 'vis-ref-1' as VisualId;
    const coreVisual = {
      id: vId,
      label: 'Clips',
      kind: 'file' as const,
      type: 'video' as const,
      ready: true,
      durationSeconds: 10,
    };
    const dirA = minimalDirector({
      visuals: {
        [vId]: coreVisual,
      },
      audioSources: {},
    });
    const dirB = minimalDirector({
      visuals: {
        [vId]: coreVisual,
        'unrelated-vis': {
          id: 'unrelated-vis',
          label: 'Other',
          kind: 'file',
          type: 'video',
          ready: true,
          durationSeconds: 999,
        },
      },
      audioSources: {},
    });
    const a = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dirA,
    });
    const b = createStreamWorkspacePaneSignature({
      mode: 'list',
      stream,
      expandedListSceneIds: [],
      directorState: dirB,
    });
    expect(a).toBe(b);
  });

  it('ignores flow viewport and scene card geometry changes', () => {
    const { stream: base } = getDefaultStreamPersistence();
    const sceneId = base.sceneOrder[0]!;
    const dir = minimalDirector({ visuals: {}, audioSources: {} });
    const moved = structuredClone(base);
    moved.flowViewport = { x: 20, y: -10, zoom: 1.25 };
    moved.scenes[sceneId]!.flow = { x: 360, y: 140, width: 360, height: 180 };

    const a = createStreamWorkspacePaneSignature({
      mode: 'flow',
      stream: base,
      expandedListSceneIds: [],
      directorState: dir,
    });
    const b = createStreamWorkspacePaneSignature({
      mode: 'flow',
      stream: moved,
      expandedListSceneIds: [],
      directorState: dir,
    });

    expect(a).toBe(b);
  });
});
