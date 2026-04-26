import { EventEmitter } from 'node:events';
import type {
  DirectorState,
  DisplayWindowState,
  DriftReport,
  LayoutProfile,
  PlaybackMode,
  RailCorrection,
  ReadinessIssue,
  AudioCapabilitiesReport,
  AudioMetadataReport,
  AudioRoutingState,
  AudioSinkSelection,
  PersistedShowConfig,
  PersistedSlotConfig,
  SlotMetadataReport,
  SlotState,
  TransportCommand,
} from '../shared/types';
import { DEFAULT_SLOT_IDS, getActiveDisplays, getLayoutSlots } from '../shared/layouts';
import { getDirectorSeconds } from '../shared/timeline';

const DEFAULT_SLOTS = Object.fromEntries(DEFAULT_SLOT_IDS.map((id) => [id, { id, ready: false }]));
const DURATION_TOLERANCE_SECONDS = 0.5;
const DRIFT_WARN_THRESHOLD_SECONDS = 0.05;
const DRIFT_CORRECTION_THRESHOLD_SECONDS = 0.1;
const MAX_CORRECTION_ATTEMPTS = 3;

export class Director extends EventEmitter {
  private state: DirectorState;

  constructor(now: () => number = Date.now) {
    super();

    this.now = now;
    this.state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: this.now(),
      offsetSeconds: 0,
      durationPolicy: 'longest-video',
      loop: {
        enabled: false,
        startSeconds: 0,
      },
      mode: 1,
      slots: structuredClone(DEFAULT_SLOTS),
      audio: {
        ready: false,
        physicalSplitAvailable: false,
        fallbackAccepted: false,
        capabilityStatus: 'unknown',
        fallbackReason: 'none',
      },
      displays: {},
      readiness: {
        ready: false,
        checkedAtWallTimeMs: this.now(),
        issues: [],
      },
      corrections: {
        displays: {},
      },
    };
  }

  private readonly now: () => number;
  private readonly correctionCounts = new Map<string, number>();
  private correctionRevision = 0;

  getState(): DirectorState {
    this.refreshReadiness();
    return structuredClone(this.state);
  }

  getPlaybackTimeSeconds(atWallTimeMs = this.now()): number {
    return getDirectorSeconds(this.state, atWallTimeMs);
  }

  setMode(mode: PlaybackMode): DirectorState {
    this.state.mode = mode;
    this.emitState();
    return this.getState();
  }

  setSlotVideo(slotId: string, videoPath: string, videoUrl: string): SlotState {
    this.ensureSlot(slotId);
    this.state.slots[slotId] = {
      ...this.state.slots[slotId],
      videoPath,
      videoUrl,
      ready: false,
      error: undefined,
      durationSeconds: undefined,
    };
    this.recalculateDuration();
    this.emitState();
    return structuredClone(this.state.slots[slotId]);
  }

  clearSlotVideo(slotId: string): SlotState {
    this.ensureSlot(slotId);
    this.state.slots[slotId] = {
      id: slotId,
      ready: false,
    };
    this.recalculateDuration();
    this.emitState();
    return structuredClone(this.state.slots[slotId]);
  }

  updateSlotMetadata(report: SlotMetadataReport): DirectorState {
    this.ensureSlot(report.slotId);
    this.state.slots[report.slotId] = {
      ...this.state.slots[report.slotId],
      durationSeconds: report.durationSeconds,
      ready: report.ready,
      error: report.error,
    };
    this.recalculateDuration();
    this.emitState();
    return this.getState();
  }

  setAudioFile(audioPath: string, audioUrl: string): AudioRoutingState {
    this.state.audio = {
      ...this.state.audio,
      path: audioPath,
      url: audioUrl,
      durationSeconds: undefined,
      ready: false,
      error: undefined,
    };
    this.state.durationPolicy = 'audio';
    this.recalculateDuration();
    this.emitState();
    return structuredClone(this.state.audio);
  }

  clearAudioFile(): AudioRoutingState {
    this.state.audio = {
      sinkId: this.state.audio.sinkId,
      sinkLabel: this.state.audio.sinkLabel,
      leftSinkId: this.state.audio.leftSinkId,
      leftSinkLabel: this.state.audio.leftSinkLabel,
      rightSinkId: this.state.audio.rightSinkId,
      rightSinkLabel: this.state.audio.rightSinkLabel,
      ready: false,
      physicalSplitAvailable: this.state.audio.physicalSplitAvailable,
      fallbackAccepted: this.state.audio.fallbackAccepted,
    };
    this.state.durationPolicy = 'longest-video';
    this.recalculateDuration();
    this.emitState();
    return structuredClone(this.state.audio);
  }

  updateAudioMetadata(report: AudioMetadataReport): DirectorState {
    this.state.audio = {
      ...this.state.audio,
      durationSeconds: report.durationSeconds,
      ready: report.ready,
      error: report.error,
      degraded: report.ready ? false : this.state.audio.degraded,
    };
    this.recalculateDuration();
    this.emitState();
    return this.getState();
  }

  setAudioSink(selection: AudioSinkSelection): DirectorState {
    if (selection.path === 'left') {
      this.state.audio = {
        ...this.state.audio,
        leftSinkId: selection.sinkId,
        leftSinkLabel: selection.sinkLabel,
      };
      this.emitState();
      return this.getState();
    }

    if (selection.path === 'right') {
      this.state.audio = {
        ...this.state.audio,
        rightSinkId: selection.sinkId,
        rightSinkLabel: selection.sinkLabel,
      };
      this.emitState();
      return this.getState();
    }

    this.state.audio = {
      ...this.state.audio,
      sinkId: selection.sinkId,
      sinkLabel: selection.sinkLabel,
    };
    this.emitState();
    return this.getState();
  }

  updateAudioCapabilities(report: AudioCapabilitiesReport): DirectorState {
    this.state.audio = {
      ...this.state.audio,
      physicalSplitAvailable: report.physicalSplitAvailable,
      fallbackAccepted: report.fallbackAccepted ?? this.state.audio.fallbackAccepted,
      capabilityStatus: report.capabilityStatus ?? this.state.audio.capabilityStatus,
      fallbackReason: report.fallbackReason ?? this.state.audio.fallbackReason,
    };
    this.emitState();
    return this.getState();
  }

  createShowConfig(savedAt = new Date().toISOString()): PersistedShowConfig {
    return {
      schemaVersion: 1,
      savedAt,
      mode: this.state.mode,
      durationPolicy: this.state.durationPolicy,
      loop: structuredClone(this.state.loop),
      slots: Object.values(this.state.slots).map((slot) => ({
        id: slot.id,
        videoPath: slot.videoPath,
      })),
      audio: {
        path: this.state.audio.path,
        sinkId: this.state.audio.sinkId,
        sinkLabel: this.state.audio.sinkLabel,
        leftSinkId: this.state.audio.leftSinkId,
        leftSinkLabel: this.state.audio.leftSinkLabel,
        rightSinkId: this.state.audio.rightSinkId,
        rightSinkLabel: this.state.audio.rightSinkLabel,
        fallbackAccepted: this.state.audio.fallbackAccepted,
      },
      displays: Object.values(this.state.displays)
        .filter((display) => display.health !== 'closed')
        .map((display) => ({
          layout: structuredClone(display.layout),
          fullscreen: display.fullscreen,
          displayId: display.displayId,
          bounds: display.bounds,
        })),
    };
  }

  restoreShowConfig(
    config: PersistedShowConfig,
    urls: { slots: Record<string, string | undefined>; audio?: string },
  ): DirectorState {
    this.state.paused = true;
    this.state.rate = 1;
    this.state.anchorWallTimeMs = this.now();
    this.state.offsetSeconds = 0;
    this.state.durationPolicy = config.durationPolicy;
    this.state.durationSeconds = undefined;
    this.state.loop = structuredClone(config.loop);
    this.state.mode = config.mode;
    this.state.slots = this.restoreSlots(config.slots, urls.slots);
    this.state.audio = {
      path: config.audio.path,
      url: urls.audio,
      sinkId: config.audio.sinkId,
      sinkLabel: config.audio.sinkLabel,
      leftSinkId: config.audio.leftSinkId,
      leftSinkLabel: config.audio.leftSinkLabel,
      rightSinkId: config.audio.rightSinkId,
      rightSinkLabel: config.audio.rightSinkLabel,
      ready: false,
      physicalSplitAvailable: false,
      fallbackAccepted: config.audio.fallbackAccepted,
      capabilityStatus: 'unknown',
      fallbackReason: 'none',
    };
    this.state.displays = {};
    this.state.corrections = { displays: {} };
    this.correctionCounts.clear();
    this.recalculateDuration();
    this.emitState();
    return this.getState();
  }

  updateDisplayLayout(id: string, layout: LayoutProfile): DirectorState {
    const display = this.state.displays[id];
    if (!display) {
      throw new Error(`Unknown display window: ${id}`);
    }

    this.state.displays[id] = {
      ...display,
      layout,
    };
    this.emitState();
    return this.getState();
  }

  registerDisplay(display: DisplayWindowState): DirectorState {
    this.state.displays[display.id] = display;
    this.emitState();
    return this.getState();
  }

  updateDisplay(display: DisplayWindowState): DirectorState {
    this.state.displays[display.id] = display;
    this.emitState();
    return this.getState();
  }

  markDisplayClosed(id: string): DirectorState {
    const current = this.state.displays[id];
    if (current) {
      this.state.displays[id] = { ...current, health: 'closed' };
      this.emitState();
    }

    return this.getState();
  }

  applyTransport(command: TransportCommand): DirectorState {
    switch (command.type) {
      case 'play':
        this.refreshReadiness();
        if (!this.state.readiness.ready) {
          this.state.paused = true;
          break;
        }
        this.play();
        break;
      case 'pause':
        this.pause();
        break;
      case 'stop':
        this.stop();
        break;
      case 'seek':
        this.seek(command.seconds);
        break;
      case 'set-rate':
        this.setRate(command.rate);
        break;
      case 'set-loop':
        this.setLoop(command.loop);
        break;
    }

    this.emitState();
    return this.getState();
  }

  ingestDrift(report: DriftReport): DirectorState {
    if (report.kind === 'control') {
      const correction = this.createCorrection('audio', report.driftSeconds);
      this.state.audio = {
        ...this.state.audio,
        lastDriftSeconds: report.driftSeconds,
        degraded: correction.action === 'degraded',
        degradationReason: correction.action === 'degraded' ? correction.reason : undefined,
      };
      this.state.corrections.audio = correction;
      this.emitState();
      return this.getState();
    }

    if (report.displayId && this.state.displays[report.displayId]) {
      const display = this.state.displays[report.displayId];
      const correction = this.createCorrection(`display:${report.displayId}`, report.driftSeconds);
      this.state.displays[report.displayId] = {
        ...display,
        lastDriftSeconds: report.driftSeconds,
        health: correction.action === 'degraded' ? 'degraded' : 'ready',
        degradationReason: correction.action === 'degraded' ? correction.reason : undefined,
      };
      this.state.corrections.displays[report.displayId] = correction;
      this.emitState();
    }

    return this.getState();
  }

  private play(): void {
    if (!this.state.paused) {
      return;
    }

    this.state.anchorWallTimeMs = this.now();
    this.state.paused = false;
  }

  private pause(): void {
    if (this.state.paused) {
      return;
    }

    this.state.offsetSeconds = this.getPlaybackTimeSeconds();
    this.state.anchorWallTimeMs = this.now();
    this.state.paused = true;
  }

  private stop(): void {
    this.state.paused = true;
    this.state.offsetSeconds = this.state.loop.enabled ? this.state.loop.startSeconds : 0;
    this.state.anchorWallTimeMs = this.now();
  }

  private seek(seconds: number): void {
    this.state.offsetSeconds = Math.max(0, seconds);
    this.state.anchorWallTimeMs = this.now();
  }

  private setRate(rate: number): void {
    if (rate <= 0) {
      throw new Error('Playback rate must be greater than zero.');
    }

    this.state.offsetSeconds = this.getPlaybackTimeSeconds();
    this.state.anchorWallTimeMs = this.now();
    this.state.rate = rate;
  }

  private setLoop(loop: DirectorState['loop']): void {
    this.state.loop = structuredClone(loop);
    this.state.offsetSeconds = this.getPlaybackTimeSeconds();
    this.state.anchorWallTimeMs = this.now();
  }

  private ensureSlot(slotId: string): void {
    if (!this.state.slots[slotId]) {
      this.state.slots[slotId] = {
        id: slotId,
        ready: false,
      };
    }
  }

  private restoreSlots(
    slots: PersistedSlotConfig[],
    urls: Record<string, string | undefined>,
  ): Record<string, SlotState> {
    const restored = structuredClone(DEFAULT_SLOTS) as Record<string, SlotState>;
    for (const slot of slots) {
      restored[slot.id] = {
        id: slot.id,
        videoPath: slot.videoPath,
        videoUrl: urls[slot.id],
        ready: false,
      };
    }

    return restored;
  }

  private recalculateDuration(): void {
    if (this.state.durationPolicy === 'audio' && this.state.audio.durationSeconds !== undefined) {
      this.state.durationSeconds = this.state.audio.durationSeconds;
      return;
    }

    if (this.state.durationPolicy !== 'longest-video') {
      const durations = Object.values(this.state.slots)
        .map((slot) => slot.durationSeconds)
        .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration));

      if (durations.length > 0 && !this.state.durationSeconds) {
        this.state.durationSeconds = Math.max(...durations);
      }

      return;
    }

    const durations = Object.values(this.state.slots)
      .map((slot) => slot.durationSeconds)
      .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration));

    this.state.durationSeconds = durations.length > 0 ? Math.max(...durations) : undefined;
  }

  private emitState(): void {
    this.refreshReadiness();
    this.emit('state', this.getState());
  }

  private refreshReadiness(): void {
    const issues = this.evaluateReadinessIssues();
    this.state.readiness = {
      ready: !issues.some((issue) => issue.severity === 'error'),
      checkedAtWallTimeMs: this.now(),
      issues,
    };
  }

  private evaluateReadinessIssues(): ReadinessIssue[] {
    const issues: ReadinessIssue[] = [];
    const activeDisplays = getActiveDisplays(this.state.displays);
    const requiredDisplayCount = this.state.mode === 1 ? 1 : 2;

    if (activeDisplays.length < requiredDisplayCount) {
      issues.push({
        severity: 'error',
        target: 'display',
        message: `Mode ${this.state.mode} requires ${requiredDisplayCount} active display window(s).`,
      });
    }

    for (const display of activeDisplays.slice(0, requiredDisplayCount)) {
      if (display.health === 'closed' || display.health === 'stale' || display.health === 'degraded') {
        issues.push({
          severity: 'error',
          target: `display:${display.id}`,
          message: `Display ${display.id} is ${display.health}${display.degradationReason ? `: ${display.degradationReason}` : ''}.`,
        });
      }

      for (const slotId of getLayoutSlots(display.layout)) {
        const slot = this.state.slots[slotId];
        if (!slot?.videoPath) {
          issues.push({
            severity: 'error',
            target: `slot:${slotId}`,
            message: `Slot ${slotId} has no video selected.`,
          });
          continue;
        }
        if (!slot.ready) {
          issues.push({
            severity: 'error',
            target: `slot:${slotId}`,
            message: slot.error ?? `Slot ${slotId} video is not ready.`,
          });
        }
      }
    }

    if (!this.state.audio.path) {
      issues.push({
        severity: 'error',
        target: 'audio',
        message: 'A stereo audio file is required for playback.',
      });
    } else if (!this.state.audio.ready) {
      issues.push({
        severity: 'error',
        target: 'audio',
        message: this.state.audio.error ?? 'Audio file is not ready.',
      });
    }

    if (this.state.mode === 3 && !this.state.audio.physicalSplitAvailable && !this.state.audio.fallbackAccepted) {
      issues.push({
        severity: 'error',
        target: 'audio:mode3',
        message: 'Mode 3 physical split routing is unavailable; accept fallback before rehearsal playback.',
      });
    }

    this.addDurationIssues(issues, activeDisplays);
    return issues;
  }

  private addDurationIssues(issues: ReadinessIssue[], activeDisplays: DisplayWindowState[]): void {
    const directorDuration = this.state.durationSeconds;
    if (directorDuration === undefined) {
      return;
    }

    const activeSlotIds = new Set(activeDisplays.flatMap((display) => getLayoutSlots(display.layout)));
    for (const slotId of activeSlotIds) {
      const duration = this.state.slots[slotId]?.durationSeconds;
      if (duration === undefined) {
        continue;
      }
      if (Math.abs(duration - directorDuration) > DURATION_TOLERANCE_SECONDS) {
        issues.push({
          severity: 'warning',
          target: 'duration',
          message: `Slot ${slotId} duration (${duration.toFixed(3)}s) differs from director duration (${directorDuration.toFixed(3)}s).`,
        });
      }
    }

    const audioDuration = this.state.audio.durationSeconds;
    if (audioDuration !== undefined && Math.abs(audioDuration - directorDuration) > DURATION_TOLERANCE_SECONDS) {
      issues.push({
        severity: 'warning',
        target: 'duration',
        message: `Audio duration (${audioDuration.toFixed(3)}s) differs from director duration (${directorDuration.toFixed(3)}s).`,
      });
    }

    if (this.state.loop.enabled && this.state.loop.endSeconds !== undefined) {
      const loopEnd = this.state.loop.endSeconds;
      if (loopEnd > directorDuration + DURATION_TOLERANCE_SECONDS) {
        issues.push({
          severity: 'error',
          target: 'loop',
          message: `Loop end (${loopEnd.toFixed(3)}s) is beyond director duration (${directorDuration.toFixed(3)}s).`,
        });
      }
    }
  }

  private createCorrection(railKey: string, driftSeconds: number): RailCorrection {
    const absoluteDrift = Math.abs(driftSeconds);
    if (absoluteDrift <= DRIFT_WARN_THRESHOLD_SECONDS) {
      this.correctionCounts.set(railKey, 0);
      return {
        action: 'none',
        driftSeconds,
        issuedAtWallTimeMs: this.now(),
        revision: ++this.correctionRevision,
      };
    }

    const attempts = (this.correctionCounts.get(railKey) ?? 0) + 1;
    this.correctionCounts.set(railKey, attempts);

    if (attempts > MAX_CORRECTION_ATTEMPTS) {
      return {
        action: 'degraded',
        targetSeconds: this.getPlaybackTimeSeconds(),
        driftSeconds,
        issuedAtWallTimeMs: this.now(),
        reason: `Rail drift stayed above ${(DRIFT_CORRECTION_THRESHOLD_SECONDS * 1000).toFixed(0)}ms after repeated corrections.`,
        revision: ++this.correctionRevision,
      };
    }

    return {
      action: absoluteDrift > DRIFT_CORRECTION_THRESHOLD_SECONDS ? 'seek' : 'none',
      targetSeconds: absoluteDrift > DRIFT_CORRECTION_THRESHOLD_SECONDS ? this.getPlaybackTimeSeconds() : undefined,
      driftSeconds,
      issuedAtWallTimeMs: this.now(),
      reason: absoluteDrift > DRIFT_CORRECTION_THRESHOLD_SECONDS ? 'Drift exceeded correction threshold.' : undefined,
      revision: ++this.correctionRevision,
    };
  }
}
