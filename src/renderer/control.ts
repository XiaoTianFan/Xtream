import './control.css';
import { formatTimecode, getDirectorSeconds } from '../shared/timeline';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import type {
  AudioExtractionFormat,
  DirectorState,
  DisplayMonitorInfo,
  MediaValidationIssue,
  VisualId,
} from '../shared/types';
import {
  createButton,
  createHint,
  createSelect,
  createSlider,
  syncSliderProgress,
  setSelectEnabled,
} from './control/dom';
import { syncPreviewElements } from './control/displayPreview';
import { createAssetPreviewController } from './control/assetPreview';
import { createDetailsPaneController } from './control/detailsPane';
import { createDisplayWorkspaceController } from './control/displayWorkspace';
import { elements } from './control/elements';
import { createEmbeddedAudioImportController } from './control/embeddedAudioImport';
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
import { createMixerPanelController } from './control/mixerPanel';
import { installShellIcons } from './control/shellIcons';
import { createTransportController } from './control/transportControls';
import type { ControlSurface, SelectedEntity } from './control/types';

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let previewSyncTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let visualRenderSignature = '';
let audioRenderSignature = '';
let displayRenderSignature = '';
let surfaceRenderSignature = '';
let activeSurface: ControlSurface = 'patch';
let selectedEntity: SelectedEntity | undefined;
const activePanels = new WeakSet<HTMLElement>();

const DISPLAY_PREVIEW_SYNC_INTERVAL_MS = 125;

const embeddedAudioImport = createEmbeddedAudioImportController({
  getAudioExtractionFormat: () => currentState?.audioExtractionFormat,
  setSelectedEntity: (entity) => {
    selectedEntity = entity;
  },
  renderState,
  setShowStatus,
});

const assetPreview = createAssetPreviewController({
  reportVisualMetadataFromVideo: embeddedAudioImport.reportVisualMetadataFromVideo,
});

const displayWorkspace = createDisplayWorkspaceController({
  getState: () => currentState,
  isSelected,
  selectEntity,
  clearSelectionIf,
  renderState,
});

let refreshDetailsPane = (state: DirectorState) => {
  detailsPane.render(state, true);
};

const mixerPanel = createMixerPanelController({
  getState: () => currentState,
  getAudioDevices: () => audioDevices,
  isSelected,
  selectEntity,
  renderState,
  syncTransportInputs: (state) => transport.syncTransportInputs(state),
  refreshDetails: (state) => refreshDetailsPane(state),
});

const detailsPane = createDetailsPaneController({
  getSelectedEntity: () => selectedEntity,
  setSelectedEntity: (entity) => {
    selectedEntity = entity;
  },
  getDisplayMonitors: () => displayMonitors,
  getAudioDevices: () => audioDevices,
  isPanelInteractionActive,
  renderState,
  clearSelectionIf,
  confirmPoolRecordRemoval,
  queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
  probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
  getDisplayStatusLabel: displayWorkspace.getDisplayStatusLabel,
  getDisplayTelemetry: displayWorkspace.getDisplayTelemetry,
  createMappingControls: displayWorkspace.createMappingControls,
  createOutputDetailMixerStrip: mixerPanel.createOutputDetailMixerStrip,
  createOutputSourceControls: mixerPanel.createOutputSourceControls,
});

const mediaPool = createMediaPoolController({
  getState: () => currentState,
  setSelectedEntity: (entity) => {
    selectedEntity = entity;
  },
  isSelected,
  clearSelectionIf,
  renderState,
  setShowStatus,
  queueEmbeddedAudioImportPrompt: embeddedAudioImport.queueEmbeddedAudioImportPrompt,
  probeVisualMetadata: embeddedAudioImport.probeVisualMetadata,
  createEmbeddedAudioRepresentation: embeddedAudioImport.createEmbeddedAudioRepresentation,
  extractEmbeddedAudioFile: embeddedAudioImport.extractEmbeddedAudioFile,
});

function renderState(state: DirectorState): void {
  currentState = state;
  if (mixerPanel.pruneSoloOutputIds(state)) {
    audioRenderSignature = '';
  }
  transport.syncTransportInputs(state);
  const nextAudioRenderSignature = mixerPanel.createRenderSignature(state);
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
    mixerPanel.renderOutputs(state);
  }
  mixerPanel.syncOutputMeters(state);
  const nextDisplayRenderSignature = displayWorkspace.createRenderSignature(state);
  if (!isPanelInteractionActive(elements.displayList) && displayRenderSignature !== nextDisplayRenderSignature) {
    displayRenderSignature = nextDisplayRenderSignature;
    displayWorkspace.render(Object.values(state.displays));
  } else {
    displayWorkspace.syncCardSummaries(Object.values(state.displays));
  }
  detailsPane.render(state);
  assetPreview.render(state, selectedEntity);
  renderIssueList(elements.issueList, combineVisibleIssues(state.readiness.issues, currentIssues));
  renderActiveSurface(state);
  void embeddedAudioImport.maybePromptEmbeddedAudioImport(state);
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

function selectEntity(entity: SelectedEntity): void {
  activeSurface = 'patch';
  selectedEntity = entity;
  mixerPanel.syncSelection(selectedEntity);
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
      displayCard.append(
        createDetailLine(display.label ?? display.id, `${displayWorkspace.getDisplayStatusLabel(display)} | ${displayWorkspace.getDisplayTelemetry(display)}`),
      );
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

function tick(): void {
  if (currentState) {
    if (!transport.isTimecodeEditing()) {
      elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState));
    }
    transport.syncTimelineScrubber(currentState);
  }
  animationFrame = window.requestAnimationFrame(tick);
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
  getSoloOutputCount: mixerPanel.getSoloOutputCount,
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
  mixerPanel.setSoloOutputIds([]);
});
elements.resetMetersButton.addEventListener('click', () => {
  mixerPanel.resetMeters(currentState);
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
  mixerPanel.applyOutputMeterReport(report);
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
