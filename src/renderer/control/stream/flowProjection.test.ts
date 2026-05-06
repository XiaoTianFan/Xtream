import { describe, expect, it } from 'vitest';
import { buildStreamSchedule } from '../../../shared/streamSchedule';
import type { CalculatedStreamTimeline, PersistedSceneConfig, PersistedStreamConfig, SceneId } from '../../../shared/types';
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

function timeline(stream: PersistedStreamConfig): CalculatedStreamTimeline {
  const schedule = buildStreamSchedule(stream, { visualDurations: {}, audioDurations: {} });
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
});
