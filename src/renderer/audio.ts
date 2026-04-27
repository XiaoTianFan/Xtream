/// <reference path="./global.d.ts" />
import { getAudioEffectiveTime, getDirectorSeconds } from '../shared/timeline';
import type { DirectorState, VirtualOutputId } from '../shared/types';
import {
  getFirstMeteredAudioSource,
  sampleMeters,
  setSoloOutputIds,
  syncAudioRuntimeToDirector,
  syncVirtualAudioGraph,
} from './control/audioRuntime';
import { getMediaSyncState } from './control/mediaSync';

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let driftTimer: number | undefined;
let lastMeterSampleMs = 0;
const METER_SAMPLE_INTERVAL_MS = 50;

function handleState(state: DirectorState): void {
  currentState = state;
  syncVirtualAudioGraph(state);
}

function handleSoloOutputIds(outputIds: VirtualOutputId[]): void {
  setSoloOutputIds(outputIds);
  if (currentState) {
    syncAudioRuntimeToDirector(currentState);
  }
}

function tick(): void {
  if (currentState) {
    const now = performance.now();
    syncAudioRuntimeToDirector(currentState);
    if (!currentState.performanceMode && now - lastMeterSampleMs >= METER_SAMPLE_INTERVAL_MS) {
      lastMeterSampleMs = now;
      sampleMeters(currentState);
    }
  }
  animationFrame = window.requestAnimationFrame(tick);
}

window.xtream.director.onState(handleState);
window.xtream.audioRuntime.onSoloOutputIds(handleSoloOutputIds);
void window.xtream.renderer.ready({ kind: 'audio' });
void window.xtream.director.getState().then(handleState);

animationFrame = window.requestAnimationFrame(tick);
driftTimer = window.setInterval(() => {
  if (!currentState || currentState.paused) {
    return;
  }
  const firstSource = getFirstMeteredAudioSource();
  if (!firstSource || getMediaSyncState(firstSource.element).pendingSeekSeconds !== undefined) {
    return;
  }
  const source = currentState.audioSources[firstSource.audioSourceId];
  if (!source) {
    return;
  }
  const sourceRate = source.playbackRate ?? 1;
  const directorSeconds = getDirectorSeconds(currentState);
  const target = getAudioEffectiveTime(directorSeconds * sourceRate, source.durationSeconds, currentState.loop);
  if (!target.audible) {
    return;
  }
  void window.xtream.renderer.reportDrift({
    kind: 'control',
    observedSeconds: firstSource.element.currentTime,
    directorSeconds,
    driftSeconds: firstSource.element.currentTime - target.seconds,
    reportedAtWallTimeMs: Date.now(),
  });
}, 1000);

window.addEventListener('beforeunload', () => {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
  }
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
});
