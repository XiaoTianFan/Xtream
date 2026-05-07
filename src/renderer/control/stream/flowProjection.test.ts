import { describe, expect, it } from 'vitest';
import { buildStreamSchedule } from '../../../shared/streamSchedule';
import type { CalculatedStreamTimeline, PersistedSceneConfig, PersistedStreamConfig, SceneId, SubCueId, VisualId } from '../../../shared/types';
import { deriveStreamFlowProjection } from './flowProjection';

function scene(id: SceneId, trigger: PersistedSceneConfig['trigger'], title = id): PersistedSceneConfig {
  return {
    id,
    title,
    trigger,
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: [],
    subCues: {},
  };
}

function visualScene(id: SceneId, trigger: PersistedSceneConfig['trigger'], visualId: VisualId, title = id): PersistedSceneConfig {
  const cueId = `${id}:visual` as SubCueId;
  return {
    ...scene(id, trigger, title),
    subCueOrder: [cueId],
    subCues: {
      [cueId]: {
        id: cueId,
        kind: 'visual',
        visualId,
        targets: [{ displayId: 'display' }],
      },
    },
  };
}

function timeline(stream: PersistedStreamConfig, visualDurations: Record<VisualId, number> = {}): CalculatedStreamTimeline {
  const schedule = buildStreamSchedule(stream, { visualDurations, audioDurations: {} });
  return {
    ...schedule,
    revision: 1,
    calculatedAtWallTimeMs: 0,
  };
}

describe('deriveStreamFlowProjection', () => {
  it('projects virtual auto-trigger links and thread-colored scene nodes', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['a', 'b', 'c'],
      scenes: {
        a: scene('a', { type: 'manual' }),
        b: scene('b', { type: 'follow-end', followsSceneId: 'a' }),
        c: scene('c', { type: 'manual' }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    expect(projection.links).toMatchObject([{ predecessorSceneId: 'a', followerSceneId: 'b', triggerType: 'follow-end' }]);
    expect(projection.nodesBySceneId.a.threadColor?.token).toBe('thread-sage');
    expect(projection.nodesBySceneId.b.threadId).toBe(projection.nodesBySceneId.a.threadId);
    expect(projection.nodesBySceneId.c.threadColor?.token).toBe('thread-teal');
  });

  it('places at-timecode roots outside the main flow lane', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['main', 'side'],
      scenes: {
        main: scene('main', { type: 'manual' }),
        side: scene('side', { type: 'at-timecode', timecodeMs: 500 }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    expect(projection.nodesBySceneId.side.rootTriggerType).toBe('at-timecode');
    expect(projection.nodesBySceneId.side.rect.y).toBeLessThan(projection.nodesBySceneId.main.rect.y);
  });

  it('places manual infinite-loop detached roots below the main lane at the first main root x position', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['loop', 'main', 'side'],
      scenes: {
        loop: { ...scene('loop', { type: 'manual' }), loop: { enabled: true, iterations: { type: 'infinite' } } },
        main: visualScene('main', { type: 'manual' }, 'main-visual' as VisualId),
        side: scene('side', { type: 'at-timecode', timecodeMs: 500 }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream, { 'main-visual': 1 } as Record<VisualId, number>), directorState: undefined });

    expect(projection.nodesBySceneId.loop.detachedReason).toBe('infinite-loop');
    expect(projection.nodesBySceneId.loop.rect.x).toBe(projection.nodesBySceneId.main.rect.x);
    expect(projection.nodesBySceneId.loop.rect.y).toBeGreaterThan(projection.nodesBySceneId.main.rect.y);
    expect(projection.nodesBySceneId.side.rect.y).toBeLessThan(projection.nodesBySceneId.main.rect.y);
    expect(projection.mainCurve.points).toHaveLength(1);
    expect(projection.mainCurve.points[0]).toMatchObject({
      x: projection.nodesBySceneId.main.rect.x + projection.nodesBySceneId.main.rect.width / 2,
      y: projection.nodesBySceneId.main.rect.y + projection.nodesBySceneId.main.rect.height / 2,
    });
  });

  it('stacks multiple manual infinite-loop detached threads below the main lane', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['loop-a', 'loop-b', 'main'],
      scenes: {
        'loop-a': { ...scene('loop-a', { type: 'manual' }), loop: { enabled: true, iterations: { type: 'infinite' } } },
        'loop-b': { ...scene('loop-b', { type: 'manual' }), loop: { enabled: true, iterations: { type: 'infinite' } } },
        main: visualScene('main', { type: 'manual' }, 'main-visual' as VisualId),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream, { 'main-visual': 1 } as Record<VisualId, number>), directorState: undefined });

    expect(projection.nodesBySceneId['loop-a'].rect.x).toBe(projection.nodesBySceneId.main.rect.x);
    expect(projection.nodesBySceneId['loop-b'].rect.x).toBe(projection.nodesBySceneId.main.rect.x);
    expect(projection.nodesBySceneId['loop-b'].rect.y).toBeGreaterThan(projection.nodesBySceneId['loop-a'].rect.y);
  });

  it('renders warning stubs for explicit missing predecessor references', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'broken'],
      scenes: {
        root: scene('root', { type: 'manual' }),
        broken: scene('broken', { type: 'follow-end', followsSceneId: 'missing-scene' }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    expect(projection.warningStubs).toHaveLength(1);
    expect(projection.warningStubs[0]).toMatchObject({ sceneId: 'broken', label: 'Missing missing-scene' });
    expect(projection.nodesBySceneId.broken.status).toBe('disabled');
  });

  it('spreads sibling and nested auto-follow branches into distinct vertical lanes', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'left', 'right', 'left-child', 'right-child'],
      scenes: {
        root: scene('root', { type: 'manual' }),
        left: scene('left', { type: 'follow-end', followsSceneId: 'root' }),
        right: scene('right', { type: 'follow-end', followsSceneId: 'root' }),
        'left-child': scene('left-child', { type: 'follow-end', followsSceneId: 'left' }),
        'right-child': scene('right-child', { type: 'follow-end', followsSceneId: 'right' }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    expect(projection.nodesBySceneId.left.rect.y).not.toBe(projection.nodesBySceneId.right.rect.y);
    expect(projection.nodesBySceneId['left-child'].rect.y).toBe(projection.nodesBySceneId.left.rect.y);
    expect(projection.nodesBySceneId['right-child'].rect.y).toBe(projection.nodesBySceneId.right.rect.y);
  });

  it('keeps the longest branch centered with shorter branches above and below', () => {
    const v = 'branch-visual' as VisualId;
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'short-above', 'long', 'short-below', 'long-child'],
      scenes: {
        root: scene('root', { type: 'manual' }),
        'short-above': visualScene('short-above', { type: 'follow-end', followsSceneId: 'root' }, v),
        long: visualScene('long', { type: 'follow-end', followsSceneId: 'root' }, v),
        'short-below': visualScene('short-below', { type: 'follow-end', followsSceneId: 'root' }, v),
        'long-child': visualScene('long-child', { type: 'follow-end', followsSceneId: 'long' }, v),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream, { [v]: 1 }), directorState: undefined });
    const longY = projection.nodesBySceneId.long.rect.y;

    expect(projection.nodesBySceneId['long-child'].rect.y).toBe(longY);
    expect(projection.nodesBySceneId['short-above'].rect.y).toBeLessThan(longY);
    expect(projection.nodesBySceneId['short-below'].rect.y).toBeGreaterThan(longY);
  });

  it('centers the deepest branch when branch durations tie', () => {
    const v = 'branch-visual' as VisualId;
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'middle', 'middle-tail', 'bottom', 'deep', 'deep-video', 'deep-tail'],
      scenes: {
        root: visualScene('root', { type: 'manual' }, v),
        middle: visualScene('middle', { type: 'follow-end', followsSceneId: 'root' }, v),
        'middle-tail': scene('middle-tail', { type: 'follow-end', followsSceneId: 'middle' }),
        bottom: scene('bottom', { type: 'follow-end', followsSceneId: 'root' }),
        deep: scene('deep', { type: 'follow-end', followsSceneId: 'root' }),
        'deep-video': visualScene('deep-video', { type: 'follow-end', followsSceneId: 'deep' }, v),
        'deep-tail': scene('deep-tail', { type: 'follow-end', followsSceneId: 'deep-video' }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream, { [v]: 1 }), directorState: undefined });
    const rootY = projection.nodesBySceneId.root.rect.y;
    const deepY = projection.nodesBySceneId.deep.rect.y;

    expect(projection.mainCurve.points).toHaveLength(4);
    expect(deepY).toBe(rootY);
    expect(projection.nodesBySceneId['deep-video'].rect.y).toBe(rootY);
    expect(projection.nodesBySceneId['deep-tail'].rect.y).toBe(rootY);
    expect(projection.nodesBySceneId.middle.rect.y).toBeLessThan(rootY);
    expect(projection.nodesBySceneId.bottom.rect.y).toBeGreaterThan(rootY);
  });

  it('falls back to branch layout when duplicated auto-follow flow rects would overlap', () => {
    const duplicateFlow = { x: 400, y: 200, width: 214, height: 136 };
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'left', 'right'],
      scenes: {
        root: scene('root', { type: 'manual' }),
        left: { ...scene('left', { type: 'follow-end', followsSceneId: 'root' }), flow: duplicateFlow },
        right: { ...scene('right', { type: 'follow-end', followsSceneId: 'root' }), flow: duplicateFlow },
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    expect(projection.nodesBySceneId.left.usesDefaultRect).toBe(true);
    expect(projection.nodesBySceneId.right.usesDefaultRect).toBe(true);
    expect(projection.nodesBySceneId.left.rect.y).not.toBe(projection.nodesBySceneId.right.rect.y);
  });

  it('keeps a disabled auto-follow branch card in its authoring branch slot', () => {
    const enabledStream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['root', 'left', 'right'],
      scenes: {
        root: scene('root', { type: 'manual' }),
        left: scene('left', { type: 'follow-end', followsSceneId: 'root' }),
        right: scene('right', { type: 'follow-end', followsSceneId: 'root' }),
      },
    };
    const disabledStream: PersistedStreamConfig = {
      ...enabledStream,
      scenes: {
        ...enabledStream.scenes,
        right: { ...enabledStream.scenes.right, disabled: true },
      },
    };

    const enabledProjection = deriveStreamFlowProjection({
      stream: enabledStream,
      timeline: timeline(enabledStream),
      directorState: undefined,
    });
    const disabledProjection = deriveStreamFlowProjection({
      stream: disabledStream,
      timeline: timeline(disabledStream),
      directorState: undefined,
    });

    expect(disabledProjection.nodesBySceneId.right.status).toBe('disabled');
    expect(disabledProjection.nodesBySceneId.right.rect).toEqual(enabledProjection.nodesBySceneId.right.rect);
  });

  it('keeps a disabled manual root card in its main-lane authoring slot', () => {
    const enabledStream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['first', 'disabled-root', 'last'],
      scenes: {
        first: scene('first', { type: 'manual' }),
        'disabled-root': scene('disabled-root', { type: 'manual' }),
        last: scene('last', { type: 'manual' }),
      },
    };
    const disabledStream: PersistedStreamConfig = {
      ...enabledStream,
      scenes: {
        ...enabledStream.scenes,
        'disabled-root': { ...enabledStream.scenes['disabled-root'], disabled: true },
      },
    };

    const enabledProjection = deriveStreamFlowProjection({
      stream: enabledStream,
      timeline: timeline(enabledStream),
      directorState: undefined,
    });
    const disabledProjection = deriveStreamFlowProjection({
      stream: disabledStream,
      timeline: timeline(disabledStream),
      directorState: undefined,
    });

    expect(disabledProjection.nodesBySceneId['disabled-root'].status).toBe('disabled');
    expect(disabledProjection.nodesBySceneId['disabled-root'].rect).toEqual(enabledProjection.nodesBySceneId['disabled-root'].rect);
  });

  it('places the next main thread after the previous thread span', () => {
    const stream: PersistedStreamConfig = {
      id: 'stream',
      label: 'Stream',
      sceneOrder: ['wide', 'wide-child', 'next-root'],
      scenes: {
        wide: { ...scene('wide', { type: 'manual' }), flow: { x: 56, y: 230, width: 420, height: 136 } },
        'wide-child': scene('wide-child', { type: 'follow-end', followsSceneId: 'wide' }),
        'next-root': scene('next-root', { type: 'manual' }),
      },
    };

    const projection = deriveStreamFlowProjection({ stream, timeline: timeline(stream), directorState: undefined });

    const previousRight = projection.nodesBySceneId['wide-child'].rect.x + projection.nodesBySceneId['wide-child'].rect.width;
    expect(projection.nodesBySceneId['wide-child'].rect.x).toBeGreaterThan(projection.nodesBySceneId.wide.rect.x + 420);
    expect(projection.nodesBySceneId['next-root'].rect.x).toBeGreaterThan(previousRight);
  });
});
