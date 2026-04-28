import type {
  DisplayWindowId,
  LoopState,
  PersistedSceneConfig,
  PersistedShowConfigV8,
  PersistedStreamConfig,
  PersistedVirtualOutputConfig,
  SceneId,
  SceneLoopPolicy,
  StreamId,
  SubCueId,
  VisualLayoutProfile,
} from './types';

export const STREAM_MAIN_ID: StreamId = 'stream-main';
export const SCENE_FIRST_ID: SceneId = 'scene-1';
export const PATCH_COMPAT_SCENE_ID: SceneId = 'patch-compat-scene';

export function loopStateToSceneLoopPolicy(loop: LoopState): SceneLoopPolicy {
  if (!loop.enabled) {
    return { enabled: false };
  }
  return {
    enabled: true,
    range: {
      startMs: Math.max(0, loop.startSeconds * 1000),
      endMs: loop.endSeconds !== undefined ? Math.max(0, loop.endSeconds * 1000) : undefined,
    },
    iterations: { type: 'infinite' },
  };
}

export function sceneLoopPolicyToLoopState(policy: SceneLoopPolicy): LoopState {
  if (!policy.enabled) {
    return { enabled: false, startSeconds: 0 };
  }
  const startMs = policy.range?.startMs ?? 0;
  const endMs = policy.range?.endMs;
  return {
    enabled: true,
    startSeconds: startMs / 1000,
    endSeconds: endMs !== undefined ? endMs / 1000 : undefined,
  };
}

export function createEmptyUserScene(id: SceneId, title: string): PersistedSceneConfig {
  return {
    id,
    title,
    trigger: { type: 'manual' },
    loop: { enabled: false },
    preload: { enabled: false },
    subCueOrder: [],
    subCues: {},
  };
}

export function getDefaultStreamPersistence(): Pick<PersistedShowConfigV8, 'streams' | 'activeStreamId'> {
  const firstScene = createEmptyUserScene(SCENE_FIRST_ID, 'Scene 1');
  const mainStream: PersistedStreamConfig = {
    id: STREAM_MAIN_ID,
    label: 'Main Stream',
    sceneOrder: [SCENE_FIRST_ID],
    scenes: { [SCENE_FIRST_ID]: firstScene },
  };
  return {
    streams: { [STREAM_MAIN_ID]: mainStream },
    activeStreamId: STREAM_MAIN_ID,
  };
}

type PatchLayoutDisplay = {
  id: DisplayWindowId;
  layout: VisualLayoutProfile;
};

/** Build the hidden Patch compatibility scene from current Patch routing (displays + outputs). */
export function buildPatchCompatibilityScene(
  loop: LoopState,
  displays: PatchLayoutDisplay[],
  outputs: Record<string, Pick<PersistedVirtualOutputConfig, 'id' | 'sources'>>,
): PersistedSceneConfig {
  const subCueOrder: SubCueId[] = [];
  const subCues: PersistedSceneConfig['subCues'] = {};

  const sortedDisplays = [...displays].sort((a, b) => a.id.localeCompare(b.id));
  for (const display of sortedDisplays) {
    const layout = display.layout;
    if (layout.type === 'single') {
      if (layout.visualId) {
        const id = `patch-vis-${display.id}-single` as SubCueId;
        subCueOrder.push(id);
        subCues[id] = {
          id,
          kind: 'visual',
          visualId: layout.visualId,
          targets: [{ displayId: display.id }],
          playbackRate: 1,
        };
      }
    } else {
      const zones = [
        { zone: 'split-left' as const, visualId: layout.visualIds[0] },
        { zone: 'split-right' as const, visualId: layout.visualIds[1] },
      ];
      for (const { zone, visualId } of zones) {
        if (visualId) {
          const id = `patch-vis-${display.id}-${zone}` as SubCueId;
          subCueOrder.push(id);
          subCues[id] = {
            id,
            kind: 'visual',
            visualId,
            targets: [{ displayId: display.id, zoneId: zone }],
            playbackRate: 1,
          };
        }
      }
    }
  }

  const sortedOutputs = Object.values(outputs).sort((a, b) => a.id.localeCompare(b.id));
  for (const output of sortedOutputs) {
    output.sources.forEach((source, index) => {
      const id = `patch-aud-${output.id}-${index}` as SubCueId;
      subCueOrder.push(id);
      subCues[id] = {
        id,
        kind: 'audio',
        audioSourceId: source.audioSourceId,
        outputIds: [output.id],
        levelDb: source.levelDb,
        pan: source.pan,
        playbackRate: 1,
      };
    });
  }

  return {
    id: PATCH_COMPAT_SCENE_ID,
    title: 'Patch Compatibility',
    trigger: { type: 'manual' },
    loop: loopStateToSceneLoopPolicy(loop),
    preload: { enabled: false },
    subCueOrder,
    subCues,
  };
}
