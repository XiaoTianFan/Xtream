import { getAudioEffectiveTime, getDirectorSeconds } from '../../../shared/timeline';
import {
  clampPitchShiftSemitones,
  evaluateAudioSubCueLevelDb,
  evaluateAudioSubCuePan,
  evaluateFadeGain,
} from '../../../shared/audioSubCueAutomation';
import type {
  AudioSourceState,
  AudioSubCuePreviewCommand,
  AudioSubCuePreviewPayload,
  DirectorState,
  LoopState,
  MeterLaneState,
  VirtualOutputSourceSelection,
  VirtualOutputState,
} from '../../../shared/types';
import { createPlaybackSyncKey, requestMediaPlay, syncTimedMediaElement } from './mediaSync';

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSourceRuntime = {
  selectionId: string;
  audioSourceId: string;
  graphKey: string;
  element: HTMLMediaElement;
  sourceNode: MediaElementAudioSourceNode;
  pitchNode?: AudioNode;
  gainNode: GainNode;
  sourcePanner: StereoPannerNode;
  meterLanes: SourceMeterLaneRuntime[];
  pendingFadeIn: boolean;
  removalTimer?: number;
};

type SourceMeterLaneRuntime = {
  id: string;
  label: string;
  audioSourceId: string;
  channelIndex: number;
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
};

type OutputSinkRouting = 'contextSink' | 'mediaElementSink';

type OutputRuntime = {
  outputId: string;
  graphKey: string;
  context: AudioContext;
  sources: OutputSourceRuntime[];
  busGain: GainNode;
  busPanner: StereoPannerNode;
  globalMuteGain: GainNode;
  envelopeGain: GainNode;
  /** Per-bus output delay; meters tap sources before this node. */
  delayNode: DelayNode;
  analyser: AnalyserNode;
  routing: OutputSinkRouting;
  destination?: MediaStreamAudioDestinationNode;
  sinkElement?: SinkCapableAudioElement;
  meterData: Uint8Array<ArrayBuffer>;
  lastMeterReportMs: number;
  transportPlaying: boolean;
  envelopeTargetGain: number;
  fadePauseTimer?: number;
};

type TransportEnvelopeMode = 'playing' | 'fading-out' | 'paused';

export const OUTPUT_BUS_DELAY_MAX_MS = 3000;
const OUTPUT_DELAY_MAX_SECONDS = OUTPUT_BUS_DELAY_MAX_MS / 1000;
const DELAY_SMOOTH_SECONDS = 0.02;
const SOURCE_GAIN_SMOOTH_SECONDS = 0.015;
const SOURCE_REMOVE_FADE_MS = 45;
const SOURCE_REMOVE_FADE_SECONDS = SOURCE_REMOVE_FADE_MS / 1000;
/** Pause/stop (and resume) envelope ramp; set to 1000ms to verify audibility. */
const TRANSPORT_FADE_MS = 85;
const TRANSPORT_FADE_SECONDS = TRANSPORT_FADE_MS / 1000;
/** On-screen level meter: bottom of scale (silence / noise floor). */
export const METER_DISPLAY_FLOOR_DB = -60;
/** Top of graticule: 0 dB ≈ full scale; levels above read as 100% (clip). */
export const METER_DISPLAY_CEIL_DB = 0;
const METER_SPAN_DB = METER_DISPLAY_CEIL_DB - METER_DISPLAY_FLOOR_DB;

const METER_FLOOR_DB = METER_DISPLAY_FLOOR_DB;
const METER_CLIP_DB = METER_DISPLAY_CEIL_DB;
const PITCH_SHIFT_WORKLET_NAME = 'xtream-audio-subcue-pitch-shift';
let pitchShiftWorkletUrl: string | undefined;
const pitchShiftWorkletLoads = new WeakMap<AudioContext, Promise<void>>();

let audioGraphSignature = '';
let outputRuntimes = new Map<string, OutputRuntime>();
let soloOutputIds = new Set<string>();
let lastGlobalAudioMuted: boolean | undefined;
let previewRuntimes = new Map<string, AudioSubCuePreviewRuntime>();

type AudioSubCuePreviewRuntime = {
  payload: AudioSubCuePreviewPayload;
  context: AudioContext;
  element: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode;
  pitchNode?: AudioNode;
  gainNode: GainNode;
  panner: StereoPannerNode;
  busGain: GainNode;
  busPanner: StereoPannerNode;
  destination?: MediaStreamAudioDestinationNode;
  sinkElement?: SinkCapableAudioElement;
  startedAtContextSeconds: number;
  pausedAtMs: number;
  stopTimer?: number;
  automationTimer?: number;
};

export function setSoloOutputIds(outputIds: Iterable<string>): void {
  soloOutputIds = new Set(outputIds);
}

export function getAudioRuntimeDebugSnapshot(): { outputs: Array<{ outputId: string; sourceIds: string[] }> } {
  return {
    outputs: [...outputRuntimes.values()].map((runtime) => ({
      outputId: runtime.outputId,
      sourceIds: runtime.sources.map((source) => source.audioSourceId),
    })),
  };
}

export async function resetAudioRuntimeForTests(): Promise<void> {
  for (const runtime of outputRuntimes.values()) {
    await disposeOutputRuntime(runtime, { immediate: true });
  }
  for (const preview of previewRuntimes.values()) {
    disposePreviewRuntime(preview);
  }
  outputRuntimes = new Map();
  previewRuntimes = new Map();
  audioGraphSignature = '';
  soloOutputIds = new Set();
  lastGlobalAudioMuted = undefined;
}

/** Build signature for topology-only changes (membership, URL, sink, channel layout). Pan updates do not rebuild. */
export function computeAudioGraphSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => ({
        output: computeOutputGraphKey(output),
        sources: output.sources.map((selection, index) => ({
          selectionId: getOutputSourceSelectionRuntimeId(selection, index),
          graphKey: computeSourceGraphKey(selection, index, state),
        })),
      })),
  );
}

export function syncVirtualAudioGraph(state: DirectorState): void {
  audioGraphSignature = computeAudioGraphSignature(state);
  const desiredOutputIds = new Set(Object.keys(state.outputs));
  for (const [outputId, runtime] of outputRuntimes) {
    if (!desiredOutputIds.has(outputId)) {
      outputRuntimes.delete(outputId);
      void disposeOutputRuntime(runtime, { immediate: true });
    }
  }
  for (const output of Object.values(state.outputs)) {
    const graphKey = computeOutputGraphKey(output);
    const existing = outputRuntimes.get(output.id);
    if (!existing) {
      const runtime = createOutputRuntime(output, state);
      outputRuntimes.set(output.id, runtime);
      reconcileOutputSources(runtime, output, state);
      void configureOutputRouting(output, runtime.context, runtime.analyser, runtime);
      continue;
    }
    if (existing.graphKey !== graphKey) {
      outputRuntimes.delete(output.id);
      void disposeOutputRuntime(existing, { immediate: true });
      const runtime = createOutputRuntime(output, state);
      outputRuntimes.set(output.id, runtime);
      reconcileOutputSources(runtime, output, state);
      void configureOutputRouting(output, runtime.context, runtime.analyser, runtime);
      continue;
    }
    reconcileOutputSources(existing, output, state);
  }
  syncAudioRuntimeToDirector(state);
}

export async function rebuildAudioGraph(state: DirectorState): Promise<void> {
  lastGlobalAudioMuted = undefined;
  for (const runtime of outputRuntimes.values()) {
    await disposeOutputRuntime(runtime, { immediate: true });
  }
  outputRuntimes = new Map();
  audioGraphSignature = '';
  syncVirtualAudioGraph(state);
}

function computeOutputGraphKey(output: VirtualOutputState): string {
  return JSON.stringify({
    id: output.id,
    sinkId: output.sinkId,
  });
}

function computeSourceGraphKey(selection: VirtualOutputSourceSelection, index: number, state: DirectorState): string {
  const source = state.audioSources[selection.audioSourceId];
  return JSON.stringify({
    selectionId: getOutputSourceSelectionRuntimeId(selection, index),
    audioSourceId: selection.audioSourceId,
    url: getAudioSourceUrl(selection.audioSourceId, state),
    channelCount: source?.channelCount,
    channelMode: source?.channelMode,
  });
}

function createOutputRuntime(output: VirtualOutputState, state: DirectorState): OutputRuntime {
  const AudioContextCtor = window.AudioContext;
  const context = new AudioContextCtor();
  const busGain = context.createGain();
  const busPanner = context.createStereoPanner();
  busPanner.pan.value = clampAudioPan(output.pan);
  const globalMuteGain = context.createGain();
  globalMuteGain.gain.value = state.globalAudioMuted ? 0 : 1;
  const envelopeGain = context.createGain();
  envelopeGain.gain.value = state.paused ? 0 : 1;
  const delayNode = context.createDelay(OUTPUT_DELAY_MAX_SECONDS);
  delayNode.delayTime.value = getClampedOutputDelaySeconds(output);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  busGain.connect(busPanner).connect(globalMuteGain).connect(envelopeGain).connect(delayNode).connect(analyser);
  return {
    outputId: output.id,
    graphKey: computeOutputGraphKey(output),
    context,
    sources: [],
    busGain,
    busPanner,
    globalMuteGain,
    envelopeGain,
    delayNode,
    analyser,
    routing: 'mediaElementSink',
    meterData: new Uint8Array(analyser.fftSize),
    lastMeterReportMs: 0,
    transportPlaying: !state.paused,
    envelopeTargetGain: state.paused ? 0 : 1,
  };
}

function reconcileOutputSources(runtime: OutputRuntime, output: VirtualOutputState, state: DirectorState): void {
  const existingBySelectionId = new Map(runtime.sources.map((source) => [source.selectionId, source]));
  const nextSources: OutputSourceRuntime[] = [];
  const retained = new Set<OutputSourceRuntime>();

  for (const [selectionIndex, selection] of output.sources.entries()) {
    const selectionId = getOutputSourceSelectionRuntimeId(selection, selectionIndex);
    const graphKey = computeSourceGraphKey(selection, selectionIndex, state);
    const existing = existingBySelectionId.get(selectionId);
    if (existing && existing.graphKey === graphKey) {
      retained.add(existing);
      nextSources.push(existing);
      continue;
    }
    if (existing) {
      disposeSourceRuntime(existing);
    }
    const created = createSourceRuntime(runtime, output, selection, selectionIndex, graphKey, state);
    if (created) {
      retained.add(created);
      nextSources.push(created);
    }
  }

  for (const source of runtime.sources) {
    if (!retained.has(source)) {
      disposeSourceRuntime(source);
    }
  }
  runtime.sources = nextSources;
}

function createSourceRuntime(
  runtime: OutputRuntime,
  output: VirtualOutputState,
  selection: VirtualOutputSourceSelection,
  selectionIndex: number,
  graphKey: string,
  state: DirectorState,
): OutputSourceRuntime | undefined {
  const selectionId = getOutputSourceSelectionRuntimeId(selection, selectionIndex);
  const url = getAudioSourceUrl(selection.audioSourceId, state);
  if (!url) {
    return undefined;
  }
  const element = document.createElement('audio');
  element.preload = 'auto';
  element.style.display = 'none';
  element.src = url;
  document.body.append(element);
  const sourceNode = runtime.context.createMediaElementSource(element);
  const gainNode = runtime.context.createGain();
  gainNode.gain.value = 0;
  const pitchNode = connectAudioSourceToGain(runtime.context, sourceNode, gainNode, state.audioSources[selection.audioSourceId]);
  const sourcePanner = runtime.context.createStereoPanner();
  sourcePanner.pan.value = clampAudioPan(selection.pan);
  gainNode.connect(sourcePanner);
  sourcePanner.connect(runtime.busGain);
  const meterLanes = createSourceMeterLanes(
    runtime.context,
    sourcePanner,
    output.id,
    selectionId,
    selection.audioSourceId,
    state.audioSources[selection.audioSourceId],
  );
  element.addEventListener('loadedmetadata', () => {
    if (isStreamRuntimeAudioSourceId(selection.audioSourceId)) {
      return;
    }
    const detectedChannelCount = getSourceChannelCount(state.audioSources[selection.audioSourceId], sourceNode);
    void window.xtream.audioSources.reportMetadata({
      audioSourceId: selection.audioSourceId,
      durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
      channelCount: detectedChannelCount,
      ready: true,
    });
  });
  element.addEventListener('error', () => {
    if (isStreamRuntimeAudioSourceId(selection.audioSourceId)) {
      return;
    }
    void window.xtream.audioSources.reportMetadata({
      audioSourceId: selection.audioSourceId,
      durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
      ready: false,
      error: element.error?.message ?? 'Audio failed to load.',
    });
  });
  return {
    selectionId,
    audioSourceId: selection.audioSourceId,
    graphKey,
    element,
    sourceNode,
    pitchNode,
    gainNode,
    sourcePanner,
    meterLanes,
    pendingFadeIn: true,
  };
}

async function disposeOutputRuntime(runtime: OutputRuntime, options: { immediate?: boolean } = {}): Promise<void> {
  if (runtime.fadePauseTimer !== undefined) {
    window.clearTimeout(runtime.fadePauseTimer);
  }
  if (runtime.sinkElement) {
    runtime.sinkElement.pause();
    runtime.sinkElement.remove();
  }
  for (const source of runtime.sources) {
    disposeSourceRuntime(source, { immediate: options.immediate });
  }
  await runtime.context.close().catch(() => undefined);
}

function disposeSourceRuntime(source: OutputSourceRuntime, options: { immediate?: boolean } = {}): void {
  if (source.removalTimer !== undefined) {
    window.clearTimeout(source.removalTimer);
    source.removalTimer = undefined;
  }
  const remove = () => {
    source.element.pause();
    source.element.remove();
    source.sourceNode.disconnect();
    source.pitchNode?.disconnect();
    source.gainNode.disconnect();
    source.sourcePanner.disconnect();
    for (const lane of source.meterLanes) {
      lane.analyser.disconnect();
    }
  };
  if (options.immediate) {
    remove();
    return;
  }
  const now = source.gainNode.context.currentTime;
  source.gainNode.gain.cancelScheduledValues(now);
  source.gainNode.gain.setValueAtTime(source.gainNode.gain.value, now);
  source.gainNode.gain.linearRampToValueAtTime(0, now + SOURCE_REMOVE_FADE_SECONDS);
  source.removalTimer = window.setTimeout(remove, SOURCE_REMOVE_FADE_MS);
}

export function syncAudioRuntimeToDirector(state: DirectorState): void {
  const directorSeconds = getDirectorSeconds(state);
  const syncKey = createPlaybackSyncKey(state);
  syncGlobalMuteGains(state);
  for (const output of Object.values(state.outputs)) {
    const runtime = outputRuntimes.get(output.id);
    if (!runtime) {
      continue;
    }
    const targetDelay = getClampedOutputDelaySeconds(output);
    const t = runtime.context.currentTime;
    runtime.delayNode.delayTime.setTargetAtTime(targetDelay, t, DELAY_SMOOTH_SECONDS);
    const transportMode = syncTransportEnvelope(runtime, state);
    runtime.busGain.gain.value = getProgramOutputGain(output, soloOutputIds);
    runtime.busPanner.pan.value = clampAudioPan(output.pan);
    const hasSoloedSource = output.sources.some((selection) => selection.solo);
    for (const sourceRuntime of runtime.sources) {
      const selection = findOutputSourceSelectionForRuntime(output.sources, sourceRuntime.selectionId, sourceRuntime.audioSourceId);
      const source = state.audioSources[sourceRuntime.audioSourceId];
      if (!selection || !source) {
        continue;
      }
      const runtimeSource = source as AudioSourceState & { runtimeOffsetSeconds?: number; runtimeLoop?: LoopState };
      const target = getRuntimeAudioTarget(source, directorSeconds, state.loop);
      const localMs = Math.max(0, (directorSeconds - (runtimeSource.runtimeOffsetSeconds ?? 0)) * 1000);
      const sourceMuted = selection.muted || (hasSoloedSource && !selection.solo);
      const automatedLevelDb = evaluateAudioSubCueLevelDb(selection.levelDb, selection.runtimeLevelAutomation, localMs);
      const fadeGain = evaluateFadeGain({
        timeMs: localMs,
        durationMs: source.durationSeconds !== undefined ? source.durationSeconds * 1000 : undefined,
        fadeIn: selection.runtimeFadeIn,
        fadeOut: selection.runtimeFadeOut,
      });
      setSourceRuntimeGain(
        sourceRuntime,
        sourceMuted || !target.audible ? 0 : dbToGain(automatedLevelDb) * dbToGain(source.levelDb ?? 0) * fadeGain,
      );
      sourceRuntime.sourcePanner.pan.value = clampAudioPan(evaluateAudioSubCuePan(selection.pan, selection.runtimePanAutomation, localMs));
      sourceRuntime.element.playbackRate = state.rate * (source.playbackRate ?? 1);
      updatePitchShiftNode(sourceRuntime.pitchNode, source.runtimePitchShiftSemitones);
      if (transportMode === 'fading-out') {
        void runtime.context.resume();
        requestMediaPlay(sourceRuntime.element);
        continue;
      }
      syncTimedMediaElement(sourceRuntime.element, target.seconds, transportMode === 'playing' && target.audible, syncKey, 0.75, () => {
        void runtime.context.resume();
      });
    }
    if (transportMode === 'paused') {
      pauseOutputTransport(runtime);
    } else {
      playOutputTransport(runtime);
    }
  }
}

export function getEffectiveOutputGain(
  globalAudioMuted: boolean,
  output: Pick<VirtualOutputState, 'id' | 'muted' | 'busLevelDb'>,
  soloIds: ReadonlySet<string>,
): number {
  if (globalAudioMuted) {
    return 0;
  }
  return getProgramOutputGain(output, soloIds);
}

function setSourceRuntimeGain(sourceRuntime: OutputSourceRuntime, targetGain: number): void {
  const gain = sourceRuntime.gainNode.gain;
  const now = sourceRuntime.gainNode.context.currentTime;
  if (sourceRuntime.pendingFadeIn) {
    sourceRuntime.pendingFadeIn = false;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(targetGain, now + SOURCE_GAIN_SMOOTH_SECONDS);
    return;
  }
  gain.setTargetAtTime(targetGain, now, SOURCE_GAIN_SMOOTH_SECONDS);
}

function getProgramOutputGain(
  output: Pick<VirtualOutputState, 'id' | 'muted' | 'busLevelDb'>,
  soloIds: ReadonlySet<string>,
): number {
  const hasSolo = soloIds.size > 0;
  if (output.muted || (hasSolo && !soloIds.has(output.id))) {
    return 0;
  }
  return dbToGain(output.busLevelDb);
}

function syncGlobalMuteGains(state: DirectorState): void {
  if (outputRuntimes.size === 0) {
    return;
  }
  if (lastGlobalAudioMuted === undefined) {
    lastGlobalAudioMuted = state.globalAudioMuted;
    for (const runtime of outputRuntimes.values()) {
      runtime.globalMuteGain.gain.value = state.globalAudioMuted ? 0 : 1;
    }
    return;
  }
  if (state.globalAudioMuted === lastGlobalAudioMuted) {
    return;
  }
  lastGlobalAudioMuted = state.globalAudioMuted;
  const target = state.globalAudioMuted ? 0 : 1;
  const dur = Math.max(0, state.globalAudioMuteFadeOverrideSeconds ?? state.globalAudioMuteFadeOutSeconds ?? 0);
  for (const runtime of outputRuntimes.values()) {
    const g = runtime.globalMuteGain.gain;
    const t0 = runtime.context.currentTime;
    g.cancelScheduledValues(t0);
    if (dur === 0) {
      g.setValueAtTime(target, t0);
    } else {
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(target, t0 + dur);
    }
  }
}

function getClampedOutputDelaySeconds(output: VirtualOutputState): number {
  return Math.min(OUTPUT_DELAY_MAX_SECONDS, Math.max(0, output.outputDelaySeconds ?? 0));
}

function playOutputTransport(runtime: OutputRuntime): void {
  if (runtime.routing === 'contextSink') {
    void runtime.context.resume();
  } else if (runtime.sinkElement) {
    requestMediaPlay(runtime.sinkElement);
  }
}

function pauseOutputTransport(runtime: OutputRuntime): void {
  if (runtime.routing === 'contextSink') {
    void runtime.context.suspend();
  } else if (runtime.sinkElement) {
    runtime.sinkElement.pause();
  }
}

function syncTransportEnvelope(runtime: OutputRuntime, state: DirectorState): TransportEnvelopeMode {
  if (!state.paused) {
    if (runtime.fadePauseTimer !== undefined) {
      window.clearTimeout(runtime.fadePauseTimer);
      runtime.fadePauseTimer = undefined;
    }
    if (runtime.envelopeTargetGain !== 1) {
      rampEnvelope(runtime, 1);
    }
    runtime.transportPlaying = true;
    return 'playing';
  }

  if (runtime.transportPlaying) {
    if (runtime.envelopeTargetGain !== 0) {
      rampEnvelope(runtime, 0);
    }
    if (runtime.fadePauseTimer !== undefined) {
      window.clearTimeout(runtime.fadePauseTimer);
    }
    runtime.fadePauseTimer = window.setTimeout(() => {
      runtime.fadePauseTimer = undefined;
      pauseRuntimeAtDirectorTarget(runtime, state);
      pauseOutputTransport(runtime);
    }, TRANSPORT_FADE_MS);
    runtime.transportPlaying = false;
    return 'fading-out';
  }

  return runtime.fadePauseTimer === undefined ? 'paused' : 'fading-out';
}

function rampEnvelope(runtime: OutputRuntime, targetGain: number): void {
  runtime.envelopeTargetGain = targetGain;
  const gain = runtime.envelopeGain.gain;
  const now = runtime.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(targetGain, now + TRANSPORT_FADE_SECONDS);
}

function pauseRuntimeAtDirectorTarget(runtime: OutputRuntime, state: DirectorState): void {
  const directorSeconds = getDirectorSeconds(state);
  for (const sourceRuntime of runtime.sources) {
    const source = state.audioSources[sourceRuntime.audioSourceId];
    if (!source || sourceRuntime.element.readyState < HTMLMediaElement.HAVE_METADATA) {
      sourceRuntime.element.pause();
      continue;
    }
    const target = getRuntimeAudioTarget(source, directorSeconds, state.loop);
    sourceRuntime.element.pause();
    sourceRuntime.element.currentTime = clampElementTime(target.seconds, sourceRuntime.element);
  }
}

export function sampleMeters(state: DirectorState, meterRoot?: HTMLElement): void {
  const now = Date.now();
  for (const [outputId, runtime] of outputRuntimes) {
    const output = state.outputs[outputId];
    const lanes: MeterLaneState[] = [];
    let peakDb = METER_FLOOR_DB;
    const outputGain = runtime.busGain.gain.value * runtime.globalMuteGain.gain.value * runtime.envelopeGain.gain.value;
    for (const sourceRuntime of runtime.sources) {
      const source = state.audioSources[sourceRuntime.audioSourceId];
      for (const lane of sourceRuntime.meterLanes) {
        const db = sampleLaneDb(lane, outputGain);
        peakDb = Math.max(peakDb, db);
        lanes.push({
          id: lane.id,
          label: lane.label,
          audioSourceId: lane.audioSourceId,
          channelIndex: lane.channelIndex,
          db,
          clipped: db >= METER_CLIP_DB,
        });
      }
      if (source && sourceRuntime.meterLanes.length !== getExpectedChannelCount(source)) {
        // A source can expose a different channel count after metadata; rebuild on the next state sync.
        sourceRuntime.graphKey = '';
      }
    }
    if (meterRoot) {
      const fills = meterRoot.querySelectorAll<HTMLElement>(`[data-meter-fill="${outputId}"]`);
      for (const fill of fills) {
        fill.style.width = meterWidth(peakDb);
        fill.style.height = meterWidth(peakDb);
      }
    }
    if (now - runtime.lastMeterReportMs > 50 && output) {
      runtime.lastMeterReportMs = now;
      void window.xtream.audioRuntime.reportMeter({
        outputId,
        lanes,
        peakDb,
        reportedAtWallTimeMs: now,
      });
    }
  }
}

export function getFirstMeteredAudioSource(): { audioSourceId: string; element: HTMLMediaElement } | undefined {
  const firstRuntime = outputRuntimes.values().next().value as OutputRuntime | undefined;
  return firstRuntime?.sources.find((source) => source.element.readyState >= HTMLMediaElement.HAVE_METADATA);
}

export function getOutputSourceSelectionRuntimeId(selection: VirtualOutputSourceSelection, index: number): string {
  return selection.id ?? `${selection.audioSourceId}@${index}`;
}

export function findOutputSourceSelectionForRuntime(
  selections: VirtualOutputSourceSelection[],
  selectionId: string,
  audioSourceId: string,
): VirtualOutputSourceSelection | undefined {
  return selections.find((selection, index) => getOutputSourceSelectionRuntimeId(selection, index) === selectionId)
    ?? selections.find((selection) => selection.audioSourceId === audioSourceId);
}

export function handleAudioSubCuePreviewCommand(command: AudioSubCuePreviewCommand): void {
  if (command.type === 'play-audio-subcue-preview') {
    playAudioSubCuePreview(command.payload);
  } else if (command.type === 'pause-audio-subcue-preview') {
    pauseAudioSubCuePreview(command.previewId);
  } else {
    stopAudioSubCuePreview(command.previewId);
  }
}

export function playAudioSubCuePreview(payload: AudioSubCuePreviewPayload): void {
  stopAudioSubCuePreview(payload.previewId);
  const context = new AudioContext();
  const element = createHiddenAudioOutput();
  element.preload = 'auto';
  element.src = payload.url;
  element.currentTime = Math.max(0, (payload.sourceStartMs ?? 0) / 1000);
  element.playbackRate = Math.max(0.01, payload.playbackRate ?? 1);

  const sourceNode = context.createMediaElementSource(element);
  const gainNode = context.createGain();
  gainNode.gain.value = 0;
  const sourceForChannel = { channelMode: payload.channelMode, channelCount: payload.channelCount } as unknown as AudioSourceState;
  const pitchNode = connectAudioSourceToGain(context, sourceNode, gainNode, sourceForChannel);
  updatePitchShiftNode(pitchNode, payload.pitchShiftSemitones);
  const panner = context.createStereoPanner();
  const busGain = context.createGain();
  const busPanner = context.createStereoPanner();
  gainNode.connect(panner).connect(busGain).connect(busPanner);
  const runtime: AudioSubCuePreviewRuntime = {
    payload,
    context,
    element,
    sourceNode,
    pitchNode,
    gainNode,
    panner,
    busGain,
    busPanner,
    startedAtContextSeconds: context.currentTime,
    pausedAtMs: 0,
  };
  previewRuntimes.set(payload.previewId, runtime);
  void configurePreviewRouting(runtime);
  syncPreviewAutomation(runtime);
  runtime.automationTimer = window.setInterval(() => syncPreviewAutomation(runtime), 25);
  if (!payload.loop?.enabled && payload.playTimeMs !== undefined) {
    runtime.stopTimer = window.setTimeout(() => stopAudioSubCuePreview(payload.previewId), Math.max(0, payload.playTimeMs));
  }
  void context.resume();
  requestMediaPlay(element);
}

export function pauseAudioSubCuePreview(previewId: string): void {
  const runtime = previewRuntimes.get(previewId);
  if (!runtime) {
    return;
  }
  runtime.pausedAtMs = getPreviewLocalMs(runtime);
  runtime.element.pause();
  if (runtime.sinkElement) {
    runtime.sinkElement.pause();
  }
  if (runtime.stopTimer !== undefined) {
    window.clearTimeout(runtime.stopTimer);
    runtime.stopTimer = undefined;
  }
}

export function stopAudioSubCuePreview(previewId: string): void {
  const runtime = previewRuntimes.get(previewId);
  if (!runtime) {
    return;
  }
  previewRuntimes.delete(previewId);
  disposePreviewRuntime(runtime);
}

export function playAudioSourcePreview(source: AudioSourceState, state: DirectorState, setStatus: (message: string) => void): void {
  const url =
    source.type === 'external-file'
      ? source.url
      : source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl
        ? source.extractedUrl
        : state.visuals[source.visualId]?.url;
  if (!url) {
    setStatus(`Preview unavailable: ${source.label} has no playable URL.`);
    return;
  }
  const audio = createHiddenAudioOutput();
  audio.src = url;
  audio.currentTime = 0;
  const context = source.channelMode === 'left' || source.channelMode === 'right' ? new AudioContext() : undefined;
  if (context) {
    const sourceNode = context.createMediaElementSource(audio);
    const gainNode = context.createGain();
    connectAudioSourceToGain(context, sourceNode, gainNode, source);
    gainNode.connect(context.destination);
  }
  audio.play().catch((error: unknown) => {
    setStatus(`Preview failed: ${error instanceof Error ? error.message : 'Unable to play audio source.'}`);
  });
  window.setTimeout(() => {
    audio.pause();
    audio.remove();
    void context?.close();
  }, 2500);
}

export async function playOutputTestTone(output: VirtualOutputState): Promise<void> {
  const context = new AudioContext();
  const maxDelay = OUTPUT_DELAY_MAX_SECONDS;
  const delayNode = context.createDelay(maxDelay);
  const d = getClampedOutputDelaySeconds(output);
  delayNode.delayTime.value = d;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = dbToGain(output.busLevelDb) * 0.18;
  oscillator.frequency.value = 660;
  oscillator.connect(gain).connect(delayNode);

  const endPlayback = (toneOutput: SinkCapableAudioElement | undefined) => {
    window.setTimeout(() => {
      oscillator.stop();
      toneOutput?.pause();
      toneOutput?.remove();
      void context.close();
    }, 850);
  };

  if (context.setSinkId) {
    delayNode.connect(context.destination);
    try {
      await context.setSinkId(output.sinkId ?? '');
      oscillator.start();
      void context.resume();
      endPlayback(undefined);
      return;
    } catch {
      delayNode.disconnect(context.destination);
    }
  }

  const destination = context.createMediaStreamDestination();
  delayNode.connect(destination);
  const toneOutput = createHiddenAudioOutput();
  toneOutput.srcObject = destination.stream;
  if (toneOutput.setSinkId) {
    await toneOutput.setSinkId(output.sinkId ?? '');
  }
  oscillator.start();
  void context.resume();
  await toneOutput.play();
  endPlayback(toneOutput);
}

/**
 * Visual position u along the -60…0 dB graticule: 0 = top (0 dB), 1 = bottom (floor), linear dB.
 * Matches {@link meterLevelPercent} in the non-saturation range (fill from bottom = 1 - u in relative terms).
 */
export function meterDbToVisualU(db: number): number {
  const d = Math.max(METER_DISPLAY_FLOOR_DB, Math.min(METER_DISPLAY_CEIL_DB, db));
  return (METER_DISPLAY_CEIL_DB - d) / METER_SPAN_DB;
}

/**
 * Inverse of {@link meterDbToVisualU} on the graticule span; u clamped to [0, 1].
 */
export function meterVisualUToDb(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return METER_DISPLAY_CEIL_DB - t * METER_SPAN_DB;
}

/**
 * dB of each tick on the -60…0 dB graticule: `0` at the top, `-60` at the bottom, linear dB.
 */
export function meterScaleLabelTopPercent(db: number): string {
  return `${meterDbToVisualU(db) * 100}%`;
}

/** Same mapping as {@link meterLevelPercent}, for square mini-meters. */
export function meterWidth(db: number | undefined): string {
  return `${meterLevelPercent(db)}%`;
}

/**
 * Fill height 0…100%: {@link METER_DISPLAY_FLOOR_DB} → 0%, {@link METER_DISPLAY_CEIL_DB} → 100%.
 * Above 0 dB the bar stays full (clip / over).
 */
export function meterLevelPercent(db: number | undefined): number {
  const d = db ?? METER_DISPLAY_FLOOR_DB;
  if (d >= METER_DISPLAY_CEIL_DB) {
    return 100;
  }
  if (d <= METER_DISPLAY_FLOOR_DB) {
    return 0;
  }
  return ((d - METER_DISPLAY_FLOOR_DB) / METER_SPAN_DB) * 100;
}

function getAudioSourceUrl(audioSourceId: string, state: DirectorState): string {
  const source = state.audioSources[audioSourceId];
  if (!source) {
    return '';
  }
  if (source.type === 'external-file') {
    return source.url ?? '';
  }
  if (source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl) {
    return source.extractedUrl;
  }
  return state.visuals[source.visualId]?.url ?? '';
}

export function getRuntimeAudioTarget(source: AudioSourceState, directorSeconds: number, fallbackLoop: LoopState): { seconds: number; audible: boolean } {
  const runtimeSource = source as AudioSourceState & {
    runtimeOffsetSeconds?: number;
    runtimeLoop?: LoopState;
    runtimeSourceStartSeconds?: number;
    runtimeSourceEndSeconds?: number;
  };
  const runtimeOffsetSeconds = runtimeSource.runtimeOffsetSeconds ?? 0;
  const localSeconds = Math.max(0, directorSeconds - runtimeOffsetSeconds);
  const rate = source.playbackRate ?? 1;
  const sourceStartSeconds = runtimeSource.runtimeSourceStartSeconds ?? 0;
  if (runtimeSource.runtimeSourceStartSeconds === undefined && runtimeSource.runtimeSourceEndSeconds === undefined) {
    return getAudioEffectiveTime(localSeconds * rate, source.durationSeconds, runtimeSource.runtimeLoop ?? fallbackLoop);
  }
  const sourceSeconds = sourceStartSeconds + localSeconds * rate;
  const loop = runtimeSource.runtimeLoop ?? { enabled: false, startSeconds: sourceStartSeconds };
  const limited = getAudioEffectiveTime(sourceSeconds, runtimeSource.runtimeSourceEndSeconds, loop);
  const playTimeAudible = source.durationSeconds === undefined || localSeconds < source.durationSeconds;
  const rangeAudible = runtimeSource.runtimeSourceEndSeconds === undefined || limited.seconds < runtimeSource.runtimeSourceEndSeconds;
  return {
    seconds: Math.max(sourceStartSeconds, limited.seconds),
    audible: limited.audible && playTimeAudible && rangeAudible,
  };
}

function updatePitchShiftNode(node: AudioNode | undefined, semitones: number | undefined): void {
  if (!node) {
    return;
  }
  const pitch = clampPitchShiftSemitones(semitones);
  const pitchInput = node as PitchShiftInputNode;
  pitchInput.pitchSemitones = pitch;
  const ratio = 2 ** (pitch / 12);
  const parameter = pitchInput.pitchWorklet?.parameters.get('pitchRatio');
  if (parameter) {
    parameter.setTargetAtTime(ratio, pitchInput.context.currentTime, 0.03);
  }
}

function isStreamRuntimeAudioSourceId(audioSourceId: string): boolean {
  return audioSourceId.startsWith('stream-audio:');
}

function connectAudioSourceToGain(
  context: AudioContext,
  sourceNode: MediaElementAudioSourceNode,
  gainNode: GainNode,
  source: AudioSourceState | undefined,
): AudioNode {
  const pitchNode = createPitchShiftNode(context, gainNode);
  if (source?.channelMode === 'left' || source?.channelMode === 'right') {
    const splitter = context.createChannelSplitter(2);
    sourceNode.connect(splitter);
    splitter.connect(pitchNode, source.channelMode === 'left' ? 0 : 1);
    return pitchNode;
  }
  sourceNode.connect(pitchNode);
  return pitchNode;
}

type PitchShiftInputNode = GainNode & {
  pitchWorklet?: AudioWorkletNode;
  pitchDestination?: AudioNode;
  pitchSemitones?: number;
};

function createPitchShiftNode(context: AudioContext, destination: AudioNode): AudioNode {
  const input = context.createGain() as PitchShiftInputNode;
  input.pitchDestination = destination;
  input.connect(destination);
  if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
    return input;
  }
  void ensurePitchShiftWorklet(context)
    .then(() => {
      const worklet = new AudioWorkletNode(context, PITCH_SHIFT_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      input.disconnect(destination);
      input.connect(worklet).connect(destination);
      input.pitchWorklet = worklet;
      updatePitchShiftNode(input, input.pitchSemitones);
    })
    .catch(() => {
      input.connect(destination);
    });
  return input;
}

function ensurePitchShiftWorklet(context: AudioContext): Promise<void> {
  const existing = pitchShiftWorkletLoads.get(context);
  if (existing) {
    return existing;
  }
  pitchShiftWorkletUrl ??= URL.createObjectURL(new Blob([PITCH_SHIFT_WORKLET_SOURCE], { type: 'text/javascript' }));
  const load = context.audioWorklet.addModule(pitchShiftWorkletUrl);
  pitchShiftWorkletLoads.set(context, load);
  return load;
}

const PITCH_SHIFT_WORKLET_SOURCE = `
class XtreamAudioSubCuePitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitchRatio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.size = 32768;
    this.mask = this.size - 1;
    this.grainSize = 1024;
    this.delay = 2048;
    this.write = 0;
    this.channels = [];
    this.grains = [];
  }

  channel(index) {
    if (!this.channels[index]) {
      this.channels[index] = new Float32Array(this.size);
      this.grains[index] = [
        { read: this.size - this.delay, phase: 0 },
        { read: this.size - this.delay - this.grainSize / 2, phase: this.grainSize / 2 },
      ];
    }
    return this.channels[index];
  }

  sample(buffer, read) {
    const base = Math.floor(read);
    const frac = read - base;
    const a = buffer[base & this.mask];
    const b = buffer[(base + 1) & this.mask];
    return a + (b - a) * frac;
  }

  grainWindow(phase) {
    return Math.sin(Math.PI * Math.max(0, Math.min(1, phase / this.grainSize)));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const ratio = parameters.pitchRatio[0] || 1;
    const channelCount = Math.max(input.length, output.length);
    if (Math.abs(ratio - 1) < 0.001) {
      for (let c = 0; c < output.length; c += 1) {
        const source = input[c] || input[0];
        if (source) {
          output[c].set(source);
        } else {
          output[c].fill(0);
        }
      }
      return true;
    }

    const frames = output[0]?.length || 0;
    const writeBase = this.write;
    for (let c = 0; c < channelCount; c += 1) {
      const source = input[c] || input[0];
      const target = output[c];
      if (!target) {
        continue;
      }
      const buffer = this.channel(c);
      const grains = this.grains[c];
      for (let i = 0; i < frames; i += 1) {
        const writeIndex = writeBase + i;
        buffer[writeIndex & this.mask] = source ? source[i] || 0 : 0;
        let sum = 0;
        let weight = 0;
        for (const grain of grains) {
          const w = this.grainWindow(grain.phase);
          sum += this.sample(buffer, grain.read) * w;
          weight += w;
          grain.read += ratio;
          grain.phase += 1;
          if (grain.phase >= this.grainSize) {
            grain.phase = 0;
            grain.read = writeIndex - this.delay;
          }
        }
        target[i] = weight > 0 ? sum / weight : 0;
      }
    }
    this.write = (this.write + frames) & this.mask;
    return true;
  }
}

registerProcessor('${PITCH_SHIFT_WORKLET_NAME}', XtreamAudioSubCuePitchShift);
`;

function createSourceMeterLanes(
  context: AudioContext,
  tapNode: AudioNode,
  outputId: string,
  selectionId: string,
  audioSourceId: string,
  source: AudioSourceState | undefined,
): SourceMeterLaneRuntime[] {
  const channelCount = getExpectedChannelCount(source);
  const splitter = context.createChannelSplitter(channelCount);
  tapNode.connect(splitter);
  const lanes: SourceMeterLaneRuntime[] = [];
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    splitter.connect(analyser, channelIndex);
    lanes.push({
      id: `${outputId}:${selectionId}:ch-${channelIndex + 1}`,
      label: formatLaneLabel(source, channelIndex, channelCount),
      audioSourceId,
      channelIndex,
      analyser,
      data: new Float32Array(analyser.fftSize),
    });
  }
  return lanes;
}

function sampleLaneDb(lane: SourceMeterLaneRuntime, outputGain: number): number {
  lane.analyser.getFloatTimeDomainData(lane.data);
  let peak = 0;
  for (const sample of lane.data) {
    peak = Math.max(peak, Math.abs(sample) * outputGain);
  }
  if (peak <= 0.00001) {
    return METER_FLOOR_DB;
  }
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(peak));
}

function getSourceChannelCount(source: AudioSourceState | undefined, sourceNode: MediaElementAudioSourceNode): number {
  return getExpectedChannelCount(source) || Math.max(1, Math.min(8, sourceNode.channelCount || 2));
}

function getExpectedChannelCount(source: AudioSourceState | undefined): number {
  if (source?.channelMode === 'left' || source?.channelMode === 'right') {
    return 1;
  }
  return Math.max(1, Math.min(8, source?.channelCount ?? 2));
}

function formatLaneLabel(source: AudioSourceState | undefined, channelIndex: number, channelCount: number): string {
  if (source?.channelMode === 'left') {
    return 'L';
  }
  if (source?.channelMode === 'right') {
    return 'R';
  }
  if (channelCount === 2) {
    return channelIndex === 0 ? 'L' : 'R';
  }
  return `C${channelIndex + 1}`;
}

function createHiddenAudioOutput(): SinkCapableAudioElement {
  const output = document.createElement('audio') as SinkCapableAudioElement;
  output.autoplay = true;
  output.style.display = 'none';
  document.body.append(output);
  return output;
}

async function configurePreviewRouting(runtime: AudioSubCuePreviewRuntime): Promise<void> {
  runtime.busGain.gain.value = dbToGain(runtime.payload.outputBusLevelDb ?? 0);
  runtime.busPanner.pan.value = clampAudioPan(runtime.payload.outputPan);
  if (runtime.context.setSinkId) {
    runtime.busPanner.connect(runtime.context.destination);
    try {
      await runtime.context.setSinkId(runtime.payload.outputSinkId ?? '');
      return;
    } catch {
      runtime.busPanner.disconnect(runtime.context.destination);
    }
  }
  const destination = runtime.context.createMediaStreamDestination();
  runtime.busPanner.connect(destination);
  const sinkElement = createHiddenAudioOutput();
  sinkElement.srcObject = destination.stream;
  runtime.destination = destination;
  runtime.sinkElement = sinkElement;
  if (sinkElement.setSinkId) {
    await sinkElement.setSinkId(runtime.payload.outputSinkId ?? '').catch(() => undefined);
  }
  await sinkElement.play().catch(() => undefined);
}

function getPreviewLocalMs(runtime: AudioSubCuePreviewRuntime): number {
  if (runtime.element.paused && runtime.pausedAtMs > 0) {
    return runtime.pausedAtMs;
  }
  return Math.max(0, (runtime.context.currentTime - runtime.startedAtContextSeconds) * 1000);
}

function syncPreviewAutomation(runtime: AudioSubCuePreviewRuntime): void {
  const localMs = getPreviewLocalMs(runtime);
  const sourceStartMs = runtime.payload.sourceStartMs ?? 0;
  const sourceEndMs = runtime.payload.sourceEndMs;
  if (sourceEndMs !== undefined && runtime.element.currentTime * 1000 >= sourceEndMs && runtime.payload.loop?.enabled) {
    runtime.element.currentTime = sourceStartMs / 1000;
  }
  const durationMs =
    runtime.payload.playTimeMs ??
    (sourceEndMs !== undefined ? Math.max(0, sourceEndMs - sourceStartMs) / Math.max(0.01, runtime.payload.playbackRate ?? 1) : undefined);
  const fadeGain = evaluateFadeGain({
    timeMs: localMs,
    durationMs,
    fadeIn: runtime.payload.fadeIn,
    fadeOut: runtime.payload.fadeOut,
  });
  const levelDb = evaluateAudioSubCueLevelDb(runtime.payload.levelDb, runtime.payload.levelAutomation, localMs);
  const gain = dbToGain(levelDb) * dbToGain(runtime.payload.sourceLevelDb ?? 0) * fadeGain;
  const now = runtime.context.currentTime;
  runtime.gainNode.gain.setTargetAtTime(gain, now, SOURCE_GAIN_SMOOTH_SECONDS);
  runtime.panner.pan.setTargetAtTime(clampAudioPan(evaluateAudioSubCuePan(runtime.payload.pan, runtime.payload.panAutomation, localMs)), now, SOURCE_GAIN_SMOOTH_SECONDS);
  updatePitchShiftNode(runtime.pitchNode, runtime.payload.pitchShiftSemitones);
}

function disposePreviewRuntime(runtime: AudioSubCuePreviewRuntime): void {
  if (runtime.stopTimer !== undefined) {
    window.clearTimeout(runtime.stopTimer);
  }
  if (runtime.automationTimer !== undefined) {
    window.clearInterval(runtime.automationTimer);
  }
  runtime.element.pause();
  runtime.element.remove();
  runtime.sinkElement?.pause();
  runtime.sinkElement?.remove();
  runtime.sourceNode.disconnect();
  runtime.pitchNode?.disconnect();
  runtime.gainNode.disconnect();
  runtime.panner.disconnect();
  runtime.busGain.disconnect();
  runtime.busPanner.disconnect();
  void runtime.context.close();
}

async function configureOutputRouting(
  output: VirtualOutputState,
  context: AudioContext,
  analyser: AnalyserNode,
  runtime: OutputRuntime,
): Promise<void> {
  if (typeof context.setSinkId === 'function') {
    analyser.connect(context.destination);
    try {
      await context.setSinkId(output.sinkId ?? '');
      runtime.routing = 'contextSink';
      await window.xtream.outputs.update(output.id, {
        physicalRoutingAvailable: true,
        fallbackReason: 'none',
        error: undefined,
      });
      return;
    } catch {
      analyser.disconnect(context.destination);
    }
  }

  const destination = context.createMediaStreamDestination();
  analyser.connect(destination);
  const sinkElement = createHiddenAudioOutput();
  sinkElement.srcObject = destination.stream;
  runtime.destination = destination;
  runtime.sinkElement = sinkElement;
  runtime.routing = 'mediaElementSink';
  if (!sinkElement.setSinkId) {
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: false,
      fallbackReason: 'setSinkId unavailable',
    });
    return;
  }
  try {
    await sinkElement.setSinkId(output.sinkId ?? '');
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: true,
      fallbackReason: 'none',
      error: undefined,
    });
  } catch (error) {
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: false,
      fallbackReason: error instanceof Error ? error.message : 'sink assignment failed',
      error: error instanceof Error ? error.message : 'Audio sink assignment failed.',
    });
  }
}

/** Web Audio `StereoPanner.pan` range; invalid values are clamped. */
export function clampAudioPan(pan: number | undefined): number {
  if (pan === undefined || !Number.isFinite(pan)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, pan));
}

function dbToGain(db: number): number {
  return db <= -60 ? 0 : 10 ** (db / 20);
}

function clampElementTime(seconds: number, element: HTMLMediaElement): number {
  const safeSeconds = Math.max(0, seconds);
  if (!Number.isFinite(element.duration)) {
    return safeSeconds;
  }
  return Math.min(safeSeconds, Math.max(0, element.duration - 0.001));
}
