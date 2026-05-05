import { describe, expect, it } from 'vitest';
import type { PersistedStreamConfig, SceneId } from './types';
import { createEmptyUserScene, STREAM_MAIN_ID } from './streamWorkspace';
import { deriveStreamThreadPlan } from './streamThreadPlan';

function streamWithScenes(scenes: PersistedStreamConfig['scenes'], order: string[]): PersistedStreamConfig {
  return {
    id: STREAM_MAIN_ID,
    label: 'Test',
    sceneOrder: order,
    scenes,
  };
}

function scene(id: SceneId, durationMs = 1000) {
  return {
    ...createEmptyUserScene(id, id),
    subCueOrder: ['v1'],
    subCues: {
      v1: {
        id: 'v1',
        kind: 'visual' as const,
        visualId: 'vid',
        targets: [{ displayId: 'd0' }],
        durationOverrideMs: durationMs,
      },
    },
  };
}

describe('streamThreadPlan', () => {
  it('detects manual and at-timecode roots', () => {
    const stream = streamWithScenes(
      {
        a: scene('a'),
        b: { ...scene('b'), trigger: { type: 'at-timecode', timecodeMs: 5000 } },
      },
      ['a', 'b'],
    );
    const plan = deriveStreamThreadPlan(stream, { a: 1000, b: 1000 });
    expect(plan.threads.map((thread) => [thread.threadId, thread.rootSceneId, thread.rootTriggerType])).toEqual([
      ['thread:a', 'a', 'manual'],
      ['thread:b', 'b', 'at-timecode'],
    ]);
  });

  it('uses implicit predecessors for auto-follow ownership', () => {
    const stream = streamWithScenes(
      {
        a: scene('a'),
        b: { ...scene('b'), trigger: { type: 'follow-end' } },
      },
      ['a', 'b'],
    );
    const plan = deriveStreamThreadPlan(stream, { a: 1000, b: 1000 });
    expect(plan.threadBySceneId.b).toBe('thread:a');
    expect(plan.threads[0].edges).toMatchObject([{ predecessorSceneId: 'a', followerSceneId: 'b', triggerType: 'follow-end' }]);
  });

  it('derives branches, offsets, and longest branch duration', () => {
    const stream = streamWithScenes(
      {
        root: scene('root', 10_000),
        a: { ...scene('a', 4000), trigger: { type: 'follow-start', followsSceneId: 'root', delayMs: 3000 } },
        b: { ...scene('b', 7000), trigger: { type: 'follow-end', followsSceneId: 'root' } },
        c: { ...scene('c', 1000), trigger: { type: 'follow-end', followsSceneId: 'a' } },
      },
      ['root', 'a', 'b', 'c'],
    );
    const plan = deriveStreamThreadPlan(stream, { root: 10_000, a: 4000, b: 7000, c: 1000 });
    const thread = plan.threads[0];
    expect(thread.branches.map((branch) => branch.sceneIds)).toEqual([
      ['root', 'a', 'c'],
      ['root', 'b'],
    ]);
    expect(thread.sceneTimings.a).toMatchObject({ threadLocalStartMs: 3000, threadLocalEndMs: 7000 });
    expect(thread.sceneTimings.b).toMatchObject({ threadLocalStartMs: 10_000, threadLocalEndMs: 17_000 });
    expect(thread.durationMs).toBe(17_000);
    expect(thread.longestBranchSceneIds).toEqual(['root', 'b']);
  });

  it('temporarily disables a missing-predecessor branch and restores it after repair', () => {
    const broken = streamWithScenes(
      {
        root: scene('root'),
        a: { ...scene('a'), trigger: { type: 'follow-end', followsSceneId: 'missing' } },
        b: { ...scene('b'), trigger: { type: 'follow-end', followsSceneId: 'a' } },
      },
      ['root', 'a', 'b'],
    );
    const brokenPlan = deriveStreamThreadPlan(broken, { root: 1000, a: 1000, b: 1000 });
    expect(brokenPlan.temporarilyDisabledSceneIds.sort()).toEqual(['a', 'b']);
    expect(brokenPlan.issues).toContainEqual(expect.objectContaining({ sceneId: 'a', message: expect.stringContaining('missing or disabled predecessor') }));

    const repaired = {
      ...broken,
      scenes: {
        ...broken.scenes,
        a: { ...broken.scenes.a, trigger: { type: 'follow-end' as const, followsSceneId: 'root' } },
      },
    };
    const repairedPlan = deriveStreamThreadPlan(repaired, { root: 1000, a: 1000, b: 1000 });
    expect(repairedPlan.temporarilyDisabledSceneIds).toEqual([]);
    expect(repairedPlan.threadBySceneId.b).toBe('thread:root');
  });

  it('temporarily disables followers of disabled predecessors', () => {
    const stream = streamWithScenes(
      {
        root: { ...scene('root'), disabled: true },
        a: { ...scene('a'), trigger: { type: 'follow-end', followsSceneId: 'root' } },
      },
      ['root', 'a'],
    );
    const plan = deriveStreamThreadPlan(stream, { root: undefined, a: 1000 });
    expect(plan.temporarilyDisabledSceneIds).toEqual(['a']);
    expect(plan.issues[0]).toMatchObject({ sceneId: 'a' });
  });

  it('keeps disabled auto-follow scenes in their owning thread for authoring display but excludes them from timing', () => {
    const stream = streamWithScenes(
      {
        root: scene('root', 1000),
        dimmed: { ...scene('dimmed', 1000), disabled: true, trigger: { type: 'follow-end', followsSceneId: 'root' } },
        next: scene('next', 1000),
      },
      ['root', 'dimmed', 'next'],
    );
    const plan = deriveStreamThreadPlan(stream, { root: 1000, dimmed: undefined, next: 1000 });
    const rootThread = plan.threads.find((thread) => thread.rootSceneId === 'root');

    expect(plan.threadBySceneId.dimmed).toBe('thread:root');
    expect(rootThread?.sceneIds).toContain('dimmed');
    expect(rootThread?.edges).toContainEqual(
      expect.objectContaining({ predecessorSceneId: 'root', followerSceneId: 'dimmed', triggerType: 'follow-end' }),
    );
    expect(rootThread?.sceneTimings.dimmed).toBeUndefined();
    expect(rootThread?.durationMs).toBe(1000);
    expect(plan.temporarilyDisabledSceneIds).toEqual([]);
  });

  it('invalidates auto-trigger cycles', () => {
    const stream = streamWithScenes(
      {
        a: { ...scene('a'), trigger: { type: 'follow-end', followsSceneId: 'b' } },
        b: { ...scene('b'), trigger: { type: 'follow-end', followsSceneId: 'a' } },
      },
      ['a', 'b'],
    );
    const plan = deriveStreamThreadPlan(stream, { a: 1000, b: 1000 });
    expect(plan.issues.some((issue) => issue.message.includes('cycle'))).toBe(true);
    expect(plan.temporarilyDisabledSceneIds.sort()).toEqual(['a', 'b']);
  });
});
