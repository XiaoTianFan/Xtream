import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { toPersistedDiskMediaPath } from './showConfig';
import type {
  AudioMetadataReport,
  AudioExtractionFormat,
  AudioSourceSplitResult,
  AudioSourceState,
  DirectorState,
  EmbeddedAudioExtractionMode,
  DisplayWindowId,
  DisplayWindowState,
  DriftReport,
  GlobalStateUpdate,
  LiveVisualCaptureConfig,
  PersistedDisplayConfigV8,
  AppControlSettingsV1,
  ShowSettingsUpdate,
  PersistedShowConfig,
  PreviewStatus,
  OutputMeterReport,
  PresetId,
  PresetResult,
  RailCorrection,
  ReadinessIssue,
  TransportCommand,
  VisualImportItem,
  VisualUpdate,
  VisualMetadataReport,
  VisualState,
  VirtualOutputSourceSelection,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputState,
  VirtualOutputUpdate,
} from '../shared/types';
import { DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS, SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS } from '../shared/types';
import { getActiveDisplays, getLayoutVisualIds } from '../shared/layouts';
import {
  buildPatchCompatibilityScene,
  getDefaultStreamPersistence,
  mergeShowConfigPatchRouting,
  sceneLoopPolicyToLoopState,
} from '../shared/streamWorkspace';
import { getDirectorSeconds } from '../shared/timeline';

const DRIFT_WARN_THRESHOLD_SECONDS = 0.05;
const DRIFT_CORRECTION_THRESHOLD_SECONDS = 0.2;
const DRIFT_DEGRADE_THRESHOLD_SECONDS = 2;
const DRIFT_CORRECTION_COOLDOWN_MS = 3000;
const MAX_CORRECTION_ATTEMPTS = 10;
const DRIFT_DEGRADATION_REASON_PREFIX = 'Rail drift stayed above';

function isExtractionPendingAudioSource(source: AudioSourceState): boolean {
  return source.type === 'embedded-visual' && source.extractionMode === 'file' && source.extractionStatus === 'pending';
}

export class Director extends EventEmitter {
  private state: DirectorState;
  private readonly now: () => number;
  private streamPlaybackGate: () => boolean = () => false;
  private readonly correctionCounts = new Map<string, number>();
  private readonly lastCorrectionWallTimeMs = new Map<string, number>();
  private correctionRevision = 0;
  private visualSequence = 0;
  private audioSourceSequence = 0;
  private outputSequence = 1;
  private outputSourceSelectionSequence = 0;
  private displayPersistMeta = new Map<DisplayWindowState['id'], Pick<PersistedDisplayConfigV8, 'visualMingle'>>();

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
    this.state = {
      paused: true,
      rate: 1,
      audioExtractionFormat: 'm4a',
      anchorWallTimeMs: this.now(),
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      globalDisplayBlackoutFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      controlDisplayPreviewMaxFps: DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS,
      performanceMode: false,
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': this.createOutputState('output-main', 'Main Output'),
      },
      displays: {},
      activeTimeline: {
        assignedVideoIds: [],
        activeAudioSourceIds: [],
      },
      audioRendererReady: false,
      readiness: {
        ready: false,
        checkedAtWallTimeMs: this.now(),
        issues: [],
      },
      corrections: {
        displays: {},
      },
      previews: {},
    };
  }

  /** True when Patch transport is actively playing (not paused). */
  isPatchTransportPlaying(): boolean {
    return !this.state.paused;
  }

  /** Stream engine registers here to block Patch play while Stream playback is active. */
  setStreamPlaybackGate(gate: () => boolean): void {
    this.streamPlaybackGate = gate;
  }

  getState(): DirectorState {
    this.refreshReadiness();
    const clone = structuredClone(this.state);
    const mingleEntries: NonNullable<DirectorState['displayVisualMingle']> = {};
    for (const [displayId, meta] of this.displayPersistMeta) {
      if (meta.visualMingle) {
        mingleEntries[displayId] = meta.visualMingle;
      }
    }
    return {
      ...clone,
      displayVisualMingle: Object.keys(mingleEntries).length > 0 ? mingleEntries : undefined,
    };
  }

  setDisplayVisualMingle(displayId: DisplayWindowId, mingle: PersistedDisplayConfigV8['visualMingle'] | undefined): void {
    if (mingle) {
      this.displayPersistMeta.set(displayId, { visualMingle: mingle });
    } else {
      this.displayPersistMeta.delete(displayId);
    }
  }

  getPlaybackTimeSeconds(atWallTimeMs = this.now()): number {
    return getDirectorSeconds(this.state, atWallTimeMs);
  }

  addVisuals(items: VisualImportItem[]): VisualState[] {
    const added: VisualState[] = [];
    for (const item of items) {
      const id = item.id ?? this.createVisualId();
      this.state.visuals[id] = {
        id,
        kind: 'file',
        label: item.label ?? `Visual ${Object.keys(this.state.visuals).length + 1}`,
        type: item.type,
        path: item.path,
        url: item.url,
        opacity: 1,
        brightness: 1,
        contrast: 1,
        playbackRate: 1,
        fileSizeBytes: this.getFileSizeBytes(item.path),
        ready: false,
      };
      added.push(structuredClone(this.state.visuals[id]));
    }
    this.recalculateTimeline();
    this.emitState();
    return added;
  }

  addLiveVisual(label: string | undefined, capture: LiveVisualCaptureConfig): VisualState {
    const id = this.createVisualId();
    this.state.visuals[id] = {
      id,
      kind: 'live',
      label: label ?? capture.label ?? this.createLiveVisualLabel(capture),
      type: 'video',
      capture: {
        ...capture,
        revision: capture.revision ?? 1,
      } as LiveVisualCaptureConfig,
      opacity: 1,
      brightness: 1,
      contrast: 1,
      playbackRate: 1,
      ready: false,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.visuals[id]);
  }

  replaceVisual(visualId: string, item: VisualImportItem): VisualState {
    const previous = this.state.visuals[visualId];
    this.state.visuals[visualId] = {
      id: visualId,
      kind: 'file',
      label: previous?.label ?? item.label ?? visualId,
      type: item.type,
      path: item.path,
      url: item.url,
      opacity: previous?.opacity ?? 1,
      brightness: previous?.brightness ?? 1,
      contrast: previous?.contrast ?? 1,
      playbackRate: previous?.playbackRate ?? 1,
      fileSizeBytes: this.getFileSizeBytes(item.path),
      ready: false,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.visuals[visualId]);
  }

  updateVisual(visualId: string, update: VisualUpdate): VisualState {
    const visual = this.state.visuals[visualId];
    if (!visual) {
      throw new Error(`Unknown visual: ${visualId}`);
    }
    this.state.visuals[visualId] = { ...visual, ...update };
    this.emitState();
    return structuredClone(this.state.visuals[visualId]);
  }

  updateLiveVisualCapture(visualId: string, capture: LiveVisualCaptureConfig): VisualState {
    const visual = this.state.visuals[visualId];
    if (!visual) {
      throw new Error(`Unknown visual: ${visualId}`);
    }
    if (visual.kind !== 'live') {
      throw new Error(`${visual.label} is not a live visual.`);
    }
    this.state.visuals[visualId] = {
      ...visual,
      capture: {
        ...capture,
        revision: capture.revision ?? (visual.capture.revision ?? 0) + 1,
      } as LiveVisualCaptureConfig,
      ready: false,
      error: undefined,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.visuals[visualId]);
  }


  clearVisual(visualId: string): VisualState {
    const previous = this.state.visuals[visualId];
    this.state.visuals[visualId] = {
      id: visualId,
      kind: 'file',
      label: previous?.label ?? visualId,
      type: previous?.type ?? 'video',
      opacity: previous?.opacity ?? 1,
      brightness: previous?.brightness ?? 1,
      contrast: previous?.contrast ?? 1,
      playbackRate: previous?.playbackRate ?? 1,
      ready: false,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.visuals[visualId]);
  }

  removeVisual(visualId: string): DirectorState {
    delete this.state.visuals[visualId];
    for (const display of Object.values(this.state.displays)) {
      display.layout =
        display.layout.type === 'single'
          ? display.layout.visualId === visualId
            ? { type: 'single' }
            : display.layout
          : {
              type: 'split',
              visualIds: display.layout.visualIds.map((id) => (id === visualId ? undefined : id)) as [
                string | undefined,
                string | undefined,
              ],
            };
    }
    for (const source of Object.values(this.state.audioSources)) {
      if (source.type === 'embedded-visual' && source.visualId === visualId) {
        this.removeAudioSource(source.id);
      }
    }
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  updateVisualMetadata(report: VisualMetadataReport): DirectorState {
    if (isStreamRuntimeMediaId(report.visualId)) {
      return this.getState();
    }
    this.state.visuals[report.visualId] ??= {
      id: report.visualId,
      kind: 'file',
      label: report.visualId,
      type: 'video',
      ready: false,
    };
    this.state.visuals[report.visualId] = {
      ...this.state.visuals[report.visualId],
      durationSeconds: report.durationSeconds ?? this.state.visuals[report.visualId].durationSeconds,
      width: report.width ?? this.state.visuals[report.visualId].width,
      height: report.height ?? this.state.visuals[report.visualId].height,
      hasEmbeddedAudio: report.hasEmbeddedAudio ?? this.state.visuals[report.visualId].hasEmbeddedAudio,
      fileSizeBytes: this.getFileSizeBytes(this.state.visuals[report.visualId].path),
      ready: report.ready,
      error: report.error,
    } as VisualState;
    for (const source of Object.values(this.state.audioSources)) {
      if (source.type === 'embedded-visual' && source.visualId === report.visualId) {
        source.durationSeconds = report.durationSeconds;
        source.ready = report.ready;
        source.error = report.error;
      }
    }
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  addAudioFileSource(audioPath: string, audioUrl: string): AudioSourceState {
    const id = this.createAudioSourceId();
    this.state.audioSources[id] = {
      id,
      label: `Audio Source ${Object.keys(this.state.audioSources).length + 1}`,
      type: 'external-file',
      path: audioPath,
      url: audioUrl,
      playbackRate: 1,
      levelDb: 0,
      fileSizeBytes: this.getFileSizeBytes(audioPath),
      ready: false,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[id]);
  }

  addEmbeddedAudioSource(visualId: string, mode: EmbeddedAudioExtractionMode = 'representation'): AudioSourceState {
    const id = `audio-source-embedded-${visualId}`;
    const existing = this.state.audioSources[id];
    const visual = this.state.visuals[visualId];
    if (existing?.type === 'embedded-visual') {
      this.state.audioSources[id] = {
        ...existing,
        extractionMode: mode,
        extractedPath: mode === 'representation' ? undefined : existing.extractedPath,
        extractedUrl: mode === 'representation' ? undefined : existing.extractedUrl,
        extractedFormat: mode === 'representation' ? undefined : existing.extractedFormat,
        extractionStatus: mode === 'representation' ? undefined : existing.extractionStatus,
        durationSeconds: visual?.durationSeconds ?? existing.durationSeconds,
        fileSizeBytes: mode === 'representation' ? visual?.fileSizeBytes : existing.fileSizeBytes,
        ready: mode === 'representation' ? Boolean(visual?.ready) : existing.ready,
        error: mode === 'representation' ? visual?.error : existing.error,
      };
    } else {
      this.state.audioSources[id] = {
        id,
        label: `Embedded Audio ${visual?.label ?? visualId}`,
        type: 'embedded-visual',
        visualId,
        extractionMode: mode,
        durationSeconds: visual?.durationSeconds,
        playbackRate: 1,
        levelDb: 0,
        fileSizeBytes: visual?.fileSizeBytes,
        ready: mode === 'representation' ? Boolean(visual?.ready) : false,
        error: mode === 'representation' ? visual?.error : undefined,
      };
    }
    this.syncDerivedEmbeddedAudioSources(this.state.audioSources[id]);
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[id]);
  }

  markEmbeddedAudioExtractionPending(visualId: string, extractedPath: string, extractedUrl: string, format: AudioExtractionFormat): AudioSourceState {
    const source = this.addEmbeddedAudioSource(visualId, 'file');
    if (source.type !== 'embedded-visual') {
      throw new Error(`Unable to create embedded audio source for ${visualId}.`);
    }
    this.state.audioSources[source.id] = {
      ...source,
      type: 'embedded-visual',
      extractionMode: 'file',
      extractedPath,
      extractedUrl,
      extractedFormat: format,
      extractionStatus: 'pending',
      ready: false,
      error: undefined,
    };
    this.syncDerivedEmbeddedAudioSources(this.state.audioSources[source.id]);
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[source.id]);
  }

  markEmbeddedAudioExtractionReady(
    visualId: string,
    extractedPath: string,
    extractedUrl: string,
    format: AudioExtractionFormat,
    fileSizeBytes?: number,
  ): AudioSourceState {
    const source = this.addEmbeddedAudioSource(visualId, 'file');
    if (source.type !== 'embedded-visual') {
      throw new Error(`Unable to create embedded audio source for ${visualId}.`);
    }
    this.state.audioSources[source.id] = {
      ...source,
      type: 'embedded-visual',
      extractionMode: 'file',
      extractedPath,
      extractedUrl,
      extractedFormat: format,
      extractionStatus: 'ready',
      fileSizeBytes,
      ready: true,
      error: undefined,
    };
    this.syncDerivedEmbeddedAudioSources(this.state.audioSources[source.id]);
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[source.id]);
  }

  markEmbeddedAudioExtractionFailed(visualId: string, error: string): AudioSourceState {
    const source = this.addEmbeddedAudioSource(visualId, 'representation');
    if (source.type !== 'embedded-visual') {
      throw new Error(`Unable to create embedded audio source for ${visualId}.`);
    }
    const visual = this.state.visuals[visualId];
    this.state.audioSources[source.id] = {
      ...source,
      type: 'embedded-visual',
      extractionMode: 'representation',
      extractedPath: undefined,
      extractedUrl: undefined,
      extractedFormat: undefined,
      extractionStatus: undefined,
      durationSeconds: visual?.durationSeconds ?? source.durationSeconds,
      fileSizeBytes: visual?.fileSizeBytes,
      ready: Boolean(visual?.ready),
      error: visual?.error,
    };
    this.syncDerivedEmbeddedAudioSources(this.state.audioSources[source.id]);
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[source.id]);
  }

  updateGlobalState(update: GlobalStateUpdate): DirectorState {
    this.state = {
      ...this.state,
      ...update,
      globalAudioMuteFadeOverrideSeconds:
        update.globalAudioMuted !== undefined && update.globalAudioMuteFadeOverrideSeconds === undefined
          ? undefined
          : update.globalAudioMuteFadeOverrideSeconds ?? this.state.globalAudioMuteFadeOverrideSeconds,
      globalDisplayBlackoutFadeOverrideSeconds:
        update.globalDisplayBlackout !== undefined && update.globalDisplayBlackoutFadeOverrideSeconds === undefined
          ? undefined
          : update.globalDisplayBlackoutFadeOverrideSeconds ?? this.state.globalDisplayBlackoutFadeOverrideSeconds,
    };
    this.emitState();
    return this.getState();
  }

  updateShowSettings(update: ShowSettingsUpdate): DirectorState {
    const clampFade = (value: number | undefined, previous: number): number => {
      if (value === undefined) {
        return previous;
      }
      return Math.min(60, Math.max(0, value));
    };
    this.state = {
      ...this.state,
      globalAudioMuteFadeOutSeconds: clampFade(update.globalAudioMuteFadeOutSeconds, this.state.globalAudioMuteFadeOutSeconds),
      globalDisplayBlackoutFadeOutSeconds: clampFade(
        update.globalDisplayBlackoutFadeOutSeconds,
        this.state.globalDisplayBlackoutFadeOutSeconds,
      ),
    };
    this.emitState();
    return this.getState();
  }

  /** Sync machine-local fields from `app-control-settings.json` (performance, extraction format, preview FPS). */
  applyPersistedAppControlSettings(snapshot: AppControlSettingsV1): DirectorState {
    const fmt: AudioExtractionFormat = snapshot.audioExtractionFormat === 'wav' ? 'wav' : 'm4a';
    const fps = Math.min(60, Math.max(1, Math.round(Number(snapshot.controlDisplayPreviewMaxFps) || DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS)));
    this.state = {
      ...this.state,
      performanceMode: Boolean(snapshot.performanceMode),
      audioExtractionFormat: fmt,
      controlDisplayPreviewMaxFps: fps,
    };
    this.emitState();
    return this.getState();
  }

  resetShow(): DirectorState {
    const preservedAudioRendererReady = this.state.audioRendererReady;
    this.correctionCounts.clear();
    this.lastCorrectionWallTimeMs.clear();
    this.correctionRevision = 0;
    this.visualSequence = 0;
    this.audioSourceSequence = 0;
    this.outputSequence = 1;
    this.outputSourceSelectionSequence = 0;
    this.displayPersistMeta.clear();
    this.state = {
      paused: true,
      rate: 1,
      audioExtractionFormat: 'm4a',
      anchorWallTimeMs: this.now(),
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
      globalAudioMuteFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      globalDisplayBlackoutFadeOutSeconds: SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS,
      controlDisplayPreviewMaxFps: DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS,
      performanceMode: false,
      visuals: {},
      audioSources: {},
      outputs: {
        'output-main': this.createOutputState('output-main', 'Main Output'),
      },
      displays: {},
      activeTimeline: {
        assignedVideoIds: [],
        activeAudioSourceIds: [],
      },
      readiness: {
        ready: false,
        checkedAtWallTimeMs: this.now(),
        issues: [],
      },
      corrections: {
        displays: {},
      },
      previews: {},
      audioRendererReady: preservedAudioRendererReady,
    };
    this.emitState();
    return this.getState();
  }

  /** Called when the dedicated audio renderer process loads (`renderer:ready`, kind `audio`). */
  markAudioRendererReady(): DirectorState {
    if (this.state.audioRendererReady) {
      return this.getState();
    }
    this.state.audioRendererReady = true;
    this.emitState();
    return this.getState();
  }

  replaceAudioFileSource(audioSourceId: string, audioPath: string, audioUrl: string): AudioSourceState {
    const source = this.state.audioSources[audioSourceId];
    if (!source) {
      throw new Error(`Unknown audio source: ${audioSourceId}`);
    }
    this.state.audioSources[audioSourceId] = {
      id: audioSourceId,
      label: source.label,
      type: 'external-file',
      path: audioPath,
      url: audioUrl,
      playbackRate: source.playbackRate ?? 1,
      levelDb: source.levelDb ?? 0,
      fileSizeBytes: this.getFileSizeBytes(audioPath),
      ready: false,
    };
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[audioSourceId]);
  }

  clearAudioSource(audioSourceId: string): AudioSourceState | undefined {
    const source = this.state.audioSources[audioSourceId];
    if (!source) {
      throw new Error(`Unknown audio source: ${audioSourceId}`);
    }
    if (source.type === 'embedded-visual') {
      this.removeAudioSource(audioSourceId);
      return undefined;
    }
    this.state.audioSources[audioSourceId] = {
      id: source.id,
      label: source.label,
      type: 'external-file',
      playbackRate: source.playbackRate ?? 1,
      levelDb: source.levelDb ?? 0,
      ready: false,
    };
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[audioSourceId]);
  }

  updateAudioSource(audioSourceId: string, update: Partial<Pick<AudioSourceState, 'label' | 'playbackRate' | 'levelDb'>>): AudioSourceState {
    const source = this.state.audioSources[audioSourceId];
    if (!source) {
      throw new Error(`Unknown audio source: ${audioSourceId}`);
    }
    this.state.audioSources[audioSourceId] = { ...source, ...update } as AudioSourceState;
    this.emitState();
    return structuredClone(this.state.audioSources[audioSourceId]);
  }

  removeAudioSource(audioSourceId: string): DirectorState {
    delete this.state.audioSources[audioSourceId];
    for (const output of Object.values(this.state.outputs)) {
      output.sources = output.sources.filter((source) => source.audioSourceId !== audioSourceId);
    }
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  splitStereoAudioSource(audioSourceId: string): AudioSourceSplitResult {
    const source = this.state.audioSources[audioSourceId];
    if (!source) {
      throw new Error(`Unknown audio source: ${audioSourceId}`);
    }
    if (source.derivedFromAudioSourceId || source.channelMode === 'left' || source.channelMode === 'right') {
      throw new Error(`${source.label} is already a mono channel source.`);
    }
    if (source.channelCount === 1) {
      throw new Error(`${source.label} is mono and cannot be split.`);
    }

    const left = this.createMonoAudioSource(source, 'left');
    const right = this.createMonoAudioSource(source, 'right');
    this.state.audioSources[left.id] = left;
    this.state.audioSources[right.id] = right;
    this.recalculateTimeline();
    this.emitState();
    return [structuredClone(left), structuredClone(right)];
  }

  updateAudioMetadata(report: AudioMetadataReport): DirectorState {
    if (isStreamRuntimeMediaId(report.audioSourceId)) {
      return this.getState();
    }
    const source = this.state.audioSources[report.audioSourceId];
    if (source) {
      const isDerivedMono = source.channelMode === 'left' || source.channelMode === 'right';
      const channelCount = isDerivedMono ? 1 : report.channelCount ?? source.channelCount;
      const channelMode =
        source.channelMode === 'left' || source.channelMode === 'right' ? source.channelMode : channelCount && channelCount >= 2 ? 'stereo' : undefined;
      this.state.audioSources[report.audioSourceId] = {
        ...source,
        durationSeconds: report.durationSeconds,
        channelCount,
        channelMode,
        fileSizeBytes: source.type === 'external-file' ? this.getFileSizeBytes(source.path) : source.fileSizeBytes,
        ready: report.ready,
        error: report.error,
      } as AudioSourceState;
    }
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  createVirtualOutput(): VirtualOutputState {
    const id = `output-${++this.outputSequence}`;
    const firstSourceId = Object.keys(this.state.audioSources)[0];
    this.state.outputs[id] = this.createOutputState(id, `Output ${this.outputSequence}`, firstSourceId);
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.outputs[id]);
  }

  updateVirtualOutput(outputId: string, update: VirtualOutputUpdate): VirtualOutputState {
    const output = this.state.outputs[outputId];
    if (!output) {
      throw new Error(`Unknown virtual output: ${outputId}`);
    }
    const nextSources = update.sources ? this.normalizeOutputSourceSelections(outputId, update.sources) : output.sources;
    this.state.outputs[outputId] = {
      ...output,
      ...update,
      sources: nextSources,
      ready: output.ready,
      error: Object.prototype.hasOwnProperty.call(update, 'error') ? update.error : output.error,
    };
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.outputs[outputId]);
  }

  addVirtualOutputSource(outputId: string, audioSourceId: string): VirtualOutputState {
    const output = this.getNormalizedOutput(outputId);
    output.sources = [...output.sources, this.createOutputSourceSelection(outputId, audioSourceId)];
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(output);
  }

  updateVirtualOutputSource(outputId: string, selectionId: string, update: VirtualOutputSourceSelectionUpdate): VirtualOutputState {
    const output = this.getNormalizedOutput(outputId);
    let found = false;
    output.sources = output.sources.map((source) => {
      if (source.id !== selectionId) {
        return source;
      }
      found = true;
      return { ...source, ...update, pan: update.pan ?? source.pan ?? 0 };
    });
    if (!found) {
      throw new Error(`Unknown virtual output source: ${selectionId}`);
    }
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(output);
  }

  removeVirtualOutputSource(outputId: string, selectionId: string): VirtualOutputState {
    const output = this.getNormalizedOutput(outputId);
    const nextSources = output.sources.filter((source) => source.id !== selectionId);
    if (nextSources.length === output.sources.length) {
      throw new Error(`Unknown virtual output source: ${selectionId}`);
    }
    output.sources = nextSources;
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(output);
  }

  updateOutputMeter(report: OutputMeterReport): VirtualOutputState {
    const { outputId, lanes, peakDb } = report;
    const output = this.state.outputs[outputId];
    if (!output) {
      throw new Error(`Unknown virtual output: ${outputId}`);
    }
    this.state.outputs[outputId] = { ...output, meterDb: peakDb, meterLanes: lanes };
    return structuredClone(this.state.outputs[outputId]);
  }

  updatePreviewStatus(report: PreviewStatus): DirectorState {
    this.state.previews[report.key] = structuredClone(report);
    this.emitState();
    return this.getState();
  }

  removeVirtualOutput(outputId: string): DirectorState {
    delete this.state.outputs[outputId];
    if (Object.keys(this.state.outputs).length === 0) {
      this.state.outputs['output-main'] = this.createOutputState('output-main', 'Main Output');
    }
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  applyPreset(preset: PresetId, ensureDisplay: (layout: DisplayWindowState['layout'], index: number) => DisplayWindowState): PresetResult {
    const visualIds = Object.keys(this.state.visuals);
    if (preset === 'split-display-one-screen') {
      const display = ensureDisplay({ type: 'split', visualIds: [visualIds[0], visualIds[1]] }, 0);
      const state = this.updateDisplay(display);
      return { state, primaryDisplayId: display.id };
    }

    const first = ensureDisplay({ type: 'single', visualId: visualIds[0] }, 0);
    const second = ensureDisplay({ type: 'single', visualId: visualIds[1] }, 1);
    this.updateDisplay(first);
    const state = this.updateDisplay(second);
    return { state, primaryDisplayId: first.id };
  }

  createShowConfig(
    savedAt = new Date().toISOString(),
    streamPersistence: Pick<PersistedShowConfig, 'stream'> = getDefaultStreamPersistence(),
    diskMedia?: { projectRootForRelativeMedia?: string },
  ): PersistedShowConfig {
    this.normalizeAllOutputSourceSelectionsInState();
    const displays: PersistedDisplayConfigV8[] = Object.values(this.state.displays).map((display) => {
      const mingle = this.displayPersistMeta.get(display.id)?.visualMingle;
      return {
        id: display.id,
        label: display.label,
        layout: structuredClone(display.layout),
        fullscreen: display.fullscreen,
        alwaysOnTop: display.alwaysOnTop,
        displayId: display.displayId,
        bounds: display.bounds,
        ...(mingle ? { visualMingle: mingle } : {}),
      };
    });
    const patchScene = buildPatchCompatibilityScene(
      this.state.loop,
      displays.map((d) => ({ id: d.id!, layout: d.layout })),
      Object.fromEntries(
        Object.values(this.state.outputs).map((o) => [o.id, { id: o.id, sources: this.normalizeOutputSourceSelections(o.id, o.sources) }]),
      ),
    );
    return {
      schemaVersion: 9,
      savedAt,
      rate: this.state.rate,
      globalAudioMuteFadeOutSeconds: this.state.globalAudioMuteFadeOutSeconds,
      globalDisplayBlackoutFadeOutSeconds: this.state.globalDisplayBlackoutFadeOutSeconds,
      stream: structuredClone(streamPersistence.stream),
      patchCompatibility: { scene: patchScene },
      visuals: Object.fromEntries(
        Object.values(this.state.visuals).map((visual) => [
          visual.id,
          visual.kind === 'live'
            ? {
                id: visual.id,
                label: visual.label,
                kind: 'live',
                type: visual.type,
                capture: structuredClone(visual.capture),
                linkedAudioSourceId: visual.linkedAudioSourceId,
                opacity: visual.opacity ?? 1,
                brightness: visual.brightness ?? 1,
                contrast: visual.contrast ?? 1,
                playbackRate: visual.playbackRate ?? 1,
              }
            : {
                id: visual.id,
                label: visual.label,
                kind: 'file',
                type: visual.type,
                path: toPersistedDiskMediaPath(diskMedia?.projectRootForRelativeMedia, visual.path),
                opacity: visual.opacity ?? 1,
                brightness: visual.brightness ?? 1,
                contrast: visual.contrast ?? 1,
                playbackRate: visual.playbackRate ?? 1,
                fileSizeBytes: visual.fileSizeBytes,
              },
        ]),
      ),
      audioSources: Object.fromEntries(
        Object.values(this.state.audioSources).map((source) => [
          source.id,
          source.type === 'external-file'
            ? {
                id: source.id,
                label: source.label,
                type: source.type,
                path: toPersistedDiskMediaPath(diskMedia?.projectRootForRelativeMedia, source.path),
                playbackRate: source.playbackRate ?? 1,
                levelDb: source.levelDb ?? 0,
                channelCount: source.channelCount,
                channelMode: source.channelMode,
                derivedFromAudioSourceId: source.derivedFromAudioSourceId,
                fileSizeBytes: source.fileSizeBytes,
              }
            : {
                id: source.id,
                label: source.label,
                type: source.type,
                visualId: source.visualId,
                extractionMode: source.extractionMode,
                extractedPath: toPersistedDiskMediaPath(diskMedia?.projectRootForRelativeMedia, source.extractedPath),
                extractedFormat: source.extractedFormat,
                extractionStatus: source.extractionStatus,
                playbackRate: source.playbackRate ?? 1,
                levelDb: source.levelDb ?? 0,
                channelCount: source.channelCount,
                channelMode: source.channelMode,
                derivedFromAudioSourceId: source.derivedFromAudioSourceId,
                fileSizeBytes: source.fileSizeBytes,
              },
        ]),
      ),
      outputs: Object.fromEntries(
        Object.values(this.state.outputs).map((output) => [
          output.id,
          {
            id: output.id,
            label: output.label,
            sources: this.normalizeOutputSourceSelections(output.id, output.sources),
            sinkId: output.sinkId,
            sinkLabel: output.sinkLabel,
            busLevelDb: output.busLevelDb,
            pan: output.pan ?? 0,
            muted: output.muted,
            outputDelaySeconds: output.outputDelaySeconds,
            fallbackAccepted: output.fallbackAccepted,
          },
        ]),
      ),
      displays,
    };
  }

  /**
   * Restores pool, outputs, and loop from persisted show data.
   * Applies `patchCompatibility.scene` routing over persisted displays and virtual outputs (v8 Patch projection).
   */
  restoreShowConfig(config: PersistedShowConfig, urls: { visuals: Record<string, string | undefined>; audioSources: Record<string, string | undefined> }): DirectorState {
    const merged = mergeShowConfigPatchRouting(config);
    this.state.paused = true;
    this.state.globalAudioMuted = false;
    this.state.globalDisplayBlackout = false;
    this.state.performanceMode = false;
    this.state.rate = merged.rate ?? 1;
    this.state.audioExtractionFormat = 'm4a';
    this.state.globalAudioMuteFadeOutSeconds = Math.min(
      60,
      Math.max(0, merged.globalAudioMuteFadeOutSeconds ?? SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS),
    );
    this.state.globalDisplayBlackoutFadeOutSeconds = Math.min(
      60,
      Math.max(0, merged.globalDisplayBlackoutFadeOutSeconds ?? SHOW_PROJECT_DEFAULT_FADE_OUT_SECONDS),
    );
    this.state.controlDisplayPreviewMaxFps = DEFAULT_CONTROL_DISPLAY_PREVIEW_MAX_FPS;
    this.state.anchorWallTimeMs = this.now();
    this.state.offsetSeconds = 0;
    this.displayPersistMeta.clear();
    for (const display of merged.displays) {
      const id = display.id;
      if (id && display.visualMingle) {
        this.displayPersistMeta.set(id, { visualMingle: display.visualMingle });
      }
    }
    this.state.loop = sceneLoopPolicyToLoopState(merged.patchCompatibility.scene.loop);
    this.state.visuals = Object.fromEntries(
      Object.values(merged.visuals).map((visual) => [
        visual.id,
        visual.kind === 'live'
          ? ({
              id: visual.id,
              label: visual.label,
              kind: 'live',
              type: 'video',
              capture: structuredClone(visual.capture),
              linkedAudioSourceId: visual.linkedAudioSourceId,
              opacity: visual.opacity ?? 1,
              brightness: visual.brightness ?? 1,
              contrast: visual.contrast ?? 1,
              playbackRate: visual.playbackRate ?? 1,
              ready: false,
            } satisfies VisualState)
          : ({
              id: visual.id,
              label: visual.label,
              kind: 'file',
              type: visual.type,
              path: visual.path,
              url: urls.visuals[visual.id],
              opacity: visual.opacity ?? 1,
              brightness: visual.brightness ?? 1,
              contrast: visual.contrast ?? 1,
              playbackRate: visual.playbackRate ?? 1,
              fileSizeBytes: visual.fileSizeBytes,
              ready: false,
            } satisfies VisualState),
      ]),
    );
    this.state.audioSources = Object.fromEntries(
      Object.values(merged.audioSources).map((source) => [
        source.id,
        source.type === 'external-file'
          ? {
              id: source.id,
              label: source.label,
              type: source.type,
              path: source.path,
              url: urls.audioSources[source.id],
              playbackRate: source.playbackRate ?? 1,
              levelDb: source.levelDb ?? 0,
              channelCount: source.channelCount,
              channelMode: source.channelMode,
              derivedFromAudioSourceId: source.derivedFromAudioSourceId,
              fileSizeBytes: source.fileSizeBytes,
              ready: false,
            }
          : {
              id: source.id,
              label: source.label,
              type: source.type,
              visualId: source.visualId,
              extractionMode: source.extractionMode ?? 'representation',
              extractedPath: source.extractedPath,
              extractedUrl: urls.audioSources[source.id],
              extractedFormat: source.extractedFormat,
              extractionStatus: source.extractionStatus,
              playbackRate: source.playbackRate ?? 1,
              levelDb: source.levelDb ?? 0,
              channelCount: source.channelCount,
              channelMode: source.channelMode,
              derivedFromAudioSourceId: source.derivedFromAudioSourceId,
              fileSizeBytes: source.fileSizeBytes,
              ready: false,
            },
      ]),
    );
    this.state.outputs = Object.fromEntries(
      Object.values(merged.outputs).map((output) => [
        output.id,
        {
          id: output.id,
          label: output.label,
          sources: this.normalizeOutputSourceSelections(output.id, output.sources),
          sinkId: output.sinkId,
          sinkLabel: output.sinkLabel,
          busLevelDb: output.busLevelDb,
          pan: output.pan ?? 0,
          muted: output.muted,
          outputDelaySeconds: output.outputDelaySeconds,
          ready: false,
          physicalRoutingAvailable: true,
          fallbackAccepted: output.fallbackAccepted ?? false,
          fallbackReason: 'none',
        } satisfies VirtualOutputState,
      ]),
    );
    if (Object.keys(this.state.outputs).length === 0) {
      this.state.outputs['output-main'] = this.createOutputState('output-main', 'Main Output');
    }
    this.state.displays = {};
    this.state.corrections = { displays: {} };
    this.state.previews = {};
    this.correctionCounts.clear();
    this.lastCorrectionWallTimeMs.clear();
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  applyTransport(command: TransportCommand): DirectorState {
    switch (command.type) {
      case 'play':
        if (this.getState().readiness.ready) {
          this.play();
        }
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

  registerDisplay(display: DisplayWindowState): DirectorState {
    this.state.displays[display.id] = display;
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  updateDisplay(display: DisplayWindowState): DirectorState {
    this.state.displays[display.id] = display;
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  updateDisplayLayout(id: string, layout: DisplayWindowState['layout']): DirectorState {
    const display = this.state.displays[id];
    if (!display) {
      throw new Error(`Unknown display window: ${id}`);
    }
    this.state.displays[id] = { ...display, layout };
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  markDisplayClosed(id: string): DirectorState {
    const display = this.state.displays[id];
    if (display) {
      this.state.displays[id] = { ...display, health: 'closed' };
      this.recalculateTimeline();
      this.emitState();
    }
    return this.getState();
  }

  removeDisplay(id: string): DirectorState {
    this.displayPersistMeta.delete(id);
    delete this.state.displays[id];
    delete this.state.corrections.displays[id];
    this.correctionCounts.delete(`display:${id}`);
    this.lastCorrectionWallTimeMs.delete(`display:${id}`);
    this.recalculateTimeline();
    this.emitState();
    return this.getState();
  }

  ingestDrift(report: DriftReport): DirectorState {
    const correction = this.createCorrection(`${report.kind}:${report.displayId ?? 'control'}`, report.driftSeconds);
    if (report.kind === 'display' && report.displayId) {
      const display = this.state.displays[report.displayId];
      if (display) {
        const hasNonDriftDegradation = display.health === 'degraded' && !display.degradationReason?.startsWith(DRIFT_DEGRADATION_REASON_PREFIX);
        this.state.displays[report.displayId] = {
          ...display,
          health: correction.action === 'degraded' || hasNonDriftDegradation ? 'degraded' : 'ready',
          lastDriftSeconds: report.driftSeconds,
          lastFrameRateFps: report.frameRateFps ?? display.lastFrameRateFps,
          lastPresentedFrameRateFps: report.presentedFrameRateFps ?? display.lastPresentedFrameRateFps,
          lastDroppedVideoFrames: report.droppedVideoFrames ?? display.lastDroppedVideoFrames,
          lastTotalVideoFrames: report.totalVideoFrames ?? display.lastTotalVideoFrames,
          lastMaxVideoFrameGapMs: report.maxVideoFrameGapMs ?? display.lastMaxVideoFrameGapMs,
          lastMediaSeekCount: report.mediaSeekCount ?? display.lastMediaSeekCount,
          lastMediaSeekFallbackCount: report.mediaSeekFallbackCount ?? display.lastMediaSeekFallbackCount,
          lastMediaSeekDurationMs: report.mediaSeekDurationMs ?? display.lastMediaSeekDurationMs,
          degradationReason: correction.action === 'degraded' || hasNonDriftDegradation ? correction.reason ?? display.degradationReason : undefined,
        };
      }
      this.state.corrections.displays[report.displayId] = correction;
    } else {
      this.state.corrections.audio = correction;
    }
    this.emitState();
    return this.getState();
  }

  private play(): void {
    if (!this.state.paused) {
      return;
    }
    if (this.streamPlaybackGate()) {
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
    const duration = this.state.activeTimeline.durationSeconds;
    this.state.offsetSeconds = duration === undefined ? Math.max(0, seconds) : Math.min(Math.max(0, seconds), duration);
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
    const clamped = this.clampLoop(loop);
    if (JSON.stringify(clamped) !== JSON.stringify(loop)) {
      this.state.activeTimeline.notice = 'Loop range was adjusted to fit the active timeline.';
    }
    this.state.loop = clamped;
    this.state.offsetSeconds = this.getPlaybackTimeSeconds();
    this.state.anchorWallTimeMs = this.now();
  }

  private getFileSizeBytes(filePath: string | undefined): number | undefined {
    if (!filePath) {
      return undefined;
    }
    try {
      return fs.statSync(filePath).size;
    } catch {
      return undefined;
    }
  }

  private clampLoop(loop: DirectorState['loop']): DirectorState['loop'] {
    const nextLoop = structuredClone(loop);
    const limit = this.state.activeTimeline.loopRangeLimit;
    if (!nextLoop.enabled || !limit) {
      return nextLoop;
    }
    nextLoop.startSeconds = Math.min(Math.max(0, nextLoop.startSeconds), limit.endSeconds);
    if (nextLoop.endSeconds !== undefined) {
      nextLoop.endSeconds = Math.min(Math.max(0, nextLoop.endSeconds), limit.endSeconds);
    }
    if (nextLoop.endSeconds !== undefined && nextLoop.endSeconds <= nextLoop.startSeconds) {
      nextLoop.startSeconds = 0;
      nextLoop.endSeconds = limit.endSeconds;
    }
    return nextLoop;
  }

  private recalculateTimeline(): void {
    const activeVisualIds = Array.from(
      new Set(getActiveDisplays(this.state.displays).flatMap((display) => getLayoutVisualIds(display.layout))),
    );
    const assignedVideoIds = activeVisualIds.filter((visualId) => {
      const visual = this.state.visuals[visualId];
      return visual?.type === 'video' && typeof visual.durationSeconds === 'number';
    });
    const assignedVideoDurations = assignedVideoIds
      .map((visualId) => this.state.visuals[visualId]?.durationSeconds)
      .filter((duration): duration is number => Number.isFinite(duration));
    const activeAudioSourceIds = Array.from(
      new Set(Object.values(this.state.outputs).flatMap((output) => output.sources.map((source) => source.audioSourceId))),
    ).filter((sourceId) => Boolean(this.state.audioSources[sourceId]));
    const activeAudioDurations =
      assignedVideoDurations.length === 0
        ? activeAudioSourceIds
            .map((sourceId) => this.state.audioSources[sourceId]?.durationSeconds)
            .filter((duration): duration is number => Number.isFinite(duration))
        : [];
    const durations = assignedVideoDurations.length > 0 ? assignedVideoDurations : activeAudioDurations;
    this.state.activeTimeline = {
      durationSeconds: durations.length > 0 ? Math.max(...durations) : undefined,
      assignedVideoIds,
      activeAudioSourceIds,
      loopRangeLimit: durations.length > 0 ? { startSeconds: 0, endSeconds: Math.max(...durations) } : undefined,
    };

    const clamped = this.clampLoop(this.state.loop);
    if (JSON.stringify(clamped) !== JSON.stringify(this.state.loop)) {
      this.state.loop = clamped;
      this.state.activeTimeline.notice = 'Loop range was adjusted to fit the active timeline.';
    }
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
    if (activeDisplays.length === 0) {
      issues.push({ severity: 'error', target: 'display', message: 'At least one active display window is required.' });
    }

    for (const display of activeDisplays) {
      if (display.health === 'closed' || display.health === 'stale' || display.health === 'degraded') {
        issues.push({
          severity: 'error',
          target: `display:${display.id}`,
          message: `Display ${display.id} is ${display.health}${display.degradationReason ? `: ${display.degradationReason}` : ''}.`,
        });
      }
      for (const visualId of getLayoutVisualIds(display.layout)) {
        const visual = this.state.visuals[visualId];
        if (!visual) {
          issues.push({ severity: 'error', target: `visual:${visualId}`, message: `Visual ${visualId} is missing.` });
        } else if (visual.kind === 'file' && !visual.path) {
          issues.push({ severity: 'error', target: `visual:${visualId}`, message: `Visual ${visualId} has no media selected.` });
        } else if (!visual.ready) {
          issues.push({ severity: 'error', target: `visual:${visualId}`, message: visual.error ?? `${visual.label} is not ready.` });
        }
      }
    }

    for (const output of Object.values(this.state.outputs)) {
      for (const selection of output.sources) {
        const source = this.state.audioSources[selection.audioSourceId];
        if (!source) {
          issues.push({
            severity: 'error',
            target: `output:${output.id}`,
            message: `${output.label} references missing audio source ${selection.audioSourceId}.`,
          });
        } else if (isExtractionPendingAudioSource(source)) {
          issues.push({
            severity: 'warning',
            target: `audio-source:${source.id}`,
            message: `${source.label} extraction is still running.`,
          });
        } else if (!source.ready) {
          issues.push({ severity: 'error', target: `audio-source:${source.id}`, message: source.error ?? `${source.label} is not ready.` });
        }
      }
      if (output.sources.length > 0 && !output.physicalRoutingAvailable && !output.fallbackAccepted) {
        issues.push({
          severity: 'error',
          target: `output:${output.id}`,
          message: `${output.label} physical routing is unavailable; accept fallback or choose another endpoint.`,
        });
      }
    }

    if (this.state.loop.enabled && this.state.loop.endSeconds !== undefined && this.state.activeTimeline.loopRangeLimit) {
      if (this.state.loop.endSeconds > this.state.activeTimeline.loopRangeLimit.endSeconds) {
        issues.push({ severity: 'error', target: 'loop', message: 'Loop end is outside the active loop range limit.' });
      }
    }
    if (this.state.activeTimeline.notice) {
      issues.push({ severity: 'warning', target: 'loop', message: this.state.activeTimeline.notice });
    }
    for (const preview of Object.values(this.state.previews)) {
      if (!preview.ready && preview.error) {
        issues.push({ severity: 'warning', target: `preview:${preview.key}`, message: preview.error });
      }
    }

    return issues;
  }

  private emitState(): void {
    this.refreshReadiness();
    this.emit('state', this.getState());
  }

  private createVisualId(): string {
    let id: string;
    do {
      this.visualSequence += 1;
      id = `visual-${this.visualSequence}`;
    } while (this.state.visuals[id]);
    return id;
  }

  private createLiveVisualLabel(capture: LiveVisualCaptureConfig): string {
    const sourceLabels: Record<LiveVisualCaptureConfig['source'], string> = {
      webcam: 'Webcam',
      screen: 'Screen',
      'screen-region': 'Screen Region',
      window: 'Window',
    };
    return `${sourceLabels[capture.source]} ${Object.keys(this.state.visuals).length + 1}`;
  }

  private createAudioSourceId(): string {
    let id: string;
    do {
      this.audioSourceSequence += 1;
      id = `audio-source-${this.audioSourceSequence}`;
    } while (this.state.audioSources[id]);
    return id;
  }

  private createDerivedAudioSourceId(sourceId: string, mode: 'left' | 'right'): string {
    const suffix = mode === 'left' ? 'left' : 'right';
    let id = `${sourceId}-${suffix}`;
    let index = 1;
    while (this.state.audioSources[id]) {
      index += 1;
      id = `${sourceId}-${suffix}-${index}`;
    }
    return id;
  }

  private createMonoAudioSource(source: AudioSourceState, mode: 'left' | 'right'): AudioSourceState {
    const id = this.createDerivedAudioSourceId(source.id, mode);
    const shared = {
      id,
      label: `${source.label} ${mode === 'left' ? 'L' : 'R'}`,
      durationSeconds: source.durationSeconds,
      playbackRate: source.playbackRate ?? 1,
      levelDb: source.levelDb ?? 0,
      channelCount: 1,
      channelMode: mode,
      derivedFromAudioSourceId: source.id,
      fileSizeBytes: source.fileSizeBytes,
      ready: source.ready,
      error: source.error,
    } as const;
    return source.type === 'external-file'
      ? {
          ...shared,
          type: 'external-file',
          path: source.path,
          url: source.url,
        }
      : {
          ...shared,
          type: 'embedded-visual',
          visualId: source.visualId,
          extractionMode: source.extractionMode,
          extractedPath: source.extractedPath,
          extractedUrl: source.extractedUrl,
          extractedFormat: source.extractedFormat,
          extractionStatus: source.extractionStatus,
        };
  }

  private syncDerivedEmbeddedAudioSources(source: AudioSourceState): void {
    if (source.type !== 'embedded-visual') {
      return;
    }
    for (const candidate of Object.values(this.state.audioSources)) {
      if (candidate.type !== 'embedded-visual' || candidate.derivedFromAudioSourceId !== source.id) {
        continue;
      }
      this.state.audioSources[candidate.id] = {
        ...candidate,
        extractionMode: source.extractionMode,
        extractedPath: source.extractedPath,
        extractedUrl: source.extractedUrl,
        extractedFormat: source.extractedFormat,
        extractionStatus: source.extractionStatus,
        durationSeconds: source.durationSeconds,
        fileSizeBytes: source.fileSizeBytes,
        ready: source.ready,
        error: source.error,
      };
    }
  }

  private ensureEmbeddedAudioSource(visualId: string): AudioSourceState | undefined {
    const visual = this.state.visuals[visualId];
    if (!visual) {
      return undefined;
    }
    const id = `audio-source-embedded-${visualId}`;
    const existing = this.state.audioSources[id];
    if (existing?.type === 'embedded-visual') {
      this.state.audioSources[id] = {
        ...existing,
        label: existing.label || `Embedded Audio ${visual.label}`,
        extractionMode: existing.extractionMode ?? 'representation',
        durationSeconds: visual.durationSeconds,
        fileSizeBytes: visual.fileSizeBytes,
        ready: visual.ready,
        error: visual.error,
      };
    } else {
      this.state.audioSources[id] = {
        id,
        label: `Embedded Audio ${visual.label}`,
        type: 'embedded-visual',
        visualId,
        extractionMode: 'representation',
        durationSeconds: visual.durationSeconds,
        playbackRate: 1,
        levelDb: 0,
        fileSizeBytes: visual.fileSizeBytes,
        ready: visual.ready,
        error: visual.error,
      };
    }
    this.updateOutputReadiness();
    this.recalculateTimeline();
    return structuredClone(this.state.audioSources[id]);
  }

  private createOutputState(id: string, label: string, sourceId?: string): VirtualOutputState {
    return {
      id,
      label,
      sources: sourceId ? [this.createOutputSourceSelection(id, sourceId)] : [],
      busLevelDb: 0,
      pan: 0,
      outputDelaySeconds: 0,
      ready: false,
      physicalRoutingAvailable: true,
      fallbackAccepted: false,
      fallbackReason: 'none',
    };
  }

  private createOutputSourceSelection(outputId: string, audioSourceId: string): VirtualOutputSourceSelection {
    return {
      id: this.nextOutputSourceSelectionId(outputId),
      audioSourceId,
      levelDb: 0,
      pan: 0,
    };
  }

  private normalizeOutputSourceSelections(outputId: string, sources: VirtualOutputSourceSelection[]): VirtualOutputSourceSelection[] {
    const seen = new Set<string>();
    return sources.map((source) => {
      const existingId = typeof source.id === 'string' && source.id.trim() ? source.id : undefined;
      const id = existingId && !seen.has(existingId) ? existingId : this.nextOutputSourceSelectionId(outputId, seen);
      seen.add(id);
      return {
        ...source,
        id,
        pan: source.pan ?? 0,
      };
    });
  }

  private normalizeAllOutputSourceSelectionsInState(): void {
    for (const output of Object.values(this.state.outputs)) {
      output.sources = this.normalizeOutputSourceSelections(output.id, output.sources);
    }
  }

  private getNormalizedOutput(outputId: string): VirtualOutputState {
    const output = this.state.outputs[outputId];
    if (!output) {
      throw new Error(`Unknown virtual output: ${outputId}`);
    }
    output.sources = this.normalizeOutputSourceSelections(outputId, output.sources);
    return output;
  }

  private nextOutputSourceSelectionId(outputId: string, reserved: Set<string> = new Set()): string {
    let id: string;
    do {
      this.outputSourceSelectionSequence += 1;
      id = `${outputId}-source-${this.outputSourceSelectionSequence}`;
    } while (reserved.has(id));
    return id;
  }

  private updateOutputReadiness(): void {
    for (const output of Object.values(this.state.outputs)) {
      const missingSource = output.sources.find((source) => !this.state.audioSources[source.audioSourceId]);
      const unreadySource = output.sources.find((source) => {
        const audioSource = this.state.audioSources[source.audioSourceId];
        return audioSource && !audioSource.ready && !isExtractionPendingAudioSource(audioSource);
      });
      output.ready = output.sources.length > 0 && !missingSource && !unreadySource;
      output.error = missingSource
        ? `Missing audio source ${missingSource.audioSourceId}.`
        : unreadySource
          ? this.state.audioSources[unreadySource.audioSourceId]?.error ?? 'Selected audio source is not ready.'
          : undefined;
    }
  }

  private createCorrection(railKey: string, driftSeconds: number): RailCorrection {
    const absoluteDrift = Math.abs(driftSeconds);
    const issuedAtWallTimeMs = this.now();
    if (absoluteDrift <= DRIFT_WARN_THRESHOLD_SECONDS) {
      this.correctionCounts.set(railKey, 0);
      this.lastCorrectionWallTimeMs.delete(railKey);
      return { action: 'none', driftSeconds, issuedAtWallTimeMs, revision: ++this.correctionRevision };
    }
    if (absoluteDrift <= DRIFT_CORRECTION_THRESHOLD_SECONDS) {
      this.correctionCounts.set(railKey, 0);
      return {
        action: 'none',
        driftSeconds,
        issuedAtWallTimeMs,
        reason: 'Drift is above warning threshold but within correction tolerance.',
        revision: ++this.correctionRevision,
      };
    }
    if (absoluteDrift < DRIFT_DEGRADE_THRESHOLD_SECONDS) {
      const lastCorrectionMs = this.lastCorrectionWallTimeMs.get(railKey);
      if (lastCorrectionMs !== undefined && issuedAtWallTimeMs - lastCorrectionMs < DRIFT_CORRECTION_COOLDOWN_MS) {
        return {
          action: 'none',
          driftSeconds,
          issuedAtWallTimeMs,
          reason: 'Drift exceeded correction threshold but correction cooldown is active.',
          revision: ++this.correctionRevision,
        };
      }
    }
    const attempts = (this.correctionCounts.get(railKey) ?? 0) + 1;
    this.correctionCounts.set(railKey, attempts);
    if (attempts > MAX_CORRECTION_ATTEMPTS && absoluteDrift >= DRIFT_DEGRADE_THRESHOLD_SECONDS) {
      return {
        action: 'degraded',
        targetSeconds: this.getPlaybackTimeSeconds(),
        driftSeconds,
        issuedAtWallTimeMs,
        reason: `${DRIFT_DEGRADATION_REASON_PREFIX} ${(DRIFT_DEGRADE_THRESHOLD_SECONDS * 1000).toFixed(0)}ms after repeated corrections.`,
        revision: ++this.correctionRevision,
      };
    }
    this.lastCorrectionWallTimeMs.set(railKey, issuedAtWallTimeMs);
    return {
      action: 'seek',
      targetSeconds: this.getPlaybackTimeSeconds(),
      driftSeconds,
      issuedAtWallTimeMs,
      reason: 'Drift exceeded sustained correction threshold.',
      revision: ++this.correctionRevision,
    };
  }
}

function isStreamRuntimeMediaId(id: string): boolean {
  return id.startsWith('stream-visual:') || id.startsWith('stream-audio:');
}
