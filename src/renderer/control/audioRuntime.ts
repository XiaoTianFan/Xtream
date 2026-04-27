import { getAudioEffectiveTime, getDirectorSeconds } from '../../shared/timeline';
import type { AudioSourceState, DirectorState, MeterLaneState, VirtualOutputState } from '../../shared/types';
import { createPlaybackSyncKey, requestMediaPlay, syncTimedMediaElement } from './mediaSync';

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSourceRuntime = {
  audioSourceId: string;
  element: HTMLMediaElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
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

type OutputRuntime = {
  outputId: string;
  context: AudioContext;
  sources: OutputSourceRuntime[];
  busGain: GainNode;
  envelopeGain: GainNode;
  analyser: AnalyserNode;
  destination: MediaStreamAudioDestinationNode;
  sinkElement: SinkCapableAudioElement;
  meterData: Uint8Array<ArrayBuffer>;
  lastMeterReportMs: number;
  transportPlaying: boolean;
  envelopeTargetGain: number;
  fadePauseTimer?: number;
};

type TransportEnvelopeMode = 'playing' | 'fading-out' | 'paused';

const TRANSPORT_FADE_SECONDS = 0.035;
const TRANSPORT_FADE_MS = TRANSPORT_FADE_SECONDS * 1000;
const METER_FLOOR_DB = -60;
const METER_CLIP_DB = 0;

let audioGraphSignature = '';
let outputRuntimes = new Map<string, OutputRuntime>();
let soloOutputIds = new Set<string>();

export function setSoloOutputIds(outputIds: Iterable<string>): void {
  soloOutputIds = new Set(outputIds);
}

export function syncVirtualAudioGraph(state: DirectorState): void {
  const signature = JSON.stringify(
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
  if (signature !== audioGraphSignature) {
    audioGraphSignature = signature;
    void rebuildAudioGraph(state);
  }
  syncAudioRuntimeToDirector(state);
}

export async function rebuildAudioGraph(state: DirectorState): Promise<void> {
  for (const runtime of outputRuntimes.values()) {
    if (runtime.fadePauseTimer !== undefined) {
      window.clearTimeout(runtime.fadePauseTimer);
    }
    runtime.sinkElement.pause();
    runtime.sinkElement.remove();
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
    const envelopeGain = context.createGain();
    envelopeGain.gain.value = state.paused ? 0 : 1;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const destination = context.createMediaStreamDestination();
    const sinkElement = createHiddenAudioOutput();
    sinkElement.srcObject = destination.stream;
    busGain.connect(envelopeGain).connect(analyser);
    analyser.connect(destination);
    const runtime: OutputRuntime = {
      outputId: output.id,
      context,
      sources: [],
      busGain,
      envelopeGain,
      analyser,
      destination,
      sinkElement,
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
      gainNode.connect(busGain);
      const meterLanes = createSourceMeterLanes(context, gainNode, output.id, selection.audioSourceId, state.audioSources[selection.audioSourceId]);
      element.addEventListener('loadedmetadata', () => {
        const detectedChannelCount = getSourceChannelCount(state.audioSources[selection.audioSourceId], sourceNode);
        void window.xtream.audioSources.reportMetadata({
          audioSourceId: selection.audioSourceId,
          durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
          channelCount: detectedChannelCount,
          ready: true,
        });
      });
      element.addEventListener('error', () => {
        void window.xtream.audioSources.reportMetadata({
          audioSourceId: selection.audioSourceId,
          durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
          ready: false,
          error: element.error?.message ?? 'Audio failed to load.',
        });
      });
      runtime.sources.push({ audioSourceId: selection.audioSourceId, element, sourceNode, gainNode, meterLanes });
    }
    outputRuntimes.set(output.id, runtime);
    await applyOutputSink(output, runtime);
  }
}

export function syncAudioRuntimeToDirector(state: DirectorState): void {
  const directorSeconds = getDirectorSeconds(state);
  const syncKey = createPlaybackSyncKey(state);
  for (const output of Object.values(state.outputs)) {
    const runtime = outputRuntimes.get(output.id);
    if (!runtime) {
      continue;
    }
    const transportMode = syncTransportEnvelope(runtime, state);
    runtime.busGain.gain.value = getEffectiveOutputGain(state.globalAudioMuted, output, soloOutputIds);
    const hasSoloedSource = output.sources.some((selection) => selection.solo);
    for (const sourceRuntime of runtime.sources) {
      const selection = output.sources.find((candidate) => candidate.audioSourceId === sourceRuntime.audioSourceId);
      const source = state.audioSources[sourceRuntime.audioSourceId];
      if (!selection || !source) {
        continue;
      }
      const target = getAudioEffectiveTime(directorSeconds * (source.playbackRate ?? 1), source.durationSeconds, state.loop);
      const sourceMuted = selection.muted || (hasSoloedSource && !selection.solo);
      sourceRuntime.gainNode.gain.value = sourceMuted || !target.audible ? 0 : dbToGain(selection.levelDb) * dbToGain(source.levelDb ?? 0);
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
      runtime.sinkElement.pause();
    } else {
      requestMediaPlay(runtime.sinkElement);
    }
  }
}

export function getEffectiveOutputGain(
  globalAudioMuted: boolean,
  output: Pick<VirtualOutputState, 'id' | 'muted' | 'busLevelDb'>,
  soloIds: ReadonlySet<string>,
): number {
  const hasSolo = soloIds.size > 0;
  if (globalAudioMuted || output.muted || (hasSolo && !soloIds.has(output.id))) {
    return 0;
  }
  return dbToGain(output.busLevelDb);
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
      runtime.sinkElement.pause();
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
    const target = getAudioEffectiveTime(directorSeconds * (source.playbackRate ?? 1), source.durationSeconds, state.loop);
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
    const outputGain = runtime.busGain.gain.value * runtime.envelopeGain.gain.value;
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
  const url = source.type === 'external-file' ? source.url : state.visuals[source.visualId]?.url;
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
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const toneOutput = createHiddenAudioOutput();
  oscillator.frequency.value = 660;
  gain.gain.value = dbToGain(output.busLevelDb) * 0.18;
  oscillator.connect(gain).connect(destination);
  toneOutput.srcObject = destination.stream;
  if (toneOutput.setSinkId) {
    await toneOutput.setSinkId(output.sinkId ?? '');
  }
  oscillator.start();
  await toneOutput.play();
  window.setTimeout(() => {
    oscillator.stop();
    toneOutput.pause();
    toneOutput.remove();
    void context.close();
  }, 850);
}

export function meterWidth(db: number | undefined): string {
  return `${Math.max(0, Math.min(100, ((db ?? -60) + 60) * (100 / 72)))}%`;
}

export function meterLevelPercent(db: number | undefined): number {
  return Math.max(0, Math.min(100, (((db ?? METER_FLOOR_DB) - METER_FLOOR_DB) / Math.abs(METER_FLOOR_DB)) * 100));
}

function getAudioSourceUrl(audioSourceId: string, state: DirectorState): string {
  const source = state.audioSources[audioSourceId];
  if (!source) {
    return '';
  }
  if (source.type === 'external-file') {
    return source.url ?? '';
  }
  return state.visuals[source.visualId]?.url ?? '';
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
  gainNode: GainNode,
  outputId: string,
  audioSourceId: string,
  source: AudioSourceState | undefined,
): SourceMeterLaneRuntime[] {
  const channelCount = getExpectedChannelCount(source);
  const splitter = context.createChannelSplitter(channelCount);
  gainNode.connect(splitter);
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

async function applyOutputSink(output: VirtualOutputState, runtime: OutputRuntime): Promise<void> {
  if (!runtime.sinkElement.setSinkId) {
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: false,
      fallbackReason: 'setSinkId unavailable',
    });
    return;
  }
  try {
    await runtime.sinkElement.setSinkId(output.sinkId ?? '');
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
