import type {
  DisplayWindowId,
  LoopState,
  PersistedAudioSubCueConfig,
  PersistedDisplayConfigV8,
  PersistedSceneConfig,
  PersistedShowConfig,
  PersistedShowConfigV8,
  PersistedStreamConfig,
  PersistedVirtualOutputConfig,
  SceneId,
  SceneLoopPolicy,
  StreamPlaybackSettings,
  StreamId,
  SubCueId,
  VisualId,
  VisualLayoutProfile,
  VirtualOutputId,
  VirtualOutputSourceSelection,
} from './types';

export const STREAM_MAIN_ID: StreamId = 'stream-main';
export const SCENE_FIRST_ID: SceneId = 'scene-1';
export const PATCH_COMPAT_SCENE_ID: SceneId = 'patch-compat-scene';

export const DEFAULT_STREAM_PLAYBACK_SETTINGS: StreamPlaybackSettings = {
  pausedPlayBehavior: 'selection-aware',
  runningEditOrphanPolicy: 'fade-out',
  runningEditOrphanFadeOutMs: 500,
};

export function normalizeStreamPlaybackSettings(settings: Partial<StreamPlaybackSettings> | undefined): StreamPlaybackSettings {
  const fadeOutMs = settings?.runningEditOrphanFadeOutMs;
  return {
    pausedPlayBehavior:
      settings?.pausedPlayBehavior === 'preserve-paused-cursor' || settings?.pausedPlayBehavior === 'selection-aware'
        ? settings.pausedPlayBehavior
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.pausedPlayBehavior,
    runningEditOrphanPolicy:
      settings?.runningEditOrphanPolicy === 'let-finish' || settings?.runningEditOrphanPolicy === 'fade-out'
        ? settings.runningEditOrphanPolicy
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.runningEditOrphanPolicy,
    runningEditOrphanFadeOutMs:
      fadeOutMs !== undefined && Number.isFinite(fadeOutMs)
        ? Math.min(60_000, Math.max(50, fadeOutMs))
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.runningEditOrphanFadeOutMs,
  };
}

export function normalizeStreamPersistence(stream: PersistedStreamConfig): PersistedStreamConfig {
  return {
    ...structuredClone(stream),
    playbackSettings: normalizeStreamPlaybackSettings(stream.playbackSettings),
  };
}

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

export function getDefaultStreamPersistence(): Pick<PersistedShowConfigV8, 'stream'> {
  const firstScene = createEmptyUserScene(SCENE_FIRST_ID, 'Scene 1');
  const mainStream: PersistedStreamConfig = {
    id: STREAM_MAIN_ID,
    label: 'Main Stream',
    sceneOrder: [SCENE_FIRST_ID],
    scenes: { [SCENE_FIRST_ID]: firstScene },
    playbackSettings: DEFAULT_STREAM_PLAYBACK_SETTINGS,
  };
  return {
    stream: mainStream,
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
        { zone: 'L' as const, visualId: layout.visualIds[0] },
        { zone: 'R' as const, visualId: layout.visualIds[1] },
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
      const audioCue: PersistedAudioSubCueConfig = {
        id,
        kind: 'audio',
        audioSourceId: source.audioSourceId,
        outputIds: [output.id],
        levelDb: source.levelDb,
        pan: source.pan,
        playbackRate: 1,
      };
      if (source.id !== undefined) {
        audioCue.outputSourceSelectionId = source.id;
      }
      if (source.muted !== undefined) {
        audioCue.muted = source.muted;
      }
      if (source.solo !== undefined) {
        audioCue.solo = source.solo;
      }
      subCues[id] = audioCue;
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

type PatchDisplayVisualSlots = {
  single?: VisualId;
  left?: VisualId;
  right?: VisualId;
};

/**
 * Inverse of {@link buildPatchCompatibilityScene}: derive persisted Patch display layouts and
 * virtual output source lists from the hidden compatibility scene so v8 shows stay consistent
 * when the scene is authoritative (e.g. hand-edited or migrated).
 */
export function applyPatchCompatibilitySceneToPersistedRouting(
  scene: PersistedSceneConfig,
  displays: PersistedDisplayConfigV8[],
  outputs: Record<VirtualOutputId, PersistedVirtualOutputConfig>,
): {
  displays: PersistedDisplayConfigV8[];
  outputs: Record<VirtualOutputId, PersistedVirtualOutputConfig>;
} {
  const displaySlots = new Map<DisplayWindowId, PatchDisplayVisualSlots>();
  const outputSources = new Map<VirtualOutputId, VirtualOutputSourceSelection[]>();

  for (const cueId of scene.subCueOrder) {
    const cue = scene.subCues[cueId];
    if (!cue) {
      continue;
    }
    if (cue.kind === 'visual') {
      for (const t of cue.targets) {
        const slot = displaySlots.get(t.displayId) ?? {};
        const zone = (t.zoneId ?? 'single') as 'single' | 'L' | 'R' | 'split-left' | 'split-right';
        if (zone === 'single') {
          slot.single = cue.visualId;
        } else if (zone === 'L' || zone === 'split-left') {
          slot.left = cue.visualId;
        } else if (zone === 'R' || zone === 'split-right') {
          slot.right = cue.visualId;
        }
        displaySlots.set(t.displayId, slot);
      }
    } else if (cue.kind === 'audio') {
      for (const outId of cue.outputIds) {
        const list = outputSources.get(outId) ?? [];
        const sel: VirtualOutputSourceSelection = {
          audioSourceId: cue.audioSourceId,
          levelDb: cue.levelDb ?? 0,
          pan: cue.pan ?? 0,
        };
        if (cue.outputSourceSelectionId !== undefined) {
          sel.id = cue.outputSourceSelectionId;
        }
        if (cue.muted !== undefined) {
          sel.muted = cue.muted;
        }
        if (cue.solo !== undefined) {
          sel.solo = cue.solo;
        }
        list.push(sel);
        outputSources.set(outId, list);
      }
    }
  }

  const nextDisplays = displays.map((d) => {
    const id = d.id;
    if (!id) {
      return d;
    }
    const slot = displaySlots.get(id);
    if (!slot) {
      const empty: VisualLayoutProfile =
        d.layout.type === 'split' ? { type: 'split', visualIds: [undefined, undefined] } : { type: 'single' };
      return { ...d, layout: empty };
    }
    let layout: VisualLayoutProfile;
    if (slot.left !== undefined || slot.right !== undefined) {
      layout = { type: 'split', visualIds: [slot.left, slot.right] };
    } else if (slot.single !== undefined) {
      layout = { type: 'single', visualId: slot.single };
    } else {
      layout = d.layout.type === 'split' ? { type: 'split', visualIds: [undefined, undefined] } : { type: 'single' };
    }
    return { ...d, layout };
  });

  const nextOutputs: Record<VirtualOutputId, PersistedVirtualOutputConfig> = {};
  for (const [id, o] of Object.entries(outputs)) {
    const sources = outputSources.get(id) ?? [];
    nextOutputs[id] = { ...o, sources: sources.map((s) => ({ ...s })) };
  }

  return { displays: nextDisplays, outputs: nextOutputs };
}

/** Apply Patch compatibility scene routing over top-level persisted displays/outputs (v8). */
export function mergeShowConfigPatchRouting(config: PersistedShowConfig): PersistedShowConfig {
  const { displays, outputs } = applyPatchCompatibilitySceneToPersistedRouting(
    config.patchCompatibility.scene,
    config.displays,
    config.outputs,
  );
  return { ...config, displays, outputs };
}
