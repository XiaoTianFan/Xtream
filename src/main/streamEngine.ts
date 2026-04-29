import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Director } from './director';
import type {
  PersistedControlSubCueConfig,
  PersistedSceneConfig,
  PersistedShowConfig,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  SceneId,
  SceneRuntimeState,
  CalculatedStreamTimeline,
  LoopState,
  StreamCommand,
  StreamEditCommand,
  StreamEnginePublicState,
  StreamRuntimeAudioSubCue,
  StreamRuntimeState,
  StreamRuntimeVisualSubCue,
  SubCueId,
} from '../shared/types';
import { createEmptyUserScene, getDefaultStreamPersistence, normalizeStreamPlaybackSettings, normalizeStreamPersistence } from '../shared/streamWorkspace';
import { isElapsedWithinLoopTotal, mapElapsedToLoopPhase, resolveLoopTiming } from '../shared/streamLoopTiming';
import {
  buildStreamSchedule,
  type StreamSchedule,
  validateStreamContent,
  validateStreamStructure,
  validateTriggerReferences,
} from '../shared/streamSchedule';

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isRunningStatus(status: StreamRuntimeState['status']): boolean {
  return status === 'running' || status === 'preloading';
}

export class StreamEngine extends EventEmitter {
  private stream: PersistedStreamConfig = getDefaultStreamPersistence().stream;
  private timelineRevision = 0;
  private playbackStream: PersistedStreamConfig = structuredClone(this.stream);
  private editTimeline: CalculatedStreamTimeline = this.createEmptyTimeline('valid');
  private playbackTimeline: CalculatedStreamTimeline = this.createEmptyTimeline('valid');
  private runtime: StreamRuntimeState | null = null;
  private validationMessages: string[] = [];
  private tickTimer: NodeJS.Timeout | undefined;
  private dispatchedControlSubCues = new Set<string>();
  private manuallyCompletedSceneIds = new Set<SceneId>();
  private skippedAtTimecodeSceneIds = new Set<SceneId>();
  private manualSceneStartOverrides = new Map<SceneId, number>();
  private orphanedAudioSubCues: StreamRuntimeAudioSubCue[] = [];
  private orphanedVisualSubCues: StreamRuntimeVisualSubCue[] = [];

  constructor(private readonly director: Director) {
    super();
  }

  isStreamPlaybackActive(): boolean {
    return this.runtime !== null && (this.runtime.status === 'running' || this.runtime.status === 'preloading' || this.runtime.status === 'paused');
  }

  loadFromShow(config: { stream: PersistedStreamConfig }): void {
    this.stopTicking();
    this.stream = normalizeStreamPersistence(config.stream);
    this.recalculateEditTimeline();
    if (this.editTimeline.status === 'valid') {
      this.promoteEditTimeline();
    } else {
      this.playbackStream = structuredClone(this.stream);
      this.playbackTimeline = this.editTimeline;
    }
    this.runtime = null;
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
    this.revalidate();
    this.emitState();
  }

  resetToDefault(): void {
    const d = getDefaultStreamPersistence();
    this.loadFromShow({ stream: structuredClone(d.stream) });
  }

  getPersistence(): Pick<PersistedShowConfig, 'stream'> {
    return {
      stream: structuredClone(this.stream),
    };
  }

  getPublicState(): StreamEnginePublicState {
    return {
      stream: structuredClone(this.stream),
      playbackStream: structuredClone(this.playbackStream),
      runtime: this.runtime ? structuredClone(this.runtime) : null,
      editTimeline: structuredClone(this.editTimeline),
      playbackTimeline: structuredClone(this.playbackTimeline),
      validationMessages: [...this.validationMessages],
    };
  }

  refreshMediaDurations(): StreamEnginePublicState {
    const wasRunning = this.runtime?.status === 'running' || this.runtime?.status === 'preloading';
    const runningCursorMs = wasRunning ? this.getRuntimeStreamMs() : undefined;
    this.recalculateEditTimeline();
    if (this.editTimeline.status === 'valid') {
      this.promoteEditTimeline();
    }
    this.revalidate();
    if (this.runtime) {
      if (wasRunning && runningCursorMs !== undefined) {
        this.runtime.offsetStreamMs = runningCursorMs;
        this.runtime.currentStreamMs = runningCursorMs;
        this.runtime.originWallTimeMs = Date.now();
        this.runtime.startedWallTimeMs = this.runtime.originWallTimeMs;
      }
      this.recomputeRuntime();
    }
    this.emitState();
    return this.getPublicState();
  }

  applyEdit(command: StreamEditCommand): StreamEnginePublicState {
    switch (command.type) {
      case 'update-stream': {
        if (command.label !== undefined) {
          this.stream.label = command.label;
        }
        if (command.playbackSettings !== undefined) {
          this.stream = normalizeStreamPersistence({
            ...this.stream,
            playbackSettings: normalizeStreamPlaybackSettings({ ...this.stream.playbackSettings, ...command.playbackSettings }),
          });
        }
        break;
      }
      case 'create-scene': {
        const sceneId = newId('scene') as SceneId;
        const scene = createEmptyUserScene(sceneId, `Scene ${this.stream.sceneOrder.length + 1}`);
        if (command.trigger) {
          scene.trigger = command.trigger;
        }
        if (command.afterSceneId !== undefined) {
          const idx = this.stream.sceneOrder.indexOf(command.afterSceneId);
          this.stream.sceneOrder.splice(idx >= 0 ? idx + 1 : this.stream.sceneOrder.length, 0, sceneId);
        } else {
          this.stream.sceneOrder.push(sceneId);
        }
        this.stream.scenes[sceneId] = scene;
        break;
      }
      case 'update-scene': {
        const scene = this.stream.scenes[command.sceneId];
        if (!scene) {
          break;
        }
        const { subCues, subCueOrder, id: _id, ...rest } = command.update;
        Object.assign(scene, rest);
        if (subCues !== undefined) {
          scene.subCues = subCues;
        }
        if (subCueOrder !== undefined) {
          scene.subCueOrder = subCueOrder;
        }
        break;
      }
      case 'duplicate-scene': {
        const source = this.stream.scenes[command.sceneId];
        if (!source) {
          break;
        }
        const sceneId = newId('scene') as SceneId;
        const subCueOrder: SubCueId[] = [];
        const subCues: PersistedSceneConfig['subCues'] = {};
        for (const sid of source.subCueOrder) {
          const sub = source.subCues[sid];
          if (!sub) {
            continue;
          }
          const nid = newId('sub') as SubCueId;
          subCueOrder.push(nid);
          subCues[nid] = { ...sub, id: nid };
        }
        const copy: PersistedSceneConfig = {
          ...structuredClone(source),
          id: sceneId,
          title: source.title ? `${source.title} copy` : undefined,
          subCueOrder,
          subCues,
        };
        const idx = this.stream.sceneOrder.indexOf(command.sceneId);
        this.stream.sceneOrder.splice(idx >= 0 ? idx + 1 : this.stream.sceneOrder.length, 0, sceneId);
        this.stream.scenes[sceneId] = copy;
        break;
      }
      case 'remove-scene': {
        this.stream.sceneOrder = this.stream.sceneOrder.filter((id) => id !== command.sceneId);
        delete this.stream.scenes[command.sceneId];
        break;
      }
      case 'reorder-scenes': {
        this.stream.sceneOrder = [...command.sceneOrder];
        break;
      }
      case 'update-subcue': {
        const scene = this.stream.scenes[command.sceneId];
        const sub = scene?.subCues[command.subCueId];
        if (!scene || !sub) {
          break;
        }
        Object.assign(sub, command.update);
        break;
      }
      default:
        break;
    }
    const wasRunning = this.runtime?.status === 'running' || this.runtime?.status === 'preloading';
    const runningCursorMs = wasRunning ? this.getRuntimeStreamMs() : undefined;
    const previousActiveAudio = wasRunning ? this.runtime?.activeAudioSubCues?.filter((cue) => !cue.orphaned).map((cue) => ({ ...cue })) ?? [] : [];
    const previousActiveVisual = wasRunning ? this.runtime?.activeVisualSubCues?.filter((cue) => !cue.orphaned).map((cue) => ({ ...cue })) ?? [] : [];
    this.recalculateEditTimeline();
    const promoted = this.editTimeline.status === 'valid';
    if (promoted) {
      this.promoteEditTimeline();
    }
    this.revalidate();
    if (this.runtime) {
      if (wasRunning && runningCursorMs !== undefined) {
        this.runtime.offsetStreamMs = runningCursorMs;
        this.runtime.currentStreamMs = runningCursorMs;
        this.runtime.originWallTimeMs = Date.now();
        this.runtime.startedWallTimeMs = this.runtime.originWallTimeMs;
      }
      this.recomputeRuntime();
      if (promoted && wasRunning) {
        this.createOrphansForRemovedActiveCues(previousActiveAudio, previousActiveVisual);
        this.recomputeRuntime();
      }
    }
    this.emitState();
    return this.getPublicState();
  }

  applyTransport(command: StreamCommand): StreamEnginePublicState {
    if (this.director.isPatchTransportPlaying() && !this.isStreamPlaybackActive() && this.commandStartsStreamPlayback(command)) {
      return this.getPublicState();
    }

    switch (command.type) {
      case 'play':
        this.handlePlay(command.sceneId, command.source ?? 'global');
        break;
      case 'pause':
        this.pause();
        break;
      case 'stop':
        this.stop();
        break;
      case 'jump-next':
        this.handleJumpNext(command.referenceSceneId);
        break;
      case 'back-to-first':
        this.handleBackToFirst();
        break;
      case 'seek':
        this.seek(command.timeMs);
        break;
      default:
        break;
    }

    this.emitState();
    return this.getPublicState();
  }

  private commandStartsStreamPlayback(command: StreamCommand): boolean {
    if (command.type === 'play') {
      return true;
    }
    if (command.type === 'seek' || command.type === 'jump-next') {
      return this.runtime?.status === 'running' || this.runtime?.status === 'preloading';
    }
    return false;
  }

  private handlePlay(sceneId?: SceneId, source: NonNullable<Extract<StreamCommand, { type: 'play' }>['source']> = 'global'): void {
    if (this.playbackTimeline.status !== 'valid') {
      return;
    }
    const stream = this.playbackStream;
    const target =
      sceneId && stream.scenes[sceneId] && !stream.scenes[sceneId].disabled
        ? sceneId
        : undefined;
    if (this.runtime?.status === 'paused' && source === 'global') {
      const pauseSelection = this.runtime.selectedSceneIdAtPause ?? this.runtime.cursorSceneId;
      if (stream.playbackSettings?.pausedPlayBehavior !== 'preserve-paused-cursor' && target && target !== pauseSelection) {
        this.startFromStreamTime(this.sceneStartMs(target) ?? 0, target);
        return;
      }
      this.resumeFromPausedCursor();
      return;
    }
    if (target && source !== 'global' && this.runtime?.status === 'running') {
      this.manualSceneStartOverrides.set(target, this.getRuntimeStreamMs());
      this.runtime.cursorSceneId = target;
      this.recomputeRuntime();
      return;
    }
    if (target) {
      const start = this.sceneStartMs(target) ?? 0;
      this.startFromStreamTime(start, target);
      return;
    }
    if (this.runtime) {
      const current = this.runtime.currentStreamMs ?? this.runtime.offsetStreamMs ?? this.runtime.pausedAtStreamMs ?? 0;
      this.startFromStreamTime(current, this.runtime.cursorSceneId);
      return;
    }
    const first = this.firstEnabledSceneId();
    if (!first) {
      this.stopTicking();
      this.runtime = { status: 'complete', sceneStates: {} };
      return;
    }
    this.startFromStreamTime(this.sceneStartMs(first) ?? 0, first);
  }

  private startFromStreamTime(timeMs: number, referenceSceneId?: SceneId): void {
    const schedule = this.playbackTimeline;
    const now = Date.now();
    this.runtime = {
      status: 'running',
      originWallTimeMs: now,
      startedWallTimeMs: now,
      offsetStreamMs: timeMs,
      currentStreamMs: timeMs,
      cursorSceneId: referenceSceneId,
      sceneStates: this.createInitialSceneStates(schedule),
      expectedDurationMs: schedule.expectedDurationMs,
      timelineNotice: schedule.notice,
    };
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
    this.recomputeRuntime();
    this.startTicking();
  }

  private pause(): void {
    if (!this.runtime || this.runtime.status !== 'running') {
      return;
    }
    const current = this.getRuntimeStreamMs();
    this.runtime.status = 'paused';
    this.runtime.pausedAtStreamMs = current;
    this.runtime.pausedCursorMs = current;
    this.runtime.selectedSceneIdAtPause = this.runtime.cursorSceneId;
    this.runtime.currentStreamMs = current;
    this.runtime.offsetStreamMs = current;
    this.runtime.originWallTimeMs = undefined;
    this.runtime.startedWallTimeMs = undefined;
    this.recomputeRuntime();
    this.stopTicking();
  }

  private resumeFromPausedCursor(): void {
    if (!this.runtime || this.runtime.status !== 'paused') {
      return;
    }
    const current = this.runtime.pausedAtStreamMs ?? this.runtime.currentStreamMs ?? this.runtime.offsetStreamMs ?? 0;
    const now = Date.now();
    this.runtime.status = 'running';
    this.runtime.offsetStreamMs = current;
    this.runtime.currentStreamMs = current;
    this.runtime.originWallTimeMs = now;
    this.runtime.startedWallTimeMs = now;
    this.runtime.pausedAtStreamMs = undefined;
    this.runtime.pausedCursorMs = undefined;
    this.runtime.selectedSceneIdAtPause = undefined;
    this.recomputeRuntime();
    this.startTicking();
  }

  private stop(): void {
    this.stopTicking();
    this.runtime = null;
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
  }

  private seek(timeMs: number): void {
    if (this.playbackTimeline.status !== 'valid') {
      return;
    }
    if (!this.runtime) {
      this.ensureIdleRuntime();
    }
    if (!this.runtime) {
      return;
    }
    const schedule = this.playbackTimeline;
    const max = schedule.expectedDurationMs;
    const nextMs = max === undefined ? clampNonNegative(timeMs) : Math.min(max, clampNonNegative(timeMs));
    this.runtime.offsetStreamMs = nextMs;
    this.runtime.currentStreamMs = nextMs;
    this.runtime.pausedAtStreamMs = this.runtime.status === 'paused' ? nextMs : undefined;
    this.runtime.pausedCursorMs = this.runtime.status === 'paused' ? nextMs : undefined;
    if (isRunningStatus(this.runtime.status)) {
      const now = Date.now();
      this.runtime.originWallTimeMs = now;
      this.runtime.startedWallTimeMs = now;
      this.startTicking();
    }
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    for (const sceneId of this.playbackStream.sceneOrder) {
      const scene = this.playbackStream.scenes[sceneId];
      if (scene?.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < nextMs) {
        this.skippedAtTimecodeSceneIds.add(sceneId);
      }
    }
    this.recomputeRuntime();
  }

  private handleBackToFirst(): void {
    if (this.runtime?.status === 'running' || this.runtime?.status === 'preloading') {
      this.recomputeRuntime();
      return;
    }
    this.ensureIdleRuntime(this.firstEnabledSceneId(), 0);
  }

  private ensureIdleRuntime(referenceSceneId: SceneId | undefined = this.firstEnabledSceneId(), timeMs = 0): void {
    const target = this.firstEnabledSceneId();
    const schedule = this.playbackTimeline;
    this.stopTicking();
    this.runtime = {
      status: target ? 'idle' : 'complete',
      cursorSceneId: referenceSceneId ?? target,
      sceneStates: this.createInitialSceneStates(schedule),
      expectedDurationMs: schedule.expectedDurationMs,
      offsetStreamMs: timeMs,
      currentStreamMs: timeMs,
      pausedAtStreamMs: timeMs,
      timelineNotice: schedule.notice,
    };
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
    this.recomputeRuntime();
  }

  private handleJumpNext(referenceSceneId?: SceneId): void {
    if (this.playbackTimeline.status !== 'valid') {
      return;
    }
    if (!this.runtime) {
      this.ensureIdleRuntime(referenceSceneId);
    }
    if (this.runtime) {
      this.recomputeRuntime();
    }
    const wasRunning = this.runtime?.status === 'running' || this.runtime?.status === 'preloading';
    const wasPaused = this.runtime?.status === 'paused';
    const cur = wasRunning
      ? this.latestSceneWithStatus(['running'])
      : wasPaused
        ? this.latestSceneWithStatus(['paused'])
        : referenceSceneId ?? this.runtime?.cursorSceneId;
    if (!this.runtime || !cur) {
      return;
    }
    const stream = this.playbackStream;
    const idx = stream.sceneOrder.indexOf(cur);
    if (idx < 0) {
      return;
    }
    const next = stream.sceneOrder.slice(idx + 1).find((id) => !stream.scenes[id]?.disabled);
    const schedule = this.playbackTimeline;
    const curEntry = schedule.entries[cur];
    const nextEntry = next ? schedule.entries[next] : undefined;
    if (!next) {
      if (wasRunning) {
        this.manuallyCompletedSceneIds.add(cur);
        const end = curEntry?.endMs ?? this.getRuntimeStreamMs();
        this.seek(end);
        this.manuallyCompletedSceneIds.add(cur);
        this.recomputeRuntime();
        if (this.runtime) {
          this.runtime.status = 'complete';
          this.runtime.cursorSceneId = undefined;
        }
        this.stopTicking();
      }
      return;
    }
    if (wasRunning || wasPaused) {
      this.manuallyCompletedSceneIds.add(cur);
    }
    const jumpTarget = nextEntry?.startMs ?? this.getRuntimeStreamMs();
    this.seek(jumpTarget);
    if (this.runtime && wasRunning) {
      const now = Date.now();
      this.runtime.status = 'running';
      this.runtime.originWallTimeMs = now;
      this.runtime.startedWallTimeMs = now;
      this.startTicking();
    }
    if (wasRunning || wasPaused) {
      this.manuallyCompletedSceneIds.add(cur);
    }
    this.recomputeRuntime();
    if (this.runtime) {
      this.runtime.cursorSceneId = next;
    }
  }

  private latestSceneWithStatus(statuses: SceneRuntimeState['status'][]): SceneId | undefined {
    if (!this.runtime) {
      return undefined;
    }
    const statusSet = new Set(statuses);
    let latest: { sceneId: SceneId; startMs: number } | undefined;
    for (const state of Object.values(this.runtime.sceneStates)) {
      if (!statusSet.has(state.status)) {
        continue;
      }
      const startMs = state.scheduledStartMs ?? this.playbackTimeline.entries[state.sceneId]?.startMs;
      if (startMs === undefined) {
        continue;
      }
      if (!latest || startMs >= latest.startMs) {
        latest = { sceneId: state.sceneId, startMs };
      }
    }
    return latest?.sceneId;
  }

  private createInitialSceneStates(schedule: CalculatedStreamTimeline, stream: PersistedStreamConfig = this.playbackStream): Record<SceneId, SceneRuntimeState> {
    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    for (const id of stream.sceneOrder) {
      const sc = stream.scenes[id];
      const entry = schedule.entries[id];
      sceneStates[id] = {
        sceneId: id,
        status: !sc || sc.disabled ? 'disabled' : entry?.startMs !== undefined ? 'ready' : 'ready',
        scheduledStartMs: entry?.startMs,
      };
    }
    return sceneStates;
  }

  private recomputeRuntime(): void {
    if (!this.runtime) {
      return;
    }
    const schedule = this.playbackTimeline;
    const stream = this.playbackStream;
    const currentMs = this.getRuntimeStreamMs();
    this.runtime.currentStreamMs = currentMs;
    this.runtime.expectedDurationMs = schedule.expectedDurationMs;
    this.runtime.timelineNotice = schedule.notice;

    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    const activeAudio: StreamRuntimeAudioSubCue[] = [];
    const activeVisual: StreamRuntimeVisualSubCue[] = [];

    for (const sceneId of stream.sceneOrder) {
      const scene = stream.scenes[sceneId];
      const entry = schedule.entries[sceneId];
      if (!scene || scene.disabled) {
        sceneStates[sceneId] = { sceneId, status: 'disabled' };
        continue;
      }
      if (this.skippedAtTimecodeSceneIds.has(sceneId)) {
        sceneStates[sceneId] = {
          sceneId,
          status: 'skipped',
          scheduledStartMs: entry?.startMs,
        };
        continue;
      }
      if (this.manuallyCompletedSceneIds.has(sceneId)) {
        sceneStates[sceneId] = {
          sceneId,
          status: 'complete',
          scheduledStartMs: entry?.startMs,
          startedAtStreamMs: entry?.startMs,
          endedAtStreamMs: currentMs,
          progress: 1,
        };
        continue;
      }
      const manualStart = this.manualSceneStartOverrides.get(sceneId);
      const start = manualStart ?? entry?.startMs;
      const end = manualStart !== undefined && entry?.durationMs !== undefined ? manualStart + entry.durationMs : entry?.endMs;
      const previous = this.runtime.sceneStates[sceneId];
      let status: SceneRuntimeState['status'] = 'ready';
      let progress: number | undefined;
      if (start === undefined) {
        status = scene.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < currentMs ? 'skipped' : 'ready';
      } else if (currentMs < start) {
        status = 'ready';
      } else if (this.runtime.status === 'idle') {
        if (currentMs < start) {
          status = 'ready';
        } else if (end !== undefined && currentMs > end) {
          status = 'complete';
          progress = 1;
        } else {
          status = 'ready';
        }
      } else if (end !== undefined && currentMs >= end) {
        status = 'complete';
        progress = 1;
      } else if (this.runtime.status === 'paused') {
        status = 'paused';
      } else {
        status = 'running';
      }
      if ((status === 'running' || status === 'paused') && start !== undefined) {
        progress = entry.durationMs && entry.durationMs > 0 ? Math.min(1, Math.max(0, (currentMs - start) / entry.durationMs)) : undefined;
        this.collectActiveSubCues(scene, start, currentMs, activeAudio, activeVisual);
        if (status === 'running') {
          this.dispatchControlSubCues(scene, start, currentMs);
        }
      }
      sceneStates[sceneId] = {
        sceneId,
        status,
        scheduledStartMs: start,
        startedAtStreamMs: start !== undefined && currentMs >= start ? start : previous?.startedAtStreamMs,
        endedAtStreamMs: status === 'complete' ? end ?? previous?.endedAtStreamMs : previous?.endedAtStreamMs,
        progress,
        error: previous?.error,
      };
    }

    const runningEntries = Object.values(sceneStates).filter((s) => s.status === 'running' || s.status === 'paused');
    if (runningEntries.length > 0) {
      this.runtime.cursorSceneId = runningEntries.reduce((latest, state) => {
        const latestStart = latest.scheduledStartMs ?? Number.NEGATIVE_INFINITY;
        const stateStart = state.scheduledStartMs ?? Number.NEGATIVE_INFINITY;
        return stateStart >= latestStart ? state : latest;
      }, runningEntries[0]).sceneId;
    }
    if (
      this.runtime.status === 'running' &&
      schedule.expectedDurationMs !== undefined &&
      currentMs >= schedule.expectedDurationMs &&
      runningEntries.length === 0
    ) {
      this.runtime.status = 'complete';
      this.runtime.cursorSceneId = undefined;
      this.stopTicking();
    }
    this.pruneExpiredOrphans(currentMs);
    this.runtime.sceneStates = sceneStates;
    this.runtime.activeAudioSubCues = [...activeAudio, ...this.orphanedAudioSubCues];
    this.runtime.activeVisualSubCues = [...activeVisual, ...this.orphanedVisualSubCues];
  }

  private getRuntimeStreamMs(): number {
    if (!this.runtime) {
      return 0;
    }
    if (this.runtime.status === 'running' || this.runtime.status === 'preloading') {
      const rate = this.getGlobalRate();
      const anchor = this.runtime.originWallTimeMs ?? Date.now();
      return (this.runtime.offsetStreamMs ?? 0) + (Date.now() - anchor) * rate;
    }
    return this.runtime.pausedAtStreamMs ?? this.runtime.currentStreamMs ?? this.runtime.offsetStreamMs ?? 0;
  }

  private getGlobalRate(): number {
    const getState = (this.director as unknown as { getState?: Director['getState'] }).getState;
    const rate = getState?.call(this.director)?.rate;
    return rate && rate > 0 ? rate : 1;
  }

  private firstEnabledSceneId(): SceneId | undefined {
    return this.playbackStream.sceneOrder.find((id) => !this.playbackStream.scenes[id]?.disabled);
  }

  private sceneStartMs(sceneId: SceneId): number | undefined {
    return this.playbackTimeline.entries[sceneId]?.startMs;
  }

  private buildSchedule(stream: PersistedStreamConfig = this.stream): StreamSchedule {
    const [visualDurations, audioDurations] = this.getDurationMaps();
    return buildStreamSchedule(stream, { visualDurations, audioDurations });
  }

  private createEmptyTimeline(status: CalculatedStreamTimeline['status']): CalculatedStreamTimeline {
    return {
      revision: ++this.timelineRevision,
      status,
      entries: {},
      calculatedAtWallTimeMs: Date.now(),
      issues: [],
    };
  }

  private calculateTimeline(stream: PersistedStreamConfig): CalculatedStreamTimeline {
    const schedule = this.buildSchedule(stream);
    return {
      revision: ++this.timelineRevision,
      status: schedule.status,
      entries: structuredClone(schedule.entries),
      expectedDurationMs: schedule.expectedDurationMs,
      calculatedAtWallTimeMs: Date.now(),
      issues: structuredClone(schedule.issues),
      notice: schedule.notice,
    };
  }

  private recalculateEditTimeline(): void {
    this.editTimeline = this.calculateTimeline(this.stream);
  }

  private promoteEditTimeline(): void {
    this.stream = normalizeStreamPersistence(this.stream);
    this.playbackStream = structuredClone(this.stream);
    this.playbackTimeline = structuredClone(this.editTimeline);
  }

  private createOrphansForRemovedActiveCues(
    previousAudio: StreamRuntimeAudioSubCue[],
    previousVisual: StreamRuntimeVisualSubCue[],
  ): void {
    if (!this.runtime || this.runtime.status !== 'running') {
      return;
    }
    const activeAudioKeys = new Set((this.runtime.activeAudioSubCues ?? []).filter((cue) => !cue.orphaned).map((cue) => this.audioCueKey(cue)));
    const activeVisualKeys = new Set((this.runtime.activeVisualSubCues ?? []).filter((cue) => !cue.orphaned).map((cue) => this.visualCueKey(cue)));
    const settings = this.playbackStream.playbackSettings;
    const fadeOutDurationMs =
      settings?.runningEditOrphanPolicy === 'fade-out' ? (settings.runningEditOrphanFadeOutMs ?? 500) : undefined;
    const fadeOutStartedWallTimeMs = fadeOutDurationMs === undefined ? undefined : Date.now();
    for (const cue of previousAudio) {
      const key = this.audioCueKey(cue);
      if (activeAudioKeys.has(key) || this.orphanedAudioSubCues.some((orphan) => this.audioCueKey(orphan) === key)) {
        continue;
      }
      this.orphanedAudioSubCues.push({ ...cue, orphaned: true, fadeOutStartedWallTimeMs, fadeOutDurationMs });
    }
    for (const cue of previousVisual) {
      const key = this.visualCueKey(cue);
      if (activeVisualKeys.has(key) || this.orphanedVisualSubCues.some((orphan) => this.visualCueKey(orphan) === key)) {
        continue;
      }
      this.orphanedVisualSubCues.push({ ...cue, orphaned: true, fadeOutStartedWallTimeMs, fadeOutDurationMs });
    }
  }

  private pruneExpiredOrphans(currentStreamMs: number): void {
    const now = Date.now();
    const keep = <T extends { streamStartMs: number; localEndMs?: number; fadeOutStartedWallTimeMs?: number; fadeOutDurationMs?: number }>(cue: T): boolean => {
      if (cue.localEndMs !== undefined && currentStreamMs >= cue.streamStartMs + cue.localEndMs) {
        return false;
      }
      return cue.fadeOutStartedWallTimeMs === undefined || cue.fadeOutDurationMs === undefined || now - cue.fadeOutStartedWallTimeMs < cue.fadeOutDurationMs;
    };
    this.orphanedAudioSubCues = this.orphanedAudioSubCues.filter(keep);
    this.orphanedVisualSubCues = this.orphanedVisualSubCues.filter(keep);
  }

  private audioCueKey(cue: StreamRuntimeAudioSubCue): string {
    return `${cue.sceneId}:${cue.subCueId}:${cue.outputId}`;
  }

  private visualCueKey(cue: StreamRuntimeVisualSubCue): string {
    return `${cue.sceneId}:${cue.subCueId}:${cue.target.displayId}:${cue.target.zoneId ?? 'single'}`;
  }

  private collectActiveSubCues(
    scene: PersistedSceneConfig,
    sceneStartMs: number,
    currentMs: number,
    activeAudio: StreamRuntimeAudioSubCue[],
    activeVisual: StreamRuntimeVisualSubCue[],
  ): void {
    const scenePhase = this.getSceneLoopPhase(scene, sceneStartMs, currentMs);
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub || sub.kind === 'control') {
        continue;
      }
      const localStartMs = sub.startOffsetMs ?? 0;
      if (scenePhase.phaseMs < localStartMs) {
        continue;
      }
      const baseDurationMs = this.getSubCueBaseDurationMs(sub);
      if (baseDurationMs === undefined) {
        continue;
      }
      const subTiming = resolveLoopTiming(sub.loop, baseDurationMs);
      const subElapsedMs = scenePhase.phaseMs - localStartMs;
      if (!isElapsedWithinLoopTotal(subElapsedMs, subTiming)) {
        continue;
      }
      const localEndMs = subTiming.totalDurationMs;
      const mediaLoop = this.createSubCueMediaLoop(sub, baseDurationMs);
      if (sub.kind === 'audio') {
        for (const outputId of sub.outputIds) {
          activeAudio.push({
            sceneId: scene.id,
            subCueId,
            audioSourceId: sub.audioSourceId,
            outputId,
            streamStartMs: scenePhase.phaseZeroStreamMs,
            localStartMs,
            localEndMs,
            levelDb: sub.levelDb ?? 0,
            pan: sub.pan ?? 0,
            muted: sub.muted,
            solo: sub.solo,
            playbackRate: sub.playbackRate ?? 1,
            mediaLoop,
          });
        }
      } else {
        for (const target of sub.targets) {
          activeVisual.push({
            sceneId: scene.id,
            subCueId,
            visualId: sub.visualId,
            target,
            streamStartMs: scenePhase.phaseZeroStreamMs,
            localStartMs,
            localEndMs,
            playbackRate: sub.playbackRate ?? 1,
            mediaLoop,
          });
        }
      }
    }
  }

  private dispatchControlSubCues(scene: PersistedSceneConfig, sceneStartMs: number, currentMs: number): void {
    const scenePhase = this.getSceneLoopPhase(scene, sceneStartMs, currentMs);
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub || sub.kind !== 'control') {
        continue;
      }
      const start = sub.startOffsetMs ?? 0;
      const key = `${scene.id}:${scenePhase.iterationKey}:${subCueId}`;
      if (scenePhase.phaseMs < start || this.dispatchedControlSubCues.has(key)) {
        continue;
      }
      this.dispatchedControlSubCues.add(key);
      this.applyControlSubCue(sub);
    }
  }

  private applyControlSubCue(sub: PersistedControlSubCueConfig): void {
    const action = sub.action;
    if (action.type === 'set-global-audio-muted') {
      this.director.updateGlobalState({ globalAudioMuted: action.muted });
    } else if (action.type === 'set-global-display-blackout') {
      this.director.updateGlobalState({ globalDisplayBlackout: action.blackout });
    } else if (action.type === 'pause-scene') {
      const st = this.runtime?.sceneStates[action.sceneId];
      if (st?.status === 'running') {
        st.status = 'paused';
      }
    } else if (action.type === 'resume-scene') {
      const st = this.runtime?.sceneStates[action.sceneId];
      if (st?.status === 'paused') {
        st.status = 'running';
      }
    } else if (action.type === 'stop-scene') {
      const st = this.runtime?.sceneStates[action.sceneId];
      if (st) {
        st.status = 'complete';
        st.endedAtStreamMs = this.getRuntimeStreamMs();
      }
    }
  }

  private getSubCueBaseDurationMs(sub: PersistedSubCueConfig): number | undefined {
    const [visualDurations, audioDurations] = this.getDurationMaps();
    let base: number | undefined;
    if (sub.kind === 'visual') {
      const d = visualDurations[sub.visualId];
      base = d === undefined ? undefined : (d * 1000) / (sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1);
    } else if (sub.kind === 'audio') {
      const d = audioDurations[sub.audioSourceId];
      base = d === undefined ? undefined : (d * 1000) / (sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1);
    } else {
      return 0;
    }
    if (sub.durationOverrideMs !== undefined && base !== undefined) {
      return Math.min(base, sub.durationOverrideMs);
    }
    return sub.durationOverrideMs ?? base;
  }

  private getSubCueExpandedDurationMs(sub: PersistedSubCueConfig): number | undefined {
    const base = this.getSubCueBaseDurationMs(sub);
    if (base === undefined) {
      return undefined;
    }
    const timing = sub.kind === 'control' ? resolveLoopTiming(undefined, base) : resolveLoopTiming(sub.loop, base);
    return timing.totalDurationMs;
  }

  private getScenePassDurationMs(scene: PersistedSceneConfig): number | undefined {
    let max = 0;
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub) {
        continue;
      }
      const duration = this.getSubCueExpandedDurationMs(sub);
      if (duration === undefined) {
        return undefined;
      }
      max = Math.max(max, (sub.startOffsetMs ?? 0) + duration);
    }
    return max;
  }

  private getSceneLoopPhase(
    scene: PersistedSceneConfig,
    sceneStartMs: number,
    currentMs: number,
  ): { phaseMs: number; phaseZeroStreamMs: number; iterationKey: number } {
    const elapsedMs = Math.max(0, currentMs - sceneStartMs);
    const passDurationMs = this.getScenePassDurationMs(scene);
    if (passDurationMs === undefined) {
      return { phaseMs: elapsedMs, phaseZeroStreamMs: sceneStartMs, iterationKey: 0 };
    }
    const timing = resolveLoopTiming(scene.loop, passDurationMs);
    const phaseMs = mapElapsedToLoopPhase(elapsedMs, timing);
    const iterationKey =
      timing.enabled && timing.loopDurationMs > 0 && elapsedMs >= timing.loopStartMs
        ? Math.floor((elapsedMs - timing.loopStartMs) / timing.loopDurationMs)
        : 0;
    return {
      phaseMs,
      phaseZeroStreamMs: currentMs - phaseMs,
      iterationKey,
    };
  }

  private createSubCueMediaLoop(sub: PersistedSubCueConfig, baseDurationMs: number): LoopState | undefined {
    if (sub.kind === 'control' || !sub.loop?.enabled) {
      return undefined;
    }
    const rate = sub.playbackRate && sub.playbackRate > 0 ? sub.playbackRate : 1;
    const loopStartMs = Math.max(0, sub.loop.range?.startMs ?? 0);
    const loopEndMs = Math.max(loopStartMs, sub.loop.range?.endMs ?? baseDurationMs);
    if (loopEndMs <= loopStartMs) {
      return undefined;
    }
    return {
      enabled: true,
      startSeconds: (loopStartMs * rate) / 1000,
      endSeconds: (loopEndMs * rate) / 1000,
    };
  }

  private revalidate(): void {
    const messages: string[] = [];
    messages.push(...validateStreamStructure(this.stream));
    messages.push(...validateTriggerReferences(this.stream));
    messages.push(...validateStreamContent(this.stream, this.getValidationContext()));
    messages.push(...this.editTimeline.issues.map((issue) => `Stream timeline: ${issue.message}`));
    this.validationMessages = messages;
  }

  private getDurationMaps(): [Record<string, number>, Record<string, number>] {
    const getState = (this.director as unknown as { getState?: Director['getState'] }).getState;
    if (!getState) {
      return [{}, {}];
    }
    const state = getState.call(this.director);
    return [
      Object.fromEntries(Object.values(state.visuals ?? {}).flatMap((visual) => (visual.durationSeconds !== undefined ? [[visual.id, visual.durationSeconds]] : []))),
      Object.fromEntries(
        Object.values(state.audioSources ?? {}).flatMap((source) => (source.durationSeconds !== undefined ? [[source.id, source.durationSeconds]] : [])),
      ),
    ];
  }

  private getValidationContext(): Parameters<typeof validateStreamContent>[1] {
    const getState = (this.director as unknown as { getState?: Director['getState'] }).getState;
    if (!getState) {
      return {};
    }
    const state = getState.call(this.director);
    return {
      visuals: new Set(Object.keys(state.visuals ?? {})),
      audioSources: new Set(Object.keys(state.audioSources ?? {})),
      outputs: new Set(Object.keys(state.outputs ?? {})),
      displayZones: new Map(
        Object.values(state.displays ?? {}).map((display) => [
          display.id,
          new Set(display.layout.type === 'split' ? (['L', 'R'] as const) : (['single'] as const)),
        ]),
      ),
      audioSourceLabels: new Map(Object.values(state.audioSources ?? {}).map((s) => [s.id, s.label])),
      visualLabels: new Map(Object.values(state.visuals ?? {}).map((v) => [v.id, v.label])),
    };
  }

  private startTicking(): void {
    if (this.tickTimer) {
      return;
    }
    this.tickTimer = setInterval(() => {
      if (!this.runtime || this.runtime.status !== 'running') {
        this.stopTicking();
        return;
      }
      this.recomputeRuntime();
      this.emitState();
    }, 100);
    this.tickTimer.unref?.();
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  private emitState(): void {
    this.emit('state', this.getPublicState());
  }
}
