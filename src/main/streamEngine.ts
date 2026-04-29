import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Director } from './director';
import type {
  PersistedControlSubCueConfig,
  PersistedSceneConfig,
  PersistedShowConfigV8,
  PersistedStreamConfig,
  PersistedSubCueConfig,
  SceneId,
  SceneRuntimeState,
  StreamCommand,
  StreamEditCommand,
  StreamEnginePublicState,
  StreamRuntimeAudioSubCue,
  StreamRuntimeState,
  StreamRuntimeVisualSubCue,
  SubCueId,
} from '../shared/types';
import { createEmptyUserScene, getDefaultStreamPersistence } from '../shared/streamWorkspace';
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
  private runtime: StreamRuntimeState | null = null;
  private validationMessages: string[] = [];
  private tickTimer: NodeJS.Timeout | undefined;
  private dispatchedControlSubCues = new Set<string>();
  private manuallyCompletedSceneIds = new Set<SceneId>();
  private skippedAtTimecodeSceneIds = new Set<SceneId>();

  constructor(private readonly director: Director) {
    super();
  }

  isStreamPlaybackActive(): boolean {
    return this.runtime !== null && (this.runtime.status === 'running' || this.runtime.status === 'preloading' || this.runtime.status === 'paused');
  }

  loadFromShow(config: { stream: PersistedStreamConfig }): void {
    this.stopTicking();
    this.stream = structuredClone(config.stream);
    this.runtime = null;
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.revalidate();
    this.emitState();
  }

  resetToDefault(): void {
    const d = getDefaultStreamPersistence();
    this.loadFromShow({ stream: structuredClone(d.stream) });
  }

  getPersistence(): Pick<PersistedShowConfigV8, 'stream'> {
    return {
      stream: structuredClone(this.stream),
    };
  }

  getPublicState(): StreamEnginePublicState {
    return {
      stream: structuredClone(this.stream),
      runtime: this.runtime ? structuredClone(this.runtime) : null,
      validationMessages: [...this.validationMessages],
    };
  }

  applyEdit(command: StreamEditCommand): StreamEnginePublicState {
    switch (command.type) {
      case 'update-stream': {
        if (command.label !== undefined) {
          this.stream.label = command.label;
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
    this.revalidate();
    if (this.runtime) {
      this.recomputeRuntime();
    }
    this.emitState();
    return this.getPublicState();
  }

  applyTransport(command: StreamCommand): StreamEnginePublicState {
    if (this.director.isPatchTransportPlaying() && command.type !== 'stop') {
      return this.getPublicState();
    }

    switch (command.type) {
      case 'go':
        this.handleGo(command.sceneId);
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'stop':
        this.stop();
        break;
      case 'jump-next':
        this.handleJumpNext();
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

  private handleGo(sceneId?: SceneId): void {
    const target =
      sceneId && this.stream.scenes[sceneId] && !this.stream.scenes[sceneId].disabled
        ? sceneId
        : this.stream.sceneOrder.find((id) => !this.stream.scenes[id]?.disabled);
    if (!target) {
      this.stopTicking();
      this.runtime = { status: 'complete', sceneStates: {} };
      return;
    }

    const schedule = this.buildSchedule();
    const targetStartMs = schedule.entries[target]?.startMs ?? 0;
    const now = Date.now();
    this.runtime = {
      status: 'running',
      originWallTimeMs: now,
      startedWallTimeMs: now,
      offsetStreamMs: targetStartMs,
      currentStreamMs: targetStartMs,
      cursorSceneId: target,
      sceneStates: this.createInitialSceneStates(schedule),
      expectedDurationMs: schedule.expectedDurationMs,
      timelineNotice: schedule.notice,
    };
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
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
    this.runtime.currentStreamMs = current;
    this.runtime.offsetStreamMs = current;
    this.runtime.originWallTimeMs = undefined;
    this.runtime.startedWallTimeMs = undefined;
    this.recomputeRuntime();
    this.stopTicking();
  }

  private resume(): void {
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
    this.recomputeRuntime();
    this.startTicking();
  }

  private stop(): void {
    this.stopTicking();
    this.runtime = null;
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
  }

  private seek(timeMs: number): void {
    if (!this.runtime) {
      this.handleBackToFirst();
    }
    if (!this.runtime) {
      return;
    }
    const schedule = this.buildSchedule();
    const max = schedule.expectedDurationMs;
    const nextMs = max === undefined ? clampNonNegative(timeMs) : Math.min(max, clampNonNegative(timeMs));
    this.runtime.offsetStreamMs = nextMs;
    this.runtime.currentStreamMs = nextMs;
    this.runtime.pausedAtStreamMs = this.runtime.status === 'paused' ? nextMs : undefined;
    if (isRunningStatus(this.runtime.status)) {
      const now = Date.now();
      this.runtime.originWallTimeMs = now;
      this.runtime.startedWallTimeMs = now;
      this.startTicking();
    }
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    for (const sceneId of this.stream.sceneOrder) {
      const scene = this.stream.scenes[sceneId];
      if (scene?.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < nextMs) {
        this.skippedAtTimecodeSceneIds.add(sceneId);
      }
    }
    this.recomputeRuntime();
  }

  private handleBackToFirst(): void {
    const target = this.stream.sceneOrder.find((id) => !this.stream.scenes[id]?.disabled);
    const schedule = this.buildSchedule();
    this.stopTicking();
    this.runtime = {
      status: target ? 'idle' : 'complete',
      cursorSceneId: target,
      sceneStates: this.createInitialSceneStates(schedule),
      expectedDurationMs: schedule.expectedDurationMs,
      offsetStreamMs: 0,
      currentStreamMs: 0,
      pausedAtStreamMs: 0,
      timelineNotice: schedule.notice,
    };
    this.dispatchedControlSubCues.clear();
    this.manuallyCompletedSceneIds.clear();
    this.skippedAtTimecodeSceneIds.clear();
    this.recomputeRuntime();
  }

  private handleJumpNext(): void {
    if (!this.runtime?.cursorSceneId) {
      return;
    }
    const cur = this.runtime.cursorSceneId;
    const idx = this.stream.sceneOrder.indexOf(cur);
    if (idx < 0) {
      return;
    }
    const next = this.stream.sceneOrder.slice(idx + 1).find((id) => !this.stream.scenes[id]?.disabled);
    const schedule = this.buildSchedule();
    const curEntry = schedule.entries[cur];
    const nextEntry = next ? schedule.entries[next] : undefined;
    if (!next) {
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
      return;
    }
    const wasRunning = this.runtime.status === 'running' || this.runtime.status === 'preloading';
    if (wasRunning) {
      this.manuallyCompletedSceneIds.add(cur);
    }
    const jumpTarget = nextEntry?.startMs ?? this.getRuntimeStreamMs();
    this.runtime.cursorSceneId = next;
    this.seek(jumpTarget);
    if (wasRunning) {
      this.manuallyCompletedSceneIds.add(cur);
    }
    this.recomputeRuntime();
  }

  private createInitialSceneStates(schedule: StreamSchedule): Record<SceneId, SceneRuntimeState> {
    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    for (const id of this.stream.sceneOrder) {
      const sc = this.stream.scenes[id];
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
    const schedule = this.buildSchedule();
    const currentMs = this.getRuntimeStreamMs();
    this.runtime.currentStreamMs = currentMs;
    this.runtime.expectedDurationMs = schedule.expectedDurationMs;
    this.runtime.timelineNotice = schedule.notice;

    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    const activeAudio: StreamRuntimeAudioSubCue[] = [];
    const activeVisual: StreamRuntimeVisualSubCue[] = [];

    for (const sceneId of this.stream.sceneOrder) {
      const scene = this.stream.scenes[sceneId];
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
      const start = entry?.startMs;
      const end = entry?.endMs;
      const previous = this.runtime.sceneStates[sceneId];
      let status: SceneRuntimeState['status'] = 'ready';
      let progress: number | undefined;
      if (start === undefined) {
        status = scene.trigger.type === 'at-timecode' && scene.trigger.timecodeMs < currentMs ? 'skipped' : 'ready';
      } else if (currentMs < start) {
        status = this.shouldPreload(sceneId, schedule, currentMs) ? 'ready-to-start' : 'ready';
      } else if (this.runtime.status === 'idle') {
        if (currentMs < start) {
          status = 'ready';
        } else if (end !== undefined && currentMs > end) {
          status = 'complete';
          progress = 1;
        } else {
          status = 'ready-to-start';
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
      this.runtime.cursorSceneId = runningEntries[0].sceneId;
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
    this.runtime.sceneStates = sceneStates;
    this.runtime.activeAudioSubCues = activeAudio;
    this.runtime.activeVisualSubCues = activeVisual;
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

  private buildSchedule(): StreamSchedule {
    const [visualDurations, audioDurations] = this.getDurationMaps();
    return buildStreamSchedule(this.stream, { visualDurations, audioDurations });
  }

  private shouldPreload(sceneId: SceneId, schedule: StreamSchedule, currentMs: number): boolean {
    const scene = this.stream.scenes[sceneId];
    const entry = schedule.entries[sceneId];
    if (!scene || entry.startMs === undefined) {
      return false;
    }
    const idx = this.stream.sceneOrder.indexOf(sceneId);
    const runningIdx = this.stream.sceneOrder.findIndex((id) => {
      const e = schedule.entries[id];
      return e.startMs !== undefined && currentMs >= e.startMs && (e.endMs === undefined || currentMs < e.endMs);
    });
    if (idx === runningIdx || idx === runningIdx + 1) {
      return true;
    }
    if (scene.preload.enabled && entry.startMs - currentMs <= (scene.preload.leadTimeMs ?? 0)) {
      return true;
    }
    const pred = resolveFollowsSceneId(this.stream, sceneId, scene.trigger);
    return pred !== undefined && schedule.entries[pred]?.startMs !== undefined && currentMs >= schedule.entries[pred].startMs!;
  }

  private collectActiveSubCues(
    scene: PersistedSceneConfig,
    sceneStartMs: number,
    currentMs: number,
    activeAudio: StreamRuntimeAudioSubCue[],
    activeVisual: StreamRuntimeVisualSubCue[],
  ): void {
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub || sub.kind === 'control') {
        continue;
      }
      const localStartMs = sub.startOffsetMs ?? 0;
      if (currentMs < sceneStartMs + localStartMs) {
        continue;
      }
      const localEndMs = this.getSubCueDurationMs(sub);
      if (localEndMs !== undefined && currentMs >= sceneStartMs + localStartMs + localEndMs) {
        continue;
      }
      if (sub.kind === 'audio') {
        for (const outputId of sub.outputIds) {
          activeAudio.push({
            sceneId: scene.id,
            subCueId,
            audioSourceId: sub.audioSourceId,
            outputId,
            streamStartMs: sceneStartMs,
            localStartMs,
            localEndMs,
            levelDb: sub.levelDb ?? 0,
            pan: sub.pan ?? 0,
            muted: sub.muted,
            solo: sub.solo,
            playbackRate: sub.playbackRate ?? 1,
          });
        }
      } else {
        for (const target of sub.targets) {
          activeVisual.push({
            sceneId: scene.id,
            subCueId,
            visualId: sub.visualId,
            target,
            streamStartMs: sceneStartMs,
            localStartMs,
            localEndMs,
            playbackRate: sub.playbackRate ?? 1,
          });
        }
      }
    }
  }

  private dispatchControlSubCues(scene: PersistedSceneConfig, sceneStartMs: number, currentMs: number): void {
    for (const subCueId of scene.subCueOrder) {
      const sub = scene.subCues[subCueId];
      if (!sub || sub.kind !== 'control') {
        continue;
      }
      const start = sceneStartMs + (sub.startOffsetMs ?? 0);
      const key = `${scene.id}:${subCueId}`;
      if (currentMs < start || this.dispatchedControlSubCues.has(key)) {
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

  private getSubCueDurationMs(sub: PersistedSubCueConfig): number | undefined {
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

  private revalidate(): void {
    const messages: string[] = [];
    messages.push(...validateStreamStructure(this.stream));
    messages.push(...validateTriggerReferences(this.stream));
    messages.push(...validateStreamContent(this.stream, this.getValidationContext()));
    const schedule = this.buildSchedule();
    messages.push(...schedule.issues.map((issue) => `Stream timeline: ${issue.message}`));
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
