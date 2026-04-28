import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Director } from './director';
import type {
  PersistedSceneConfig,
  PersistedShowConfigV8,
  PersistedStreamConfig,
  SceneId,
  SceneRuntimeState,
  StreamCommand,
  StreamEditCommand,
  StreamEnginePublicState,
  StreamId,
  StreamRuntimeState,
  SubCueId,
} from '../shared/types';
import { createEmptyUserScene, getDefaultStreamPersistence } from '../shared/streamWorkspace';
import {
  estimateLinearManualStreamDurationMs,
  validateStreamContent,
  validateStreamStructure,
  validateTriggerReferences,
} from '../shared/streamSchedule';

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export class StreamEngine extends EventEmitter {
  private stream: PersistedStreamConfig = getDefaultStreamPersistence().stream;
  private runtime: StreamRuntimeState | null = null;
  private validationMessages: string[] = [];

  constructor(private readonly director: Director) {
    super();
  }

  isStreamPlaybackActive(): boolean {
    return this.runtime !== null && (this.runtime.status === 'running' || this.runtime.status === 'preloading' || this.runtime.status === 'paused');
  }

  loadFromShow(config: { stream: PersistedStreamConfig }): void {
    this.stream = structuredClone(config.stream);
    this.runtime = null;
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
          if (idx >= 0) {
            this.stream.sceneOrder.splice(idx + 1, 0, sceneId);
          } else {
            this.stream.sceneOrder.push(sceneId);
          }
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
        if (idx >= 0) {
          this.stream.sceneOrder.splice(idx + 1, 0, sceneId);
        } else {
          this.stream.sceneOrder.push(sceneId);
        }
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
        if (this.runtime) {
          this.runtime.status = 'paused';
          for (const id of Object.keys(this.runtime.sceneStates)) {
            const st = this.runtime.sceneStates[id];
            if (st?.status === 'running') {
              st.status = 'paused';
            }
          }
        }
        break;
      case 'resume':
        if (this.runtime && this.runtime.status === 'paused') {
          this.runtime.status = 'running';
          for (const id of Object.keys(this.runtime.sceneStates)) {
            const st = this.runtime.sceneStates[id];
            if (st?.status === 'paused') {
              st.status = 'running';
            }
          }
        }
        break;
      case 'stop':
        this.runtime = null;
        break;
      case 'jump-next':
        this.handleJumpNext();
        break;
      case 'back-to-first':
        this.handleBackToFirst();
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
      this.runtime = {
        status: 'complete',
        sceneStates: {},
      };
      return;
    }

    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    for (const id of this.stream.sceneOrder) {
      const sc = this.stream.scenes[id];
      if (!sc || sc.disabled) {
        sceneStates[id] = { sceneId: id, status: 'disabled' };
      } else if (id === target) {
        sceneStates[id] = { sceneId: id, status: 'running', startedAtStreamMs: 0 };
      } else {
        sceneStates[id] = { sceneId: id, status: 'ready' };
      }
    }

    const wall = Date.now();
    this.runtime = {
      status: 'running',
      originWallTimeMs: wall,
      cursorSceneId: target,
      sceneStates,
      expectedDurationMs: estimateLinearManualStreamDurationMs(this.stream, ...this.getDurationMaps()) ?? undefined,
    };
  }

  private handleBackToFirst(): void {
    const target = this.stream.sceneOrder.find((id) => !this.stream.scenes[id]?.disabled);
    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    for (const id of this.stream.sceneOrder) {
      const sc = this.stream.scenes[id];
      sceneStates[id] = {
        sceneId: id,
        status: !sc || sc.disabled ? 'disabled' : 'ready',
      };
    }
    this.runtime = {
      status: target ? 'idle' : 'complete',
      cursorSceneId: target,
      sceneStates,
      expectedDurationMs: estimateLinearManualStreamDurationMs(this.stream, ...this.getDurationMaps()) ?? undefined,
    };
  }

  private handleJumpNext(): void {
    if (!this.runtime || !this.runtime.cursorSceneId) {
      return;
    }
    const cur = this.runtime.cursorSceneId;
    const idx = this.stream.sceneOrder.indexOf(cur);
    if (idx < 0) {
      return;
    }
    const curState = this.runtime.sceneStates[cur];
    if (curState) {
      curState.status = 'complete';
      curState.endedAtStreamMs = 0;
    }
    const next = this.stream.sceneOrder.slice(idx + 1).find((id) => !this.stream.scenes[id]?.disabled);
    if (!next) {
      this.runtime.status = 'complete';
      this.runtime.cursorSceneId = undefined;
      return;
    }
    this.runtime.cursorSceneId = next;
    const ns = this.runtime.sceneStates[next];
    if (ns) {
      ns.status = 'running';
      ns.startedAtStreamMs = 0;
    }
  }

  private revalidate(): void {
    const messages: string[] = [];
    messages.push(...validateStreamStructure(this.stream));
    messages.push(...validateTriggerReferences(this.stream));
    messages.push(...validateStreamContent(this.stream, this.getValidationContext()));
    this.validationMessages = messages;
  }

  private getDurationMaps(): [Record<string, number>, Record<string, number>] {
    const getState = (this.director as unknown as { getState?: Director['getState'] }).getState;
    if (!getState) {
      return [{}, {}];
    }
    const state = getState.call(this.director);
    return [
      Object.fromEntries(Object.values(state.visuals).flatMap((visual) => (visual.durationSeconds !== undefined ? [[visual.id, visual.durationSeconds]] : []))),
      Object.fromEntries(
        Object.values(state.audioSources).flatMap((source) => (source.durationSeconds !== undefined ? [[source.id, source.durationSeconds]] : [])),
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
      visuals: new Set(Object.keys(state.visuals)),
      audioSources: new Set(Object.keys(state.audioSources)),
      outputs: new Set(Object.keys(state.outputs)),
      displayZones: new Map(
        Object.values(state.displays).map((display) => [
          display.id,
          new Set(display.layout.type === 'split' ? ['L', 'R'] : ['single']),
        ]),
      ),
      audioSourceLabels: new Map(Object.values(state.audioSources).map((s) => [s.id, s.label])),
      visualLabels: new Map(Object.values(state.visuals).map((v) => [v.id, v.label])),
    };
  }

  private emitState(): void {
    this.emit('state', this.getPublicState());
  }
}
