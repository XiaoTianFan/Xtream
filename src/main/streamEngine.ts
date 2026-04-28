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
import { estimateLinearManualStreamDurationMs, validateStreamStructure, validateTriggerReferences } from '../shared/streamSchedule';

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export class StreamEngine extends EventEmitter {
  private streams: Record<StreamId, PersistedStreamConfig> = {};
  private activeStreamId: StreamId | undefined;
  private runtime: StreamRuntimeState | null = null;
  private validationMessages: string[] = [];

  constructor(private readonly director: Director) {
    super();
  }

  isStreamPlaybackActive(): boolean {
    return this.runtime !== null && (this.runtime.status === 'running' || this.runtime.status === 'preloading');
  }

  loadFromShow(config: { streams: Record<StreamId, PersistedStreamConfig>; activeStreamId?: StreamId }): void {
    this.streams = structuredClone(config.streams);
    this.activeStreamId = config.activeStreamId ?? Object.keys(this.streams)[0];
    this.runtime = null;
    this.revalidate();
    this.emitState();
  }

  resetToDefault(): void {
    const d = getDefaultStreamPersistence();
    this.loadFromShow({ streams: structuredClone(d.streams), activeStreamId: d.activeStreamId });
  }

  getPersistence(): Pick<PersistedShowConfigV8, 'streams' | 'activeStreamId'> {
    return {
      streams: structuredClone(this.streams),
      activeStreamId: this.activeStreamId,
    };
  }

  getPublicState(): StreamEnginePublicState {
    return {
      activeStreamId: this.activeStreamId,
      streams: structuredClone(this.streams),
      runtime: this.runtime ? structuredClone(this.runtime) : null,
      validationMessages: [...this.validationMessages],
    };
  }

  applyEdit(command: StreamEditCommand): StreamEnginePublicState {
    switch (command.type) {
      case 'create-stream': {
        const id = newId('stream') as StreamId;
        const firstSceneId = newId('scene') as SceneId;
        this.streams[id] = {
          id,
          label: command.label?.trim() || 'Stream',
          sceneOrder: [firstSceneId],
          scenes: { [firstSceneId]: createEmptyUserScene(firstSceneId, 'Scene 1') },
        };
        this.activeStreamId = id;
        break;
      }
      case 'update-stream': {
        const stream = this.streams[command.streamId];
        if (!stream) {
          break;
        }
        if (command.label !== undefined) {
          stream.label = command.label;
        }
        if (command.active) {
          this.activeStreamId = command.streamId;
        }
        break;
      }
      case 'create-scene': {
        const stream = this.streams[command.streamId];
        if (!stream) {
          break;
        }
        const sceneId = newId('scene') as SceneId;
        const scene = createEmptyUserScene(sceneId, `Scene ${stream.sceneOrder.length + 1}`);
        if (command.trigger) {
          scene.trigger = command.trigger;
        }
        if (command.afterSceneId !== undefined) {
          const idx = stream.sceneOrder.indexOf(command.afterSceneId);
          if (idx >= 0) {
            stream.sceneOrder.splice(idx + 1, 0, sceneId);
          } else {
            stream.sceneOrder.push(sceneId);
          }
        } else {
          stream.sceneOrder.push(sceneId);
        }
        stream.scenes[sceneId] = scene;
        break;
      }
      case 'update-scene': {
        const stream = this.streams[command.streamId];
        const scene = stream?.scenes[command.sceneId];
        if (!stream || !scene) {
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
        const stream = this.streams[command.streamId];
        const source = stream?.scenes[command.sceneId];
        if (!stream || !source) {
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
        const idx = stream.sceneOrder.indexOf(command.sceneId);
        if (idx >= 0) {
          stream.sceneOrder.splice(idx + 1, 0, sceneId);
        } else {
          stream.sceneOrder.push(sceneId);
        }
        stream.scenes[sceneId] = copy;
        break;
      }
      case 'remove-scene': {
        const stream = this.streams[command.streamId];
        if (!stream) {
          break;
        }
        stream.sceneOrder = stream.sceneOrder.filter((id) => id !== command.sceneId);
        delete stream.scenes[command.sceneId];
        break;
      }
      case 'reorder-scenes': {
        const stream = this.streams[command.streamId];
        if (!stream) {
          break;
        }
        stream.sceneOrder = [...command.sceneOrder];
        break;
      }
      case 'update-subcue': {
        const stream = this.streams[command.streamId];
        const scene = stream?.scenes[command.sceneId];
        const sub = scene?.subCues[command.subCueId];
        if (!stream || !scene || !sub) {
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
    const stream = this.streams[command.streamId];
    if (!stream) {
      return this.getPublicState();
    }
    if (command.type !== 'stop' && command.streamId !== this.activeStreamId) {
      return this.getPublicState();
    }
    if (this.director.isPatchTransportPlaying() && command.type !== 'stop') {
      return this.getPublicState();
    }

    switch (command.type) {
      case 'go':
        this.handleGo(stream, command.sceneId);
        break;
      case 'pause':
        if (this.runtime && this.runtime.streamId === command.streamId) {
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
        if (this.runtime && this.runtime.streamId === command.streamId && this.runtime.status === 'paused') {
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
        if (this.runtime?.streamId === command.streamId) {
          this.runtime = null;
        }
        break;
      case 'jump-next':
        this.handleJumpNext(stream);
        break;
      case 'back-to-first':
        this.runtime = null;
        this.handleGo(stream);
        break;
      default:
        break;
    }

    this.emitState();
    return this.getPublicState();
  }

  private handleGo(stream: PersistedStreamConfig, sceneId?: SceneId): void {
    const target =
      sceneId && stream.scenes[sceneId] && !stream.scenes[sceneId].disabled
        ? sceneId
        : stream.sceneOrder.find((id) => !stream.scenes[id]?.disabled);
    if (!target) {
      this.runtime = {
        streamId: stream.id,
        status: 'complete',
        sceneStates: {},
      };
      return;
    }

    const sceneStates: Record<SceneId, SceneRuntimeState> = {};
    for (const id of stream.sceneOrder) {
      const sc = stream.scenes[id];
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
      streamId: stream.id,
      status: 'running',
      originWallTimeMs: wall,
      cursorSceneId: target,
      sceneStates,
      expectedDurationMs: estimateLinearManualStreamDurationMs(stream, {}, {}) ?? undefined,
    };
  }

  private handleJumpNext(stream: PersistedStreamConfig): void {
    if (!this.runtime || this.runtime.streamId !== stream.id || !this.runtime.cursorSceneId) {
      return;
    }
    const cur = this.runtime.cursorSceneId;
    const idx = stream.sceneOrder.indexOf(cur);
    if (idx < 0) {
      return;
    }
    const curState = this.runtime.sceneStates[cur];
    if (curState) {
      curState.status = 'complete';
      curState.endedAtStreamMs = 0;
    }
    const next = stream.sceneOrder.slice(idx + 1).find((id) => !stream.scenes[id]?.disabled);
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
    const stream = this.activeStreamId ? this.streams[this.activeStreamId] : undefined;
    if (!stream) {
      messages.push('No active stream');
    } else {
      messages.push(...validateStreamStructure(stream));
      messages.push(...validateTriggerReferences(stream));
    }
    this.validationMessages = messages;
  }

  private emitState(): void {
    this.emit('state', this.getPublicState());
  }
}
