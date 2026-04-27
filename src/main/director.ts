import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type {
  AudioMetadataReport,
  AudioSourceState,
  DirectorState,
  DisplayWindowState,
  DriftReport,
  GlobalStateUpdate,
  PersistedShowConfig,
  PreviewStatus,
  PresetId,
  PresetResult,
  RailCorrection,
  ReadinessIssue,
  TransportCommand,
  VisualImportItem,
  VisualUpdate,
  VisualMetadataReport,
  VisualState,
  VirtualOutputState,
  VirtualOutputUpdate,
} from '../shared/types';
import { getActiveDisplays, getLayoutVisualIds } from '../shared/layouts';
import { getDirectorSeconds } from '../shared/timeline';

const DRIFT_WARN_THRESHOLD_SECONDS = 0.05;
const DRIFT_CORRECTION_THRESHOLD_SECONDS = 0.1;
const DRIFT_DEGRADE_THRESHOLD_SECONDS = 2;
const MAX_CORRECTION_ATTEMPTS = 10;
const DRIFT_DEGRADATION_REASON_PREFIX = 'Rail drift stayed above';

export class Director extends EventEmitter {
  private state: DirectorState;
  private readonly now: () => number;
  private readonly correctionCounts = new Map<string, number>();
  private correctionRevision = 0;
  private visualSequence = 0;
  private audioSourceSequence = 0;
  private outputSequence = 1;

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
    this.state = {
      paused: true,
      rate: 1,
      anchorWallTimeMs: this.now(),
      offsetSeconds: 0,
      loop: { enabled: false, startSeconds: 0 },
      globalAudioMuted: false,
      globalDisplayBlackout: false,
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
    };
  }

  getState(): DirectorState {
    this.refreshReadiness();
    return structuredClone(this.state);
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

  replaceVisual(visualId: string, item: VisualImportItem): VisualState {
    const previous = this.state.visuals[visualId];
    this.state.visuals[visualId] = {
      id: visualId,
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

  clearVisual(visualId: string): VisualState {
    const previous = this.state.visuals[visualId];
    this.state.visuals[visualId] = {
      id: visualId,
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
    this.state.visuals[report.visualId] ??= {
      id: report.visualId,
      label: report.visualId,
      type: 'video',
      ready: false,
    };
    this.state.visuals[report.visualId] = {
      ...this.state.visuals[report.visualId],
      durationSeconds: report.durationSeconds,
      width: report.width,
      height: report.height,
      hasEmbeddedAudio: report.hasEmbeddedAudio,
      fileSizeBytes: this.getFileSizeBytes(this.state.visuals[report.visualId].path),
      ready: report.ready,
      error: report.error,
    };
    for (const source of Object.values(this.state.audioSources)) {
      if (source.type === 'embedded-visual' && source.visualId === report.visualId) {
        source.durationSeconds = report.durationSeconds;
        source.ready = report.ready;
        source.error = report.error;
      }
    }
    if (report.ready && report.hasEmbeddedAudio) {
      this.ensureEmbeddedAudioSource(report.visualId);
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

  addEmbeddedAudioSource(visualId: string): AudioSourceState {
    const id = `audio-source-embedded-${visualId}`;
    const existing = this.state.audioSources[id];
    if (existing) {
      return structuredClone(existing);
    }
    const visual = this.state.visuals[visualId];
    this.state.audioSources[id] = {
      id,
      label: `Embedded Audio ${visual?.label ?? visualId}`,
      type: 'embedded-visual',
      visualId,
      durationSeconds: visual?.durationSeconds,
      playbackRate: 1,
      levelDb: 0,
      fileSizeBytes: visual?.fileSizeBytes,
      ready: Boolean(visual?.ready),
      error: visual?.error,
    };
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.audioSources[id]);
  }

  updateGlobalState(update: GlobalStateUpdate): DirectorState {
    this.state = {
      ...this.state,
      ...update,
    };
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

  updateAudioMetadata(report: AudioMetadataReport): DirectorState {
    const source = this.state.audioSources[report.audioSourceId];
    if (source) {
      this.state.audioSources[report.audioSourceId] = {
        ...source,
        durationSeconds: report.durationSeconds,
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
    this.state.outputs[outputId] = {
      ...output,
      ...update,
      ready: output.ready,
      error: Object.prototype.hasOwnProperty.call(update, 'error') ? update.error : output.error,
    };
    this.updateOutputReadiness();
    this.recalculateTimeline();
    this.emitState();
    return structuredClone(this.state.outputs[outputId]);
  }

  updateOutputMeter(outputId: string, meterDb: number): VirtualOutputState {
    const output = this.state.outputs[outputId];
    if (!output) {
      throw new Error(`Unknown virtual output: ${outputId}`);
    }
    this.state.outputs[outputId] = { ...output, meterDb };
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

  createShowConfig(savedAt = new Date().toISOString()): PersistedShowConfig {
    return {
      schemaVersion: 4,
      savedAt,
      rate: this.state.rate,
      loop: structuredClone(this.state.loop),
      visuals: Object.fromEntries(
        Object.values(this.state.visuals).map((visual) => [
          visual.id,
          {
            id: visual.id,
            label: visual.label,
            type: visual.type,
            path: visual.path,
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
                path: source.path,
                playbackRate: source.playbackRate ?? 1,
                levelDb: source.levelDb ?? 0,
                fileSizeBytes: source.fileSizeBytes,
              }
            : {
                id: source.id,
                label: source.label,
                type: source.type,
                visualId: source.visualId,
                playbackRate: source.playbackRate ?? 1,
                levelDb: source.levelDb ?? 0,
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
            sources: structuredClone(output.sources),
            sinkId: output.sinkId,
            sinkLabel: output.sinkLabel,
            busLevelDb: output.busLevelDb,
            muted: output.muted,
            fallbackAccepted: output.fallbackAccepted,
          },
        ]),
      ),
      displays: Object.values(this.state.displays).map((display) => ({
        id: display.id,
        label: display.label,
        layout: structuredClone(display.layout),
        fullscreen: display.fullscreen,
        displayId: display.displayId,
        bounds: display.bounds,
      })),
    };
  }

  restoreShowConfig(config: PersistedShowConfig, urls: { visuals: Record<string, string | undefined>; audioSources: Record<string, string | undefined> }): DirectorState {
    this.state.paused = true;
    this.state.globalAudioMuted = false;
    this.state.globalDisplayBlackout = false;
    this.state.rate = config.rate ?? 1;
    this.state.anchorWallTimeMs = this.now();
    this.state.offsetSeconds = 0;
    this.state.loop = structuredClone(config.loop);
    this.state.visuals = Object.fromEntries(
      Object.values(config.visuals).map((visual) => [
        visual.id,
        {
          id: visual.id,
          label: visual.label,
          type: visual.type,
          path: visual.path,
          url: urls.visuals[visual.id],
          opacity: visual.opacity ?? 1,
          brightness: visual.brightness ?? 1,
          contrast: visual.contrast ?? 1,
          playbackRate: visual.playbackRate ?? 1,
          fileSizeBytes: visual.fileSizeBytes,
          ready: false,
        } satisfies VisualState,
      ]),
    );
    this.state.audioSources = Object.fromEntries(
      Object.values(config.audioSources).map((source) => [
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
              fileSizeBytes: source.fileSizeBytes,
              ready: false,
            }
          : {
              id: source.id,
              label: source.label,
              type: source.type,
              visualId: source.visualId,
              playbackRate: source.playbackRate ?? 1,
              levelDb: source.levelDb ?? 0,
              fileSizeBytes: source.fileSizeBytes,
              ready: false,
            },
      ]),
    );
    this.state.outputs = Object.fromEntries(
      Object.values(config.outputs).map((output) => [
        output.id,
        {
          id: output.id,
          label: output.label,
          sources: structuredClone(output.sources),
          sinkId: output.sinkId,
          sinkLabel: output.sinkLabel,
          busLevelDb: output.busLevelDb,
          muted: output.muted,
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
    delete this.state.displays[id];
    delete this.state.corrections.displays[id];
    this.correctionCounts.delete(`display:${id}`);
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
      loopRangeLimit: durations.length > 0 ? { startSeconds: 0, endSeconds: Math.min(...durations) } : undefined,
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
        if (!visual?.path) {
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

  private createAudioSourceId(): string {
    let id: string;
    do {
      this.audioSourceSequence += 1;
      id = `audio-source-${this.audioSourceSequence}`;
    } while (this.state.audioSources[id]);
    return id;
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
      sources: sourceId ? [{ audioSourceId: sourceId, levelDb: 0 }] : [],
      busLevelDb: 0,
      ready: false,
      physicalRoutingAvailable: true,
      fallbackAccepted: false,
      fallbackReason: 'none',
    };
  }

  private updateOutputReadiness(): void {
    for (const output of Object.values(this.state.outputs)) {
      const missingSource = output.sources.find((source) => !this.state.audioSources[source.audioSourceId]);
      const unreadySource = output.sources.find((source) => {
        const audioSource = this.state.audioSources[source.audioSourceId];
        return audioSource && !audioSource.ready;
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
    if (absoluteDrift <= DRIFT_WARN_THRESHOLD_SECONDS) {
      this.correctionCounts.set(railKey, 0);
      return { action: 'none', driftSeconds, issuedAtWallTimeMs: this.now(), revision: ++this.correctionRevision };
    }
    if (absoluteDrift <= DRIFT_CORRECTION_THRESHOLD_SECONDS) {
      this.correctionCounts.set(railKey, 0);
      return {
        action: 'none',
        driftSeconds,
        issuedAtWallTimeMs: this.now(),
        reason: 'Drift is above warning threshold but within correction tolerance.',
        revision: ++this.correctionRevision,
      };
    }
    const attempts = (this.correctionCounts.get(railKey) ?? 0) + 1;
    this.correctionCounts.set(railKey, attempts);
    if (attempts > MAX_CORRECTION_ATTEMPTS && absoluteDrift >= DRIFT_DEGRADE_THRESHOLD_SECONDS) {
      return {
        action: 'degraded',
        targetSeconds: this.getPlaybackTimeSeconds(),
        driftSeconds,
        issuedAtWallTimeMs: this.now(),
        reason: `${DRIFT_DEGRADATION_REASON_PREFIX} ${(DRIFT_DEGRADE_THRESHOLD_SECONDS * 1000).toFixed(0)}ms after repeated corrections.`,
        revision: ++this.correctionRevision,
      };
    }
    return {
      action: 'seek',
      targetSeconds: this.getPlaybackTimeSeconds(),
      driftSeconds,
      issuedAtWallTimeMs: this.now(),
      reason: 'Drift exceeded correction threshold.',
      revision: ++this.correctionRevision,
    };
  }
}
