import type {
  DirectorState,
  MeterLaneState,
  OutputMeterReport,
  VirtualOutputId,
  VirtualOutputSourceSelection,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputState,
} from '../../../shared/types';
import {
  meterLevelPercent,
  METER_DISPLAY_CEIL_DB,
  METER_DISPLAY_FLOOR_DB,
} from '../media/audioRuntime';
import {
  busDbToFaderSliderValue,
  faderMaxSteps,
  faderSliderMax,
  faderSliderMin,
  faderSliderValueToBusDb,
  faderZeroSliderValue,
  quantizeBusFaderDb,
} from '../meters/busFaderLaw';
import { createButton, createDbFader, createHint, createPanKnob, createSelect, createSlider, syncSliderProgress } from '../shared/dom';
import { formatAudioChannelLabel } from '../shared/formatters';
import {
  labelCountFromHeight,
  observeElementHeight,
  renderAudioFaderGraticule,
  renderOutputMeterGraticule,
} from '../meters/graticuleLayout';
import type { SelectedEntity } from '../shared/types';
import { deriveOutputMeterLanes } from './meterLanes';

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
  renderState: (state: DirectorState) => void;
  syncTransportInputs: (state: DirectorState) => void;
  refreshDetails: (state: DirectorState) => void;
};

export function createMixerPanelController(elements: MixerPanelElements, options: MixerPanelControllerOptions): MixerPanelController {
  let soloOutputIds = new Set<VirtualOutputId>();
  const latestMeterReports = new Map<VirtualOutputId, OutputMeterReport>();
  const meterLaneElementCache = new Map<string, Set<HTMLElement>>();
  const meterPeakElementCache = new Map<VirtualOutputId, Set<HTMLElement>>();
  const meterLaneSegmentsCache = new WeakMap<HTMLElement, HTMLElement[]>();

  function createRenderSignature(state: DirectorState): string {
    return JSON.stringify({
      sources: Object.values(state.audioSources)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((source) => source),
      outputs: Object.values(state.outputs)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((output) => ({ ...output, meterDb: undefined, meterLanes: undefined })),
      devices: options.getAudioDevices().map((device) => `${device.deviceId}:${device.label}`).join('|'),
      solo: createSoloOutputSignature(state),
    });
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

  function getSoloOutputCount(): number {
    return soloOutputIds.size;
  }

  function renderOutputs(state: DirectorState): void {
    const strips = Object.values(state.outputs).map((output) => createMixerStrip(output, state));
    elements.outputPanel.replaceChildren(...strips);
  }

  function syncSelection(selectedEntity: SelectedEntity | undefined): void {
    elements.outputPanel.querySelectorAll<HTMLElement>('[data-output-strip]').forEach((strip) => {
      strip.classList.toggle('selected', selectedEntity?.type === 'output' && selectedEntity.id === strip.dataset.outputStrip);
    });
  }

  function syncOutputMeters(state: DirectorState): void {
    for (const output of Object.values(state.outputs)) {
      applyOutputMeterReport({
        outputId: output.id,
        lanes: getOutputMeterLanes(output),
        peakDb: output.meterDb ?? -60,
        reportedAtWallTimeMs: Date.now(),
      });
    }
  }

  function resetMeters(state: DirectorState | undefined): void {
    for (const output of Object.values(state?.outputs ?? {})) {
      const lanes = getOutputMeterLanes(output).map((lane) => ({ ...lane, db: -60, clipped: false }));
      applyOutputMeterReport({
        outputId: output.id,
        lanes,
        peakDb: -60,
        reportedAtWallTimeMs: Date.now(),
      });
    }
  }

  function applyOutputMeterReport(report: OutputMeterReport): void {
    latestMeterReports.set(report.outputId, report);
    const matchedLaneElements = new Set<HTMLElement>();
    for (const lane of report.lanes) {
      const percent = meterLevelPercent(lane.db);
      for (const laneElement of getCachedMeterLaneElements(lane.id)) {
        matchedLaneElements.add(laneElement);
        laneElement.style.setProperty('--meter-level', `${percent}%`);
        laneElement.dataset.state = lane.clipped ? 'clip' : lane.db >= -6 ? 'hot' : 'nominal';
        laneElement.setAttribute('aria-label', `${lane.label} ${lane.db.toFixed(1)} dB`);
        syncMeterLaneSegments(laneElement, percent);
      }
    }
    const strip = elements.outputPanel.querySelector(`[data-output-strip="${report.outputId}"]`);
    if (strip) {
      const domLanes = Array.from(strip.querySelectorAll<HTMLElement>('[data-meter-lane]')).sort((a, b) => {
        const ma = a.dataset.meterLane?.match(/:ch-(\d+)$/);
        const mb = b.dataset.meterLane?.match(/:ch-(\d+)$/);
        return (ma ? Number(ma[1]) : 0) - (mb ? Number(mb[1]) : 0);
      });
      const sortedReportLanes = [...report.lanes].sort((left, right) => left.channelIndex - right.channelIndex);
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
    for (const peak of getCachedMeterPeakElements(report.outputId)) {
      peak.textContent = report.peakDb <= -60 ? '-inf' : `${report.peakDb.toFixed(1)}`;
    }
  }

  function mountMixerStripContents(container: HTMLElement, output: VirtualOutputState, state: DirectorState): void {
    container.replaceChildren();
    const busPan = createPanKnob({
      name: `${output.label} bus pan`,
      value: output.pan ?? 0,
      variant: 'mixer',
      onChange: (pan) => {
        void window.xtream.outputs.update(output.id, { pan });
      },
    });
    const panWrap = document.createElement('div');
    panWrap.className = 'mixer-strip-pan';
    panWrap.append(busPan);
    const db = document.createElement('strong');
    db.className = 'mixer-db';
    db.textContent = `${quantizeBusFaderDb(output.busLevelDb).toFixed(1)} dB`;
    const body = document.createElement('div');
    body.className = 'mixer-strip-body';
    const track = document.createElement('div');
    track.className = 'mixer-strip-track';
    const meter = createOutputMeter(output);
    const fader = createAudioFader(output, (busLevelDb) => {
      db.textContent = `${busLevelDb.toFixed(1)} dB`;
      void window.xtream.outputs.update(output.id, { busLevelDb });
    });
    track.append(meter, fader);
    body.append(track);
    const toggles = document.createElement('div');
    toggles.className = 'mixer-toggles';
    const isSoloed = soloOutputIds.has(output.id);
    const solo = createButton('S', isSoloed ? 'secondary active' : 'secondary', () => {
      const nextSoloOutputIds = new Set(soloOutputIds);
      if (nextSoloOutputIds.has(output.id)) {
        nextSoloOutputIds.delete(output.id);
      } else {
        nextSoloOutputIds.add(output.id);
      }
      setSoloOutputIds(nextSoloOutputIds);
    });
    solo.title = `${isSoloed ? 'Unsolo' : 'Solo'} ${output.label}`;
    solo.setAttribute('aria-label', solo.title);
    solo.setAttribute('aria-pressed', String(isSoloed));
    const mute = createButton('M', output.muted ? 'secondary active' : 'secondary', async () => {
      await window.xtream.outputs.update(output.id, { muted: !output.muted });
      const nextState = await window.xtream.director.getState();
      options.renderState(nextState);
      renderOutputs(nextState);
      syncOutputMeters(nextState);
    });
    mute.title = `${output.muted ? 'Unmute' : 'Mute'} ${output.label}`;
    mute.setAttribute('aria-label', mute.title);
    mute.setAttribute('aria-pressed', String(Boolean(output.muted)));
    toggles.append(solo, mute);
    toggles.addEventListener('click', (event) => event.stopPropagation());
    const label = document.createElement('span');
    label.className = 'mixer-label';
    label.textContent = output.label;
    const status = document.createElement('span');
    status.className = `status-dot ${output.ready ? 'ready' : output.sources.length > 0 ? 'blocked' : 'standby'}`;
    const labelRow = document.createElement('div');
    labelRow.className = 'mixer-label-row';
    labelRow.append(status, label);
    container.append(panWrap, db, body, toggles, labelRow);
  }

  function attachMixerStripSelectionHandlers(strip: HTMLElement, outputId: VirtualOutputId): void {
    strip.tabIndex = 0;
    strip.addEventListener('click', () => options.selectEntity({ type: 'output', id: outputId }));
    strip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.selectEntity({ type: 'output', id: outputId });
      }
    });
  }

  function createMixerStrip(output: VirtualOutputState, state: DirectorState): HTMLElement {
    const strip = document.createElement('article');
    strip.className = `mixer-strip${options.isSelected('output', output.id) ? ' selected' : ''}${soloOutputIds.has(output.id) ? ' solo' : ''}`;
    strip.dataset.outputStrip = output.id;
    attachMixerStripSelectionHandlers(strip, output.id);
    mountMixerStripContents(strip, output, state);
    return strip;
  }

  function createOutputDetailMixerStrip(output: VirtualOutputState, state: DirectorState): HTMLElement {
    const strip = document.createElement('article');
    strip.className = `mixer-strip mixer-strip--detail${options.isSelected('output', output.id) ? ' selected' : ''}${soloOutputIds.has(output.id) ? ' solo' : ''}`;
    strip.dataset.outputStrip = output.id;
    attachMixerStripSelectionHandlers(strip, output.id);
    mountMixerStripContents(strip, output, state);
    return strip;
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

  function createAudioFader(output: VirtualOutputState, onChange: (busLevelDb: number) => void): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'audio-fader';
    const rail = document.createElement('div');
    rail.className = 'audio-fader-rail';
    const cap = document.createElement('div');
    cap.className = 'audio-fader-cap';
    const faderScale = document.createElement('div');
    faderScale.className = 'audio-fader-scale';
    faderScale.setAttribute('aria-hidden', 'true');
    const input = createSlider({
      min: faderSliderMin(),
      max: faderSliderMax(),
      step: '1',
      value: String(busDbToFaderSliderValue(quantizeBusFaderDb(output.busLevelDb))),
      ariaLabel: `${output.label} bus level`,
      className: 'audio-fader-input vertical-slider',
    });
    input.setAttribute('orient', 'vertical');
    syncAudioFaderPosition(wrapper, input);
    input.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.altKey) {
        event.preventDefault();
        const z = faderZeroSliderValue();
        input.value = String(z);
        syncSliderProgress(input);
        syncAudioFaderPosition(wrapper, input);
        onChange(quantizeBusFaderDb(faderSliderValueToBusDb(z)));
      }
    });
    input.addEventListener('input', () => {
      syncAudioFaderPosition(wrapper, input);
      onChange(quantizeBusFaderDb(faderSliderValueToBusDb(Number(input.value))));
    });
    wrapper.append(rail, cap, faderScale, input);
    observeElementHeight(wrapper, (h) => {
      renderAudioFaderGraticule(faderScale, labelCountFromHeight(h));
    });
    return wrapper;
  }

  function syncAudioFaderPosition(wrapper: HTMLElement, input: HTMLInputElement): void {
    const min = Number(input.min || 0);
    const max = Number(input.max || faderMaxSteps());
    const value = Number(input.value || 0);
    const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    wrapper.style.setProperty('--fader-position', `${Math.min(100, Math.max(0, percent))}%`);
  }

  function getOutputMeterLanes(output: VirtualOutputState): MeterLaneState[] {
    const meteringState = options.getMeteringState?.() ?? options.getState();
    const laneOutput = meteringState?.outputs[output.id] ?? output;
    return deriveOutputMeterLanes(laneOutput, meteringState, latestMeterReports.get(output.id));
  }

  async function resolveOutputSourceSelectionId(outputId: VirtualOutputId, selection: VirtualOutputSourceSelection, selectionIndex: number): Promise<string> {
    if (selection.id) {
      return selection.id;
    }
    const currentOutput = (await window.xtream.director.getState()).outputs[outputId];
    const currentSelection = currentOutput?.sources[selectionIndex];
    if (currentSelection?.id) {
      return currentSelection.id;
    }
    throw new Error(`Unable to resolve output source selection for ${selection.audioSourceId}.`);
  }

  async function updateOutputSourceSelection(
    outputId: VirtualOutputId,
    selection: VirtualOutputSourceSelection,
    selectionIndex: number,
    update: VirtualOutputSourceSelectionUpdate,
  ): Promise<VirtualOutputState> {
    const selectionId = await resolveOutputSourceSelectionId(outputId, selection, selectionIndex);
    return window.xtream.outputs.updateSource(outputId, selectionId, update);
  }

  function createOutputSourceControls(output: VirtualOutputState, state: DirectorState): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'output-source-list';
    const availableSources = Object.values(state.audioSources).filter(
      (source) => !output.sources.some((selection) => selection.audioSourceId === source.id),
    );
    const addSourceControl =
      availableSources.length > 0
        ? createSelect(
            'Add source',
            [['', 'Choose source'], ...availableSources.map((source): [string, string] => [source.id, source.label])],
            '',
            (audioSourceId) => {
              if (audioSourceId) {
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
                void window.xtream.outputs
                  .addSource(output.id, audioSourceId)
                  .then(async () => {
                    const nextState = await window.xtream.director.getState();
                    options.renderState(nextState);
                    options.refreshDetails(nextState);
                  });
              }
            },
          )
        : undefined;
    if (output.sources.length === 0) {
      wrapper.append(createHint('No sources selected.'));
    }
    for (const [selectionIndex, selection] of output.sources.entries()) {
      const source = state.audioSources[selection.audioSourceId];
      const row = document.createElement('div');
      row.className = 'output-source-row';

      const sourceInfo = document.createElement('div');
      sourceInfo.className = 'output-source-info';
      const label = document.createElement('strong');
      label.textContent = source?.label ?? selection.audioSourceId;
      label.title = source?.label ?? selection.audioSourceId;
      const meta = document.createElement('small');
      meta.textContent = source ? `${source.type === 'external-file' ? 'file' : 'embedded'}${formatAudioChannelLabel(source)}` : 'missing source';
      sourceInfo.append(label, meta);

      const levelControl = createDbFader('Level dB', selection.levelDb, (levelDb) => {
        void updateOutputSourceSelection(output.id, selection, selectionIndex, { levelDb });
      });
      levelControl.classList.add('output-source-level');

      const sourcePan = createPanKnob({
        name: `Pan ${source?.label ?? selection.audioSourceId}`,
        value: selection.pan ?? 0,
        variant: 'row',
        onChange: (pan) => {
          void updateOutputSourceSelection(output.id, selection, selectionIndex, { pan });
        },
      });
      sourcePan.classList.add('output-source-pan');

      const removeButton = createButton('Remove', 'secondary', async () => {
        await window.xtream.outputs.removeSource(output.id, await resolveOutputSourceSelectionId(output.id, selection, selectionIndex));
        const nextState = await window.xtream.director.getState();
        options.renderState(nextState);
        options.refreshDetails(nextState);
      });
      const soloButton = createButton('S', selection.solo ? 'secondary active' : 'secondary', async () => {
        const nextOutput = await updateOutputSourceSelection(output.id, selection, selectionIndex, { solo: !selection.solo });
        const nextState = await window.xtream.director.getState();
        nextState.outputs[nextOutput.id] = nextOutput;
        options.renderState(nextState);
        options.refreshDetails(nextState);
      });
      soloButton.title = `${selection.solo ? 'Unsolo' : 'Solo'} ${source?.label ?? selection.audioSourceId}`;
      soloButton.setAttribute('aria-label', soloButton.title);
      soloButton.setAttribute('aria-pressed', String(Boolean(selection.solo)));
      const muteButton = createButton('M', selection.muted ? 'secondary active' : 'secondary', async () => {
        const nextOutput = await updateOutputSourceSelection(output.id, selection, selectionIndex, { muted: !selection.muted });
        const nextState = await window.xtream.director.getState();
        nextState.outputs[nextOutput.id] = nextOutput;
        options.renderState(nextState);
        options.refreshDetails(nextState);
      });
      muteButton.title = `${selection.muted ? 'Unmute' : 'Mute'} ${source?.label ?? selection.audioSourceId}`;
      muteButton.setAttribute('aria-label', muteButton.title);
      muteButton.setAttribute('aria-pressed', String(Boolean(selection.muted)));
      const actions = document.createElement('div');
      actions.className = 'button-row compact output-source-actions';
      actions.append(soloButton, muteButton, removeButton);
      const mid = document.createElement('div');
      mid.className = 'output-source-mid';
      mid.append(levelControl, sourcePan);
      row.append(sourceInfo, mid, actions);
      wrapper.append(row);
    }
    if (addSourceControl) {
      wrapper.append(addSourceControl);
    }
    return wrapper;
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
    resetMeters,
    createOutputDetailMixerStrip,
    createOutputSourceControls,
  };
}
