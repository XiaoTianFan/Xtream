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
  SceneTrigger,
  StreamPlaybackSettings,
  StreamId,
  SubCueId,
  VisualId,
  VisualLayoutProfile,
  VirtualOutputId,
  VirtualOutputSourceSelection,
} from './types';
import {
  AUDIO_SUBCUE_LEVEL_MAX_DB,
  AUDIO_SUBCUE_LEVEL_MIN_DB,
  AUDIO_SUBCUE_PAN_MAX,
  AUDIO_SUBCUE_PAN_MIN,
  clampAudioAutomationPoints,
  clampPitchShiftSemitones,
  normalizeFadeSpec,
  normalizeAudioSourceRange,
} from './audioSubCueAutomation';
import { normalizeSceneTimingLinks } from './subCueTimingLink';
import { normalizeVisualFadeSpec, normalizeVisualFreezeFrameMs } from './visualSubCueTiming';

export const STREAM_MAIN_ID: StreamId = 'stream-main';
export const SCENE_FIRST_ID: SceneId = 'scene-1';
export const PATCH_COMPAT_SCENE_ID: SceneId = 'patch-compat-scene';

export const DEFAULT_STREAM_PLAYBACK_SETTINGS: StreamPlaybackSettings = {
  pausedPlayBehavior: 'selection-aware',
  multiTimelineResumeBehavior: 'resume-all-clocks',
  parallelTimelineSeekBehavior: 'leave-running',
  canonicalSceneStateSummary: 'last-instance',
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
    multiTimelineResumeBehavior:
      settings?.multiTimelineResumeBehavior === 'resume-all-clocks' || settings?.multiTimelineResumeBehavior === 'launch-focused-cue-only'
        ? settings.multiTimelineResumeBehavior
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.multiTimelineResumeBehavior,
    parallelTimelineSeekBehavior:
      settings?.parallelTimelineSeekBehavior === 'leave-running' ||
      settings?.parallelTimelineSeekBehavior === 'follow-relative-seek' ||
      settings?.parallelTimelineSeekBehavior === 'pause-parallel' ||
      settings?.parallelTimelineSeekBehavior === 'clear-parallel'
        ? settings.parallelTimelineSeekBehavior
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.parallelTimelineSeekBehavior,
    canonicalSceneStateSummary:
      settings?.canonicalSceneStateSummary === 'last-instance' || settings?.canonicalSceneStateSummary === 'first-instance'
        ? settings.canonicalSceneStateSummary
        : DEFAULT_STREAM_PLAYBACK_SETTINGS.canonicalSceneStateSummary,
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

/** Rewrites legacy trigger shapes from disk; idempotent on current `SceneTrigger` union. */
export function migrateSceneTriggerLoose(trigger: unknown): SceneTrigger {
  if (!trigger || typeof trigger !== 'object' || !('type' in trigger)) {
    return { type: 'manual' };
  }
  const t = trigger as {
    type: string;
    followsSceneId?: SceneId;
    offsetMs?: number;
    delayMs?: number;
    timecodeMs?: number;
  };
  switch (t.type) {
    case 'manual':
      return { type: 'manual' };
    case 'at-timecode':
      return { type: 'at-timecode', timecodeMs: typeof t.timecodeMs === 'number' ? t.timecodeMs : 0 };
    case 'simultaneous-start':
      return { type: 'follow-start', followsSceneId: t.followsSceneId };
    case 'time-offset': {
      const ms = typeof t.offsetMs === 'number' ? t.offsetMs : 0;
      return ms !== 0
        ? { type: 'follow-start', followsSceneId: t.followsSceneId, delayMs: ms }
        : { type: 'follow-start', followsSceneId: t.followsSceneId };
    }
    case 'follow-start': {
      const delayMs = typeof t.delayMs === 'number' ? t.delayMs : undefined;
      return delayMs !== undefined && delayMs !== 0
        ? { type: 'follow-start', followsSceneId: t.followsSceneId, delayMs }
        : { type: 'follow-start', followsSceneId: t.followsSceneId };
    }
    case 'follow-end': {
      const delayMs = typeof t.delayMs === 'number' ? t.delayMs : undefined;
      return delayMs !== undefined && delayMs !== 0
        ? { type: 'follow-end', followsSceneId: t.followsSceneId, delayMs }
        : { type: 'follow-end', followsSceneId: t.followsSceneId };
    }
    default:
      return { type: 'manual' };
  }
}

export function normalizeStreamPersistence(stream: PersistedStreamConfig): PersistedStreamConfig {
  const next = structuredClone(stream) as PersistedStreamConfig;
  for (const id of Object.keys(next.scenes)) {
    const scene = next.scenes[id];
    if (scene) {
      scene.trigger = migrateSceneTriggerLoose(scene.trigger);
      normalizeSceneTimingLinks(scene);
      for (const subCueId of Object.keys(scene.subCues)) {
        const subCue = scene.subCues[subCueId];
        if (subCue?.kind === 'visual') {
          subCue.fadeIn = normalizeVisualFadeSpec(subCue.fadeIn, undefined);
          subCue.fadeOut = normalizeVisualFadeSpec(subCue.fadeOut, undefined);
          subCue.freezeFrameMs = normalizeVisualFreezeFrameMs(subCue.freezeFrameMs, undefined);
          continue;
        }
        if (subCue?.kind !== 'audio') {
          continue;
        }
        if (subCue.sourceStartMs !== undefined || subCue.sourceEndMs !== undefined) {
          const range = normalizeAudioSourceRange({
            sourceStartMs: subCue.sourceStartMs,
            sourceEndMs: subCue.sourceEndMs,
          });
          subCue.sourceStartMs = range.startMs > 0 ? range.startMs : undefined;
          subCue.sourceEndMs = range.endMs !== undefined && range.endMs > range.startMs ? range.endMs : undefined;
        }
        if (subCue.pitchShiftSemitones !== undefined) {
          const pitch = clampPitchShiftSemitones(subCue.pitchShiftSemitones);
          subCue.pitchShiftSemitones = pitch === 0 ? undefined : pitch;
        }
        subCue.fadeIn = normalizeFadeSpec(subCue.fadeIn, undefined);
        subCue.fadeOut = normalizeFadeSpec(subCue.fadeOut, undefined);
        subCue.levelAutomation = clampAudioAutomationPoints(
          subCue.levelAutomation,
          undefined,
          AUDIO_SUBCUE_LEVEL_MIN_DB,
          AUDIO_SUBCUE_LEVEL_MAX_DB,
        );
        subCue.panAutomation = clampAudioAutomationPoints(
          subCue.panAutomation,
          undefined,
          AUDIO_SUBCUE_PAN_MIN,
          AUDIO_SUBCUE_PAN_MAX,
        );
      }
    }
  }
  return {
    ...next,
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

export function getDefaultStreamPersistence(): Pick<PersistedShowConfig, 'stream'> {
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
