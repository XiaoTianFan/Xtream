import { getAudioEffectiveTime, getDirectorSeconds } from '../../../shared/timeline';
import type { AudioSourceState, DirectorState, MeterLaneState, VirtualOutputState } from '../../../shared/types';
import { createPlaybackSyncKey, requestMediaPlay, syncTimedMediaElement } from './mediaSync';

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSourceRuntime = {
  audioSourceId: string;
  element: HTMLMediaElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
  sourcePanner: StereoPannerNode;
  meterLanes: SourceMeterLaneRuntime[];
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

let audioGraphSignature = '';
let outputRuntimes = new Map<string, OutputRuntime>();
let soloOutputIds = new Set<string>();
let lastGlobalAudioMuted: boolean | undefined;

export function setSoloOutputIds(outputIds: Iterable<string>): void {
  soloOutputIds = new Set(outputIds);
}

/** Build signature for topology-only changes (membership, URL, sink, channel layout). Pan updates do not rebuild. */
export function computeAudioGraphSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => ({
        id: output.id,
        sinkId: output.sinkId,
        sources: output.sources.map((selection) => ({
          id: selection.audioSourceId,
          url: getAudioSourceUrl(selection.audioSourceId, state),
          channelCount: state.audioSources[selection.audioSourceId]?.channelCount,
          channelMode: state.audioSources[selection.audioSourceId]?.channelMode,
        })),
      })),
  );
}

export function syncVirtualAudioGraph(state: DirectorState): void {
  const signature = computeAudioGraphSignature(state);
  if (signature !== audioGraphSignature) {
    audioGraphSignature = signature;
    void rebuildAudioGraph(state);
  }
  syncAudioRuntimeToDirector(state);
}

export async function rebuildAudioGraph(state: DirectorState): Promise<void> {
  lastGlobalAudioMuted = undefined;
  for (const runtime of outputRuntimes.values()) {
    if (runtime.fadePauseTimer !== undefined) {
      window.clearTimeout(runtime.fadePauseTimer);
    }
    if (runtime.sinkElement) {
      runtime.sinkElement.pause();
      runtime.sinkElement.remove();
    }
    for (const source of runtime.sources) {
      source.element.pause();
      source.element.remove();
    }
    await runtime.context.close().catch(() => undefined);
  }
  outputRuntimes = new Map();
  const AudioContextCtor = window.AudioContext;
  for (const output of Object.values(state.outputs)) {
    const context = new AudioContextCtor();
    const busGain = context.createGain();
    const busPanner = context.createStereoPanner();
    busPanner.pan.value = clampAudioPan(output.pan);
    const globalMuteGain = context.createGain();
    globalMuteGain.gain.value = state.globalAudioMuted ? 0 : 1;
    const envelopeGain = context.createGain();
    envelopeGain.gain.value = state.paused ? 0 : 1;
    const delayNode = context.createDelay(OUTPUT_DELAY_MAX_SECONDS);
    const d0 = getClampedOutputDelaySeconds(output);
    delayNode.delayTime.value = d0;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    busGain.connect(busPanner).connect(globalMuteGain).connect(envelopeGain).connect(delayNode).connect(analyser);
    const runtime: OutputRuntime = {
      outputId: output.id,
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
    for (const selection of output.sources) {
      const url = getAudioSourceUrl(selection.audioSourceId, state);
      if (!url) {
        continue;
      }
      const element = document.createElement('audio');
      element.preload = 'auto';
      element.style.display = 'none';
      element.src = url;
      document.body.append(element);
      const sourceNode = context.createMediaElementSource(element);
      const gainNode = context.createGain();
      connectAudioSourceToGain(context, sourceNode, gainNode, state.audioSources[selection.audioSourceId]);
      const sourcePanner = context.createStereoPanner();
      sourcePanner.pan.value = clampAudioPan(selection.pan);
      gainNode.connect(sourcePanner);
      sourcePanner.connect(busGain);
      const meterLanes = createSourceMeterLanes(
        context,
        sourcePanner,
        output.id,
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
      runtime.sources.push({ audioSourceId: selection.audioSourceId, element, sourceNode, gainNode, sourcePanner, meterLanes });
    }
    outputRuntimes.set(output.id, runtime);
    await configureOutputRouting(output, context, analyser, runtime);
  }
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
      const selection = output.sources.find((candidate) => candidate.audioSourceId === sourceRuntime.audioSourceId);
      const source = state.audioSources[sourceRuntime.audioSourceId];
      if (!selection || !source) {
        continue;
      }
      const runtimeOffsetSeconds = (source as AudioSourceState & { runtimeOffsetSeconds?: number }).runtimeOffsetSeconds ?? 0;
      const target = getAudioEffectiveTime((directorSeconds - runtimeOffsetSeconds) * (source.playbackRate ?? 1), source.durationSeconds, state.loop);
      const sourceMuted = selection.muted || (hasSoloedSource && !selection.solo);
      sourceRuntime.gainNode.gain.value = sourceMuted || !target.audible ? 0 : dbToGain(selection.levelDb) * dbToGain(source.levelDb ?? 0);
      sourceRuntime.sourcePanner.pan.value = clampAudioPan(selection.pan);
      sourceRuntime.element.playbackRate = state.rate * (source.playbackRate ?? 1);
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
  const dur = Math.max(0, state.globalAudioMuteFadeOutSeconds ?? 0);
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
    const runtimeOffsetSeconds = (source as AudioSourceState & { runtimeOffsetSeconds?: number }).runtimeOffsetSeconds ?? 0;
    const target = getAudioEffectiveTime((directorSeconds - runtimeOffsetSeconds) * (source.playbackRate ?? 1), source.durationSeconds, state.loop);
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
        audioGraphSignature = '';
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

function isStreamRuntimeAudioSourceId(audioSourceId: string): boolean {
  return audioSourceId.startsWith('stream-audio:');
}

function connectAudioSourceToGain(
  context: AudioContext,
  sourceNode: MediaElementAudioSourceNode,
  gainNode: GainNode,
  source: AudioSourceState | undefined,
): void {
  if (source?.channelMode === 'left' || source?.channelMode === 'right') {
    const splitter = context.createChannelSplitter(2);
    sourceNode.connect(splitter);
    splitter.connect(gainNode, source.channelMode === 'left' ? 0 : 1);
    return;
  }
  sourceNode.connect(gainNode);
}

function createSourceMeterLanes(
  context: AudioContext,
  tapNode: AudioNode,
  outputId: string,
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
      id: `${outputId}:${audioSourceId}:ch-${channelIndex + 1}`,
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
