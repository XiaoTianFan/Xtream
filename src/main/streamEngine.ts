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
  resolveFollowsSceneId,
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
  private controlPausedSceneIds = new Set<SceneId>();
  private controlStoppedSceneIds = new Set<SceneId>();
  private controlEffectRevision = 0;
  private orphanedAudioSubCues: StreamRuntimeAudioSubCue[] = [];
  private orphanedVisualSubCues: StreamRuntimeVisualSubCue[] = [];
  /** Global play anchor from `startFromStreamTime`; manual scenes only auto-play from schedule when this matches (unless {@link manualSceneSchedulePlaybackActive}). */
  private streamPlayReferenceSceneId: SceneId | undefined;
  /** Stream-time passed into the last `startFromStreamTime`; used with {@link streamPlayReferenceSceneId} to include earlier manual rows in the same playback jump. */
  private streamPlaybackAnchorMs: number | undefined;
  /** Scenes treated as already passed the playhead due to seek or starting after a later reference scene. */
  private scheduleConsumedSceneIds = new Set<SceneId>();
  /** When true, the current session was started via scene-row / flow-card "run from here" (vs global play). Affects predecessor consumption and manual inclusion. */
  private streamPlayUsedSceneRowIntent = false;

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
    this.streamPlayReferenceSceneId = undefined;
    this.streamPlaybackAnchorMs = undefined;
    this.scheduleConsumedSceneIds.clear();
    this.streamPlayUsedSceneRowIntent = false;
    this.clearControlSceneOverrides();
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
        this.startFromStreamTime(this.sceneStartMs(target) ?? 0, target, false);
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
      const sceneRowRunFromHereIntent = source === 'scene-row' || source === 'flow-card';
      this.startFromStreamTime(start, target, sceneRowRunFromHereIntent);
      return;
    }
    if (this.runtime) {
      const current = this.runtime.currentStreamMs ?? this.runtime.offsetStreamMs ?? this.runtime.pausedAtStreamMs ?? 0;
      this.startFromStreamTime(current, this.runtime.cursorSceneId, false);
      return;
    }
    const first = this.firstEnabledSceneId();
    if (!first) {
      this.stopTicking();
      this.runtime = { status: 'complete', sceneStates: {} };
      return;
    }
    this.startFromStreamTime(this.sceneStartMs(first) ?? 0, first, false);
  }

  private startFromStreamTime(timeMs: number, referenceSceneId?: SceneId, sceneRowRunFromHereIntent = false): void {
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
    this.clearControlSceneOverrides();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
    this.streamPlayReferenceSceneId = referenceSceneId;
    this.streamPlaybackAnchorMs = timeMs;
    this.streamPlayUsedSceneRowIntent = sceneRowRunFromHereIntent;
    this.scheduleConsumedSceneIds.clear();
    const stream = this.playbackStream;
    const refIdx = referenceSceneId !== undefined ? stream.sceneOrder.indexOf(referenceSceneId) : -1;
    if (refIdx >= 0) {
      for (let i = 0; i < refIdx; i += 1) {
        const id = stream.sceneOrder[i];
        if (stream.scenes[id]?.disabled) {
          continue;
        }
        const e = schedule.entries[id];
        if (e?.endMs !== undefined && (sceneRowRunFromHereIntent ? e.endMs < timeMs : e.endMs <= timeMs)) {
          this.scheduleConsumedSceneIds.add(id);
        }
      }
    }
    this.recomputeRuntime();
    if (this.runtime.status === 'running') {
      this.startTicking();
    }
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
    if (this.runtime.status === 'running') {
      this.startTicking();
    }
  }

  private stop(): void {
    this.stopTicking();
    this.runtime = null;
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.manualSceneStartOverrides.clear();
    this.streamPlayReferenceSceneId = undefined;
    this.streamPlaybackAnchorMs = undefined;
    this.scheduleConsumedSceneIds.clear();
    this.streamPlayUsedSceneRowIntent = false;
    this.clearControlSceneOverrides();
    this.orphanedAudioSubCues = [];
    this.orphanedVisualSubCues = [];
  }

  private clearControlSceneOverrides(): void {
    this.controlPausedSceneIds.clear();
    this.controlStoppedSceneIds.clear();
    this.controlEffectRevision += 1;
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
    this.clearControlSceneOverrides();
    for (const sceneId of this.playbackStream.sceneOrder) {
      const scene = this.playbackStream.scenes[sceneId];
      if (scene?.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < nextMs) {
        this.skippedAtTimecodeSceneIds.add(sceneId);
      }
    }
    this.refreshScheduleConsumedIdsAfterSeek(nextMs);
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
    this.streamPlayReferenceSceneId = undefined;
    this.streamPlaybackAnchorMs = undefined;
    this.scheduleConsumedSceneIds.clear();
    this.streamPlayUsedSceneRowIntent = false;
    this.clearControlSceneOverrides();
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

  private refreshScheduleConsumedIdsAfterSeek(streamMs: number): void {
    this.scheduleConsumedSceneIds.clear();
    const stream = this.playbackStream;
    const schedule = this.playbackTimeline;
    for (const id of stream.sceneOrder) {
      if (stream.scenes[id]?.disabled) {
        continue;
      }
      const e = schedule.entries[id];
      if (e?.endMs !== undefined && e.endMs < streamMs) {
        this.scheduleConsumedSceneIds.add(id);
      }
    }
  }

  /** Whether a manual row should use timeline entry times vs waiting for scene-row / flow-card. */
  private manualSceneSchedulePlaybackActive(
    sceneId: SceneId,
    schedule: CalculatedStreamTimeline,
    stream: PersistedStreamConfig,
  ): boolean {
    const scene = stream.scenes[sceneId];
    const ent = schedule.entries[sceneId];
    if (!scene || scene.disabled || scene.trigger.type !== 'manual') {
      return false;
    }
    if (this.scheduleConsumedSceneIds.has(sceneId)) {
      return true;
    }
    if (sceneId === this.streamPlayReferenceSceneId) {
      return true;
    }
    const ref = this.streamPlayReferenceSceneId;
    const anchor = this.streamPlaybackAnchorMs;
    if (ref !== undefined && anchor !== undefined && ent?.startMs !== undefined && ent.endMs !== undefined) {
      const refIdx = stream.sceneOrder.indexOf(ref);
      const sIdx = stream.sceneOrder.indexOf(sceneId);
      if (refIdx >= 0 && sIdx >= 0 && sIdx < refIdx) {
        if (this.streamPlayUsedSceneRowIntent) {
          if (anchor > ent.startMs && anchor < ent.endMs) {
            return true;
          }
        } else if (ent.startMs <= anchor) {
          return true;
        }
      }
    }
    return false;
  }

  private predEffectiveStartMs(
    predId: SceneId,
    sceneStates: Record<SceneId, SceneRuntimeState>,
    schedule: CalculatedStreamTimeline,
    stream: PersistedStreamConfig,
  ): number | undefined {
    const pred = stream.scenes[predId];
    const ent = schedule.entries[predId];
    if (!pred || pred.disabled || !ent) {
      return undefined;
    }
    const mo = this.manualSceneStartOverrides.get(predId);
    if (mo !== undefined) {
      return mo;
    }
    const st = sceneStates[predId];
    if (st?.status === 'running' || st?.status === 'paused' || st?.status === 'complete') {
      if (st.scheduledStartMs !== undefined) {
        return st.scheduledStartMs;
      }
    }
    if (pred.trigger.type === 'manual') {
      if (!this.manualSceneSchedulePlaybackActive(predId, schedule, stream)) {
        return undefined;
      }
      return ent.startMs;
    }
    if (st?.scheduledStartMs !== undefined) {
      return st.scheduledStartMs;
    }
    return ent.startMs;
  }

  private predEffectiveEndMs(
    predId: SceneId,
    sceneStates: Record<SceneId, SceneRuntimeState>,
    schedule: CalculatedStreamTimeline,
    stream: PersistedStreamConfig,
  ): number | undefined {
    const pred = stream.scenes[predId];
    const ent = schedule.entries[predId];
    if (!pred || pred.disabled || !ent) {
      return undefined;
    }
    const mo = this.manualSceneStartOverrides.get(predId);
    if (mo !== undefined && ent.durationMs !== undefined) {
      return mo + ent.durationMs;
    }
    const st = sceneStates[predId];
    if (st?.status === 'running' || st?.status === 'paused') {
      const s = st.scheduledStartMs;
      if (s !== undefined && ent.durationMs !== undefined) {
        return s + ent.durationMs;
      }
    }
    if (st?.status === 'complete') {
      return st.endedAtStreamMs ?? ent.endMs;
    }
    if (pred.trigger.type === 'manual' && mo === undefined) {
      if (!this.manualSceneSchedulePlaybackActive(predId, schedule, stream)) {
        return undefined;
      }
      return ent.endMs;
    }
    return ent.endMs;
  }

  /**
   * Earliest stream time strictly after `currentMs` when a scene will begin without a new explicit play,
   * excluding manual rows that are waiting for scene-row / flow-card unless they are schedule-active on the timeline.
   */
  private nextScheduledAutoStartMsAfter(
    currentMs: number,
    sceneStates: Record<SceneId, SceneRuntimeState>,
    schedule: CalculatedStreamTimeline,
    stream: PersistedStreamConfig,
  ): number | undefined {
    let next: number | undefined;
    for (const sceneId of stream.sceneOrder) {
      const scene = stream.scenes[sceneId];
      if (!scene || scene.disabled) {
        continue;
      }
      const st = sceneStates[sceneId];
      if (st.status === 'complete' || st.status === 'skipped' || st.status === 'disabled') {
        continue;
      }
      if (scene.trigger.type === 'manual') {
        if (!this.manualSceneSchedulePlaybackActive(sceneId, schedule, stream)) {
          continue;
        }
        const start = st.scheduledStartMs;
        if (start !== undefined && start > currentMs) {
          next = next === undefined ? start : Math.min(next, start);
        }
        continue;
      }
      if (scene.trigger.type === 'at-timecode') {
        const tc = scene.trigger.timecodeMs;
        if (tc > currentMs) {
          next = next === undefined ? tc : Math.min(next, tc);
        }
        continue;
      }
      if (scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end') {
        const pred = resolveFollowsSceneId(stream, sceneId, scene.trigger);
        const predCfg = pred ? stream.scenes[pred] : undefined;
        if (
          pred &&
          predCfg &&
          !predCfg.disabled &&
          predCfg.trigger.type === 'manual' &&
          !this.manualSceneSchedulePlaybackActive(pred, schedule, stream)
        ) {
          const pst = pred ? sceneStates[pred] : undefined;
          if (pst?.status === 'ready') {
            // Planned schedule start exists, but the manual row has not run — wall clock must not chase it.
            continue;
          }
        }
      }
      const start = st.scheduledStartMs;
      if (start !== undefined && start > currentMs) {
        next = next === undefined ? start : Math.min(next, start);
      }
    }
    return next;
  }

  private allEnabledScenesTerminal(sceneStates: Record<SceneId, SceneRuntimeState>, stream: PersistedStreamConfig): boolean {
    for (const sceneId of stream.sceneOrder) {
      const scene = stream.scenes[sceneId];
      if (!scene || scene.disabled) {
        continue;
      }
      const st = sceneStates[sceneId];
      if (st.status !== 'complete' && st.status !== 'skipped') {
        return false;
      }
    }
    return true;
  }

  private recomputeRuntime(depth = 0): void {
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
      if (this.controlStoppedSceneIds.has(sceneId)) {
        sceneStates[sceneId] = {
          sceneId,
          status: 'complete',
          scheduledStartMs: entry?.startMs,
          startedAtStreamMs: this.manualSceneStartOverrides.get(sceneId) ?? entry?.startMs,
          endedAtStreamMs: currentMs,
          progress: 1,
        };
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
      const previous = this.runtime.sceneStates[sceneId];

      let start: number | undefined;
      let end: number | undefined;
      if (manualStart !== undefined) {
        start = manualStart;
        end = entry?.durationMs !== undefined ? manualStart + entry.durationMs : undefined;
      } else if (scene.trigger.type === 'manual') {
        if (this.manualSceneSchedulePlaybackActive(sceneId, schedule, stream)) {
          start = entry?.startMs;
          end = entry?.endMs;
        } else {
          sceneStates[sceneId] = {
            sceneId,
            status: 'ready',
            scheduledStartMs: entry?.startMs,
            startedAtStreamMs: previous?.startedAtStreamMs,
            endedAtStreamMs: previous?.endedAtStreamMs,
            progress: undefined,
            error: previous?.error,
          };
          continue;
        }
      } else if (scene.trigger.type === 'at-timecode') {
        start = entry?.startMs;
        end = entry?.endMs;
      } else {
        const trig = scene.trigger;
        if (trig.type === 'follow-start') {
          const pred = resolveFollowsSceneId(stream, sceneId, trig);
          if (pred) {
            const ps = this.predEffectiveStartMs(pred, sceneStates, schedule, stream);
            if (ps !== undefined) {
              start = ps + (trig.delayMs ?? 0);
              if (entry?.durationMs !== undefined) {
                end = start + entry.durationMs;
              }
            }
          }
        } else if (trig.type === 'follow-end') {
          const pred = resolveFollowsSceneId(stream, sceneId, trig);
          if (pred) {
            const pe = this.predEffectiveEndMs(pred, sceneStates, schedule, stream);
            if (pe !== undefined) {
              start = pe + (trig.delayMs ?? 0);
              if (entry?.durationMs !== undefined) {
                end = start + entry.durationMs;
              }
            }
          }
        } else {
          start = entry?.startMs;
          end = entry?.endMs;
        }
      }

      let status: SceneRuntimeState['status'] = 'ready';
      let progress: number | undefined;
      const shouldDispatchControlCues =
        this.runtime.status === 'running' &&
        start !== undefined &&
        currentMs >= start &&
        (end === undefined || currentMs <= end || (manualStart !== undefined && end === start));
      if (shouldDispatchControlCues) {
        const beforeControlRevision = this.controlEffectRevision;
        this.dispatchControlSubCues(scene, start!, currentMs);
        if (this.controlEffectRevision !== beforeControlRevision && depth < 5) {
          this.recomputeRuntime(depth + 1);
          return;
        }
      }
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
      } else if (this.controlPausedSceneIds.has(sceneId)) {
        status = 'paused';
      } else if (this.runtime.status === 'paused') {
        status = 'paused';
      } else {
        status = 'running';
      }
      if ((status === 'running' || status === 'paused') && start !== undefined) {
        progress = entry.durationMs && entry.durationMs > 0 ? Math.min(1, Math.max(0, (currentMs - start) / entry.durationMs)) : undefined;
        this.collectActiveSubCues(scene, start, currentMs, activeAudio, activeVisual);
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
      const candidateSceneId = runningEntries.reduce((latest, state) => {
        const latestStart = latest.scheduledStartMs ?? Number.NEGATIVE_INFINITY;
        const stateStart = state.scheduledStartMs ?? Number.NEGATIVE_INFINITY;
        return stateStart >= latestStart ? state : latest;
      }, runningEntries[0]).sceneId;
      const prevCursor = this.runtime.cursorSceneId;
      const prevSt = prevCursor ? sceneStates[prevCursor] : undefined;
      const prevStart = prevSt?.scheduledStartMs;
      const candSt = sceneStates[candidateSceneId];
      const candStart = candSt?.scheduledStartMs;
      const prevEnded = Boolean(
        prevCursor && prevSt && (prevSt.status === 'complete' || prevSt.status === 'skipped'),
      );
      if (
        prevEnded &&
        prevStart !== undefined &&
        candStart !== undefined &&
        candStart < prevStart
      ) {
        this.runtime.cursorSceneId = this.firstEnabledSceneAfter(stream, prevCursor!) ?? candidateSceneId;
      } else if (
        prevCursor &&
        prevSt?.status === 'ready' &&
        prevStart !== undefined &&
        candStart !== undefined &&
        candStart < prevStart
      ) {
        /** Keep playback focus on a later stacked row (e.g. manual) instead of regressing to an earlier-running base. */
        this.runtime.cursorSceneId = prevCursor;
      } else {
        this.runtime.cursorSceneId = candidateSceneId;
      }
    }
    if (this.runtime.status === 'running' && this.allEnabledScenesTerminal(sceneStates, stream)) {
      this.runtime.status = 'complete';
      this.runtime.cursorSceneId = undefined;
      this.runtime.originWallTimeMs = undefined;
      this.runtime.startedWallTimeMs = undefined;
      this.stopTicking();
    } else if (
      this.runtime.status === 'running' &&
      schedule.expectedDurationMs !== undefined &&
      currentMs >= schedule.expectedDurationMs &&
      runningEntries.length === 0
    ) {
      this.runtime.status = 'complete';
      this.runtime.cursorSceneId = undefined;
      this.stopTicking();
    } else if (this.runtime.status === 'running') {
      const nextAuto = this.nextScheduledAutoStartMsAfter(currentMs, sceneStates, schedule, stream);
      if (runningEntries.length === 0 && nextAuto === undefined) {
        this.applyStreamAutoPauseAfterManualTail(currentMs);
      }
    }
    this.pruneExpiredOrphans(currentMs);
    this.runtime.sceneStates = sceneStates;
    this.runtime.activeAudioSubCues = [...activeAudio, ...this.orphanedAudioSubCues];
    this.runtime.activeVisualSubCues = [...activeVisual, ...this.orphanedVisualSubCues];
  }

  /**
   * Auto-triggered playback has caught up; only manual or manual-gated scenes remain.
   * Use real paused transport state so timecode and media projection stay frozen until Play.
   */
  private applyStreamAutoPauseAfterManualTail(streamMs: number): void {
    if (!this.runtime || this.runtime.status !== 'running') {
      return;
    }
    this.runtime.status = 'paused';
    this.runtime.pausedAtStreamMs = streamMs;
    this.runtime.pausedCursorMs = streamMs;
    this.runtime.selectedSceneIdAtPause = this.runtime.cursorSceneId;
    this.runtime.currentStreamMs = streamMs;
    this.runtime.offsetStreamMs = streamMs;
    this.runtime.originWallTimeMs = undefined;
    this.runtime.startedWallTimeMs = undefined;
    this.stopTicking();
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

  /** First enabled scene strictly after `afterSceneId` in `sceneOrder`, or `undefined` if none. */
  private firstEnabledSceneAfter(stream: PersistedStreamConfig, afterSceneId: SceneId): SceneId | undefined {
    const idx = stream.sceneOrder.indexOf(afterSceneId);
    if (idx < 0) {
      return undefined;
    }
    return stream.sceneOrder.slice(idx + 1).find((id) => !stream.scenes[id]?.disabled);
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
      this.director.updateGlobalState({
        globalAudioMuted: action.muted,
        globalAudioMuteFadeOverrideSeconds: this.fadeMsToSeconds(this.globalControlFadeMs(action.muted, action)),
      });
    } else if (action.type === 'set-global-display-blackout') {
      this.director.updateGlobalState({
        globalDisplayBlackout: action.blackout,
        globalDisplayBlackoutFadeOverrideSeconds: this.fadeMsToSeconds(this.globalControlFadeMs(action.blackout, action)),
      });
    } else if (action.type === 'play-scene') {
      this.playSceneByControl(action.sceneId);
    } else if (action.type === 'pause-scene') {
      this.pauseSceneByControl(action.sceneId);
    } else if (action.type === 'resume-scene') {
      this.resumeSceneByControl(action.sceneId);
    } else if (action.type === 'stop-scene') {
      this.stopSceneByControl(action.sceneId, action.fadeOutMs);
    }
  }

  private fadeMsToSeconds(ms: number | undefined): number | undefined {
    return ms === undefined ? undefined : Math.max(0, ms) / 1000;
  }

  private globalControlFadeMs(
    enabling: boolean,
    action:
      | Extract<PersistedControlSubCueConfig['action'], { type: 'set-global-audio-muted' }>
      | Extract<PersistedControlSubCueConfig['action'], { type: 'set-global-display-blackout' }>,
  ): number | undefined {
    return enabling ? action.fadeOutMs ?? action.fadeMs : action.fadeInMs ?? action.fadeMs;
  }

  private canControlTargetScene(sceneId: SceneId): boolean {
    const scene = this.playbackStream.scenes[sceneId];
    if (!scene || scene.disabled) {
      return false;
    }
    const status = this.runtime?.sceneStates[sceneId]?.status;
    return status !== 'disabled' && status !== 'preloading' && status !== 'failed';
  }

  private playSceneByControl(sceneId: SceneId): void {
    if (!this.runtime || !this.canControlTargetScene(sceneId)) {
      return;
    }
    const currentMs = this.getRuntimeStreamMs();
    this.manualSceneStartOverrides.set(sceneId, currentMs);
    this.controlStoppedSceneIds.delete(sceneId);
    this.controlPausedSceneIds.delete(sceneId);
    this.manuallyCompletedSceneIds.delete(sceneId);
    this.skippedAtTimecodeSceneIds.delete(sceneId);
    this.clearDispatchedControlSubCuesForScene(sceneId);
    this.runtime.cursorSceneId = sceneId;
    this.controlEffectRevision += 1;
  }

  private pauseSceneByControl(sceneId: SceneId): void {
    if (!this.runtime || !this.canControlTargetScene(sceneId) || this.controlStoppedSceneIds.has(sceneId)) {
      return;
    }
    this.controlPausedSceneIds.add(sceneId);
    this.controlEffectRevision += 1;
  }

  private resumeSceneByControl(sceneId: SceneId): void {
    if (!this.runtime || !this.canControlTargetScene(sceneId)) {
      return;
    }
    if (this.controlPausedSceneIds.delete(sceneId)) {
      this.controlEffectRevision += 1;
    }
  }

  private stopSceneByControl(sceneId: SceneId, fadeOutMs: number | undefined): void {
    if (!this.runtime || !this.canControlTargetScene(sceneId)) {
      return;
    }
    this.createOrphansForStoppedScene(sceneId, fadeOutMs);
    this.controlStoppedSceneIds.add(sceneId);
    this.controlPausedSceneIds.delete(sceneId);
    this.manualSceneStartOverrides.delete(sceneId);
    this.controlEffectRevision += 1;
  }

  private clearDispatchedControlSubCuesForScene(sceneId: SceneId): void {
    const prefix = `${sceneId}:`;
    for (const key of [...this.dispatchedControlSubCues]) {
      if (key.startsWith(prefix)) {
        this.dispatchedControlSubCues.delete(key);
      }
    }
  }

  private createOrphansForStoppedScene(sceneId: SceneId, fadeOutMs: number | undefined): void {
    if (!this.runtime || fadeOutMs === undefined || fadeOutMs <= 0) {
      return;
    }
    const fadeOutDurationMs = Math.max(0, fadeOutMs);
    const fadeOutStartedWallTimeMs = Date.now();
    const activeAudio = this.runtime.activeAudioSubCues?.filter((cue) => cue.sceneId === sceneId && !cue.orphaned) ?? [];
    const activeVisual = this.runtime.activeVisualSubCues?.filter((cue) => cue.sceneId === sceneId && !cue.orphaned) ?? [];
    for (const cue of activeAudio) {
      if (!this.orphanedAudioSubCues.some((orphan) => this.audioCueKey(orphan) === this.audioCueKey(cue))) {
        this.orphanedAudioSubCues.push({ ...cue, orphaned: true, fadeOutStartedWallTimeMs, fadeOutDurationMs });
      }
    }
    for (const cue of activeVisual) {
      if (!this.orphanedVisualSubCues.some((orphan) => this.visualCueKey(orphan) === this.visualCueKey(cue))) {
        this.orphanedVisualSubCues.push({ ...cue, orphaned: true, fadeOutStartedWallTimeMs, fadeOutDurationMs });
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
