import { getAudioEffectiveTime, getDirectorSeconds } from '../../shared/timeline';
import type { AudioSourceState, DirectorState, VirtualOutputState } from '../../shared/types';
import { createPlaybackSyncKey, requestMediaPlay, syncTimedMediaElement } from './mediaSync';

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSourceRuntime = {
  audioSourceId: string;
  element: HTMLMediaElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
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
      sourceNode.connect(gainNode).connect(busGain);
      element.addEventListener('loadedmetadata', () => {
        void window.xtream.audioSources.reportMetadata({
          audioSourceId: selection.audioSourceId,
          durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
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
      runtime.sources.push({ audioSourceId: selection.audioSourceId, element, sourceNode, gainNode });
    }
    outputRuntimes.set(output.id, runtime);
    await applyOutputSink(output, runtime);
  }
}

export function syncAudioRuntimeToDirector(state: DirectorState): void {
  const directorSeconds = getDirectorSeconds(state);
  const syncKey = createPlaybackSyncKey(state);
  const hasSolo = soloOutputIds.size > 0;
  for (const output of Object.values(state.outputs)) {
    const runtime = outputRuntimes.get(output.id);
    if (!runtime) {
      continue;
    }
    const transportMode = syncTransportEnvelope(runtime, state);
    runtime.busGain.gain.value = state.globalAudioMuted || output.muted || (hasSolo && !soloOutputIds.has(output.id)) ? 0 : dbToGain(output.busLevelDb);
    for (const sourceRuntime of runtime.sources) {
      const selection = output.sources.find((candidate) => candidate.audioSourceId === sourceRuntime.audioSourceId);
      const source = state.audioSources[sourceRuntime.audioSourceId];
      if (!selection || !source) {
        continue;
      }
      const target = getAudioEffectiveTime(directorSeconds * (source.playbackRate ?? 1), source.durationSeconds, state.loop);
      sourceRuntime.gainNode.gain.value = selection.muted || !target.audible ? 0 : dbToGain(selection.levelDb) * dbToGain(source.levelDb ?? 0);
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
    runtime.analyser.getByteTimeDomainData(runtime.meterData);
    let peak = 0;
    for (const sample of runtime.meterData) {
      peak = Math.max(peak, Math.abs((sample - 128) / 128));
    }
    const meterDb = peak <= 0.00001 ? -60 : Math.max(-60, 20 * Math.log10(peak));
    if (meterRoot) {
      const fills = meterRoot.querySelectorAll<HTMLElement>(`[data-meter-fill="${outputId}"]`);
      for (const fill of fills) {
        fill.style.width = meterWidth(meterDb);
        fill.style.height = meterWidth(meterDb);
      }
    }
    if (now - runtime.lastMeterReportMs > 250 && state.outputs[outputId]) {
      runtime.lastMeterReportMs = now;
      void window.xtream.outputs.reportMeter(outputId, meterDb);
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
  audio.play().catch((error: unknown) => {
    setStatus(`Preview failed: ${error instanceof Error ? error.message : 'Unable to play audio source.'}`);
  });
  window.setTimeout(() => {
    audio.pause();
    audio.remove();
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
