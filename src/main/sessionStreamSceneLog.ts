import type { SceneId, SceneRuntimeState, StreamEnginePublicState } from '../shared/types';
import type { SessionLogPayload } from '../shared/showOpenProfile';
import { formatTimecode } from '../shared/timeline';

type SceneStatusSnapshot = {
  status: SceneRuntimeState['status'];
};

function runtimeRunId(state: StreamEnginePublicState): string {
  const runtime = state.runtime;
  const started = runtime?.startedWallTimeMs ?? runtime?.originWallTimeMs;
  return started === undefined ? 'stream-runtime' : `stream-runtime-${started}`;
}

function currentStreamMs(state: StreamEnginePublicState): number | undefined {
  const runtime = state.runtime;
  if (!runtime) {
    return undefined;
  }
  return runtime.currentStreamMs ?? runtime.pausedAtStreamMs ?? runtime.offsetStreamMs;
}

function sceneLabel(state: StreamEnginePublicState, sceneId: SceneId): string {
  return state.playbackStream.scenes[sceneId]?.title || state.stream.scenes[sceneId]?.title || sceneId;
}

function transitionPayload(
  state: StreamEnginePublicState,
  scene: SceneRuntimeState,
  previous: SceneStatusSnapshot | undefined,
): SessionLogPayload {
  const ms = currentStreamMs(state);
  return {
    runId: runtimeRunId(state),
    checkpoint: 'stream_scene_state_transition',
    domain: 'stream',
    kind: 'operation',
    extra: {
      sceneId: scene.sceneId,
      sceneTitle: sceneLabel(state, scene.sceneId),
      fromStatus: previous?.status,
      toStatus: scene.status,
      runtimeStatus: state.runtime?.status,
      currentStreamMs: ms,
      timelineTimecode: ms === undefined ? undefined : formatTimecode(ms / 1000),
      scheduledStartMs: scene.scheduledStartMs,
      startedAtStreamMs: scene.startedAtStreamMs,
      endedAtStreamMs: scene.endedAtStreamMs,
      progress: scene.progress,
      error: scene.error,
      initial: previous === undefined,
    },
  };
}

export class StreamSceneStateTransitionLogger {
  private previous = new Map<SceneId, SceneStatusSnapshot>();

  collect(state: StreamEnginePublicState): SessionLogPayload[] {
    if (!state.runtime) {
      this.previous.clear();
      return [];
    }

    const next = new Map<SceneId, SceneStatusSnapshot>();
    const rows: SessionLogPayload[] = [];

    for (const sceneId of state.stream.sceneOrder) {
      const scene = state.runtime.sceneStates[sceneId];
      if (!scene) {
        continue;
      }
      const previous = this.previous.get(sceneId);
      next.set(sceneId, { status: scene.status });
      if (previous?.status === scene.status) {
        continue;
      }
      rows.push(transitionPayload(state, scene, previous));
    }

    this.previous = next;
    return rows;
  }

  reset(): void {
    this.previous.clear();
  }
}
