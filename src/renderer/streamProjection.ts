import type {
  AudioSourceState,
  DisplayWindowId,
  DisplayZoneId,
  DirectorState,
  LoopState,
  PersistedDisplayConfigV8,
  SceneId,
  StreamRuntimeVisualSubCue,
  StreamEnginePublicState,
  SubCueId,
  VirtualOutputSourceSelection,
  VisualId,
  VisualLayoutProfile,
  VisualMingleAlgorithm,
  VisualMingleMode,
  VisualMingleSettings,
  VisualState,
} from '../shared/types';
import { clampPitchShiftSemitones, normalizeAudioSourceRange } from '../shared/audioSubCueAutomation';

type RuntimeOffset = {
  runtimeOffsetSeconds?: number;
  runtimeLoop?: LoopState;
};

export type StreamDisplayLayer = {
  layerId: VisualId;
  sourceVisualId: VisualId;
  displayId: DisplayWindowId;
  zoneId: DisplayZoneId;
  visual: VisualState & RuntimeOffset;
  timelineId?: string;
  timelineKind?: 'main' | 'parallel';
  timelineOrderIndex: number;
  threadOrderIndex: number;
  runtimeInstanceId?: string;
  sceneId: SceneId;
  sceneOrderIndex: number;
  subCueId: SubCueId;
  subCueOrderIndex: number;
  streamStartMs: number;
  localStartMs: number;
  absoluteStartMs: number;
  order: number;
  selected: boolean;
  opacity: number;
  blendAlgorithm: VisualMingleAlgorithm;
  transitionMs: number;
  orphaned: boolean;
};

export type StreamDisplayZoneFrame = {
  zoneId: DisplayZoneId;
  layers: StreamDisplayLayer[];
};

export type StreamDisplayFrame = {
  displayId: DisplayWindowId;
  layout: VisualLayoutProfile;
  mode: VisualMingleMode;
  algorithm: VisualMingleAlgorithm;
  transitionMs: number;
  zones: StreamDisplayZoneFrame[];
};

const DEFAULT_VISUAL_MINGLE_SETTINGS: Required<VisualMingleSettings> = {
  mode: 'prioritize-latest',
  algorithm: 'latest',
  defaultTransitionMs: 0,
};

export function normalizeVisualMingleSettings(
  settings: PersistedDisplayConfigV8['visualMingle'] | undefined,
): Required<VisualMingleSettings> {
  const mode: VisualMingleMode = settings?.mode === 'layered' || settings?.mode === 'prioritize-latest'
    ? settings.mode
    : DEFAULT_VISUAL_MINGLE_SETTINGS.mode;
  const algorithm = isVisualMingleAlgorithm(settings?.algorithm)
    ? settings.algorithm
    : DEFAULT_VISUAL_MINGLE_SETTINGS.algorithm;
  const defaultTransitionMs =
    settings?.defaultTransitionMs !== undefined && Number.isFinite(settings.defaultTransitionMs)
      ? Math.max(0, Math.round(settings.defaultTransitionMs))
      : DEFAULT_VISUAL_MINGLE_SETTINGS.defaultTransitionMs;
  return { mode, algorithm, defaultTransitionMs };
}

function isVisualMingleAlgorithm(value: unknown): value is VisualMingleAlgorithm {
  return (
    value === 'latest' ||
    value === 'alpha-over' ||
    value === 'additive' ||
    value === 'multiply' ||
    value === 'screen' ||
    value === 'lighten' ||
    value === 'darken' ||
    value === 'crossfade'
  );
}

function cueFadeFactor(cue: { fadeOutStartedWallTimeMs?: number; fadeOutDurationMs?: number }, nowWallTimeMs: number): number {
  if (cue.fadeOutStartedWallTimeMs === undefined || cue.fadeOutDurationMs === undefined || cue.fadeOutDurationMs <= 0) {
    return 1;
  }
  const elapsed = nowWallTimeMs - cue.fadeOutStartedWallTimeMs;
  return Math.max(0, Math.min(1, 1 - elapsed / cue.fadeOutDurationMs));
}

function gainFactorToDb(factor: number): number {
  return factor <= 0 ? -120 : 20 * Math.log10(factor);
}

function isStreamRuntimeActive(streamState: StreamEnginePublicState | undefined): boolean {
  const status = streamState?.runtime?.status;
  return status === 'running' || status === 'paused' || status === 'preloading';
}

function timelineCurrentMs(streamState: StreamEnginePublicState): number {
  const runtime = streamState.runtime;
  return Math.max(0, runtime?.currentStreamMs ?? runtime?.pausedAtStreamMs ?? runtime?.pausedCursorMs ?? runtime?.offsetStreamMs ?? 0);
}

function sceneOrderIndex(streamState: StreamEnginePublicState, sceneId: SceneId): number {
  const index = streamState.playbackStream.sceneOrder.indexOf(sceneId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function subCueOrderIndex(streamState: StreamEnginePublicState, sceneId: SceneId, subCueId: SubCueId): number {
  const index = streamState.playbackStream.scenes[sceneId]?.subCueOrder.indexOf(subCueId) ?? -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function runtimeTimelineSort(streamState: StreamEnginePublicState, cue: StreamRuntimeVisualSubCue): {
  timelineId?: string;
  timelineKind?: 'main' | 'parallel';
  timelineOrderIndex: number;
  threadOrderIndex: number;
} {
  const runtime = streamState.runtime;
  const instance = cue.runtimeInstanceId ? runtime?.threadInstances?.[cue.runtimeInstanceId] : undefined;
  const timeline = instance?.timelineId ? runtime?.timelineInstances?.[instance.timelineId] : undefined;
  const timelineOrder = runtime?.timelineOrder ?? Object.keys(runtime?.timelineInstances ?? {});
  const timelineOrderIndex = instance?.timelineId ? timelineOrder.indexOf(instance.timelineId) : -1;
  const threadOrderIndex = instance && timeline ? timeline.orderedThreadInstanceIds.indexOf(instance.id) : -1;
  return {
    timelineId: instance?.timelineId,
    timelineKind: timeline?.kind,
    timelineOrderIndex: timelineOrderIndex >= 0 ? timelineOrderIndex : Number.MAX_SAFE_INTEGER,
    threadOrderIndex: threadOrderIndex >= 0 ? threadOrderIndex : Number.MAX_SAFE_INTEGER,
  };
}

function compareDisplayLayers(left: StreamDisplayLayer, right: StreamDisplayLayer): number {
  return (
    left.absoluteStartMs - right.absoluteStartMs ||
    left.timelineOrderIndex - right.timelineOrderIndex ||
    left.threadOrderIndex - right.threadOrderIndex ||
    (left.runtimeInstanceId ?? '').localeCompare(right.runtimeInstanceId ?? '') ||
    left.sceneOrderIndex - right.sceneOrderIndex ||
    left.subCueOrderIndex - right.subCueOrderIndex ||
    left.layerId.localeCompare(right.layerId)
  );
}

function createStreamVisualLayer(args: {
  cue: StreamRuntimeVisualSubCue;
  visual: VisualState;
  streamState: StreamEnginePublicState;
  nowWallTimeMs: number;
  order: number;
  settings: Required<VisualMingleSettings>;
}): StreamDisplayLayer {
  const { cue, visual, streamState, nowWallTimeMs, order, settings } = args;
  const zoneId = cue.target.zoneId ?? 'single';
  const absoluteStartMs = cue.streamStartMs + cue.localStartMs;
  const timelineSort = runtimeTimelineSort(streamState, cue);
  const layerId = `stream-visual:${timelineSort.timelineId ?? 'canonical'}:${cue.runtimeInstanceId ?? 'canonical'}:${cue.sceneId}:${cue.subCueId}:${
    cue.target.displayId
  }:${zoneId}:${cue.streamStartMs}:${cue.localStartMs}`;
  const fadeFactor = cueFadeFactor(cue, nowWallTimeMs);
  const projectedVisual = {
    ...visual,
    id: layerId,
    opacity: (visual.opacity ?? 1) * fadeFactor,
    playbackRate: (visual.playbackRate ?? 1) * cue.playbackRate,
    durationSeconds: cue.localEndMs !== undefined ? cue.localEndMs / 1000 : visual.durationSeconds,
    runtimeOffsetSeconds: absoluteStartMs / 1000,
    runtimeLoop: cue.mediaLoop,
  } as VisualState & RuntimeOffset;
  return {
    layerId,
    sourceVisualId: cue.visualId,
    displayId: cue.target.displayId,
    zoneId,
    visual: projectedVisual,
    ...timelineSort,
    runtimeInstanceId: cue.runtimeInstanceId,
    sceneId: cue.sceneId,
    sceneOrderIndex: sceneOrderIndex(streamState, cue.sceneId),
    subCueId: cue.subCueId,
    subCueOrderIndex: subCueOrderIndex(streamState, cue.sceneId, cue.subCueId),
    streamStartMs: cue.streamStartMs,
    localStartMs: cue.localStartMs,
    absoluteStartMs,
    order,
    selected: false,
    opacity: projectedVisual.opacity ?? 1,
    blendAlgorithm: settings.algorithm,
    transitionMs: settings.defaultTransitionMs,
    orphaned: cue.orphaned === true,
  };
}

function chooseDisplayLayout(zones: StreamDisplayZoneFrame[], fallback: VisualLayoutProfile): VisualLayoutProfile {
  const hasSplitZones = zones.some((zone) => zone.zoneId === 'L' || zone.zoneId === 'R');
  return hasSplitZones ? { type: 'split', visualIds: [undefined, undefined] } : emptyLayoutFor(fallback);
}

function selectZoneLayers(
  layers: StreamDisplayLayer[],
  settings: Required<VisualMingleSettings>,
  currentMs: number,
): StreamDisplayLayer[] {
  if (settings.mode === 'layered') {
    return layers.map((layer) => ({ ...layer, selected: true }));
  }
  const latest = layers[layers.length - 1];
  if (!latest) {
    return [];
  }
  const transitionMs = settings.defaultTransitionMs;
  if (transitionMs <= 0 || layers.length === 1) {
    return layers.map((layer) => ({ ...layer, selected: layer.layerId === latest.layerId, opacity: layer.layerId === latest.layerId ? layer.opacity : 0 }));
  }
  const previous = layers[layers.length - 2];
  const progress = Math.max(0, Math.min(1, (currentMs - latest.absoluteStartMs) / transitionMs));
  return layers.map((layer) => {
    if (layer.layerId === latest.layerId) {
      return { ...layer, selected: true, opacity: layer.opacity * progress };
    }
    if (previous && layer.layerId === previous.layerId && progress < 1) {
      return { ...layer, selected: true, opacity: layer.opacity * (1 - progress) };
    }
    return { ...layer, selected: false, opacity: 0 };
  });
}

export function buildStreamDisplayFrames(
  state: DirectorState,
  streamState: StreamEnginePublicState | undefined,
): Record<DisplayWindowId, StreamDisplayFrame> {
  const runtime = streamState?.runtime;
  if (!isStreamRuntimeActive(streamState) || !runtime || !streamState) {
    return {};
  }
  const nowWallTimeMs = Date.now();
  const currentMs = timelineCurrentMs(streamState);
  const layersByDisplayZone = new Map<DisplayWindowId, Map<DisplayZoneId, StreamDisplayLayer[]>>();
  let order = 0;
  for (const cue of runtime.activeVisualSubCues ?? []) {
    const visual = state.visuals[cue.visualId];
    const display = state.displays[cue.target.displayId];
    if (!visual || !display) {
      continue;
    }
    const settings = normalizeVisualMingleSettings(state.displayVisualMingle?.[display.id]);
    const layer = createStreamVisualLayer({ cue, visual, streamState, nowWallTimeMs, order, settings });
    order += 1;
    const byZone = layersByDisplayZone.get(display.id) ?? new Map<DisplayZoneId, StreamDisplayLayer[]>();
    const zoneLayers = byZone.get(layer.zoneId) ?? [];
    zoneLayers.push(layer);
    byZone.set(layer.zoneId, zoneLayers);
    layersByDisplayZone.set(display.id, byZone);
  }

  const frames: Record<DisplayWindowId, StreamDisplayFrame> = {};
  for (const display of Object.values(state.displays)) {
    const settings = normalizeVisualMingleSettings(state.displayVisualMingle?.[display.id]);
    const byZone = layersByDisplayZone.get(display.id) ?? new Map<DisplayZoneId, StreamDisplayLayer[]>();
    const zones: StreamDisplayZoneFrame[] = [];
    for (const zoneId of (['single', 'L', 'R'] as DisplayZoneId[])) {
      const layers = [...(byZone.get(zoneId) ?? [])].sort(compareDisplayLayers);
      if (layers.length === 0) {
        continue;
      }
      zones.push({ zoneId, layers: selectZoneLayers(layers, settings, currentMs) });
    }
    frames[display.id] = {
      displayId: display.id,
      layout: chooseDisplayLayout(zones, display.layout),
      mode: settings.mode,
      algorithm: settings.algorithm,
      transitionMs: settings.defaultTransitionMs,
      zones,
    };
  }
  return frames;
}

export function deriveDirectorStateForStream(state: DirectorState, streamState: StreamEnginePublicState | undefined): DirectorState {
  const runtime = streamState?.runtime;
  if (!isStreamRuntimeActive(streamState) || !runtime) {
    return state;
  }
  const nowWallTimeMs = Date.now();

  const sceneStateValues = Object.values(runtime.sceneStates ?? {});
  /** No scene playing, but we have per-row state — avoid chasing a planned start while manual rows wait. */
  const freezeDerivedTimeline =
    runtime.status === 'running' &&
    runtime.originWallTimeMs !== undefined &&
    sceneStateValues.length > 0 &&
    !sceneStateValues.some((s) => s.status === 'running' || s.status === 'preloading');

  const paused = runtime.status !== 'running' || freezeDerivedTimeline;
  const offsetSeconds = paused
    ? (runtime.pausedAtStreamMs ?? runtime.currentStreamMs ?? runtime.offsetStreamMs ?? 0) / 1000
    : (runtime.offsetStreamMs ?? runtime.currentStreamMs ?? 0) / 1000;
  const derived: DirectorState = {
    ...state,
    paused,
    anchorWallTimeMs:
      runtime.status === 'running' && !freezeDerivedTimeline
        ? (runtime.originWallTimeMs ?? Date.now())
        : Date.now(),
    offsetSeconds,
    loop: { enabled: false, startSeconds: 0 },
    audioSources: { ...state.audioSources },
    visuals: { ...state.visuals },
    outputs: Object.fromEntries(
      Object.entries(state.outputs).map(([id, output]) => [
        id,
        {
          ...output,
          sources: [],
        },
      ]),
    ),
    displays: Object.fromEntries(
      Object.entries(state.displays).map(([id, display]) => [
        id,
        {
          ...display,
          layout: emptyLayoutFor(display.layout),
        },
      ]),
    ),
    activeTimeline: {
      assignedVideoIds: [],
      activeAudioSourceIds: [],
      durationSeconds: runtime.expectedDurationMs !== undefined ? runtime.expectedDurationMs / 1000 : undefined,
      loopRangeLimit: runtime.expectedDurationMs !== undefined ? { startSeconds: 0, endSeconds: runtime.expectedDurationMs / 1000 } : undefined,
      notice: runtime.timelineNotice,
    },
  };

  for (const cue of runtime.activeAudioSubCues ?? []) {
    const source = state.audioSources[cue.audioSourceId];
    const output = derived.outputs[cue.outputId];
    if (!source || !output) {
      continue;
    }
    const fadeFactor = cueFadeFactor(cue, nowWallTimeMs);
    const cloneId = `stream-audio:${cue.sceneId}:${cue.subCueId}:${cue.outputId}${cue.runtimeInstanceId ? `:${cue.runtimeInstanceId}` : ''}`;
    const sourceRange = normalizeAudioSourceRange({
      sourceStartMs: cue.sourceStartMs,
      sourceEndMs: cue.sourceEndMs,
      sourceDurationMs: source.durationSeconds !== undefined ? source.durationSeconds * 1000 : undefined,
    });
    derived.audioSources[cloneId] = {
      ...source,
      id: cloneId,
      label: `${source.label}`,
      playbackRate: (source.playbackRate ?? 1) * cue.playbackRate,
      durationSeconds: cue.localEndMs !== undefined ? cue.localEndMs / 1000 : source.durationSeconds,
      ready: source.ready,
      error: source.error,
      runtimeOffsetSeconds: (cue.streamStartMs + cue.localStartMs) / 1000,
      runtimeSourceStartSeconds: sourceRange.startMs / 1000,
      runtimeSourceEndSeconds: sourceRange.endMs !== undefined ? sourceRange.endMs / 1000 : undefined,
      runtimePitchShiftSemitones: clampPitchShiftSemitones(cue.pitchShiftSemitones),
      runtimeLoop: cue.mediaLoop,
    } as AudioSourceState & RuntimeOffset;
    const selection: VirtualOutputSourceSelection = {
      id: cloneId,
      audioSourceId: cloneId,
      levelDb: cue.levelDb + gainFactorToDb(fadeFactor),
      pan: cue.pan ?? 0,
      runtimeSubCueStartMs: cue.streamStartMs + cue.localStartMs,
      runtimeFadeIn: cue.fadeIn,
      runtimeFadeOut: cue.fadeOut,
      runtimeLevelAutomation: cue.levelAutomation,
      runtimePanAutomation: cue.panAutomation,
    };
    if (cue.muted !== undefined) {
      selection.muted = cue.muted;
    }
    if (cue.solo !== undefined) {
      selection.solo = cue.solo;
    }
    output.sources.push(selection);
    derived.activeTimeline.activeAudioSourceIds.push(cloneId);
  }

  const frames = buildStreamDisplayFrames(state, streamState);
  for (const frame of Object.values(frames)) {
    const slots: { single?: string; left?: string; right?: string } = {};
    for (const zone of frame.zones) {
      for (const layer of zone.layers) {
        derived.visuals[layer.layerId] = layer.visual;
        derived.activeTimeline.assignedVideoIds.push(layer.layerId);
        if (!layer.selected) {
          continue;
        }
        if (zone.zoneId === 'L') {
          slots.left = layer.layerId;
        } else if (zone.zoneId === 'R') {
          slots.right = layer.layerId;
        } else {
          slots.single = layer.layerId;
        }
      }
    }
    const displayId = frame.displayId;
    const display = derived.displays[displayId];
    if (!display) {
      continue;
    }
    display.layout =
      slots.left !== undefined || slots.right !== undefined
        ? { type: 'split', visualIds: [slots.left, slots.right] }
        : { type: 'single', visualId: slots.single };
  }

  return derived;
}

function emptyLayoutFor(layout: VisualLayoutProfile): VisualLayoutProfile {
  return layout.type === 'split' ? { type: 'split', visualIds: [undefined, undefined] } : { type: 'single' };
}
