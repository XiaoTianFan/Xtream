import './control.css';
import { describeLayout } from '../shared/layouts';
import { formatTimecode, getDirectorSeconds } from '../shared/timeline';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import type {
  AudioExtractionFormat,
  AudioSourceState,
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  MediaValidationIssue,
  MeterLaneState,
  OutputMeterReport,
  VisualId,
  VisualLayoutProfile,
  VisualState,
  VirtualOutputId,
  VirtualOutputState,
} from '../shared/types';
import {
  meterLevelPercent,
  METER_DISPLAY_CEIL_DB,
  METER_DISPLAY_FLOOR_DB,
  OUTPUT_BUS_DELAY_MAX_MS,
  playAudioSourcePreview,
  playOutputTestTone,
} from './control/audioRuntime';
import {
  busDbToFaderSliderValue,
  faderMaxSteps,
  faderSliderMax,
  faderSliderMin,
  faderSliderValueToBusDb,
  faderZeroSliderValue,
  quantizeBusFaderDb,
} from './control/busFaderLaw';
import {
  labelCountFromHeight,
  observeElementHeight,
  renderAudioFaderGraticule,
  renderOutputMeterGraticule,
} from './control/graticuleLayout';
import {
  formatAudioChannelDetail,
  formatAudioChannelLabel,
  formatBytes,
  formatDuration,
  formatMilliseconds,
} from './control/formatters';
import {
  createButton,
  createDbFader,
  createHint,
  createSelect,
  createSlider,
  createPanKnob,
  syncSliderProgress,
  setSelectEnabled,
} from './control/dom';
import {
  applyDisplayBlackoutFadeStyle,
  applyVisualStyle,
  createDisplayPreview,
  getPreviewVisualIds,
  syncPreviewElements,
} from './control/displayPreview';
import { elements } from './control/elements';
import { renderIssues as renderIssueList } from './control/issues';
import {
  applyLayoutPrefs,
  getMaxMixerWidth,
  installSplitters,
  readLayoutPrefs,
  restoreTemporaryMixerExpansion,
  setTemporaryMixerWidth,
} from './control/layoutPrefs';
import { createLaunchDashboardController } from './control/launchDashboard';
import { createMediaPoolController } from './control/mediaPool';
import { installShellIcons } from './control/shellIcons';
import { createTransportController } from './control/transportControls';
import type { ControlSurface, SelectedEntity } from './control/types';
import { hasEmbeddedAudioTrack } from './mediaMetadata';

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let previewSyncTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let visualRenderSignature = '';
let audioRenderSignature = '';
let displayRenderSignature = '';
let detailsRenderSignature = '';
let assetPreviewSignature = '';
let surfaceRenderSignature = '';
let activeSurface: ControlSurface = 'patch';
let selectedEntity: SelectedEntity | undefined;
let localPreviewCleanup: (() => void) | undefined;
let soloOutputIds = new Set<VirtualOutputId>();
const latestMeterReports = new Map<VirtualOutputId, OutputMeterReport>();
const meterLaneElementCache = new Map<string, Set<HTMLElement>>();
const meterPeakElementCache = new Map<VirtualOutputId, Set<HTMLElement>>();
const meterLaneSegmentsCache = new WeakMap<HTMLElement, HTMLElement[]>();
const activePanels = new WeakSet<HTMLElement>();
const pendingEmbeddedAudioImportBatches: VisualId[][] = [];
let embeddedAudioImportPromptActive = false;

const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;

const mediaPool = createMediaPoolController({
  getState: () => currentState,
  setSelectedEntity: (entity) => {
    selectedEntity = entity;
  },
  isSelected,
  clearSelectionIf,
  renderState,
  setShowStatus,
  queueEmbeddedAudioImportPrompt,
  probeVisualMetadata,
  createEmbeddedAudioRepresentation,
  extractEmbeddedAudioFile,
});

function renderState(state: DirectorState): void {
  currentState = state;
  pruneMixerSoloOutputIds(state);
  transport.syncTransportInputs(state);
  const nextAudioRenderSignature = createAudioRenderSignature(state);
  const nextVisualRenderSignature = mediaPool.createRenderSignature(state, selectedEntity);
  if (
    !isPanelInteractionActive(elements.visualList) &&
    !isPanelInteractionActive(elements.audioPanel) &&
    visualRenderSignature !== nextVisualRenderSignature
  ) {
    visualRenderSignature = nextVisualRenderSignature;
    mediaPool.render(state);
  }
  if (!isPanelInteractionActive(elements.outputPanel) && audioRenderSignature !== nextAudioRenderSignature) {
    audioRenderSignature = nextAudioRenderSignature;
    renderOutputs(state);
  }
  syncOutputMeters(state);
  const nextDisplayRenderSignature = createDisplayRenderSignature(state);
  if (!isPanelInteractionActive(elements.displayList) && displayRenderSignature !== nextDisplayRenderSignature) {
    displayRenderSignature = nextDisplayRenderSignature;
    renderDisplays(Object.values(state.displays));
  } else {
    syncDisplayCardSummaries(Object.values(state.displays));
  }
  renderDetails(state);
  renderSelectedAssetPreview(state);
  renderIssueList(elements.issueList, combineVisibleIssues(state.readiness.issues, currentIssues));
  renderActiveSurface(state);
  void maybePromptEmbeddedAudioImport(state);
}

function isPanelInteractionActive(panel: HTMLElement): boolean {
  if (activePanels.has(panel)) {
    return true;
  }
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    panel.contains(activeElement) &&
    activeElement.matches('select, input, textarea')
  );
}

function createAudioRenderSignature(state: DirectorState): string {
  return JSON.stringify({
    sources: Object.values(state.audioSources)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => source),
    outputs: Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => ({ ...output, meterDb: undefined, meterLanes: undefined })),
    devices: audioDevices.map((device) => `${device.deviceId}:${device.label}`).join('|'),
    solo: createSoloOutputSignature(state),
  });
}

function createSoloOutputSignature(state = currentState): string {
  return [...soloOutputIds]
    .filter((outputId) => state?.outputs[outputId])
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

function pruneMixerSoloOutputIds(state: DirectorState): void {
  const pruned = [...soloOutputIds].filter((outputId) => state.outputs[outputId]);
  if (pruned.length === soloOutputIds.size) {
    return;
  }
  soloOutputIds = new Set(pruned);
  audioRenderSignature = '';
  void window.xtream.audioRuntime.setSoloOutputIds(pruned);
}

function setMixerSoloOutputIds(outputIds: Iterable<VirtualOutputId>): void {
  const previousSignature = createSoloOutputSignature();
  const nextIds = [...new Set(outputIds)].filter((outputId) => currentState?.outputs[outputId]);
  soloOutputIds = new Set(nextIds);
  const nextSignature = createSoloOutputSignature();
  if (previousSignature !== nextSignature) {
    void window.xtream.audioRuntime.setSoloOutputIds(nextIds);
  }
  if (!currentState) {
    audioRenderSignature = '';
    return;
  }
  audioRenderSignature = createAudioRenderSignature(currentState);
  transport.syncTransportInputs(currentState);
  renderOutputs(currentState);
  syncOutputMeters(currentState);
}

function setShowStatus(message: string, issues: MediaValidationIssue[] = currentIssues): void {
  elements.showStatus.textContent = message;
  currentIssues = issues;
  renderIssueList(elements.issueList, combineVisibleIssues(currentState?.readiness.issues ?? [], currentIssues));
}

function combineVisibleIssues(readinessIssues: MediaValidationIssue[], operationIssues: MediaValidationIssue[]): MediaValidationIssue[] {
  const seen = new Set<string>();
  const combined: MediaValidationIssue[] = [];
  for (const issue of [...readinessIssues, ...operationIssues]) {
    const key = `${issue.severity}:${issue.target}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(issue);
  }
  return combined;
}

function getLiveStateLabel(state: DirectorState): 'LIVE' | 'STANDBY' | 'BLOCKED' | 'DEGRADED' {
  if (state.readiness.issues.some((issue) => issue.severity === 'error')) {
    return 'BLOCKED';
  }
  if (state.readiness.issues.some((issue) => issue.severity === 'warning') || Object.values(state.displays).some((display) => display.health === 'degraded')) {
    return 'DEGRADED';
  }
  return state.paused ? 'STANDBY' : 'LIVE';
}

function renderOutputs(state: DirectorState): void {
  const strips = Object.values(state.outputs).map((output) => createMixerStrip(output, state));
  elements.outputPanel.replaceChildren(...strips);
}

function syncMixerSelection(): void {
  document.querySelectorAll<HTMLElement>('[data-output-strip]').forEach((strip) => {
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

function applyOutputMeterReport(report: OutputMeterReport): void {
  latestMeterReports.set(report.outputId, report);
  for (const lane of report.lanes) {
    const percent = meterLevelPercent(lane.db);
    for (const laneElement of getCachedMeterLaneElements(lane.id)) {
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
  const meter = createOutputMeter(output, state);
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
    setMixerSoloOutputIds(nextSoloOutputIds);
  });
  solo.title = `${isSoloed ? 'Unsolo' : 'Solo'} ${output.label}`;
  solo.setAttribute('aria-label', solo.title);
  solo.setAttribute('aria-pressed', String(isSoloed));
  const mute = createButton('M', output.muted ? 'secondary active' : 'secondary', async () => {
    await window.xtream.outputs.update(output.id, { muted: !output.muted });
    renderState(await window.xtream.director.getState());
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
  strip.addEventListener('click', () => selectEntity({ type: 'output', id: outputId }));
  strip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEntity({ type: 'output', id: outputId });
    }
  });
}

function createMixerStrip(output: VirtualOutputState, state: DirectorState): HTMLElement {
  const strip = document.createElement('article');
  strip.className = `mixer-strip${isSelected('output', output.id) ? ' selected' : ''}${soloOutputIds.has(output.id) ? ' solo' : ''}`;
  strip.dataset.outputStrip = output.id;
  attachMixerStripSelectionHandlers(strip, output.id);
  mountMixerStripContents(strip, output, state);
  return strip;
}

function createOutputDetailMixerStrip(output: VirtualOutputState, state: DirectorState): HTMLElement {
  const strip = document.createElement('article');
  strip.className = `mixer-strip mixer-strip--detail${isSelected('output', output.id) ? ' selected' : ''}${soloOutputIds.has(output.id) ? ' solo' : ''}`;
  strip.dataset.outputStrip = output.id;
  attachMixerStripSelectionHandlers(strip, output.id);
  mountMixerStripContents(strip, output, state);
  return strip;
}

function createOutputMeter(output: VirtualOutputState, state = currentState): HTMLElement {
  const meter = document.createElement('div');
  meter.className = 'output-meter';
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', `${output.label} output meter`);

  const scale = document.createElement('div');
  scale.className = 'output-meter-scale';
  const lanes = document.createElement('div');
  lanes.className = 'output-meter-lanes';
  const laneStates = getOutputMeterLanes(output, state);
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
  /* Row dB is linear; if the meter’s level curve becomes nonlinear, derive row boundaries
   * from the same dB↔visual law as the graticule (`meterLevelPercent` / `meterVisualUToDb`). */
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

function getOutputMeterLanes(output: VirtualOutputState, state = currentState): MeterLaneState[] {
  const reported = latestMeterReports.get(output.id)?.lanes ?? output.meterLanes;
  if (reported && reported.length > 0) {
    return reported;
  }
  return output.sources.flatMap((selection) => {
    const source = state?.audioSources[selection.audioSourceId];
    const channelCount = source?.channelMode === 'left' || source?.channelMode === 'right' ? 1 : Math.max(1, Math.min(8, source?.channelCount ?? 2));
    return Array.from({ length: channelCount }, (_, channelIndex): MeterLaneState => ({
      id: `${output.id}:${selection.audioSourceId}:ch-${channelIndex + 1}`,
      label: formatMeterLaneLabel(source, channelIndex, channelCount),
      audioSourceId: selection.audioSourceId,
      channelIndex,
      db: -60,
      clipped: false,
    }));
  });
}

function formatMeterLaneLabel(source: AudioSourceState | undefined, channelIndex: number, channelCount: number): string {
  if (source?.channelMode === 'left') {
    return 'L';
  }
  if (source?.channelMode === 'right') {
    return 'R';
  }
  if (channelCount === 2) {
    return channelIndex === 0 ? 'L' : 'R';
  }
  return `C${channelIndex + 1}`;
}

function selectEntity(entity: SelectedEntity): void {
  activeSurface = 'patch';
  selectedEntity = entity;
  syncMixerSelection();
  restoreTemporaryMixerExpansion();
  mediaPool.selectEntityPoolTab(entity);
  if (currentState) {
    visualRenderSignature = '';
    renderState(currentState);
  }
}

function setActiveSurface(surface: ControlSurface): void {
  activeSurface = surface;
  surfaceRenderSignature = '';
  if (currentState) {
    renderState(currentState);
  }
}

function clearSelectionIf(entity: SelectedEntity): void {
  if (selectedEntity?.type === entity.type && selectedEntity.id === entity.id) {
    selectedEntity = undefined;
    applyLayoutPrefs(readLayoutPrefs());
  }
}

function isSelected(type: SelectedEntity['type'], id: string): boolean {
  return selectedEntity?.type === type && selectedEntity.id === id;
}

function confirmPoolRecordRemoval(label: string): boolean {
  return window.confirm(
    `Remove "${label}" from the media pool?\n\nThis only removes the project record from the pool. It will not erase or delete the media file from disk.`,
  );
}

function createOutputSourceControls(output: VirtualOutputState, state: DirectorState): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'output-source-list';
  const availableSources = Object.values(state.audioSources).filter(
    (source) => !output.sources.some((selection) => selection.audioSourceId === source.id),
  );
  if (availableSources.length > 0) {
    wrapper.append(
      createSelect(
        'Add source',
        [['', 'Choose source'], ...availableSources.map((source): [string, string] => [source.id, source.label])],
        '',
        (audioSourceId) => {
          if (audioSourceId) {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            void window.xtream.outputs
              .update(output.id, { sources: [...output.sources, { audioSourceId, levelDb: 0, pan: 0 }] })
              .then(async () => {
              const nextState = await window.xtream.director.getState();
              renderState(nextState);
              detailsRenderSignature = '';
              renderDetails(nextState, true);
            });
          }
        },
      ),
    );
  }
  if (output.sources.length === 0) {
    wrapper.append(createHint('No sources selected.'));
  }
  for (const selection of output.sources) {
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
      void window.xtream.outputs.update(output.id, {
        sources: output.sources.map((candidate) =>
          candidate.audioSourceId === selection.audioSourceId ? { ...candidate, levelDb } : candidate,
        ),
      });
    });
    levelControl.classList.add('output-source-level');

    const sourcePan = createPanKnob({
      name: `Pan ${source?.label ?? selection.audioSourceId}`,
      value: selection.pan ?? 0,
      variant: 'row',
      onChange: (pan) => {
        void window.xtream.outputs.update(output.id, {
          sources: output.sources.map((candidate) =>
            candidate.audioSourceId === selection.audioSourceId ? { ...candidate, pan } : candidate,
          ),
        });
      },
    });
    sourcePan.classList.add('output-source-pan');

    const removeButton = createButton('Remove', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, {
        sources: output.sources.filter((candidate) => candidate.audioSourceId !== selection.audioSourceId),
      });
      renderState(await window.xtream.director.getState());
    });
    const soloButton = createButton('S', selection.solo ? 'secondary active' : 'secondary', async () => {
      await window.xtream.outputs.update(output.id, {
        sources: output.sources.map((candidate) =>
          candidate.audioSourceId === selection.audioSourceId ? { ...candidate, solo: !candidate.solo } : candidate,
        ),
      });
      renderState(await window.xtream.director.getState());
    });
    soloButton.title = `${selection.solo ? 'Unsolo' : 'Solo'} ${source?.label ?? selection.audioSourceId}`;
    soloButton.setAttribute('aria-label', soloButton.title);
    soloButton.setAttribute('aria-pressed', String(Boolean(selection.solo)));
    const muteButton = createButton('M', selection.muted ? 'secondary active' : 'secondary', async () => {
      await window.xtream.outputs.update(output.id, {
        sources: output.sources.map((candidate) =>
          candidate.audioSourceId === selection.audioSourceId ? { ...candidate, muted: !candidate.muted } : candidate,
        ),
      });
      renderState(await window.xtream.director.getState());
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
  return wrapper;
}

async function loadAudioDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    audioDevices = [];
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  audioDevices = devices.filter((device) => device.kind === 'audiooutput');
}

async function loadDisplayMonitors(): Promise<void> {
  displayMonitors = await window.xtream.displays.listMonitors();
}

function renderDisplays(displays: DisplayWindowState[]): void {
  elements.displayList.replaceChildren(
    ...displays.map((display) => {
      const card = document.createElement('article');
      card.className = `display-card monitor-card${isSelected('display', display.id) ? ' selected' : ''} ${getDisplayStatusClass(display)}`;
      card.dataset.displayCard = display.id;
      card.tabIndex = 0;
      card.addEventListener('click', () => selectEntity({ type: 'display', id: display.id }));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectEntity({ type: 'display', id: display.id });
        }
      });
      const preview = createDisplayPreview(display, currentState);
      preview.dataset.displayPreview = display.id;
      const overlay = document.createElement('div');
      overlay.className = 'display-overlay';
      const title = document.createElement('strong');
      title.dataset.displayTitle = display.id;
      title.textContent = display.label ?? display.id;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.displayBadge = display.id;
      badge.textContent = getDisplayStatusLabel(display);
      overlay.append(title, badge);
      const telemetry = document.createElement('div');
      telemetry.className = 'display-telemetry';
      telemetry.dataset.displayDetails = display.id;
      telemetry.textContent = getDisplayCardTelemetry(display);
      const remove = createButton('Remove', 'secondary icon-button display-remove', async () => {
        if (confirm(`Remove ${display.id}?`)) {
          await window.xtream.displays.close(display.id);
          await window.xtream.displays.remove(display.id);
          clearSelectionIf({ type: 'display', id: display.id });
          renderState(await window.xtream.director.getState());
        }
      });
      remove.textContent = 'X';
      remove.title = `Remove ${display.id}`;
      remove.setAttribute('aria-label', `Remove ${display.id}`);
      remove.addEventListener('click', (event) => event.stopPropagation());
      card.append(preview, overlay, telemetry, remove);
      return card;
    }),
  );
}

function createDisplayRenderSignature(state: DirectorState): string {
  const displayParts = Object.values(state.displays)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((display) => {
      const visualParts = getPreviewVisualIds(display.layout).map((visualId) => {
        const visual = state.visuals[visualId];
        return `${visualId}:${visual?.type ?? 'missing'}:${visual?.url ?? ''}:${visual?.durationSeconds ?? ''}:${visual?.playbackRate ?? 1}`;
      });
      return `${display.id}:${display.layout.type}:${JSON.stringify(display.layout)}:${visualParts.join(',')}`;
    });
  return `${state.performanceMode ? 'performance' : 'normal'}|${displayParts.join('|')}`;
}

function syncDisplayCardSummaries(displays: DisplayWindowState[]): void {
  for (const display of displays) {
    const card = elements.displayList.querySelector<HTMLElement>(`[data-display-card="${display.id}"]`);
    if (card) {
      card.classList.toggle('selected', isSelected('display', display.id));
      card.classList.remove('display-ready', 'display-standby', 'display-no-signal', 'display-degraded', 'display-closed');
      card.classList.add(getDisplayStatusClass(display));
    }
    const title = elements.displayList.querySelector<HTMLElement>(`[data-display-title="${display.id}"]`);
    if (title) {
      title.textContent = display.label ?? display.id;
    }
    const badge = elements.displayList.querySelector<HTMLElement>(`[data-display-badge="${display.id}"]`);
    if (badge) {
      badge.textContent = getDisplayStatusLabel(display);
    }
    const details = elements.displayList.querySelector<HTMLElement>(`[data-display-details="${display.id}"]`);
    if (details) {
      details.textContent = getDisplayCardTelemetry(display);
    }
    const preview = elements.displayList.querySelector<HTMLElement>(`[data-display-preview="${display.id}"]`);
    if (preview) {
      if (currentState) {
        applyDisplayBlackoutFadeStyle(preview, currentState.globalDisplayBlackoutFadeOutSeconds);
      }
      preview.classList.toggle('blacked-out', Boolean(currentState?.globalDisplayBlackout));
      for (const visualId of getPreviewVisualIds(display.layout)) {
        const visual = currentState?.visuals[visualId];
        if (!visual) {
          continue;
        }
        preview.querySelectorAll<HTMLElement>(`[data-visual-id="${visualId}"] img, [data-visual-id="${visualId}"] video`).forEach((element) => {
          applyVisualStyle(element, visual);
        });
      }
    }
  }
}

function getDisplayStatusLabel(display: DisplayWindowState): string {
  if (display.health === 'closed') {
    return 'Closed';
  }
  if (display.health === 'ready' && getPreviewVisualIds(display.layout).length > 0) {
    return currentState?.paused ? 'Standby' : 'Ready';
  }
  if (display.health === 'degraded' || display.health === 'stale') {
    return 'Degraded';
  }
  return 'No Signal';
}

function getDisplayStatusClass(display: DisplayWindowState): string {
  const label = getDisplayStatusLabel(display).toLowerCase().replace(/\s+/g, '-');
  return `display-${label}`;
}

function getDisplayTelemetry(display: DisplayWindowState): string {
  return `${describeLayout(display.layout)} | drift ${display.lastDriftSeconds?.toFixed(3) ?? '--'}s | raf ${
    display.lastFrameRateFps?.toFixed(1) ?? '--'
  } | video ${display.lastPresentedFrameRateFps?.toFixed(1) ?? '--'}fps | drop ${display.lastDroppedVideoFrames ?? '--'}/${
    display.lastTotalVideoFrames ?? '--'
  } | gap ${display.lastMaxVideoFrameGapMs?.toFixed(0) ?? '--'}ms | seeks ${display.lastMediaSeekCount ?? 0} | ${
    display.fullscreen ? 'fullscreen' : 'windowed'
  } | monitor ${display.displayId ?? 'default'}`;
}

function getDisplayCardTelemetry(display: DisplayWindowState): string {
  return `drift ${formatMilliseconds(display.lastDriftSeconds)} | video ${display.lastPresentedFrameRateFps?.toFixed(1) ?? '--'}fps | drop ${
    display.lastDroppedVideoFrames ?? '--'
  } | gap ${display.lastMaxVideoFrameGapMs?.toFixed(0) ?? '--'}ms | seeks ${display.lastMediaSeekCount ?? 0}`;
}

function createMappingControls(display: DisplayWindowState, visualIds: VisualId[], enabled = true): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'mapping-grid';
  const layoutSelect = createSelect(
    'Layout',
    [
      ['single', 'Single visual'],
      ['split', 'Split visuals'],
    ],
    display.layout.type,
    (value) => {
      const nextLayout: VisualLayoutProfile =
        value === 'split'
          ? { type: 'split', visualIds: getSplitVisuals(display.layout, visualIds) }
          : { type: 'single', visualId: getPrimaryVisual(display.layout, visualIds) };
      void updateDisplayLayout(display.id, nextLayout);
    },
  );
  wrapper.append(layoutSelect);
  setSelectEnabled(layoutSelect, enabled);
  if (display.layout.type === 'single') {
    const visualSelect = createVisualPicker(
      'Visual',
      visualIds,
      display.layout.visualId ?? '',
      (visualId) => void updateDisplayLayout(display.id, { type: 'single', visualId }),
    );
    setVisualPickerEnabled(visualSelect, enabled);
    wrapper.append(visualSelect);
    return wrapper;
  }
  const [leftVisual, rightVisual] = display.layout.visualIds;
  const leftSelect = createVisualPicker('Left visual', visualIds, leftVisual ?? '', (visualId) => {
    void updateDisplayLayout(display.id, { type: 'split', visualIds: [visualId, rightVisual] });
  });
  const rightSelect = createVisualPicker('Right visual', visualIds, rightVisual ?? '', (visualId) => {
    void updateDisplayLayout(display.id, { type: 'split', visualIds: [leftVisual, visualId] });
  });
  setVisualPickerEnabled(leftSelect, enabled);
  setVisualPickerEnabled(rightSelect, enabled);
  wrapper.append(leftSelect, rightSelect);
  return wrapper;
}

function createVisualPicker(labelText: string, visualIds: VisualId[], value: string, onChange: (visualId: string) => void): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'mapping-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'search';
  input.value = value ? (currentState?.visuals[value]?.label ?? value) : '';
  input.placeholder = 'Search visuals';
  const dataList = document.createElement('datalist');
  dataList.id = `visual-picker-${labelText.toLowerCase().replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2)}`;
  for (const visualId of visualIds) {
    const option = document.createElement('option');
    option.value = currentState?.visuals[visualId]?.label ?? visualId;
    option.dataset.visualId = visualId;
    dataList.append(option);
  }
  input.setAttribute('list', dataList.id);
  input.addEventListener('change', () => {
    const query = input.value.trim().toLowerCase();
    const match = visualIds.find((visualId) => {
      const label = currentState?.visuals[visualId]?.label ?? visualId;
      return visualId.toLowerCase() === query || label.toLowerCase() === query;
    });
    if (match) {
      onChange(match);
    }
  });
  field.append(label, input, dataList);
  return field;
}

function setVisualPickerEnabled(wrapper: HTMLDivElement, enabled: boolean): void {
  const input = wrapper.querySelector('input');
  if (input) {
    input.disabled = !enabled;
  }
}

function getPrimaryVisual(layout: VisualLayoutProfile, visualIds: VisualId[]): VisualId | undefined {
  return layout.type === 'single' ? layout.visualId ?? visualIds[0] : layout.visualIds[0] ?? visualIds[0];
}

function getSplitVisuals(layout: VisualLayoutProfile, visualIds: VisualId[]): [VisualId | undefined, VisualId | undefined] {
  if (layout.type === 'split') {
    return layout.visualIds;
  }
  const left = layout.visualId ?? visualIds[0];
  const right = visualIds.find((visualId) => visualId !== left) ?? visualIds[1];
  return [left, right];
}

async function updateDisplayLayout(displayId: string, layout: VisualLayoutProfile): Promise<void> {
  await window.xtream.displays.update(displayId, { layout });
  renderState(await window.xtream.director.getState());
}

function renderDetails(state: DirectorState, force = false): void {
  const signature = JSON.stringify({ selectedEntity, state: createDetailsSignature(state), devices: displayMonitors, audioDevices: audioDevices.length });
  if (!force && detailsRenderSignature === signature) {
    return;
  }
  if (!force && isPanelInteractionActive(elements.detailsContent)) {
    return;
  }
  detailsRenderSignature = signature;
  updateDetailsHeading();
  if (!selectedEntity) {
    renderDefaultDetails(state);
    return;
  }
  if (selectedEntity.type === 'visual') {
    const visual = state.visuals[selectedEntity.id];
    if (!visual) {
      selectedEntity = undefined;
      renderDefaultDetails(state);
      return;
    }
    renderVisualDetails(visual);
    return;
  }
  if (selectedEntity.type === 'audio-source') {
    const source = state.audioSources[selectedEntity.id];
    if (!source) {
      selectedEntity = undefined;
      renderDefaultDetails(state);
      return;
    }
    renderAudioSourceDetails(source, state);
    return;
  }
  if (selectedEntity.type === 'display') {
    const display = state.displays[selectedEntity.id];
    if (!display) {
      selectedEntity = undefined;
      renderDefaultDetails(state);
      return;
    }
    renderDisplayDetails(display, state);
    return;
  }
  const output = state.outputs[selectedEntity.id];
  if (!output) {
    selectedEntity = undefined;
    renderDefaultDetails(state);
    return;
  }
  renderOutputDetails(output, state);
}

function updateDetailsHeading(): void {
  const headingByType: Record<SelectedEntity['type'], string> = {
    visual: 'Visual Details',
    'audio-source': 'Audio Source Details',
    display: 'Display Details',
    output: 'Output Details',
  };
  elements.detailsHeading.textContent = selectedEntity ? headingByType[selectedEntity.type] : 'Patch Summary';
}

function stableDisplayForDetailsSignature(display: DisplayWindowState): Record<string, unknown> {
  return {
    id: display.id,
    label: display.label,
    bounds: display.bounds,
    displayId: display.displayId,
    fullscreen: display.fullscreen,
    alwaysOnTop: display.alwaysOnTop,
    layout: display.layout,
    health: display.health,
    degradationReason: display.degradationReason,
  };
}

function createDetailsSignature(state: DirectorState): unknown {
  const stableDisplays = Object.fromEntries(
    Object.entries(state.displays).map(([id, display]) => [id, stableDisplayForDetailsSignature(display)]),
  );
  const base = {
    visuals: state.visuals,
    audioSources: state.audioSources,
    displays: stableDisplays,
    outputs: Object.fromEntries(Object.entries(state.outputs).map(([id, output]) => [id, { ...output, meterDb: undefined, meterLanes: undefined }])),
  };
  if (selectedEntity?.type === 'display') {
    return { ...base, selectedDisplayLive: state.displays[selectedEntity.id] };
  }
  return base;
}

function renderDefaultDetails(state: DirectorState): void {
  const summary = document.createElement('div');
  summary.className = 'detail-card';
  summary.append(
    createDetailLine('Visuals', String(Object.keys(state.visuals).length)),
    createDetailLine('Audio Sources', String(Object.keys(state.audioSources).length)),
    createDetailLine('Displays', String(Object.keys(state.displays).length)),
    createDetailLine('Outputs', String(Object.keys(state.outputs).length)),
  );
  elements.detailsContent.replaceChildren(summary);
}

function renderActiveSurface(state: DirectorState): void {
  syncRailState();
  const isPatch = activeSurface === 'patch';
  elements.appFrame.classList.toggle('surface-mode', !isPatch);
  elements.workspace.hidden = !isPatch;
  elements.mainFooterSplitter.hidden = !isPatch;
  elements.operatorFooter.hidden = !isPatch;
  elements.surfacePanel.hidden = isPatch;
  if (isPatch) {
    surfaceRenderSignature = '';
    return;
  }

  const signature = JSON.stringify({
    activeSurface,
    readiness: state.readiness,
    counts: {
      visuals: Object.keys(state.visuals).length,
      audioSources: Object.keys(state.audioSources).length,
      displays: Object.keys(state.displays).length,
      outputs: Object.keys(state.outputs).length,
    },
    globals: {
      globalAudioMuted: state.globalAudioMuted,
      globalDisplayBlackout: state.globalDisplayBlackout,
      globalAudioMuteFadeOutSeconds: state.globalAudioMuteFadeOutSeconds,
      globalDisplayBlackoutFadeOutSeconds: state.globalDisplayBlackoutFadeOutSeconds,
      performanceMode: state.performanceMode,
      audioExtractionFormat: state.audioExtractionFormat,
    },
    displays: Object.values(state.displays).map((display) => ({
      id: display.id,
      label: display.label,
      health: display.health,
      lastDriftSeconds: display.lastDriftSeconds,
      lastFrameRateFps: display.lastFrameRateFps,
    })),
    outputs: Object.values(state.outputs).map((output) => ({
      id: output.id,
      label: output.label,
      ready: output.ready,
      physicalRoutingAvailable: output.physicalRoutingAvailable,
      fallbackAccepted: output.fallbackAccepted,
      error: output.error,
    })),
  });
  if (surfaceRenderSignature === signature) {
    return;
  }
  surfaceRenderSignature = signature;

  if (activeSurface === 'cue') {
    renderPlaceholderSurface('Cue', 'Sequential cue control is planned for the cue-system roadmap. This placeholder does not alter show state.');
    return;
  }
  if (activeSurface === 'performance') {
    renderPlaceholderSurface('Performance', 'The live execution and monitoring view is planned. Use Patch for current show operation.');
    return;
  }
  if (activeSurface === 'config') {
    renderConfigSurface(state);
    return;
  }
  renderLogsSurface(state);
}

function syncRailState(): void {
  const railButtons: Record<ControlSurface, HTMLButtonElement> = {
    patch: elements.patchRailButton,
    cue: elements.cueRailButton,
    performance: elements.performanceRailButton,
    config: elements.configRailButton,
    logs: elements.logsRailButton,
  };
  for (const [surface, button] of Object.entries(railButtons) as Array<[ControlSurface, HTMLButtonElement]>) {
    const active = activeSurface === surface;
    button.classList.toggle('active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

function renderPlaceholderSurface(title: string, detail: string): void {
  const card = createSurfaceCard(title);
  card.append(createHint(detail));
  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(card));
}

function renderConfigSurface(state: DirectorState): void {
  const summary = createSurfaceCard('Runtime');
  summary.append(
    createDetailLine('Runtime Version', XTREAM_RUNTIME_VERSION),
    createDetailLine('Readiness', getLiveStateLabel(state)),
    createDetailLine('Global Audio', state.globalAudioMuted ? 'muted' : 'live'),
    createDetailLine('Display Blackout', state.globalDisplayBlackout ? 'active' : 'off'),
    createDetailLine('Performance Mode', state.performanceMode ? 'on' : 'off'),
  );

  const showProject = createSurfaceCard('Show project');
  const formatSelect = createSelect(
    'Extracted Audio Format',
    [
      ['m4a', 'M4A / AAC'],
      ['wav', 'WAV / PCM'],
    ],
    state.audioExtractionFormat,
    (audioExtractionFormat) => {
      void window.xtream.show.updateSettings({ audioExtractionFormat: audioExtractionFormat as AudioExtractionFormat }).then(renderState);
    },
  );
  showProject.append(
    createHint('These options are stored in your show project file (Save Show). They are not global application preferences.'),
    formatSelect,
    createHint('Fade durations apply when toggling audio mute or display blackout from the operator footer (0 = instant).'),
    createNumberDetailControl(
      'Audio mute fade (s)',
      state.globalAudioMuteFadeOutSeconds,
      0,
      10,
      0.05,
      (globalAudioMuteFadeOutSeconds) => window.xtream.show.updateSettings({ globalAudioMuteFadeOutSeconds }),
    ),
    createNumberDetailControl(
      'Display blackout fade (s)',
      state.globalDisplayBlackoutFadeOutSeconds,
      0,
      10,
      0.05,
      (globalDisplayBlackoutFadeOutSeconds) => window.xtream.show.updateSettings({ globalDisplayBlackoutFadeOutSeconds }),
    ),
  );

  const actions = createSurfaceCard('System Actions');
  const actionRow = document.createElement('div');
  actionRow.className = 'button-row';
  actionRow.append(
    createButton('Save Show', 'secondary', () => elements.saveShowButton.click()),
    createButton('Open Show', 'secondary', () => elements.openShowButton.click()),
    createButton('Export Diagnostics', 'secondary', async () => {
      const filePath = await window.xtream.show.exportDiagnostics();
      if (filePath) {
        setShowStatus(`Exported diagnostics: ${filePath}`);
      }
    }),
    createButton('Refresh Outputs', 'secondary', () => elements.refreshOutputsButton.click()),
    createButton('Reset Meters', 'secondary', () => elements.resetMetersButton.click()),
  );
  actions.append(actionRow);

  const topology = createSurfaceCard('Patch Topology');
  topology.append(
    createDetailLine('Visuals', String(Object.keys(state.visuals).length)),
    createDetailLine('Audio Sources', String(Object.keys(state.audioSources).length)),
    createDetailLine('Displays', String(Object.keys(state.displays).length)),
    createDetailLine('Virtual Outputs', String(Object.keys(state.outputs).length)),
  );

  const rawState = createSurfaceCard('Director State', 'wide');
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(state, null, 2);
  rawState.append(pre);

  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(summary, showProject, actions, topology, rawState));
}

function renderLogsSurface(state: DirectorState): void {
  const issues = [...state.readiness.issues, ...currentIssues];
  const issueCard = createSurfaceCard('Readiness Issues');
  if (issues.length === 0) {
    issueCard.append(createHint('No readiness issues reported.'));
  } else {
    const list = document.createElement('ul');
    list.className = 'log-list';
    for (const issue of issues) {
      const item = document.createElement('li');
      item.className = issue.severity === 'error' ? 'warning' : 'hint';
      item.textContent = `${issue.severity.toUpperCase()} ${issue.target}: ${issue.message}`;
      list.append(item);
    }
    issueCard.append(list);
  }

  const displayCard = createSurfaceCard('Display Telemetry');
  const displays = Object.values(state.displays);
  if (displays.length === 0) {
    displayCard.append(createHint('No display windows have been created.'));
  } else {
    for (const display of displays) {
      displayCard.append(createDetailLine(display.label ?? display.id, `${getDisplayStatusLabel(display)} | ${getDisplayTelemetry(display)}`));
    }
  }

  const outputCard = createSurfaceCard('Audio Routing');
  for (const output of Object.values(state.outputs)) {
    outputCard.append(
      createDetailLine(
        output.label,
        `${output.ready ? 'ready' : output.sources.length > 0 ? 'blocked' : 'empty'} | ${output.physicalRoutingAvailable ? 'physical' : 'fallback'} | ${
          output.error ?? 'no errors'
        }`,
      ),
    );
  }

  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(issueCard, displayCard, outputCard));
}

function createSurfaceCard(title: string, className = ''): HTMLElement {
  const card = document.createElement('section');
  card.className = `surface-card ${className}`.trim();
  card.append(createDetailTitle(title));
  return card;
}

function wrapSurfaceGrid(...children: HTMLElement[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'surface-grid';
  grid.append(...children);
  return grid;
}

function renderVisualDetails(visual: VisualState): void {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(visual.label, (nextLabel) => window.xtream.visuals.update(visual.id, { label: nextLabel }));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  toolbarActions.append(
    createButton('Replace', 'secondary', async () => {
      const replaced = await window.xtream.visuals.replace(visual.id);
      if (replaced) {
        queueEmbeddedAudioImportPrompt([replaced]);
        probeVisualMetadata(replaced);
      }
      renderState(await window.xtream.director.getState());
    }),
  );
  const removeFromPool = createButton('Remove', 'secondary', async () => {
    if (!confirmPoolRecordRemoval(visual.label)) {
      return;
    }
    await window.xtream.visuals.remove(visual.id);
    clearSelectionIf({ type: 'visual', id: visual.id });
    renderState(await window.xtream.director.getState());
  });
  removeFromPool.title = `Remove ${visual.label} from the media pool (does not delete the file on disk)`;
  toolbarActions.append(removeFromPool);
  toolbar.append(toolbarStart, toolbarActions);
  card.append(
    toolbar,
    createDetailLine('Type', visual.type),
    createDetailLine('Path', visual.path ?? '--'),
    createDetailLine('Duration', formatDuration(visual.durationSeconds)),
    createDetailLine('Dimensions', visual.width && visual.height ? `${visual.width}x${visual.height}` : '--'),
    createDetailLine('File Size', formatBytes(visual.fileSizeBytes)),
    createDetailLine('Embedded Audio', visual.hasEmbeddedAudio === undefined ? 'unknown' : visual.hasEmbeddedAudio ? 'yes' : 'no'),
    createNumberDetailControl('Opacity', visual.opacity ?? 1, 0, 1, 0.01, (opacity) => window.xtream.visuals.update(visual.id, { opacity })),
    createNumberDetailControl('Brightness', visual.brightness ?? 1, 0, 2, 0.01, (brightness) => window.xtream.visuals.update(visual.id, { brightness })),
    createNumberDetailControl('Contrast', visual.contrast ?? 1, 0, 2, 0.01, (contrast) => window.xtream.visuals.update(visual.id, { contrast })),
    createNumberDetailControl('Playback Rate', visual.playbackRate ?? 1, 0.1, 4, 0.01, (playbackRate) =>
      window.xtream.visuals.update(visual.id, { playbackRate }),
    ),
  );
  elements.detailsContent.replaceChildren(card);
}

function renderAudioSourceDetails(source: AudioSourceState, state: DirectorState): void {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(source.label, (nextLabel) => window.xtream.audioSources.update(source.id, { label: nextLabel }));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  toolbarActions.append(
    ...(source.type === 'external-file'
      ? [
          createButton('Replace', 'secondary', async () => {
            await window.xtream.audioSources.replaceFile(source.id);
            renderState(await window.xtream.director.getState());
          }),
        ]
      : []),
  );
  const removeFromPool = createButton('Remove', 'secondary', async () => {
    if (!confirmPoolRecordRemoval(source.label)) {
      return;
    }
    await window.xtream.audioSources.remove(source.id);
    clearSelectionIf({ type: 'audio-source', id: source.id });
    renderState(await window.xtream.director.getState());
  });
  removeFromPool.title = `Remove ${source.label} from the audio pool (does not delete the file on disk)`;
  toolbarActions.append(removeFromPool);
  toolbar.append(toolbarStart, toolbarActions);
  card.append(
    toolbar,
    createDetailLine('Type', source.type),
    createDetailLine('Path', source.type === 'external-file' ? source.path ?? '--' : state.visuals[source.visualId]?.path ?? source.visualId),
    ...(source.type === 'embedded-visual'
      ? [
          createDetailLine('Extraction', source.extractionMode === 'file' ? `file ${source.extractionStatus ?? 'pending'}` : 'representation'),
          createDetailLine('Extracted File', source.extractedPath ?? '--'),
        ]
      : []),
    createDetailLine('Duration', formatDuration(source.durationSeconds)),
    createDetailLine('Channels', formatAudioChannelDetail(source)),
    createDetailLine('File Size', formatBytes(source.fileSizeBytes)),
    createDetailLine('Readiness', source.ready ? 'ready' : source.error ?? 'loading'),
    createNumberDetailControl('Source Level dB', source.levelDb ?? 0, -60, 12, 1, (levelDb) => window.xtream.audioSources.update(source.id, { levelDb })),
    createNumberDetailControl('Playback Rate', source.playbackRate ?? 1, 0.1, 4, 0.01, (playbackRate) =>
      window.xtream.audioSources.update(source.id, { playbackRate }),
    ),
  );
  elements.detailsContent.replaceChildren(card);
}

function renderDisplayDetails(display: DisplayWindowState, state: DirectorState): void {
  const visualIds = Object.keys(state.visuals);
  const card = document.createElement('div');
  card.className = 'detail-card';
  const labelInput = createLabelInput(display.label ?? display.id, (label) => window.xtream.displays.update(display.id, { label }));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', labelInput));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  const pinOnTop = createButton(display.alwaysOnTop ? 'Normal layer' : 'Always on top', 'secondary', async () => {
    await window.xtream.displays.update(display.id, { alwaysOnTop: !display.alwaysOnTop });
    renderState(await window.xtream.director.getState());
  });
  pinOnTop.title = 'Keep this display window above other application windows';
  toolbarActions.append(
    pinOnTop,
    createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', async () => {
      await window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
      renderState(await window.xtream.director.getState());
    }),
  );
  if (display.health === 'closed') {
    toolbarActions.append(
      createButton('Reopen', 'secondary', async () => {
        await window.xtream.displays.reopen(display.id);
        renderState(await window.xtream.director.getState());
      }),
    );
  } else {
    toolbarActions.append(
      createButton('Close', 'secondary', async () => {
        await window.xtream.displays.close(display.id);
        renderState(await window.xtream.director.getState());
      }),
    );
  }
  toolbarActions.append(
    createButton('Remove', 'secondary', async () => {
      if (confirm(`Remove ${display.id}?`)) {
        await window.xtream.displays.remove(display.id);
        clearSelectionIf({ type: 'display', id: display.id });
        renderState(await window.xtream.director.getState());
      }
    }),
  );
  toolbar.append(toolbarStart, toolbarActions);
  const mapping = createMappingControls(display, visualIds, display.health !== 'closed');
  const monitorSelect = createSelect(
    'Monitor',
    [['', 'Current/default'], ...displayMonitors.map((monitor): [string, string] => [monitor.id, monitor.label])],
    display.displayId ?? '',
    (displayId) => {
      void window.xtream.displays.update(display.id, { displayId: displayId || undefined });
    },
  );
  card.append(
    toolbar,
    createDetailLine('Display', display.id),
    createDetailLine('Status', getDisplayStatusLabel(display)),
    createDetailLine('Telemetry', getDisplayTelemetry(display)),
    mapping,
    monitorSelect,
  );
  elements.detailsContent.replaceChildren(card);
}

function renderOutputDetails(output: VirtualOutputState, state: DirectorState): void {
  const card = document.createElement('div');
  card.className = 'detail-card detail-card--output';
  const label = createLabelInput(output.label, (nextLabel) => window.xtream.outputs.update(output.id, { label: nextLabel }));
  const toolbar = document.createElement('div');
  toolbar.className = 'output-detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'output-detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'output-detail-toolbar-actions button-row';
  toolbarActions.append(
    createButton('Test Tone', 'secondary', () => playOutputTestTone(output)),
    createButton('Remove', 'secondary', async () => {
      if (confirm(`Remove ${output.label}?`)) {
        await window.xtream.outputs.remove(output.id);
        clearSelectionIf({ type: 'output', id: output.id });
        renderState(await window.xtream.director.getState());
      }
    }),
  );
  toolbar.append(toolbarStart, toolbarActions);
  const routingRow = document.createElement('div');
  routingRow.className = 'output-detail-routing-row';
  const physicalLabel = document.createElement('span');
  physicalLabel.className = 'output-detail-routing-label';
  physicalLabel.textContent = 'Physical output';
  const delayLabel = document.createElement('span');
  delayLabel.className = 'output-detail-routing-label';
  delayLabel.textContent = 'Delay Offset (ms)';
  const select = document.createElement('select');
  for (const [optionValue, optionLabel] of getAudioSinkOptions()) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = output.sinkId ?? '';
  select.addEventListener('change', () => {
    const sinkId = select.value;
    const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
    void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel });
  });
  const selectWrap = document.createElement('div');
  selectWrap.className = 'output-detail-routing-select-wrap';
  selectWrap.append(select);
  const delayMs = Math.round((output.outputDelaySeconds ?? 0) * 1000);
  const delayControls = createDelayMsControlsOnly(
    delayMs,
    0,
    OUTPUT_BUS_DELAY_MAX_MS,
    1,
    async (nextMs) => {
      await window.xtream.outputs.update(output.id, { outputDelaySeconds: nextMs / 1000 });
    },
  );
  routingRow.append(physicalLabel, delayLabel, selectWrap, delayControls);
  const sourceControls = createOutputSourceControls(output, state);
  const mainColumn = document.createElement('div');
  mainColumn.className = 'output-detail-main';
  mainColumn.append(routingRow, sourceControls);
  const stripWrap = document.createElement('div');
  stripWrap.className = 'output-detail-strip';
  stripWrap.append(createOutputDetailMixerStrip(output, state));
  const body = document.createElement('div');
  body.className = 'output-detail-body';
  body.append(mainColumn, stripWrap);
  card.append(toolbar, body);
  elements.detailsContent.replaceChildren(card);
}

function createDetailTitle(text: string): HTMLHeadingElement {
  const title = document.createElement('h3');
  title.textContent = text;
  return title;
}

function createDetailLine(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-line';
  const key = document.createElement('span');
  key.textContent = label;
  const val = document.createElement('strong');
  val.textContent = value;
  row.append(key, val);
  return row;
}

function createDetailField(label: string, field: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'detail-field';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text, field);
  return row;
}

function createNumberDetailControl(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onCommit: (value: number) => Promise<unknown>,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'detail-number-control';
  const title = document.createElement('span');
  title.textContent = label;
  const range = createSlider({
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    ariaLabel: label,
  });
  const number = document.createElement('input');
  number.type = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = String(value);
  const commit = (rawValue: string) => {
    const nextValue = Math.min(max, Math.max(min, Number(rawValue)));
    if (!Number.isFinite(nextValue)) {
      return;
    }
    range.value = String(nextValue);
    number.value = String(nextValue);
    syncSliderProgress(range);
    void onCommit(nextValue).then(async () => renderState(await window.xtream.director.getState()));
  };
  range.addEventListener('input', () => {
    number.value = range.value;
  });
  range.addEventListener('change', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));
  wrapper.append(title, range, number);
  return wrapper;
}

/** Range + number only, for the output routing 2×2 layout (headings on the row above). */
function createDelayMsControlsOnly(
  value: number,
  min: number,
  max: number,
  step: number,
  onCommit: (value: number) => Promise<unknown>,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'output-detail-delay-inputs';
  const range = createSlider({
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    ariaLabel: 'Delay Offset (ms)',
  });
  const number = document.createElement('input');
  number.type = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = String(value);
  const commit = (rawValue: string) => {
    const nextValue = Math.min(max, Math.max(min, Number(rawValue)));
    if (!Number.isFinite(nextValue)) {
      return;
    }
    range.value = String(nextValue);
    number.value = String(nextValue);
    syncSliderProgress(range);
    void onCommit(nextValue).then(async () => renderState(await window.xtream.director.getState()));
  };
  range.addEventListener('input', () => {
    number.value = range.value;
  });
  range.addEventListener('change', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));
  wrapper.append(range, number);
  return wrapper;
}

function renderSelectedAssetPreview(state: DirectorState): void {
  const previewableSelection = selectedEntity?.type === 'visual' || selectedEntity?.type === 'audio-source' ? selectedEntity : undefined;
  if (state.performanceMode) {
    assetPreviewSignature = 'performance-mode';
    localPreviewCleanup?.();
    localPreviewCleanup = undefined;
    elements.assetPreview.replaceChildren();
    elements.assetPreviewRegion.hidden = true;
    return;
  }
  const signature = JSON.stringify({
    selectedEntity: previewableSelection,
    visual: selectedEntity?.type === 'visual' ? state.visuals[selectedEntity.id] : undefined,
    audio: selectedEntity?.type === 'audio-source' ? state.audioSources[selectedEntity.id] : undefined,
  });
  if (assetPreviewSignature === signature) {
    return;
  }
  assetPreviewSignature = signature;
  localPreviewCleanup?.();
  localPreviewCleanup = undefined;
  elements.assetPreview.replaceChildren();
  elements.assetPreviewRegion.hidden = !previewableSelection;
  if (!previewableSelection) {
    return;
  }
  if (selectedEntity?.type === 'visual') {
    const visual = state.visuals[selectedEntity.id];
    if (visual) {
      renderVisualAssetPreview(visual);
    }
    return;
  }
  if (selectedEntity?.type === 'audio-source') {
    const source = state.audioSources[selectedEntity.id];
    if (source) {
      renderAudioAssetPreview(source, state);
    }
    return;
  }
}

function renderVisualAssetPreview(visual: VisualState): void {
  const shell = document.createElement('div');
  shell.className = 'asset-preview-shell';
  const title = createDetailTitle(visual.label);
  if (!visual.url) {
    shell.append(title, createHint('No playable URL for this visual.'));
    elements.assetPreview.replaceChildren(shell);
    return;
  }
  if (visual.type === 'image') {
    const image = document.createElement('img');
    image.src = visual.url;
    image.alt = visual.label;
    applyVisualStyle(image, visual);
    shell.append(title, image);
    elements.assetPreview.replaceChildren(shell);
    return;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = visual.url;
  applyVisualStyle(video, visual);
  video.playbackRate = visual.playbackRate ?? 1;
  video.addEventListener('loadedmetadata', () => reportVisualMetadataFromVideo(visual.id, video));
  const controls = createLocalMediaControls(video);
  shell.append(title, video, controls);
  elements.assetPreview.replaceChildren(shell);
  localPreviewCleanup = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}

function probeVisualMetadata(visual: VisualState): void {
  if (!visual.url) {
    return;
  }
  if (visual.type === 'image') {
    const image = new Image();
    image.src = visual.url;
    image.addEventListener('load', () => {
      void window.xtream.visuals.reportMetadata({
        visualId: visual.id,
        width: image.naturalWidth,
        height: image.naturalHeight,
        ready: true,
      });
    });
    image.addEventListener('error', () => {
      void window.xtream.visuals.reportMetadata({ visualId: visual.id, ready: false, error: 'Image failed to load.' });
    });
    return;
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.style.display = 'none';
  video.src = visual.url;
  document.body.append(video);
  const cleanup = () => {
    video.removeAttribute('src');
    video.load();
    video.remove();
  };
  video.addEventListener(
    'loadedmetadata',
    () => {
      reportVisualMetadataFromVideo(visual.id, video);
      cleanup();
    },
    { once: true },
  );
  video.addEventListener(
    'error',
    () => {
      void window.xtream.visuals.reportMetadata({ visualId: visual.id, ready: false, error: video.error?.message ?? 'Video failed to load.' });
      cleanup();
    },
    { once: true },
  );
}

function reportVisualMetadataFromVideo(visualId: VisualId, video: HTMLVideoElement): void {
  void window.xtream.visuals.reportMetadata({
    visualId,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
    width: video.videoWidth || undefined,
    height: video.videoHeight || undefined,
    hasEmbeddedAudio: hasEmbeddedAudioTrack(video),
    ready: true,
  });
}

async function maybePromptEmbeddedAudioImport(state: DirectorState): Promise<void> {
  if (embeddedAudioImportPromptActive || pendingEmbeddedAudioImportBatches.length === 0) {
    return;
  }
  const batch = pendingEmbeddedAudioImportBatches[0];
  const batchVisuals = batch.map((visualId) => state.visuals[visualId]).filter((visual): visual is VisualState => Boolean(visual));
  if (
    batchVisuals.length < batch.length ||
    batchVisuals.some((visual) => !visual.ready && !visual.error)
  ) {
    return;
  }
  const readyAudioVisuals = batchVisuals.filter(
    (visual): visual is VisualState => visual.ready && visual.type === 'video',
  );
  pendingEmbeddedAudioImportBatches.shift();
  if (readyAudioVisuals.length === 0) {
    return;
  }
  embeddedAudioImportPromptActive = true;
  const choice = await window.xtream.show.chooseEmbeddedAudioImport(readyAudioVisuals.map((visual) => visual.label));
  try {
    if (choice === 'representation') {
      for (const visual of readyAudioVisuals) {
        await createEmbeddedAudioRepresentation(visual.id);
      }
    }
    if (choice === 'file') {
      for (const visual of readyAudioVisuals) {
        await extractEmbeddedAudioFile(visual.id);
      }
    }
  } finally {
    embeddedAudioImportPromptActive = false;
  }
}

async function createEmbeddedAudioRepresentation(visualId: VisualId): Promise<void> {
  const source = await window.xtream.audioSources.addEmbedded(visualId, 'representation');
  selectedEntity = { type: 'audio-source', id: source.id };
  renderState(await window.xtream.director.getState());
  setShowStatus(`Created representation audio source for ${source.label}.`);
}

async function extractEmbeddedAudioFile(visualId: VisualId): Promise<void> {
  try {
    const source = await window.xtream.audioSources.extractEmbedded(visualId, currentState?.audioExtractionFormat);
    selectedEntity = { type: 'audio-source', id: source.id };
    renderState(await window.xtream.director.getState());
    const format = source.type === 'embedded-visual' ? source.extractedFormat?.toUpperCase() : undefined;
    setShowStatus(`Extracted embedded audio to ${format ?? 'file'} for ${source.label}.`);
  } catch (error: unknown) {
    renderState(await window.xtream.director.getState());
    setShowStatus(error instanceof Error ? error.message : 'Audio extraction failed.');
  }
}

function renderAudioAssetPreview(source: AudioSourceState, state: DirectorState): void {
  const url =
    source.type === 'external-file'
      ? source.url
      : source.extractionMode === 'file' && source.extractionStatus === 'ready' && source.extractedUrl
        ? source.extractedUrl
        : state.visuals[source.visualId]?.url;
  const shell = document.createElement('div');
  shell.className = 'asset-preview-shell';
  shell.append(createDetailTitle(source.label));
  if (!url) {
    shell.append(createHint('No playable URL for this audio source.'));
    elements.assetPreview.replaceChildren(shell);
    return;
  }
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  const controls = createLocalMediaControls(audio);
  shell.append(audio, controls);
  elements.assetPreview.replaceChildren(shell);
  localPreviewCleanup = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
}

function createLocalMediaControls(media: HTMLMediaElement): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'local-preview-controls';
  const play = createButton('Play', 'secondary', () => {
    if (media.paused) {
      void media.play();
      play.textContent = 'Pause';
    } else {
      media.pause();
      play.textContent = 'Play';
    }
  });
  const scrubber = createSlider({ min: '0', max: '0', step: '0.01', value: '0', ariaLabel: 'Preview scrubber' });
  media.addEventListener('loadedmetadata', () => {
    scrubber.max = Number.isFinite(media.duration) ? String(media.duration) : '0';
    syncSliderProgress(scrubber);
  });
  media.addEventListener('timeupdate', () => {
    if (document.activeElement !== scrubber) {
      scrubber.value = String(media.currentTime);
      syncSliderProgress(scrubber);
    }
  });
  media.addEventListener('pause', () => {
    play.textContent = 'Play';
  });
  scrubber.addEventListener('input', () => {
    media.currentTime = Number(scrubber.value) || 0;
  });
  controls.append(play, scrubber);
  return controls;
}

function tick(): void {
  if (currentState) {
    if (!transport.isTimecodeEditing()) {
      elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState));
    }
    transport.syncTimelineScrubber(currentState);
  }
  animationFrame = window.requestAnimationFrame(tick);
}

function getAudioSinkOptions(): Array<[string, string]> {
  const options: Array<[string, string]> = [['', 'System default output']];
  for (const device of audioDevices) {
    options.push([device.deviceId, device.label || `Audio output ${options.length}`]);
  }
  return options;
}

function createLabelInput(value: string, onCommit: (label: string) => Promise<unknown>): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'label-input';
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => {
    const label = input.value.trim() || value;
    input.value = label;
    void onCommit(label).then(async () => renderState(await window.xtream.director.getState()));
  });
  return input;
}

function installInteractionLock(panel: HTMLElement): void {
  panel.addEventListener('pointerdown', () => activePanels.add(panel));
  const release = () => {
    window.setTimeout(() => activePanels.delete(panel), 0);
  };
  panel.addEventListener('pointerup', release);
  panel.addEventListener('pointercancel', release);
}

const transport = createTransportController({
  getState: () => currentState,
  getSoloOutputCount: () => soloOutputIds.size,
  renderState,
  setShowStatus,
});

const launchDashboard = createLaunchDashboardController({
  renderState,
  setShowStatus,
  clearSelection: () => {
    selectedEntity = undefined;
  },
});

installInteractionLock(elements.visualList);
installInteractionLock(elements.audioPanel);
installInteractionLock(elements.displayList);
installInteractionLock(elements.outputPanel);
installInteractionLock(elements.detailsContent);
elements.runtimeVersionLabel.textContent = `Xtream runtime ${XTREAM_RUNTIME_VERSION}`;
installShellIcons();
installSplitters();
mediaPool.install();
launchDashboard.show();

elements.timecode.tabIndex = 0;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    mediaPool.dismissContextMenu();
  }
});
document.addEventListener('scroll', mediaPool.dismissContextMenu, true);
elements.patchRailButton.addEventListener('click', () => setActiveSurface('patch'));
elements.cueRailButton.addEventListener('click', () => setActiveSurface('cue'));
elements.performanceRailButton.addEventListener('click', () => setActiveSurface('performance'));
elements.configRailButton.addEventListener('click', () => setActiveSurface('config'));
elements.logsRailButton.addEventListener('click', () => setActiveSurface('logs'));
elements.timecode.title = 'Double-click to seek by timecode';
elements.timecode.addEventListener('dblclick', transport.beginTimecodeEdit);
elements.timecode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    transport.beginTimecodeEdit();
  }
});
elements.loopToggleButton.addEventListener('click', () => {
  elements.loopPopover.hidden = !elements.loopPopover.hidden;
  elements.loopToggleButton.setAttribute('aria-expanded', String(!elements.loopPopover.hidden));
});
elements.rateDisplayButton.addEventListener('dblclick', transport.beginRateEdit);
elements.rateDisplayButton.addEventListener('pointerdown', transport.beginRateDrag);
elements.rateDisplayButton.addEventListener('pointermove', transport.updateRateDrag);
elements.rateDisplayButton.addEventListener('pointerup', transport.finishRateDrag);
elements.rateDisplayButton.addEventListener('pointercancel', () => {
  transport.cancelRateDrag();
});
elements.playButton.addEventListener('click', () => void transport.sendTransport({ type: 'play' }));
elements.pauseButton.addEventListener('click', () => void transport.sendTransport({ type: 'pause' }));
elements.stopButton.addEventListener('click', () => void transport.sendTransport({ type: 'stop' }));
elements.timelineScrubber.addEventListener('input', () => syncSliderProgress(elements.timelineScrubber));
elements.timelineScrubber.addEventListener('change', () => {
  void transport.sendTransport({ type: 'seek', seconds: Number(elements.timelineScrubber.value) || 0 });
});
elements.loopActivateButton.addEventListener('click', () => {
  if (!currentState) {
    return;
  }
  void transport.commitLoopDraft(!currentState.loop.enabled);
});
for (const input of [elements.loopStartInput, elements.loopEndInput]) {
  input.addEventListener('input', () => transport.markTransportDraft(input));
  input.addEventListener('change', () => void transport.commitLoopDraft());
}
elements.saveShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.save();
  renderState(result.state);
  setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
});
elements.saveShowAsButton.addEventListener('click', async () => {
  const result = await window.xtream.show.saveAs();
  if (result) {
    renderState(result.state);
    setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
  }
});

function queueEmbeddedAudioImportPrompt(visuals: VisualState[] | undefined): void {
  const videoIds = (visuals ?? []).filter((visual) => visual.type === 'video').map((visual) => visual.id);
  if (videoIds.length > 0) {
    pendingEmbeddedAudioImportBatches.push(videoIds);
  }
}
elements.openShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.open();
  if (result) {
    renderState(result.state);
    setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
    if (launchDashboard.isVisible()) {
      launchDashboard.hide();
    }
  }
});
elements.createShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.createProject();
  if (result) {
    selectedEntity = undefined;
    renderState(result.state);
    setShowStatus(`Created show project: ${result.filePath ?? 'selected folder'}`, result.issues);
    if (launchDashboard.isVisible()) {
      launchDashboard.hide();
    }
  }
});
elements.launchOpenShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.open();
  if (result) {
    launchDashboard.complete(result, `Opened show config: ${result.filePath ?? 'selected file'}`);
    return;
  }
  await launchDashboard.load();
});
elements.launchCreateShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.createProject();
  if (result) {
    launchDashboard.complete(result, `Created show project: ${result.filePath ?? 'selected folder'}`);
    return;
  }
  await launchDashboard.load();
});
elements.launchOpenDefaultButton.addEventListener('click', async () => {
  const result = await window.xtream.show.openDefault();
  launchDashboard.complete(result, `Opened default show: ${result.filePath ?? 'default location'}`);
});
elements.createOutputButton.addEventListener('click', async () => {
  const output = await window.xtream.outputs.create();
  selectedEntity = { type: 'output', id: output.id };
  renderState(await window.xtream.director.getState());
});
elements.refreshOutputsButton.addEventListener('click', async () => {
  await loadAudioDevices();
  renderState(await window.xtream.director.getState());
});
elements.expandMixerButton.addEventListener('click', () => {
  setTemporaryMixerWidth(getMaxMixerWidth());
});
elements.globalAudioMuteButton.addEventListener('click', async () => {
  renderState(await window.xtream.director.updateGlobalState({ globalAudioMuted: !currentState?.globalAudioMuted }));
});
elements.displayBlackoutButton.addEventListener('click', async () => {
  renderState(await window.xtream.director.updateGlobalState({ globalDisplayBlackout: !currentState?.globalDisplayBlackout }));
});
elements.performanceModeButton.addEventListener('click', async () => {
  renderState(await window.xtream.director.updateGlobalState({ performanceMode: !currentState?.performanceMode }));
});
elements.clearSoloButton.addEventListener('click', () => {
  setMixerSoloOutputIds([]);
});
elements.resetMetersButton.addEventListener('click', () => {
  for (const output of Object.values(currentState?.outputs ?? {})) {
    const lanes = getOutputMeterLanes(output).map((lane) => ({ ...lane, db: -60, clipped: false }));
    applyOutputMeterReport({
      outputId: output.id,
      lanes,
      peakDb: -60,
      reportedAtWallTimeMs: Date.now(),
    });
  }
});
elements.createDisplayButton.addEventListener('click', async () => {
  const display = await window.xtream.displays.create({ layout: { type: 'single', visualId: Object.keys(currentState?.visuals ?? {})[0] } });
  selectedEntity = { type: 'display', id: display.id };
  renderState(await window.xtream.director.getState());
});
window.xtream.director.onState(renderState);
window.xtream.audioRuntime.onMeterLanes((report) => {
  if (currentState?.outputs[report.outputId]) {
    currentState.outputs[report.outputId] = {
      ...currentState.outputs[report.outputId],
      meterDb: report.peakDb,
      meterLanes: report.lanes,
    };
  }
  applyOutputMeterReport(report);
});
void window.xtream.renderer.ready({ kind: 'control' });
void launchDashboard.load();
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then(renderState);

animationFrame = window.requestAnimationFrame(tick);
previewSyncTimer = window.setInterval(() => {
  if (currentState) {
    syncPreviewElements(currentState);
  }
}, DISPLAY_PREVIEW_SYNC_INTERVAL_MS);

window.addEventListener('beforeunload', () => {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
  }
  if (previewSyncTimer !== undefined) {
    window.clearInterval(previewSyncTimer);
  }
});
