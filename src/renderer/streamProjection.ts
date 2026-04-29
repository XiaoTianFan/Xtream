import type {
  AudioSourceState,
  DirectorState,
  LoopState,
  StreamEnginePublicState,
  VirtualOutputSourceSelection,
  VisualLayoutProfile,
  VisualState,
} from '../shared/types';

type RuntimeOffset = {
  runtimeOffsetSeconds?: number;
  runtimeLoop?: LoopState;
};

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
    const cloneId = `stream-audio:${cue.sceneId}:${cue.subCueId}:${cue.outputId}`;
    derived.audioSources[cloneId] = {
      ...source,
      id: cloneId,
      label: `${source.label}`,
      playbackRate: (source.playbackRate ?? 1) * cue.playbackRate,
      durationSeconds: cue.localEndMs !== undefined ? cue.localEndMs / 1000 : source.durationSeconds,
      ready: source.ready,
      error: source.error,
      runtimeOffsetSeconds: (cue.streamStartMs + cue.localStartMs) / 1000,
      runtimeLoop: cue.mediaLoop,
    } as AudioSourceState & RuntimeOffset;
    const selection: VirtualOutputSourceSelection = {
      id: cloneId,
      audioSourceId: cloneId,
      levelDb: cue.levelDb + gainFactorToDb(fadeFactor),
      pan: cue.pan ?? 0,
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

  const displaySlots = new Map<string, { single?: string; left?: string; right?: string }>();
  for (const cue of runtime.activeVisualSubCues ?? []) {
    const visual = state.visuals[cue.visualId];
    const display = derived.displays[cue.target.displayId];
    if (!visual || !display) {
      continue;
    }
    const fadeFactor = cueFadeFactor(cue, nowWallTimeMs);
    const cloneId = `stream-visual:${cue.sceneId}:${cue.subCueId}:${cue.target.displayId}:${cue.target.zoneId ?? 'single'}`;
    derived.visuals[cloneId] = {
      ...visual,
      id: cloneId,
      opacity: (visual.opacity ?? 1) * fadeFactor,
      playbackRate: (visual.playbackRate ?? 1) * cue.playbackRate,
      durationSeconds: cue.localEndMs !== undefined ? cue.localEndMs / 1000 : visual.durationSeconds,
      runtimeOffsetSeconds: (cue.streamStartMs + cue.localStartMs) / 1000,
      runtimeLoop: cue.mediaLoop,
    } as VisualState & RuntimeOffset;
    const slots = displaySlots.get(display.id) ?? {};
    const zone = cue.target.zoneId ?? 'single';
    if (zone === 'L') {
      slots.left = cloneId;
    } else if (zone === 'R') {
      slots.right = cloneId;
    } else {
      slots.single = cloneId;
    }
    displaySlots.set(display.id, slots);
    derived.activeTimeline.assignedVideoIds.push(cloneId);
  }

  for (const [displayId, slots] of displaySlots) {
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
