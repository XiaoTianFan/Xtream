import type {
  AudioSourceId,
  DirectorState,
  MeterLaneState,
  OutputMeterReport,
  VirtualOutputId,
  VirtualOutputState,
} from '../../../shared/types';
import {
  meterLevelPercent,
  METER_DISPLAY_CEIL_DB,
  METER_DISPLAY_FLOOR_DB,
} from '../media/audioRuntime';
import {
  DEFAULT_METER_BALLISTICS,
  smoothMeterDb,
  STALE_METER_REPORT_MS,
} from '../meters/meterBallistics';
import { createOutputDetailMixerStrip as createOutputDetailMixerStripElement, createMixerStrip as createMixerStripElement, type MixerStripDeps } from './mixerPanel/mixerStrip';
import {
  labelCountFromHeight,
  observeElementHeight,
  renderOutputMeterGraticule,
} from '../meters/graticuleLayout';
import type { SelectedEntity } from '../shared/types';
import { deriveOutputMeterLanes } from './meterLanes';
import { createOutputSourceControls as createOutputSourceControlsElement } from './mixerPanel/outputSourceControls';
import { createMixerRenderSignature } from './mixerPanel/signatures';

export type MixerPanelController = {
  createRenderSignature: (state: DirectorState) => string;
  pruneSoloOutputIds: (state: DirectorState) => boolean;
  setSoloOutputIds: (outputIds: Iterable<VirtualOutputId>) => void;
  applyEngineSoloOutputIds: (outputIds: VirtualOutputId[]) => void;
  getSoloOutputCount: () => number;
  renderOutputs: (state: DirectorState) => void;
  syncSelection: (selectedEntity: SelectedEntity | undefined) => void;
  syncOutputMeters: (state: DirectorState) => void;
  applyOutputMeterReport: (report: OutputMeterReport) => void;
  tickMeterBallistics: (nowMs: number) => void;
  resetMeters: (state: DirectorState | undefined) => void;
  createOutputDetailMixerStrip: (output: VirtualOutputState, state: DirectorState) => HTMLElement;
  createOutputSourceControls: (output: VirtualOutputState, state: DirectorState) => HTMLElement;
};

export type MixerPanelElements = {
  outputPanel: HTMLDivElement;
};

type MixerPanelControllerOptions = {
  getState: () => DirectorState | undefined;
  /** Patch timeline + routing for metering; defaults to `getState` when omitted. Should match audio renderer projection (e.g. Stream-active derived state). */
  getMeteringState?: () => DirectorState | undefined;
  getAudioDevices: () => MediaDeviceInfo[];
  isSelected: (type: SelectedEntity['type'], id: string) => boolean;
  selectEntity: (entity: SelectedEntity) => void;
  clearSelectionIf?: (entity: SelectedEntity) => void;
  renderState: (state: DirectorState) => void;
  syncTransportInputs: (state: DirectorState) => void;
  refreshDetails: (state: DirectorState) => void;
  setShowStatus?: (message: string) => void;
};

export function createMixerPanelController(elements: MixerPanelElements, options: MixerPanelControllerOptions): MixerPanelController {
  let soloOutputIds = new Set<VirtualOutputId>();
  const latestMeterReports = new Map<VirtualOutputId, OutputMeterReport>();
  const smoothedLaneDb = new Map<string, number>();
  const smoothedPeakDb = new Map<VirtualOutputId, number>();
  let lastSmoothPerfMs: number | undefined;
  const meterLaneElementCache = new Map<string, Set<HTMLElement>>();
  const meterPeakElementCache = new Map<VirtualOutputId, Set<HTMLElement>>();
  const meterLaneSegmentsCache = new WeakMap<HTMLElement, HTMLElement[]>();

  function resolveEffectiveTargets(report: OutputMeterReport, meteringState: DirectorState | undefined): OutputMeterReport {
    const floor = METER_DISPLAY_FLOOR_DB;
    const age = Date.now() - report.reportedAtWallTimeMs;
    if (age <= STALE_METER_REPORT_MS || meteringState === undefined) {
      return report;
    }
    if (meteringState.performanceMode !== true && meteringState.paused !== true) {
      return report;
    }
    return {
      ...report,
      peakDb: floor,
      lanes: report.lanes.map((l) => ({ ...l, db: floor, clipped: false })),
    };
  }

  function pruneSmoothedState(state: DirectorState): void {
    const meteringState = options.getMeteringState?.() ?? state;
    const allowedLaneIds = new Set<string>();
    for (const output of Object.values(state.outputs)) {
      const lanes = deriveOutputMeterLanes(output, meteringState, latestMeterReports.get(output.id));
      for (const lane of lanes) {
        allowedLaneIds.add(lane.id);
      }
    }
    for (const id of smoothedLaneDb.keys()) {
      if (!allowedLaneIds.has(id)) {
        smoothedLaneDb.delete(id);
      }
    }
    const allowedOutputs = new Set(Object.keys(state.outputs));
    for (const id of smoothedPeakDb.keys()) {
      if (!allowedOutputs.has(id)) {
        smoothedPeakDb.delete(id);
      }
    }
  }

  function paintMixerMeterUi(report: OutputMeterReport, lanes: MeterLaneState[], peakDb: number): void {
    const outputId = report.outputId;
    const matchedLaneElements = new Set<HTMLElement>();
    for (const lane of lanes) {
      const percent = meterLevelPercent(lane.db);
      for (const laneElement of getCachedMeterLaneElements(lane.id)) {
        matchedLaneElements.add(laneElement);
        laneElement.style.setProperty('--meter-level', `${percent}%`);
        laneElement.dataset.state = lane.clipped ? 'clip' : lane.db >= -6 ? 'hot' : 'nominal';
        laneElement.setAttribute('aria-label', `${lane.label} ${lane.db.toFixed(1)} dB`);
        syncMeterLaneSegments(laneElement, percent);
      }
    }
    const strip = elements.outputPanel.querySelector(`[data-output-strip="${outputId}"]`);
    if (strip) {
      const domLanes = Array.from(strip.querySelectorAll<HTMLElement>('[data-meter-lane]')).sort((a, b) => {
        const ma = a.dataset.meterLane?.match(/:ch-(\d+)$/);
        const mb = b.dataset.meterLane?.match(/:ch-(\d+)$/);
        return (ma ? Number(ma[1]) : 0) - (mb ? Number(mb[1]) : 0);
      });
      const sortedReportLanes = [...lanes].sort((left, right) => left.channelIndex - right.channelIndex);
      for (let i = 0; i < domLanes.length && i < sortedReportLanes.length; i += 1) {
        const laneElement = domLanes[i];
        if (matchedLaneElements.has(laneElement)) {
          continue;
        }
        const lane = sortedReportLanes[i];
        const percent = meterLevelPercent(lane.db);
        laneElement.style.setProperty('--meter-level', `${percent}%`);
        laneElement.dataset.state = lane.clipped ? 'clip' : lane.db >= -6 ? 'hot' : 'nominal';
        laneElement.setAttribute('aria-label', `${lane.label} ${lane.db.toFixed(1)} dB`);
        syncMeterLaneSegments(laneElement, percent);
      }
    }
    for (const peak of getCachedMeterPeakElements(outputId)) {
      peak.textContent = peakDb <= -60 ? '-inf' : `${peakDb.toFixed(1)}`;
    }
  }

  function smoothStep(nowPerf: number): void {
    const state = options.getState();
    if (!state) {
      return;
    }

    const deltaSec =
      lastSmoothPerfMs === undefined ? 0 : Math.min(0.25, (nowPerf - lastSmoothPerfMs) / 1000);
    lastSmoothPerfMs = nowPerf;

    const meteringState = options.getMeteringState?.() ?? state;

    for (const output of Object.values(state.outputs)) {
      const rawReport = latestMeterReports.get(output.id);
      if (!rawReport) {
        continue;
      }

      const effective = resolveEffectiveTargets(rawReport, meteringState);
      const sortedLanes = [...effective.lanes].sort((left, right) => left.channelIndex - right.channelIndex);

      let prevPeak = smoothedPeakDb.get(output.id);
      if (prevPeak === undefined) {
        prevPeak = effective.peakDb;
      }
      const nextPeak = smoothMeterDb(prevPeak, effective.peakDb, deltaSec, DEFAULT_METER_BALLISTICS);
      smoothedPeakDb.set(output.id, nextPeak);

      const displayLanes: MeterLaneState[] = sortedLanes.map((lane) => {
        let prev = smoothedLaneDb.get(lane.id);
        if (prev === undefined) {
          prev = lane.db;
        }
        const db = smoothMeterDb(prev, lane.db, deltaSec, DEFAULT_METER_BALLISTICS);
        smoothedLaneDb.set(lane.id, db);
        return {
          ...lane,
          db,
          clipped: db >= METER_DISPLAY_CEIL_DB,
        };
      });

      paintMixerMeterUi(rawReport, displayLanes, nextPeak);
    }
  }

  function createRenderSignature(state: DirectorState): string {
    return createMixerRenderSignature(state, options.getAudioDevices(), createSoloOutputSignature(state));
  }

  function createSoloOutputSignature(state = options.getState()): string {
    return [...soloOutputIds]
      .filter((outputId) => state?.outputs[outputId])
      .sort((left, right) => left.localeCompare(right))
      .join('|');
  }

  function pruneSoloOutputIds(state: DirectorState): boolean {
    const pruned = [...soloOutputIds].filter((outputId) => state.outputs[outputId]);
    if (pruned.length === soloOutputIds.size) {
      return false;
    }
    soloOutputIds = new Set(pruned);
    void window.xtream.audioRuntime.setSoloOutputIds(pruned);
    return true;
  }

  function setSoloOutputIds(outputIds: Iterable<VirtualOutputId>): void {
    const previousSignature = createSoloOutputSignature();
    const currentState = options.getState();
    const nextIds = [...new Set(outputIds)].filter((outputId) => currentState?.outputs[outputId]);
    soloOutputIds = new Set(nextIds);
    const nextSignature = createSoloOutputSignature();
    if (previousSignature !== nextSignature) {
      void window.xtream.audioRuntime.setSoloOutputIds(nextIds);
    }
    const state = options.getState();
    if (!state) {
      return;
    }
    options.syncTransportInputs(state);
    renderOutputs(state);
    syncOutputMeters(state);
  }

  function applyEngineSoloOutputIds(outputIds: VirtualOutputId[]): void {
    const state = options.getState();
    if (!state) {
      return;
    }
    const nextIds = [...new Set(outputIds)].filter((outputId) => state.outputs[outputId]);
    const nextSignature = nextIds.slice().sort((left, right) => left.localeCompare(right)).join('|');
    const prevSignature = createSoloOutputSignature(state);
    if (nextSignature === prevSignature) {
      return;
    }
    soloOutputIds = new Set(nextIds);
    options.syncTransportInputs(state);
    renderOutputs(state);
    syncOutputMeters(state);
  }

  async function assignAudioSourceToOutput(outputId: VirtualOutputId, audioSourceId: AudioSourceId): Promise<void> {
    const state = await window.xtream.director.getState();
    const output = state.outputs[outputId];
    if (!output) {
      options.setShowStatus?.('Output no longer exists.');
      return;
    }
    const source = state.audioSources[audioSourceId];
    if (!source) {
      options.setShowStatus?.('Audio source no longer exists.');
      return;
    }
    if (output.sources.some((selection) => selection.audioSourceId === audioSourceId)) {
      options.setShowStatus?.(`${source.label} is already routed to ${output.label}.`);
      return;
    }

    await window.xtream.outputs.addSource(outputId, audioSourceId);
    const nextState = await window.xtream.director.getState();
    options.setShowStatus?.(`Added ${source.label} to ${output.label}.`);
    options.renderState(nextState);
    renderOutputs(nextState);
    options.refreshDetails(nextState);
    syncOutputMeters(nextState);
  }

  function getSoloOutputCount(): number {
    return soloOutputIds.size;
  }

  function createMixerStripDeps(): MixerStripDeps {
    return {
      isSelected: options.isSelected,
      soloOutputIds,
      setSoloOutputIds,
      selectEntity: options.selectEntity,
      clearSelectionIf: options.clearSelectionIf,
      renderState: options.renderState,
      refreshDetails: options.refreshDetails,
      renderOutputs,
      syncOutputMeters,
      createOutputMeter,
      assignAudioSourceToOutput,
      rejectMediaPoolDrop: () => options.setShowStatus?.('Drop an audio source here.'),
    };
  }

  function renderOutputs(state: DirectorState): void {
    pruneSmoothedState(state);
    const strips = Object.values(state.outputs).map((output) => createMixerStripElement(output, createMixerStripDeps()));
    elements.outputPanel.replaceChildren(...strips);
  }

  function syncSelection(selectedEntity: SelectedEntity | undefined): void {
    elements.outputPanel.querySelectorAll<HTMLElement>('[data-output-strip]').forEach((strip) => {
      strip.classList.toggle('selected', selectedEntity?.type === 'output' && selectedEntity.id === strip.dataset.outputStrip);
    });
  }

  function syncMixerStripReadyDots(state: DirectorState): void {
    for (const output of Object.values(state.outputs)) {
      const strip = elements.outputPanel.querySelector<HTMLElement>(`[data-output-strip="${output.id}"]`);
      const dot = strip?.querySelector<HTMLElement>('.status-dot');
      if (!dot) {
        continue;
      }
      dot.className = `status-dot ${output.ready ? 'ready' : output.sources.length > 0 ? 'blocked' : 'standby'}`;
    }
  }

  function syncOutputMeters(state: DirectorState): void {
    const wallMs = Date.now();
    for (const output of Object.values(state.outputs)) {
      latestMeterReports.set(output.id, {
        outputId: output.id,
        lanes: getOutputMeterLanes(output),
        peakDb: output.meterDb ?? -60,
        reportedAtWallTimeMs: wallMs,
      });
    }
    smoothStep(performance.now());
    syncMixerStripReadyDots(state);
  }

  function applyOutputMeterReport(report: OutputMeterReport): void {
    latestMeterReports.set(report.outputId, report);
    smoothStep(performance.now());
  }

  function tickMeterBallistics(nowMs: number): void {
    smoothStep(nowMs);
  }

  function resetMeters(state: DirectorState | undefined): void {
    lastSmoothPerfMs = undefined;
    smoothedLaneDb.clear();
    smoothedPeakDb.clear();
    if (!state) {
      return;
    }
    const meteringState = options.getMeteringState?.() ?? state;
    const wallMs = Date.now();
    for (const output of Object.values(state.outputs)) {
      const lanes = deriveOutputMeterLanes(output, meteringState, undefined).map((lane) => ({
        ...lane,
        db: METER_DISPLAY_FLOOR_DB,
        clipped: false,
      }));
      latestMeterReports.set(output.id, {
        outputId: output.id,
        lanes,
        peakDb: METER_DISPLAY_FLOOR_DB,
        reportedAtWallTimeMs: wallMs,
      });
      for (const lane of lanes) {
        smoothedLaneDb.set(lane.id, METER_DISPLAY_FLOOR_DB);
      }
      smoothedPeakDb.set(output.id, METER_DISPLAY_FLOOR_DB);
      paintMixerMeterUi(latestMeterReports.get(output.id)!, lanes, METER_DISPLAY_FLOOR_DB);
    }
  }

  function createOutputDetailMixerStrip(output: VirtualOutputState, state: DirectorState): HTMLElement {
    void state;
    return createOutputDetailMixerStripElement(output, createMixerStripDeps());
  }

  function createOutputMeter(output: VirtualOutputState): HTMLElement {
    const meter = document.createElement('div');
    meter.className = 'output-meter';
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', `${output.label} output meter`);

    const scale = document.createElement('div');
    scale.className = 'output-meter-scale';
    const lanes = document.createElement('div');
    lanes.className = 'output-meter-lanes';
    const laneStates = getOutputMeterLanes(output);
    lanes.style.setProperty('--meter-lane-count', String(Math.max(1, laneStates.length)));
    for (const laneState of laneStates) {
      lanes.append(createOutputMeterLane(laneState));
    }

    const peak = document.createElement('span');
    peak.className = 'output-meter-peak';
    peak.dataset.meterPeak = output.id;
    peak.textContent = output.meterDb === undefined || output.meterDb <= -60 ? '-inf' : `${output.meterDb.toFixed(1)}`;
    registerMeterPeakElement(output.id, peak);

    meter.append(scale, lanes, peak);
    observeElementHeight(lanes, (h) => {
      renderOutputMeterGraticule(scale, labelCountFromHeight(h));
    });
    return meter;
  }

  function createOutputMeterLane(lane: MeterLaneState): HTMLElement {
    const laneElement = document.createElement('div');
    laneElement.className = 'output-meter-lane';
    laneElement.dataset.meterLane = lane.id;
    laneElement.dataset.state = lane.clipped ? 'clip' : lane.db >= -6 ? 'hot' : 'nominal';
    registerMeterLaneElement(lane.id, laneElement);
    const percent = meterLevelPercent(lane.db);
    laneElement.style.setProperty('--meter-level', `${percent}%`);
    laneElement.setAttribute('role', 'presentation');

    const segments = document.createElement('div');
    segments.className = 'output-meter-segments';
    const segmentElements: HTMLElement[] = [];
    for (let index = 0; index < 20; index += 1) {
      const segment = document.createElement('span');
      segment.dataset.segment = String(index);
      segmentElements.push(segment);
      segments.append(segment);
    }
    meterLaneSegmentsCache.set(laneElement, segmentElements);

    const label = document.createElement('span');
    label.className = 'output-meter-lane-label';
    label.textContent = lane.label;
    laneElement.append(segments, label);
    syncMeterLaneSegments(laneElement, percent);
    return laneElement;
  }

  function syncMeterLaneSegments(laneElement: HTMLElement, percent: number): void {
    const segments = meterLaneSegmentsCache.get(laneElement) ?? Array.from(laneElement.querySelectorAll<HTMLElement>('.output-meter-segments span'));
    const activeCount = Math.round((segments.length * percent) / 100);
    const isClipped = laneElement.dataset.state === 'clip';
    const spanDb = METER_DISPLAY_CEIL_DB - METER_DISPLAY_FLOOR_DB;
    /* Row dB is linear; if the meter's level curve becomes nonlinear, derive row boundaries
     * from the same dB<->visual law as the graticule (`meterLevelPercent` / `meterVisualUToDb`). */
    segments.forEach((segment, index) => {
      const segmentDb =
        METER_DISPLAY_CEIL_DB - (index / Math.max(1, segments.length - 1)) * spanDb;
      /* Row 0 = top = 0 dB; last row = bottom = floor. Light from the bottom up (std. VU). */
      segment.dataset.active = String(index >= segments.length - activeCount);
      segment.dataset.zone = isClipped
        || segmentDb >= -3
        ? 'danger'
        : segmentDb >= -12
          ? 'hot'
          : segmentDb >= -24
            ? 'approaching'
            : 'nominal';
    });
  }

  function registerMeterLaneElement(laneId: string, element: HTMLElement): void {
    const elements = meterLaneElementCache.get(laneId) ?? new Set<HTMLElement>();
    elements.add(element);
    meterLaneElementCache.set(laneId, elements);
  }

  function registerMeterPeakElement(outputId: VirtualOutputId, element: HTMLElement): void {
    const elements = meterPeakElementCache.get(outputId) ?? new Set<HTMLElement>();
    elements.add(element);
    meterPeakElementCache.set(outputId, elements);
  }

  function getCachedMeterLaneElements(laneId: string): HTMLElement[] {
    return getConnectedCachedElements(meterLaneElementCache, laneId);
  }

  function getCachedMeterPeakElements(outputId: VirtualOutputId): HTMLElement[] {
    return getConnectedCachedElements(meterPeakElementCache, outputId);
  }

  function getConnectedCachedElements<Key>(cache: Map<Key, Set<HTMLElement>>, key: Key): HTMLElement[] {
    const elements = cache.get(key);
    if (!elements) {
      return [];
    }
    const connected: HTMLElement[] = [];
    for (const element of elements) {
      if (element.isConnected) {
        connected.push(element);
      } else {
        elements.delete(element);
      }
    }
    if (elements.size === 0) {
      cache.delete(key);
    }
    return connected;
  }

  function getOutputMeterLanes(output: VirtualOutputState): MeterLaneState[] {
    const meteringState = options.getMeteringState?.() ?? options.getState();
    const laneOutput = meteringState?.outputs[output.id] ?? output;
    return deriveOutputMeterLanes(laneOutput, meteringState, latestMeterReports.get(output.id));
  }

  function createOutputSourceControls(output: VirtualOutputState, state: DirectorState): HTMLElement {
    return createOutputSourceControlsElement(output, state, {
      renderState: options.renderState,
      refreshDetails: options.refreshDetails,
    });
  }

  return {
    createRenderSignature,
    pruneSoloOutputIds,
    setSoloOutputIds,
    applyEngineSoloOutputIds,
    getSoloOutputCount,
    renderOutputs,
    syncSelection,
    syncOutputMeters,
    applyOutputMeterReport,
    tickMeterBallistics,
    resetMeters,
    createOutputDetailMixerStrip,
    createOutputSourceControls,
  };
}
