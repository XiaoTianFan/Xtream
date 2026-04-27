import './control.css';
import { describeLayout } from '../shared/layouts';
import { formatTimecode, getDirectorSeconds, getMediaEffectiveTime, parseTimecodeInput } from '../shared/timeline';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import type {
  AudioSourceState,
  AudioSourceId,
  DirectorState,
  DisplayWindowId,
  DisplayMonitorInfo,
  DisplayWindowState,
  MediaValidationIssue,
  MeterLaneState,
  OutputMeterReport,
  TransportCommand,
  VisualId,
  VisualLayoutProfile,
  VisualState,
  VirtualOutputId,
  VirtualOutputState,
} from '../shared/types';
import {
  meterLevelPercent,
  playAudioSourcePreview,
  playOutputTestTone,
} from './control/audioRuntime';
import {
  assertElement,
  createButton,
  createDbFader,
  createHint,
  createPreviewLabel,
  createSelect,
  createSlider,
  syncSliderProgress,
  setSelectEnabled,
} from './control/dom';
import { renderIssues as renderIssueList } from './control/issues';
import { decorateIconButton } from './control/icons';
import { createPlaybackSyncKey, syncTimedMediaElement } from './control/mediaSync';

const elements = {
  appFrame: assertElement(document.querySelector<HTMLDivElement>('.app-frame'), 'appFrame'),
  workspace: assertElement(document.querySelector<HTMLElement>('.workspace'), 'workspace'),
  operatorFooter: assertElement(document.querySelector<HTMLElement>('.operator-footer'), 'operatorFooter'),
  surfacePanel: assertElement(document.querySelector<HTMLElement>('#surfacePanel'), 'surfacePanel'),
  patchRailButton: assertElement(document.querySelector<HTMLButtonElement>('#patchRailButton'), 'patchRailButton'),
  cueRailButton: assertElement(document.querySelector<HTMLButtonElement>('#cueRailButton'), 'cueRailButton'),
  performanceRailButton: assertElement(document.querySelector<HTMLButtonElement>('#performanceRailButton'), 'performanceRailButton'),
  configRailButton: assertElement(document.querySelector<HTMLButtonElement>('#configRailButton'), 'configRailButton'),
  logsRailButton: assertElement(document.querySelector<HTMLButtonElement>('#logsRailButton'), 'logsRailButton'),
  timecode: assertElement(document.querySelector<HTMLDivElement>('#timecode'), 'timecode'),
  showStatus: assertElement(document.querySelector<HTMLDivElement>('#showStatus'), 'showStatus'),
  issueList: assertElement(document.querySelector<HTMLDivElement>('#issueList'), 'issueList'),
  visualList: assertElement(document.querySelector<HTMLDivElement>('#visualList'), 'visualList'),
  audioPanel: assertElement(document.querySelector<HTMLDivElement>('#audioPanel'), 'audioPanel'),
  displayList: assertElement(document.querySelector<HTMLDivElement>('#displayList'), 'displayList'),
  outputPanel: assertElement(document.querySelector<HTMLDivElement>('#outputPanel'), 'outputPanel'),
  workspaceSplitter: assertElement(document.querySelector<HTMLDivElement>('#workspaceSplitter'), 'workspaceSplitter'),
  mainFooterSplitter: assertElement(document.querySelector<HTMLDivElement>('#mainFooterSplitter'), 'mainFooterSplitter'),
  footerSplitter: assertElement(document.querySelector<HTMLDivElement>('#footerSplitter'), 'footerSplitter'),
  assetPreviewSplitter: assertElement(document.querySelector<HTMLDivElement>('#assetPreviewSplitter'), 'assetPreviewSplitter'),
  detailsContent: assertElement(document.querySelector<HTMLDivElement>('#detailsContent'), 'detailsContent'),
  detailsHeading: assertElement(document.querySelector<HTMLHeadingElement>('#detailsHeading'), 'detailsHeading'),
  assetPreviewRegion: assertElement(document.querySelector<HTMLDivElement>('#assetPreviewRegion'), 'assetPreviewRegion'),
  assetPreview: assertElement(document.querySelector<HTMLDivElement>('#assetPreview'), 'assetPreview'),
  liveState: assertElement(document.querySelector<HTMLSpanElement>('#liveState'), 'liveState'),
  playButton: assertElement(document.querySelector<HTMLButtonElement>('#playButton'), 'playButton'),
  pauseButton: assertElement(document.querySelector<HTMLButtonElement>('#pauseButton'), 'pauseButton'),
  stopButton: assertElement(document.querySelector<HTMLButtonElement>('#stopButton'), 'stopButton'),
  loopToggleButton: assertElement(document.querySelector<HTMLButtonElement>('#loopToggleButton'), 'loopToggleButton'),
  rateDisplayButton: assertElement(document.querySelector<HTMLButtonElement>('#rateDisplayButton'), 'rateDisplayButton'),
  timelineScrubber: assertElement(document.querySelector<HTMLInputElement>('#timelineScrubber'), 'timelineScrubber'),
  timelineSummaryPrimary: assertElement(document.querySelector<HTMLDivElement>('#timelineSummaryPrimary'), 'timelineSummaryPrimary'),
  timelineLoopLimitLine: assertElement(document.querySelector<HTMLDivElement>('#timelineLoopLimitLine'), 'timelineLoopLimitLine'),
  loopStartInput: assertElement(document.querySelector<HTMLInputElement>('#loopStartInput'), 'loopStartInput'),
  loopEndInput: assertElement(document.querySelector<HTMLInputElement>('#loopEndInput'), 'loopEndInput'),
  loopActivateButton: assertElement(document.querySelector<HTMLButtonElement>('#loopActivateButton'), 'loopActivateButton'),
  loopPopover: assertElement(document.querySelector<HTMLDivElement>('#loopPopover'), 'loopPopover'),
  visualTabButton: assertElement(document.querySelector<HTMLButtonElement>('#visualTabButton'), 'visualTabButton'),
  audioTabButton: assertElement(document.querySelector<HTMLButtonElement>('#audioTabButton'), 'audioTabButton'),
  poolSearchInput: assertElement(document.querySelector<HTMLInputElement>('#poolSearchInput'), 'poolSearchInput'),
  poolSortSelect: assertElement(document.querySelector<HTMLSelectElement>('#poolSortSelect'), 'poolSortSelect'),
  saveShowButton: assertElement(document.querySelector<HTMLButtonElement>('#saveShowButton'), 'saveShowButton'),
  saveShowAsButton: assertElement(document.querySelector<HTMLButtonElement>('#saveShowAsButton'), 'saveShowAsButton'),
  openShowButton: assertElement(document.querySelector<HTMLButtonElement>('#openShowButton'), 'openShowButton'),
  exportDiagnosticsButton: assertElement(document.querySelector<HTMLButtonElement>('#exportDiagnosticsButton'), 'exportDiagnosticsButton'),
  addVisualsButton: assertElement(document.querySelector<HTMLButtonElement>('#addVisualsButton'), 'addVisualsButton'),
  createOutputButton: assertElement(document.querySelector<HTMLButtonElement>('#createOutputButton'), 'createOutputButton'),
  refreshOutputsButton: assertElement(document.querySelector<HTMLButtonElement>('#refreshOutputsButton'), 'refreshOutputsButton'),
  clearSoloButton: assertElement(document.querySelector<HTMLButtonElement>('#clearSoloButton'), 'clearSoloButton'),
  resetMetersButton: assertElement(document.querySelector<HTMLButtonElement>('#resetMetersButton'), 'resetMetersButton'),
  globalAudioMuteButton: assertElement(document.querySelector<HTMLButtonElement>('#globalAudioMuteButton'), 'globalAudioMuteButton'),
  displayBlackoutButton: assertElement(document.querySelector<HTMLButtonElement>('#displayBlackoutButton'), 'displayBlackoutButton'),
  performanceModeButton: assertElement(document.querySelector<HTMLButtonElement>('#performanceModeButton'), 'performanceModeButton'),
  runtimeVersionLabel: assertElement(document.querySelector<HTMLSpanElement>('#runtimeVersionLabel'), 'runtimeVersionLabel'),
  createDisplayButton: assertElement(document.querySelector<HTMLButtonElement>('#createDisplayButton'), 'createDisplayButton'),
};

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
let timecodeEditor: HTMLInputElement | undefined;
let activePoolTab: 'visuals' | 'audio' = 'visuals';
let activeSurface: ControlSurface = 'patch';
let poolSearchQuery = '';
let poolSort: 'label' | 'duration' | 'status' = 'label';
let selectedEntity: SelectedEntity | undefined;
let localPreviewCleanup: (() => void) | undefined;
let rateDragStart: { clientX: number; rate: number } | undefined;
let soloOutputIds = new Set<VirtualOutputId>();
const latestMeterReports = new Map<VirtualOutputId, OutputMeterReport>();
const meterLaneElementCache = new Map<string, Set<HTMLElement>>();
const meterPeakElementCache = new Map<VirtualOutputId, Set<HTMLElement>>();
const meterLaneSegmentsCache = new WeakMap<HTMLElement, HTMLElement[]>();
let activeAudioSourceMenu: HTMLElement | undefined;
const activePanels = new WeakSet<HTMLElement>();

type SelectedEntity =
  | { type: 'visual'; id: VisualId }
  | { type: 'audio-source'; id: AudioSourceId }
  | { type: 'display'; id: DisplayWindowId }
  | { type: 'output'; id: VirtualOutputId };

type ControlSurface = 'patch' | 'cue' | 'performance' | 'config' | 'logs';

const UI_PREF_KEY = 'xtream.control.layout.v1';
const DISPLAY_PREVIEW_MAX_WIDTH = 854;
const DISPLAY_PREVIEW_MAX_HEIGHT = 480;
const DISPLAY_PREVIEW_MIN_FRAME_INTERVAL_MS = 1000 / 15;
const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;
const displayPreviewCanvases = new WeakMap<HTMLVideoElement, { canvas: HTMLCanvasElement; lastDrawMs: number }>();

type LayoutPrefs = {
  mediaWidthPx?: number;
  footerHeightPx?: number;
  mixerWidthPx?: number;
  assetPreviewHeightPx?: number;
};

const transportDraftElements = new Set<HTMLInputElement>([elements.loopStartInput, elements.loopEndInput]);

function renderState(state: DirectorState): void {
  currentState = state;
  pruneMixerSoloOutputIds(state);
  syncTransportInputs(state);
  const nextAudioRenderSignature = createAudioRenderSignature(state);
  const nextVisualRenderSignature = `${createVisualRenderSignature(state)}:${activePoolTab}:${poolSearchQuery}:${poolSort}:${selectedEntity?.type}:${selectedEntity?.id}`;
  if (
    !isPanelInteractionActive(elements.visualList) &&
    !isPanelInteractionActive(elements.audioPanel) &&
    visualRenderSignature !== nextVisualRenderSignature
  ) {
    visualRenderSignature = nextVisualRenderSignature;
    renderMediaPool(state);
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
  renderIssueList(elements.issueList, [...state.readiness.issues, ...currentIssues]);
  renderActiveSurface(state);
}

function isPanelInteractionActive(panel: HTMLElement): boolean {
  const activeElement = document.activeElement;
  return activePanels.has(panel) || (activeElement instanceof HTMLElement && panel.contains(activeElement) && activeElement.matches('select, input, textarea'));
}

function createVisualRenderSignature(state: DirectorState): string {
  return JSON.stringify(
    Object.values(state.visuals)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((visual) => ({
        id: visual.id,
        label: visual.label,
        type: visual.type,
        path: visual.path,
        url: visual.url,
        ready: visual.ready,
        error: visual.error,
        durationSeconds: visual.durationSeconds,
        width: visual.width,
        height: visual.height,
        hasEmbeddedAudio: visual.hasEmbeddedAudio,
        opacity: visual.opacity,
        brightness: visual.brightness,
        contrast: visual.contrast,
        playbackRate: visual.playbackRate,
        fileSizeBytes: visual.fileSizeBytes,
      })),
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
  syncTransportInputs(currentState);
  renderOutputs(currentState);
  syncOutputMeters(currentState);
}

function setShowStatus(message: string, issues: MediaValidationIssue[] = currentIssues): void {
  elements.showStatus.textContent = message;
  currentIssues = issues;
  renderIssueList(elements.issueList, [...(currentState?.readiness.issues ?? []), ...currentIssues]);
}

function syncTransportInputs(state: DirectorState): void {
  elements.playButton.disabled = !state.readiness.ready;
  elements.rateDisplayButton.textContent = `${state.rate.toFixed(2)}x`;
  const liveState = getLiveStateLabel(state);
  elements.liveState.textContent = liveState;
  elements.liveState.dataset.state = liveState.toLowerCase();
  elements.loopToggleButton.classList.toggle('active', state.loop.enabled);
  elements.loopToggleButton.setAttribute('aria-expanded', String(!elements.loopPopover.hidden));
  elements.loopActivateButton.textContent = state.loop.enabled ? 'Deactivate' : 'Activate';
  elements.loopActivateButton.setAttribute('aria-pressed', String(state.loop.enabled));
  elements.loopActivateButton.classList.toggle('active', state.loop.enabled);
  elements.loopActivateButton.title = state.loop.enabled ? 'Turn loop playback off' : 'Turn loop playback on';
  if (!isTransportDraftActive(elements.loopStartInput)) {
    elements.loopStartInput.value = formatTimecode(state.loop.startSeconds);
  }
  if (!isTransportDraftActive(elements.loopEndInput)) {
    elements.loopEndInput.value = state.loop.endSeconds === undefined ? '' : formatTimecode(state.loop.endSeconds);
  }
  elements.showStatus.textContent = state.readiness.ready
    ? 'Show readiness: ready'
    : `Show readiness: blocked by ${state.readiness.issues.filter((issue) => issue.severity === 'error').length} issue(s)`;
  elements.globalAudioMuteButton.classList.toggle('active', state.globalAudioMuted);
  elements.globalAudioMuteButton.textContent = state.globalAudioMuted ? 'Audio Muted' : 'Audio Mute';
  elements.globalAudioMuteButton.setAttribute('aria-pressed', String(state.globalAudioMuted));
  elements.clearSoloButton.disabled = soloOutputIds.size === 0;
  elements.clearSoloButton.classList.toggle('active', soloOutputIds.size > 0);
  elements.clearSoloButton.setAttribute('aria-pressed', String(soloOutputIds.size > 0));
  elements.clearSoloButton.title = soloOutputIds.size > 0 ? 'Clear all soloed outputs' : 'No soloed outputs';
  elements.displayBlackoutButton.classList.toggle('active', state.globalDisplayBlackout);
  elements.displayBlackoutButton.textContent = state.globalDisplayBlackout ? 'Display Blackout On' : 'Display Blackout';
  elements.displayBlackoutButton.setAttribute('aria-pressed', String(state.globalDisplayBlackout));
  elements.performanceModeButton.classList.toggle('active', state.performanceMode);
  elements.performanceModeButton.textContent = state.performanceMode ? 'Performance Mode On' : 'Performance Mode';
  elements.performanceModeButton.setAttribute('aria-pressed', String(state.performanceMode));
  elements.performanceModeButton.title = state.performanceMode
    ? 'Performance mode disables control-window video previews and live meter sampling.'
    : 'Disable control-window preview and meter workloads for weaker playback machines.';
  syncTimelineScrubber(state);
}

function syncTimelineScrubber(state: DirectorState): void {
  const duration = state.activeTimeline.durationSeconds;
  const currentSeconds = getDirectorSeconds(state);
  if (duration === undefined) {
    elements.timelineScrubber.disabled = true;
    elements.timelineScrubber.max = '0';
    elements.timelineScrubber.value = '0';
    elements.timelineSummaryPrimary.textContent = 'No active timeline duration';
    elements.timelineLoopLimitLine.textContent = '';
    elements.timelineLoopLimitLine.hidden = true;
    elements.timelineScrubber.style.setProperty('--progress', '0%');
    elements.timelineScrubber.style.removeProperty('--loop-start');
    elements.timelineScrubber.style.removeProperty('--loop-end');
    return;
  }
  elements.timelineScrubber.disabled = false;
  elements.timelineScrubber.max = String(duration);
  if (document.activeElement !== elements.timelineScrubber) {
    elements.timelineScrubber.value = String(Math.min(currentSeconds, duration));
  }
  elements.timelineScrubber.style.setProperty('--progress', `${Math.min(100, Math.max(0, (currentSeconds / duration) * 100))}%`);
  if (state.loop.enabled) {
    elements.timelineScrubber.style.setProperty('--loop-start', `${Math.min(100, Math.max(0, (state.loop.startSeconds / duration) * 100))}%`);
    elements.timelineScrubber.style.setProperty(
      '--loop-end',
      `${Math.min(100, Math.max(0, ((state.loop.endSeconds ?? duration) / duration) * 100))}%`,
    );
  } else {
    elements.timelineScrubber.style.removeProperty('--loop-start');
    elements.timelineScrubber.style.removeProperty('--loop-end');
  }
  const loopLimit = state.activeTimeline.loopRangeLimit;
  elements.timelineSummaryPrimary.textContent = `Timeline ${formatTimecode(Math.min(currentSeconds, duration))} / ${formatTimecode(duration)}`;
  if (loopLimit) {
    elements.timelineLoopLimitLine.textContent = `loop range limit: ${formatTimecode(loopLimit.startSeconds)}-${formatTimecode(loopLimit.endSeconds)}`;
    elements.timelineLoopLimitLine.hidden = false;
  } else {
    elements.timelineLoopLimitLine.textContent = '';
    elements.timelineLoopLimitLine.hidden = true;
  }
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

function isTransportDraftActive(input: HTMLInputElement): boolean {
  return document.activeElement === input || (transportDraftElements.has(input) && input.dataset.dirty === 'true');
}

function renderMediaPool(state: DirectorState): void {
  syncPoolTabs();
  const rows =
    activePoolTab === 'visuals'
      ? getFilteredVisuals(Object.values(state.visuals)).map((visual) => createVisualRow(visual))
      : getFilteredAudioSources(Object.values(state.audioSources), state).map((source) => createAudioSourceRow(source, state));
  elements.visualList.classList.toggle('drop-target', activePoolTab === 'visuals');
  if (activePoolTab === 'audio') {
    elements.visualList.hidden = true;
    elements.audioPanel.hidden = false;
    elements.audioPanel.replaceChildren(...(rows.length > 0 ? rows : [createHint('No audio sources match this filter.')]));
  } else {
    elements.visualList.hidden = false;
    elements.audioPanel.hidden = true;
    elements.visualList.replaceChildren(...(rows.length > 0 ? rows : [createHint('No visuals match this filter.')]));
    elements.audioPanel.replaceChildren();
  }
}

function createVisualRow(visual: VisualState): HTMLElement {
  const row = document.createElement('article');
  row.className = `asset-row${isSelected('visual', visual.id) ? ' selected' : ''}`;
  row.tabIndex = 0;
  row.dataset.assetId = visual.id;
  row.addEventListener('click', () => selectEntity({ type: 'visual', id: visual.id }));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEntity({ type: 'visual', id: visual.id });
    }
  });
  const status = document.createElement('span');
  status.className = `status-dot ${visual.ready ? 'ready' : visual.error ? 'blocked' : 'standby'}`;
  const label = document.createElement('strong');
  label.textContent = visual.label;
  const meta = document.createElement('span');
  meta.className = 'asset-meta';
  meta.textContent = `${visual.type} | ${formatDuration(visual.durationSeconds)} | ${visual.width && visual.height ? `${visual.width}x${visual.height}` : 'size --'}`;
  const remove = createButton('Remove', 'secondary row-action', async () => {
    if (!confirmPoolRecordRemoval(visual.label)) {
      return;
    }
    await window.xtream.visuals.remove(visual.id);
    clearSelectionIf({ type: 'visual', id: visual.id });
    renderState(await window.xtream.director.getState());
  });
  decorateIconButton(remove, 'X', `Remove ${visual.label} from pool`);
  remove.addEventListener('click', (event) => event.stopPropagation());
  row.append(status, label, meta, remove);
  return row;
}

function createAudioSourceRow(source: AudioSourceState, state: DirectorState): HTMLElement {
  const row = document.createElement('article');
  row.className = `asset-row${isSelected('audio-source', source.id) ? ' selected' : ''}`;
  row.tabIndex = 0;
  row.addEventListener('click', () => selectEntity({ type: 'audio-source', id: source.id }));
  row.addEventListener('contextmenu', (event) => showAudioSourceContextMenu(event, source));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEntity({ type: 'audio-source', id: source.id });
    }
  });
  const status = document.createElement('span');
  status.className = `status-dot ${source.ready ? 'ready' : source.error ? 'blocked' : 'standby'}`;
  const label = document.createElement('strong');
  label.textContent = source.label;
  const origin = source.type === 'external-file' ? source.path ?? 'External file' : `Embedded from ${state.visuals[source.visualId]?.label ?? source.visualId}`;
  const meta = document.createElement('span');
  meta.className = 'asset-meta';
  meta.textContent = `${source.type === 'external-file' ? 'file' : 'embedded'}${formatAudioChannelLabel(source)} | ${formatDuration(source.durationSeconds)} | ${origin}`;
  const remove = createButton('Remove', 'secondary row-action', async () => {
    if (!confirmPoolRecordRemoval(source.label)) {
      return;
    }
    await window.xtream.audioSources.remove(source.id);
    clearSelectionIf({ type: 'audio-source', id: source.id });
    renderState(await window.xtream.director.getState());
  });
  decorateIconButton(remove, 'X', `Remove ${source.label} from pool`);
  remove.addEventListener('click', (event) => event.stopPropagation());
  row.append(status, label, meta, remove);
  return row;
}

function confirmPoolRecordRemoval(label: string): boolean {
  return window.confirm(
    `Remove "${label}" from the media pool?\n\nThis only removes the project record from the pool. It will not erase or delete the media file from disk.`,
  );
}

function showAudioSourceContextMenu(event: MouseEvent, source: AudioSourceState): void {
  event.preventDefault();
  event.stopPropagation();
  dismissAudioSourceContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu audio-source-menu';
  menu.setAttribute('role', 'menu');
  const splitButton = createButton('Split to mono', 'secondary context-menu-item', async () => {
    dismissAudioSourceContextMenu();
    try {
      const [left] = await window.xtream.audioSources.splitStereo(source.id);
      selectedEntity = { type: 'audio-source', id: left.id };
      renderState(await window.xtream.director.getState());
      setShowStatus(`Split ${source.label} into virtual L/R mono sources.`);
    } catch (error: unknown) {
      setShowStatus(error instanceof Error ? error.message : 'Unable to split this audio source.');
    }
  });
  splitButton.setAttribute('role', 'menuitem');
  if (source.derivedFromAudioSourceId || source.channelMode === 'left' || source.channelMode === 'right' || source.channelCount === 1) {
    splitButton.disabled = true;
    splitButton.title = source.channelCount === 1 ? 'Mono sources cannot be split.' : 'This source is already a mono channel.';
  }
  menu.append(splitButton);
  document.body.append(menu);
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - menuBounds.width - 4)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - menuBounds.height - 4)}px`;
  activeAudioSourceMenu = menu;
}

function dismissAudioSourceContextMenu(): void {
  activeAudioSourceMenu?.remove();
  activeAudioSourceMenu = undefined;
}

function renderOutputs(state: DirectorState): void {
  clearMeterElementCaches();
  const strips = Object.values(state.outputs).map((output) => createMixerStrip(output));
  const addStrip = createButton('Add Output', 'secondary mixer-add-strip', async () => {
    const output = await window.xtream.outputs.create();
    selectedEntity = { type: 'output', id: output.id };
    renderState(await window.xtream.director.getState());
  });
  elements.outputPanel.replaceChildren(...strips, addStrip);
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

function createMixerStrip(output: VirtualOutputState, state = currentState): HTMLElement {
  const strip = document.createElement('article');
  strip.className = `mixer-strip${isSelected('output', output.id) ? ' selected' : ''}${soloOutputIds.has(output.id) ? ' solo' : ''}`;
  strip.dataset.outputStrip = output.id;
  strip.tabIndex = 0;
  strip.addEventListener('click', () => selectEntity({ type: 'output', id: output.id }));
  strip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEntity({ type: 'output', id: output.id });
    }
  });
  const db = document.createElement('strong');
  db.className = 'mixer-db';
  db.textContent = `${output.busLevelDb.toFixed(0)} dB`;
  const body = document.createElement('div');
  body.className = 'mixer-strip-body';
  const meter = createOutputMeter(output, state);
  const fader = createAudioFader(output, (busLevelDb) => {
    db.textContent = `${busLevelDb.toFixed(0)} dB`;
    void window.xtream.outputs.update(output.id, { busLevelDb });
  });
  body.append(meter, fader);
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
  strip.append(db, body, toggles, label, status);
  return strip;
}

function createOutputMeter(output: VirtualOutputState, state = currentState): HTMLElement {
  const meter = document.createElement('div');
  meter.className = 'output-meter';
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', `${output.label} output meter`);

  const scale = document.createElement('div');
  scale.className = 'output-meter-scale';
  for (const label of ['0', '-6', '-12', '-24', '-36', '-60']) {
    const tick = document.createElement('span');
    tick.textContent = label;
    scale.append(tick);
  }

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
  segments.forEach((segment, index) => {
    const segmentDb = -((index / Math.max(1, segments.length - 1)) * 60);
    segment.dataset.active = String(index >= segments.length - activeCount);
    segment.dataset.zone = isClipped || segmentDb >= -3 ? 'danger' : segmentDb >= -12 ? 'hot' : 'nominal';
  });
}

function clearMeterElementCaches(): void {
  meterLaneElementCache.clear();
  meterPeakElementCache.clear();
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
  const zero = document.createElement('span');
  zero.className = 'audio-fader-zero';
  zero.textContent = '0';
  const input = createSlider({
    min: '-60',
    max: '12',
    step: '1',
    value: String(output.busLevelDb),
    ariaLabel: `${output.label} bus level`,
    className: 'audio-fader-input vertical-slider',
  });
  input.setAttribute('orient', 'vertical');
  syncAudioFaderPosition(wrapper, input);
  input.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.altKey) {
      event.preventDefault();
      input.value = '0';
      syncSliderProgress(input);
      syncAudioFaderPosition(wrapper, input);
      onChange(0);
    }
  });
  input.addEventListener('input', () => {
    syncAudioFaderPosition(wrapper, input);
    onChange(Number(input.value));
  });
  wrapper.append(rail, cap, zero, input);
  return wrapper;
}

function syncAudioFaderPosition(wrapper: HTMLElement, input: HTMLInputElement): void {
  const min = Number(input.min || -60);
  const max = Number(input.max || 12);
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

function getFilteredVisuals(visuals: VisualState[]): VisualState[] {
  return visuals.filter(matchesPoolQuery).sort(comparePoolItems);
}

function getFilteredAudioSources(sources: AudioSourceState[], state: DirectorState): AudioSourceState[] {
  return sources
    .filter((source) => {
      const haystack =
        source.type === 'external-file'
          ? `${source.label} ${source.path ?? ''}`
          : `${source.label} ${state.visuals[source.visualId]?.label ?? source.visualId}`;
      return matchesQuery(haystack);
    })
    .sort(comparePoolItems);
}

function matchesPoolQuery(item: VisualState | AudioSourceState): boolean {
  const haystack = 'path' in item ? `${item.label} ${item.path ?? ''} ${item.type}` : `${item.label} ${item.type}`;
  return matchesQuery(haystack);
}

function matchesQuery(haystack: string): boolean {
  return haystack.toLowerCase().includes(poolSearchQuery.trim().toLowerCase());
}

function comparePoolItems<T extends { label: string; ready: boolean; durationSeconds?: number }>(left: T, right: T): number {
  if (poolSort === 'duration') {
    return (left.durationSeconds ?? Number.POSITIVE_INFINITY) - (right.durationSeconds ?? Number.POSITIVE_INFINITY);
  }
  if (poolSort === 'status') {
    return Number(right.ready) - Number(left.ready) || left.label.localeCompare(right.label);
  }
  return left.label.localeCompare(right.label);
}

function syncPoolTabs(): void {
  const visualActive = activePoolTab === 'visuals';
  elements.visualTabButton.classList.toggle('active', visualActive);
  elements.visualTabButton.setAttribute('aria-selected', String(visualActive));
  elements.audioTabButton.classList.toggle('active', !visualActive);
  elements.audioTabButton.setAttribute('aria-selected', String(!visualActive));
  elements.addVisualsButton.title = visualActive ? 'Add visuals' : 'Add external audio';
  elements.addVisualsButton.setAttribute('aria-label', visualActive ? 'Add visuals' : 'Add external audio');
}

function selectEntity(entity: SelectedEntity): void {
  activeSurface = 'patch';
  selectedEntity = entity;
  syncMixerSelection();
  document.documentElement.style.setProperty('--mixer-width', '30vw');
  if (entity.type === 'visual') {
    activePoolTab = 'visuals';
  }
  if (entity.type === 'audio-source') {
    activePoolTab = 'audio';
  }
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

function formatDuration(seconds: number | undefined): string {
  return seconds === undefined ? 'duration --' : formatTimecode(seconds);
}

function formatAudioChannelLabel(source: AudioSourceState): string {
  if (source.channelMode === 'left') {
    return ' | L mono';
  }
  if (source.channelMode === 'right') {
    return ' | R mono';
  }
  if (source.channelCount !== undefined) {
    return ` | ${source.channelCount} ch`;
  }
  return '';
}

function formatAudioChannelDetail(source: AudioSourceState): string {
  if (source.channelMode === 'left') {
    return `mono L${source.derivedFromAudioSourceId ? ` from ${source.derivedFromAudioSourceId}` : ''}`;
  }
  if (source.channelMode === 'right') {
    return `mono R${source.derivedFromAudioSourceId ? ` from ${source.derivedFromAudioSourceId}` : ''}`;
  }
  if (source.channelCount !== undefined) {
    return source.channelCount >= 2 ? `${source.channelCount} channels (stereo)` : `${source.channelCount} channel`;
  }
  return 'unknown';
}

function createOutputSourceControls(output: VirtualOutputState, state: DirectorState): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'output-source-list';
  for (const selection of output.sources) {
    const source = state.audioSources[selection.audioSourceId];
    const row = document.createElement('div');
    row.className = 'output-source-row';
    const label = document.createElement('strong');
    label.textContent = source?.label ?? selection.audioSourceId;
    const levelControl = createDbFader('Level dB', selection.levelDb, (levelDb) => {
      void window.xtream.outputs.update(output.id, {
        sources: output.sources.map((candidate) =>
          candidate.audioSourceId === selection.audioSourceId ? { ...candidate, levelDb } : candidate,
        ),
      });
    });
    const removeButton = createButton('Remove Source', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, {
        sources: output.sources.filter((candidate) => candidate.audioSourceId !== selection.audioSourceId),
      });
      renderState(await window.xtream.director.getState());
    });
    const muteButton = createButton(selection.muted ? 'Unmute Source' : 'Mute Source', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, {
        sources: output.sources.map((candidate) =>
          candidate.audioSourceId === selection.audioSourceId ? { ...candidate, muted: !candidate.muted } : candidate,
        ),
      });
      renderState(await window.xtream.director.getState());
    });
    const actions = document.createElement('div');
    actions.className = 'button-row compact';
    actions.append(muteButton, removeButton);
    row.append(label, levelControl, actions);
    wrapper.append(row);
  }
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
            void window.xtream.outputs
              .update(output.id, { sources: [...output.sources, { audioSourceId, levelDb: 0 }] })
              .then(async () => renderState(await window.xtream.director.getState()));
          }
        },
      ),
    );
  }
  if (output.sources.length === 0) {
    wrapper.append(createHint('No sources selected.'));
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
        return `${visualId}:${visual?.type ?? 'missing'}:${visual?.url ?? ''}`;
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

function formatMilliseconds(seconds: number | undefined): string {
  return seconds === undefined ? '--' : `${Math.round(seconds * 1000)}ms`;
}

function createDisplayPreview(display: DisplayWindowState, state: DirectorState | undefined): HTMLElement {
  const preview = document.createElement('div');
  preview.className = `display-preview ${display.layout.type}`;
  preview.classList.toggle('blacked-out', Boolean(state?.globalDisplayBlackout));
  if (!state) {
    preview.textContent = 'Preview unavailable';
    return preview;
  }
  for (const visualId of getPreviewVisualIds(display.layout)) {
    const visual = state.visuals[visualId];
    const pane = document.createElement('section');
    pane.className = 'display-preview-pane';
    pane.dataset.visualId = visualId;
    if (!visual?.url) {
      pane.append(createPreviewLabel(visual?.label ?? visualId, 'No visual selected'));
    } else if (visual.type === 'image') {
      const image = document.createElement('img');
      image.src = visual.url;
      image.alt = visual.label;
      applyVisualStyle(image, visual);
      image.addEventListener('load', () => reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, true, undefined, display.id));
      image.addEventListener('error', () =>
        reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, false, `${display.id} image preview failed to load.`, display.id),
      );
      pane.append(image);
    } else {
      if (state.performanceMode) {
        pane.append(createPreviewLabel(visual.label, 'video preview disabled in performance mode'));
        preview.append(pane);
        continue;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = visual.url;
      video.dataset.visualId = visualId;
      video.dataset.previewVideo = 'true';
      video.style.display = 'none';
      applyVisualStyle(video, visual);
      video.playbackRate = state.rate * (visual.playbackRate ?? 1);
      video.addEventListener('loadedmetadata', () => reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, true, undefined, display.id));
      video.addEventListener('error', () =>
        reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, false, `${display.id} video preview failed to load.`, display.id),
      );
      const canvas = createDisplayPreviewCanvas(video);
      pane.append(video, canvas);
    }
    preview.append(pane);
  }
  return preview;
}

function reportPreviewStatus(key: string, visualId: string | undefined, ready: boolean, error?: string, displayId?: string): void {
  void window.xtream.renderer.reportPreviewStatus({
    key,
    displayId,
    visualId,
    ready,
    error,
    reportedAtWallTimeMs: Date.now(),
  });
}

function createDisplayPreviewCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'display-preview-canvas';
  canvas.width = DISPLAY_PREVIEW_MAX_WIDTH;
  canvas.height = DISPLAY_PREVIEW_MAX_HEIGHT;
  displayPreviewCanvases.set(video, { canvas, lastDrawMs: 0 });
  video.addEventListener('loadedmetadata', () => resizeDisplayPreviewCanvas(video, canvas));
  return canvas;
}

function resizeDisplayPreviewCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const sourceWidth = video.videoWidth || DISPLAY_PREVIEW_MAX_WIDTH;
  const sourceHeight = video.videoHeight || DISPLAY_PREVIEW_MAX_HEIGHT;
  const scale = Math.min(DISPLAY_PREVIEW_MAX_WIDTH / sourceWidth, DISPLAY_PREVIEW_MAX_HEIGHT / sourceHeight, 1);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
}

function drawDisplayPreviewFrame(video: HTMLVideoElement): void {
  const preview = displayPreviewCanvases.get(video);
  if (!preview || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const now = performance.now();
  if (now - preview.lastDrawMs < DISPLAY_PREVIEW_MIN_FRAME_INTERVAL_MS) {
    return;
  }
  preview.lastDrawMs = now;
  if (video.videoWidth > 0 && video.videoHeight > 0 && (preview.canvas.width === DISPLAY_PREVIEW_MAX_WIDTH || preview.canvas.height === DISPLAY_PREVIEW_MAX_HEIGHT)) {
    resizeDisplayPreviewCanvas(video, preview.canvas);
  }
  const context = preview.canvas.getContext('2d');
  context?.drawImage(video, 0, 0, preview.canvas.width, preview.canvas.height);
}

function getPreviewVisualIds(layout: VisualLayoutProfile): VisualId[] {
  return layout.type === 'single' ? (layout.visualId ? [layout.visualId] : []) : layout.visualIds.filter(Boolean) as VisualId[];
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

function renderDetails(state: DirectorState): void {
  const signature = JSON.stringify({ selectedEntity, state: createDetailsSignature(state), devices: displayMonitors, audioDevices: audioDevices.length });
  if (detailsRenderSignature === signature && isPanelInteractionActive(elements.detailsContent)) {
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

function createDetailsSignature(state: DirectorState): unknown {
  return {
    visuals: state.visuals,
    audioSources: state.audioSources,
    displays: state.displays,
    outputs: Object.fromEntries(Object.entries(state.outputs).map(([id, output]) => [id, { ...output, meterDb: undefined, meterLanes: undefined }])),
  };
}

function renderDefaultDetails(state: DirectorState): void {
  updateDetailsHeading();
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
      performanceMode: state.performanceMode,
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

  const actions = createSurfaceCard('System Actions');
  const actionRow = document.createElement('div');
  actionRow.className = 'button-row';
  actionRow.append(
    createButton('Save Show', 'secondary', () => elements.saveShowButton.click()),
    createButton('Open Show', 'secondary', () => elements.openShowButton.click()),
    createButton('Export Diagnostics', 'secondary', () => elements.exportDiagnosticsButton.click()),
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

  elements.surfacePanel.replaceChildren(wrapSurfaceGrid(summary, actions, topology, rawState));
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
  card.append(
    createDetailField('Label', label),
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
  const actions = document.createElement('div');
  actions.className = 'button-row';
  actions.append(
    createButton('Replace', 'secondary', async () => {
      const replaced = await window.xtream.visuals.replace(visual.id);
      if (replaced) {
        probeVisualMetadata(replaced);
      }
      renderState(await window.xtream.director.getState());
    }),
    createButton('Clear', 'secondary', async () => {
      await window.xtream.visuals.clear(visual.id);
      renderState(await window.xtream.director.getState());
    }),
  );
  card.append(actions);
  elements.detailsContent.replaceChildren(card);
}

function renderAudioSourceDetails(source: AudioSourceState, state: DirectorState): void {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(source.label, (nextLabel) => window.xtream.audioSources.update(source.id, { label: nextLabel }));
  card.append(
    createDetailField('Label', label),
    createDetailLine('Type', source.type),
    createDetailLine('Path', source.type === 'external-file' ? source.path ?? '--' : state.visuals[source.visualId]?.path ?? source.visualId),
    createDetailLine('Duration', formatDuration(source.durationSeconds)),
    createDetailLine('Channels', formatAudioChannelDetail(source)),
    createDetailLine('File Size', formatBytes(source.fileSizeBytes)),
    createDetailLine('Readiness', source.ready ? 'ready' : source.error ?? 'loading'),
    createNumberDetailControl('Source Level dB', source.levelDb ?? 0, -60, 12, 1, (levelDb) => window.xtream.audioSources.update(source.id, { levelDb })),
    createNumberDetailControl('Playback Rate', source.playbackRate ?? 1, 0.1, 4, 0.01, (playbackRate) =>
      window.xtream.audioSources.update(source.id, { playbackRate }),
    ),
  );
  const actions = document.createElement('div');
  actions.className = 'button-row';
  actions.append(
    createButton('Preview', 'secondary', () => playAudioSourcePreview(source, state, setShowStatus)),
    ...(source.type === 'external-file'
      ? [
          createButton('Replace', 'secondary', async () => {
            await window.xtream.audioSources.replaceFile(source.id);
            renderState(await window.xtream.director.getState());
          }),
        ]
      : []),
  );
  card.append(actions);
  elements.detailsContent.replaceChildren(card);
}

function renderDisplayDetails(display: DisplayWindowState, state: DirectorState): void {
  const visualIds = Object.keys(state.visuals);
  const card = document.createElement('div');
  card.className = 'detail-card';
  const labelInput = createLabelInput(display.label ?? display.id, (label) => window.xtream.displays.update(display.id, { label }));
  const mapping = createMappingControls(display, visualIds, display.health !== 'closed');
  const monitorSelect = createSelect(
    'Monitor',
    [['', 'Current/default'], ...displayMonitors.map((monitor): [string, string] => [monitor.id, monitor.label])],
    display.displayId ?? '',
    (displayId) => {
      void window.xtream.displays.update(display.id, { displayId: displayId || undefined });
    },
  );
  const actions = document.createElement('div');
  actions.className = 'button-row';
  actions.append(
    createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', async () => {
      await window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
      renderState(await window.xtream.director.getState());
    }),
    createButton('Close', 'secondary', async () => {
      await window.xtream.displays.close(display.id);
      renderState(await window.xtream.director.getState());
    }),
    createButton('Reopen', 'secondary', async () => {
      await window.xtream.displays.reopen(display.id);
      renderState(await window.xtream.director.getState());
    }),
    createButton('Remove', 'secondary', async () => {
      if (confirm(`Remove ${display.id}?`)) {
        await window.xtream.displays.remove(display.id);
        clearSelectionIf({ type: 'display', id: display.id });
        renderState(await window.xtream.director.getState());
      }
    }),
  );
  card.append(
    createDetailField('Label', labelInput),
    createDetailLine('Display', display.id),
    createDetailLine('Status', getDisplayStatusLabel(display)),
    createDetailLine('Telemetry', getDisplayTelemetry(display)),
    mapping,
    monitorSelect,
    actions,
  );
  elements.detailsContent.replaceChildren(card);
}

function renderOutputDetails(output: VirtualOutputState, state: DirectorState): void {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(output.label, (nextLabel) => window.xtream.outputs.update(output.id, { label: nextLabel }));
  const busControl = createDbFader('Bus level dB', output.busLevelDb, (busLevelDb) => {
    void window.xtream.outputs.update(output.id, { busLevelDb });
  });
  const sinkField = createSelect('Physical output', getAudioSinkOptions(), output.sinkId ?? '', (sinkId) => {
    const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
    void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel });
  });
  const sourceControls = createOutputSourceControls(output, state);
  const actions = document.createElement('div');
  actions.className = 'button-row';
  actions.append(
    createButton(output.muted ? 'Unmute' : 'Mute', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, { muted: !output.muted });
      renderState(await window.xtream.director.getState());
    }),
    createButton('Test Tone', 'secondary', () => playOutputTestTone(output)),
    createButton('Remove', 'secondary', async () => {
      if (confirm(`Remove ${output.label}?`)) {
        await window.xtream.outputs.remove(output.id);
        clearSelectionIf({ type: 'output', id: output.id });
        renderState(await window.xtream.director.getState());
      }
    }),
  );
  card.append(
    createDetailField('Label', label),
    busControl,
    createDetailLine('Meter', formatOutputMeterDetail(output)),
    sinkField,
    sourceControls,
    actions,
  );
  elements.detailsContent.replaceChildren(card);
}

function formatOutputMeterDetail(output: VirtualOutputState): string {
  const report = latestMeterReports.get(output.id);
  const peakDb = report?.peakDb ?? output.meterDb;
  const laneCount = report?.lanes.length ?? output.meterLanes?.length ?? getOutputMeterLanes(output).length;
  const peakLabel = peakDb === undefined || peakDb <= -60 ? '-inf' : `${peakDb.toFixed(1)} dB`;
  return `${peakLabel} peak | ${laneCount} lane${laneCount === 1 ? '' : 's'}`;
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

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return '--';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function applyVisualStyle(element: HTMLElement, visual: VisualState): void {
  element.style.opacity = String(visual.opacity ?? 1);
  element.style.filter = `brightness(${visual.brightness ?? 1}) contrast(${visual.contrast ?? 1})`;
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
    hasEmbeddedAudio: hasAudioTracks(video),
    ready: true,
  });
}

function hasAudioTracks(video: HTMLVideoElement): boolean | undefined {
  const maybeTracks = video as HTMLVideoElement & {
    audioTracks?: { length: number };
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
  };
  if (maybeTracks.audioTracks) {
    return maybeTracks.audioTracks.length > 0;
  }
  if (typeof maybeTracks.mozHasAudio === 'boolean') {
    return maybeTracks.mozHasAudio;
  }
  if (typeof maybeTracks.webkitAudioDecodedByteCount === 'number') {
    return maybeTracks.webkitAudioDecodedByteCount > 0;
  }
  return undefined;
}

function renderAudioAssetPreview(source: AudioSourceState, state: DirectorState): void {
  const url = source.type === 'external-file' ? source.url : state.visuals[source.visualId]?.url;
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
    if (!timecodeEditor) {
      elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState));
    }
    syncTimelineScrubber(currentState);
  }
  animationFrame = window.requestAnimationFrame(tick);
}

function syncPreviewElements(state: DirectorState): void {
  if (state.performanceMode) {
    document.querySelectorAll<HTMLVideoElement>('video[data-preview-video="true"]').forEach((video) => video.pause());
    return;
  }
  const targetSeconds = getDirectorSeconds(state);
  const syncKey = createPlaybackSyncKey(state);
  const videos = document.querySelectorAll<HTMLVideoElement>('video[data-preview-video="true"]');
  for (const video of videos) {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }
    const visualId = video.dataset.visualId;
    const visual = visualId ? state.visuals[visualId] : undefined;
    const visualDuration = visual?.durationSeconds;
    const effectiveTarget = getMediaEffectiveTime(targetSeconds * (visual?.playbackRate ?? 1), visualDuration ?? video.duration, state.loop);
    video.playbackRate = state.rate;
    if (visual) {
      video.playbackRate = state.rate * (visual.playbackRate ?? 1);
      applyVisualStyle(video, visual);
    }
    syncTimedMediaElement(video, effectiveTarget, !state.paused, syncKey, 0.75);
    drawDisplayPreviewFrame(video);
  }
}

async function sendTransport(command: TransportCommand): Promise<void> {
  renderState(await window.xtream.director.transport(command));
}

function beginTimecodeEdit(): void {
  if (!currentState || timecodeEditor) {
    return;
  }
  const input = document.createElement('input');
  input.className = 'timecode-input';
  input.type = 'text';
  input.value = formatTimecode(getDirectorSeconds(currentState));
  input.setAttribute('aria-label', 'Seek timecode');
  timecodeEditor = input;
  elements.timecode.replaceChildren(input);
  input.focus();
  input.select();

  const finish = (commit: boolean) => {
    if (timecodeEditor !== input) {
      return;
    }
    timecodeEditor = undefined;
    if (commit) {
      const result = parseTimecodeInput(input.value);
      if (!result.ok) {
        setShowStatus(`Seek timecode rejected: ${result.error}`);
      } else {
        void sendTransport({ type: 'seek', seconds: result.seconds });
      }
    }
    elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState!));
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      finish(true);
    }
    if (event.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function beginRateEdit(): void {
  if (!currentState) {
    return;
  }
  const input = document.createElement('input');
  input.className = 'rate-input-inline';
  input.type = 'number';
  input.min = '0.1';
  input.step = '0.01';
  input.value = String(currentState.rate);
  elements.rateDisplayButton.replaceChildren(input);
  input.focus();
  input.select();
  const finish = (commit: boolean) => {
    if (commit) {
      const rate = Number(input.value);
      if (Number.isFinite(rate) && rate > 0) {
        void sendTransport({ type: 'set-rate', rate });
      }
    }
    elements.rateDisplayButton.textContent = currentState ? `${currentState.rate.toFixed(2)}x` : '1.00x';
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      finish(true);
    }
    if (event.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function beginRateDrag(event: PointerEvent): void {
  if (!currentState || event.button !== 0) {
    return;
  }
  rateDragStart = { clientX: event.clientX, rate: currentState.rate };
  elements.rateDisplayButton.setPointerCapture(event.pointerId);
}

function updateRateDrag(event: PointerEvent): void {
  if (!rateDragStart) {
    return;
  }
  const delta = event.clientX - rateDragStart.clientX;
  const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
  elements.rateDisplayButton.textContent = `${nextRate.toFixed(2)}x`;
}

function finishRateDrag(event: PointerEvent): void {
  if (!rateDragStart) {
    return;
  }
  const delta = event.clientX - rateDragStart.clientX;
  const nextRate = Math.max(0.1, Math.min(4, rateDragStart.rate + delta * 0.01));
  rateDragStart = undefined;
  if (Math.abs(delta) > 2) {
    void sendTransport({ type: 'set-rate', rate: Number(nextRate.toFixed(2)) });
  }
}

function readLoopDraft(enabledOverride?: boolean): DirectorState['loop'] {
  const enabled = enabledOverride !== undefined ? enabledOverride : (currentState?.loop.enabled ?? false);
  const start = parseTimecodeInput(elements.loopStartInput.value);
  const end = elements.loopEndInput.value.trim() === '' ? undefined : parseTimecodeInput(elements.loopEndInput.value);
  return {
    enabled,
    startSeconds: start.ok ? start.seconds : 0,
    endSeconds: end === undefined ? undefined : end.ok ? end.seconds : undefined,
  };
}

function markTransportDraft(input: HTMLInputElement): void {
  input.dataset.dirty = 'true';
}

function clearTransportDrafts(inputs: HTMLInputElement[]): void {
  for (const input of inputs) {
    input.dataset.dirty = 'false';
  }
}

async function commitLoopDraft(enabledOverride?: boolean): Promise<void> {
  await sendTransport({ type: 'set-loop', loop: readLoopDraft(enabledOverride) });
  clearTransportDrafts([elements.loopStartInput, elements.loopEndInput]);
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
  panel.addEventListener('click', release);
}

function installShellIcons(): void {
  decorateIconButton(elements.playButton, 'Play', 'Play');
  decorateIconButton(elements.pauseButton, 'Pause', 'Pause');
  decorateIconButton(elements.stopButton, 'StopCircle', 'Stop');
  decorateIconButton(elements.loopToggleButton, 'Repeat', 'Loop settings');
  decorateIconButton(elements.saveShowButton, 'Save', 'Save show');
  decorateIconButton(elements.saveShowAsButton, 'FileJson', 'Save show as');
  decorateIconButton(elements.openShowButton, 'FolderOpen', 'Open show');
  decorateIconButton(elements.exportDiagnosticsButton, 'Bug', 'Export diagnostics');
  decorateIconButton(elements.addVisualsButton, 'Plus', 'Add visuals');
  decorateIconButton(elements.createDisplayButton, 'Plus', 'Add display');
  decorateIconButton(elements.createOutputButton, 'Plus', 'Create output');
  decorateIconButton(elements.refreshOutputsButton, 'RefreshCcw', 'Refresh outputs');
}

function installSplitters(): void {
  applyLayoutPrefs(readLayoutPrefs());
  installSplitter(elements.workspaceSplitter, 'x', (delta) => {
    const workspace = elements.workspaceSplitter.parentElement!;
    const current = readLayoutPrefs().mediaWidthPx ?? workspace.querySelector<HTMLElement>('.media-pool')!.getBoundingClientRect().width;
    saveLayoutPrefs({ mediaWidthPx: clamp(current + delta, 260, Math.max(320, workspace.getBoundingClientRect().width - 420)) });
  });
  installSplitter(elements.mainFooterSplitter, 'y', (delta) => {
    const frame = elements.mainFooterSplitter.parentElement!;
    const current = readLayoutPrefs().footerHeightPx ?? frame.querySelector<HTMLElement>('.operator-footer')!.getBoundingClientRect().height;
    saveLayoutPrefs({ footerHeightPx: clamp(current - delta, 180, Math.max(220, frame.getBoundingClientRect().height - 280)) });
  });
  installSplitter(elements.footerSplitter, 'x', (delta) => {
    const footer = elements.footerSplitter.parentElement!;
    const current = readLayoutPrefs().mixerWidthPx ?? footer.querySelector<HTMLElement>('.mixer-panel')!.getBoundingClientRect().width;
    saveLayoutPrefs({ mixerWidthPx: clamp(current + delta, 260, Math.max(320, footer.getBoundingClientRect().width - 360)) });
  });
  installSplitter(elements.assetPreviewSplitter, 'y', (delta) => {
    const current = readLayoutPrefs().assetPreviewHeightPx ?? elements.assetPreview.getBoundingClientRect().height;
    saveLayoutPrefs({ assetPreviewHeightPx: clamp(current - delta, 110, 320) });
  });
}

function installSplitter(handle: HTMLElement, axis: 'x' | 'y', onDelta: (delta: number) => void): void {
  let start = 0;
  handle.addEventListener('pointerdown', (event) => {
    start = axis === 'x' ? event.clientX : event.clientY;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }
    const current = axis === 'x' ? event.clientX : event.clientY;
    onDelta(current - start);
    start = current;
  });
  const finish = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 12;
    if (axis === 'x' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowRight' ? step : -step);
    }
    if (axis === 'y' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onDelta(event.key === 'ArrowDown' ? step : -step);
    }
  });
}

function readLayoutPrefs(): LayoutPrefs {
  try {
    return JSON.parse(localStorage.getItem(UI_PREF_KEY) ?? '{}') as LayoutPrefs;
  } catch {
    return {};
  }
}

function saveLayoutPrefs(update: LayoutPrefs): void {
  const prefs = { ...readLayoutPrefs(), ...update };
  localStorage.setItem(UI_PREF_KEY, JSON.stringify(prefs));
  applyLayoutPrefs(prefs);
}

function applyLayoutPrefs(prefs: LayoutPrefs): void {
  const root = document.documentElement;
  if (prefs.mediaWidthPx !== undefined) {
    root.style.setProperty('--media-pool-width', `${prefs.mediaWidthPx}px`);
  }
  if (prefs.footerHeightPx !== undefined) {
    root.style.setProperty('--operator-footer-height', `${prefs.footerHeightPx}px`);
  }
  if (prefs.mixerWidthPx !== undefined) {
    root.style.setProperty('--mixer-width', `${prefs.mixerWidthPx}px`);
  }
  if (prefs.assetPreviewHeightPx !== undefined) {
    root.style.setProperty('--asset-preview-height', `${prefs.assetPreviewHeightPx}px`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

installInteractionLock(elements.visualList);
installInteractionLock(elements.audioPanel);
installInteractionLock(elements.displayList);
installInteractionLock(elements.outputPanel);
installInteractionLock(elements.detailsContent);
elements.runtimeVersionLabel.textContent = `Xtream runtime ${XTREAM_RUNTIME_VERSION}`;
installShellIcons();
installSplitters();

elements.timecode.tabIndex = 0;
document.addEventListener('click', dismissAudioSourceContextMenu);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    dismissAudioSourceContextMenu();
  }
});
document.addEventListener('scroll', dismissAudioSourceContextMenu, true);
elements.patchRailButton.addEventListener('click', () => setActiveSurface('patch'));
elements.cueRailButton.addEventListener('click', () => setActiveSurface('cue'));
elements.performanceRailButton.addEventListener('click', () => setActiveSurface('performance'));
elements.configRailButton.addEventListener('click', () => setActiveSurface('config'));
elements.logsRailButton.addEventListener('click', () => setActiveSurface('logs'));
elements.timecode.title = 'Double-click to seek by timecode';
elements.timecode.addEventListener('dblclick', beginTimecodeEdit);
elements.timecode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    beginTimecodeEdit();
  }
});
elements.loopToggleButton.addEventListener('click', () => {
  elements.loopPopover.hidden = !elements.loopPopover.hidden;
  elements.loopToggleButton.setAttribute('aria-expanded', String(!elements.loopPopover.hidden));
});
elements.rateDisplayButton.addEventListener('dblclick', beginRateEdit);
elements.rateDisplayButton.addEventListener('pointerdown', beginRateDrag);
elements.rateDisplayButton.addEventListener('pointermove', updateRateDrag);
elements.rateDisplayButton.addEventListener('pointerup', finishRateDrag);
elements.rateDisplayButton.addEventListener('pointercancel', () => {
  rateDragStart = undefined;
});
elements.visualTabButton.addEventListener('click', () => {
  activePoolTab = 'visuals';
  visualRenderSignature = '';
  if (currentState) {
    renderState(currentState);
  }
});
elements.audioTabButton.addEventListener('click', () => {
  activePoolTab = 'audio';
  visualRenderSignature = '';
  if (currentState) {
    renderState(currentState);
  }
});
elements.poolSearchInput.addEventListener('input', () => {
  poolSearchQuery = elements.poolSearchInput.value;
  visualRenderSignature = '';
  if (currentState) {
    renderState(currentState);
  }
});
elements.poolSortSelect.addEventListener('change', () => {
  poolSort = elements.poolSortSelect.value as typeof poolSort;
  visualRenderSignature = '';
  if (currentState) {
    renderState(currentState);
  }
});
elements.visualList.addEventListener('dragover', (event) => {
  if (activePoolTab === 'visuals') {
    event.preventDefault();
    elements.visualList.classList.add('drag-over');
  }
});
elements.visualList.addEventListener('dragleave', () => elements.visualList.classList.remove('drag-over'));
elements.visualList.addEventListener('drop', async (event) => {
  event.preventDefault();
  elements.visualList.classList.remove('drag-over');
  if (activePoolTab !== 'visuals') {
    return;
  }
  const paths = Array.from(event.dataTransfer?.files ?? [])
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) {
    setShowStatus('Drop import unavailable: no file paths were exposed by the platform.');
    return;
  }
  const visuals = await window.xtream.visuals.addDropped(paths);
  visuals.forEach(probeVisualMetadata);
  if (visuals[0]) {
    selectedEntity = { type: 'visual', id: visuals[0].id };
  }
  renderState(await window.xtream.director.getState());
});
elements.playButton.addEventListener('click', () => void sendTransport({ type: 'play' }));
elements.pauseButton.addEventListener('click', () => void sendTransport({ type: 'pause' }));
elements.stopButton.addEventListener('click', () => void sendTransport({ type: 'stop' }));
elements.timelineScrubber.addEventListener('input', () => syncSliderProgress(elements.timelineScrubber));
elements.timelineScrubber.addEventListener('change', () => {
  void sendTransport({ type: 'seek', seconds: Number(elements.timelineScrubber.value) || 0 });
});
elements.loopActivateButton.addEventListener('click', () => {
  if (!currentState) {
    return;
  }
  void commitLoopDraft(!currentState.loop.enabled);
});
for (const input of [elements.loopStartInput, elements.loopEndInput]) {
  input.addEventListener('input', () => markTransportDraft(input));
  input.addEventListener('change', () => void commitLoopDraft());
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
elements.openShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.open();
  if (result) {
    renderState(result.state);
    setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
  }
});
elements.exportDiagnosticsButton.addEventListener('click', async () => {
  const filePath = await window.xtream.show.exportDiagnostics();
  if (filePath) {
    setShowStatus(`Exported diagnostics: ${filePath}`);
  }
});
elements.addVisualsButton.addEventListener('click', async () => {
  if (activePoolTab === 'audio') {
    const source = await window.xtream.audioSources.addFile();
    if (source) {
      selectedEntity = { type: 'audio-source', id: source.id };
    }
  } else {
    const visuals = await window.xtream.visuals.add();
    visuals?.forEach(probeVisualMetadata);
    if (visuals?.[0]) {
      selectedEntity = { type: 'visual', id: visuals[0].id };
    }
  }
  renderState(await window.xtream.director.getState());
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
