import { XTREAM_RUNTIME_VERSION } from '../../../shared/version';
import type {
  AudioExtractionFormat,
  DirectorState,
  DisplayWindowState,
  MediaValidationIssue,
  StreamPausedPlayBehavior,
  StreamPlaybackSettings,
} from '../../../shared/types';
import type { SurfaceController } from '../app/surfaceRouter';
import { createSurfaceStateSignature } from '../app/surfaceSignatures';
import { createButton, createHint, createSelect, createSlider, syncSliderProgress } from '../shared/dom';
import { createDetailLine, createDetailTitle, createSurfaceCard, wrapSurfaceGrid } from '../shared/surfaceCards';
import { elements } from '../shell/elements';
import type { ShowOpenProfileLogEntry } from '../../../shared/showOpenProfile';
import { clearShowOpenProfileLogBuffer, getShowOpenProfileLogBuffer, getShowOpenProfileLogRevision } from './showOpenProfileUi';
import {
  applyConfigLayoutPrefs,
  createConfigLayoutController,
  readConfigLayoutPrefs,
  type ConfigLayoutRefs,
} from './configLayoutPrefs';
import { createStreamTabBar } from '../stream/streamDom';

const CONFIG_TAB_SESSION_KEY = 'xtream.control.config.tab.v1';

type ConfigTabId = 'overview' | 'project' | 'diagnostics' | 'advanced';

const CONFIG_TAB_ORDER: ConfigTabId[] = ['overview', 'project', 'diagnostics', 'advanced'];

function readStoredConfigTab(): ConfigTabId {
  try {
    const raw = sessionStorage.getItem(CONFIG_TAB_SESSION_KEY);
    if (raw && (CONFIG_TAB_ORDER as string[]).includes(raw)) {
      return raw as ConfigTabId;
    }
  } catch {
    /* ignore */
  }
  return 'overview';
}

let configActiveTab: ConfigTabId = readStoredConfigTab();

type ConfigSurfaceOptions = {
  renderState: (state: DirectorState) => void;
  getDirectorState: () => DirectorState | undefined;
  setShowStatus: (message: string) => void;
  getOperationIssues: () => MediaValidationIssue[];
  getDisplayStatusLabel: (display: DisplayWindowState) => string;
  getDisplayTelemetry: (display: DisplayWindowState) => string;
};

const layoutRefs: ConfigLayoutRefs = {};
const layoutCtl = createConfigLayoutController(layoutRefs);
let shellMounted = false;
let upperMount: HTMLElement | null = null;
let resizeHandlerInstalled = false;

function requireLayoutRef(name: string): HTMLElement {
  const el = layoutRefs[name as keyof ConfigLayoutRefs];
  if (!el) {
    throw new Error(`Missing config layout ref: ${name}`);
  }
  return el;
}

function onWindowResize(): void {
  layoutCtl.syncSplitterAria();
}

export function createConfigSurfaceController(options: ConfigSurfaceOptions): SurfaceController {
  function mountShell(): void {
    if (shellMounted) {
      return;
    }
    shellMounted = true;
    elements.surfacePanel.classList.add('config-surface-panel');

    const root = document.createElement('section');
    root.className = 'config-surface';
    layoutRefs.root = root;

    const upper = document.createElement('div');
    upper.className = 'config-surface-upper';
    upperMount = upper;

    const splitter = document.createElement('div');
    splitter.className = 'splitter horizontal';
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'horizontal');
    splitter.setAttribute('aria-label', 'Resize settings and profile log panes');
    splitter.tabIndex = 0;
    layoutRefs.configBottomSplitter = splitter;

    const logPane = document.createElement('aside');
    logPane.className = 'config-surface-log';
    logPane.setAttribute('aria-label', 'Show open profile log');
    layoutRefs.logPane = logPane;

    root.append(upper, splitter, logPane);
    elements.surfacePanel.replaceChildren(root);

    applyConfigLayoutPrefs(layoutRefs, readConfigLayoutPrefs());
    layoutCtl.installSplitters(requireLayoutRef);

    if (!resizeHandlerInstalled) {
      resizeHandlerInstalled = true;
      window.addEventListener('resize', onWindowResize);
    }
  }

  function unmountShell(): void {
    if (!shellMounted) {
      return;
    }
    shellMounted = false;
    upperMount = null;
    layoutRefs.root = undefined;
    layoutRefs.logPane = undefined;
    layoutRefs.configBottomSplitter = undefined;
    elements.surfacePanel.classList.remove('config-surface-panel');
    elements.surfacePanel.replaceChildren();
    if (resizeHandlerInstalled) {
      resizeHandlerInstalled = false;
      window.removeEventListener('resize', onWindowResize);
    }
  }

  function setActiveTab(next: ConfigTabId): void {
    configActiveTab = next;
    try {
      sessionStorage.setItem(CONFIG_TAB_SESSION_KEY, next);
    } catch {
      /* ignore */
    }
    const nextState = options.getDirectorState();
    if (nextState) {
      options.renderState(nextState);
    }
  }

  return {
    id: 'config',
    mount: mountShell,
    unmount: unmountShell,
    createRenderSignature: (state) =>
      `${createSurfaceStateSignature('config', state)}:${JSON.stringify(options.getOperationIssues())}:${getShowOpenProfileLogRevision()}:${configActiveTab}`,
    render: (state) => {
      mountShell();
      renderIntoShell(state, options, setActiveTab);
      layoutCtl.syncSplitterAria();
    },
  };
}

function formatProfileLogLine(entry: ShowOpenProfileLogEntry): string {
  const iso = new Date(entry.loggedAt).toISOString();
  const t = iso.slice(11, 23);
  const seg = entry.segmentMs !== undefined ? ` seg=${Math.round(entry.segmentMs)}ms` : '';
  const extra = entry.extra !== undefined && Object.keys(entry.extra).length > 0 ? ` ${JSON.stringify(entry.extra)}` : '';
  const rid = entry.runId.length > 12 ? `…${entry.runId.slice(-10)}` : entry.runId;
  return `${t} [${entry.source}] ${rid} ${entry.checkpoint} +${Math.round(entry.sinceRunStartMs)}ms${seg}${extra}`;
}

function renderShowOpenProfileLogCard(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'config-log-pane';

  const header = document.createElement('div');
  header.className = 'config-log-pane-header';
  const title = createDetailTitle('Show open profile log');
  title.className = 'config-log-pane-title';
  const clearBtn = createButton('Clear log', 'secondary config-log-clear', () => {
    clearShowOpenProfileLogBuffer();
  });
  header.append(title, clearBtn);

  const scroll = document.createElement('div');
  scroll.className = 'config-log-scroll';
  const pre = document.createElement('pre');
  pre.className = 'config-log-pre';
  const lines = [...getShowOpenProfileLogBuffer()].map(formatProfileLogLine);
  pre.textContent = lines.length > 0 ? lines.join('\n') : 'No entries yet. Open a show to record checkpoints.';
  scroll.append(pre);

  root.append(header, scroll);
  requestAnimationFrame(() => {
    scroll.scrollTop = scroll.scrollHeight;
  });
  return root;
}

function renderDiagnosticsContent(state: DirectorState, options: ConfigSurfaceOptions): HTMLElement {
  const exportCard = createSurfaceCard('Diagnostics export');
  const exportRow = document.createElement('div');
  exportRow.className = 'button-row';
  exportRow.append(
    createButton('Export Diagnostics', 'secondary', async () => {
      const filePath = await window.xtream.show.exportDiagnostics({
        showOpenProfileLog: [...getShowOpenProfileLogBuffer()],
      });
      if (filePath) {
        options.setShowStatus(`Exported diagnostics: ${filePath}`);
      }
    }),
  );
  exportCard.append(exportRow);

  const issues = [...state.readiness.issues, ...options.getOperationIssues()];
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
        createDetailLine(display.label ?? display.id, `${options.getDisplayStatusLabel(display)} | ${options.getDisplayTelemetry(display)}`),
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

  return wrapSurfaceGrid(exportCard, issueCard, displayCard, outputCard);
}

function wrapConfigOverviewPanels(
  runtimeCard: HTMLElement,
  topologyCard: HTMLElement,
  appSettingsCard: HTMLElement,
): HTMLElement {
  const leftStack = document.createElement('div');
  leftStack.className = 'config-overview-stack';
  leftStack.append(runtimeCard, topologyCard);

  const root = document.createElement('div');
  root.className = 'config-overview-columns';
  root.append(leftStack, appSettingsCard);
  return root;
}

function panelForTab(tab: ConfigTabId, state: DirectorState, options: ConfigSurfaceOptions): HTMLElement {
  const summary = createSurfaceCard('Runtime');
  summary.append(
    createDetailLine('Runtime Version', XTREAM_RUNTIME_VERSION),
    createDetailLine('Readiness', getLiveStateLabel(state)),
    createDetailLine('Global Audio', state.globalAudioMuted ? 'muted' : 'live'),
    createDetailLine('Display Blackout', state.globalDisplayBlackout ? 'active' : 'off'),
  );

  const topology = createSurfaceCard('Patch Topology');
  topology.append(
    createDetailLine('Visuals', String(Object.keys(state.visuals).length)),
    createDetailLine('Audio Sources', String(Object.keys(state.audioSources).length)),
    createDetailLine('Displays', String(Object.keys(state.displays).length)),
    createDetailLine('Virtual Outputs', String(Object.keys(state.outputs).length)),
  );

  const appConfiguration = createSurfaceCard('App configuration');
  const perfToggle = document.createElement('button');
  perfToggle.type = 'button';
  perfToggle.className = 'secondary';
  perfToggle.textContent = state.performanceMode ? 'Performance Mode On' : 'Performance Mode';
  perfToggle.classList.toggle('active', state.performanceMode);
  perfToggle.setAttribute('aria-pressed', String(state.performanceMode));
  perfToggle.title = state.performanceMode
    ? 'Performance mode disables control-window video previews and live meter sampling.'
    : 'Disable control-window preview and meter workloads for weaker playback machines.';
  perfToggle.addEventListener('click', async () => {
    const live = options.getDirectorState();
    options.renderState(
      await window.xtream.director.updateGlobalState({ performanceMode: !live?.performanceMode }),
    );
  });
  const extractionFormatSelect = createSelect(
    'Extracted audio format',
    [
      ['m4a', 'M4A / AAC'],
      ['wav', 'WAV / PCM'],
    ],
    state.audioExtractionFormat,
    (audioExtractionFormat) => {
      void window.xtream.appControl.mergeSettings({ audioExtractionFormat: audioExtractionFormat as AudioExtractionFormat }).then(options.renderState);
    },
  );
  appConfiguration.append(
    createHint('Stored on this machine for Xtream Control (not in show files). Applies to every show project on this computer.'),
    perfToggle,
    extractionFormatSelect,
    createHint('Used when extracting embedded audio from video into files with Save Show.'),
    createNumberDetailControl(
      'Display preview max FPS',
      state.controlDisplayPreviewMaxFps,
      1,
      60,
      1,
      (controlDisplayPreviewMaxFps) =>
        window.xtream.appControl.mergeSettings({
          controlDisplayPreviewMaxFps,
        }),
      options.renderState,
    ),
    createHint(
      'Caps redraw rate for Patch/Stream display preview cards (file video → canvas). Live capture paths are separate.',
    ),
  );

  const showProject = createSurfaceCard('Show project');
  showProject.append(
    createHint('Fade durations below are saved in your show project file (Save Show).'),
    createHint('Fade durations apply when toggling audio mute or display blackout from the operator footer (0 = instant).'),
    createNumberDetailControl(
      'Audio mute fade (s)',
      state.globalAudioMuteFadeOutSeconds,
      0,
      10,
      0.05,
      (globalAudioMuteFadeOutSeconds) => window.xtream.show.updateSettings({ globalAudioMuteFadeOutSeconds }),
      options.renderState,
    ),
    createNumberDetailControl(
      'Display blackout fade (s)',
      state.globalDisplayBlackoutFadeOutSeconds,
      0,
      10,
      0.05,
      (globalDisplayBlackoutFadeOutSeconds) => window.xtream.show.updateSettings({ globalDisplayBlackoutFadeOutSeconds }),
      options.renderState,
    ),
  );

  const streamPlayback = createSurfaceCard('Stream playback');
  streamPlayback.append(createHint('These Stream transport preferences are stored in your show project file.'));
  void renderStreamPlaybackSettings(streamPlayback, options);

  const advancedPlaceholder = createSurfaceCard('Advanced');
  advancedPlaceholder.append(createHint('Reserved for future settings.'));

  switch (tab) {
    case 'overview':
      return wrapConfigOverviewPanels(summary, topology, appConfiguration);
    case 'project':
      return wrapSurfaceGrid(showProject, streamPlayback);
    case 'diagnostics':
      return renderDiagnosticsContent(state, options);
    case 'advanced':
      return wrapSurfaceGrid(advancedPlaceholder);
  }
}

function renderIntoShell(state: DirectorState, options: ConfigSurfaceOptions, setActiveTab: (next: ConfigTabId) => void): void {
  if (!upperMount || !layoutRefs.logPane) {
    return;
  }

  const tabRow = document.createElement('div');
  tabRow.className = 'stream-workspace-tab-row';
  tabRow.append(
    createStreamTabBar(
      'Config sections',
      [
        ['overview', 'Overview'],
        ['project', 'Show & playback'],
        ['diagnostics', 'Diagnostics'],
        ['advanced', 'Advanced'],
      ],
      configActiveTab,
      (next) => setActiveTab(next as ConfigTabId),
    ),
  );

  const panels = document.createElement('div');
  panels.className = 'config-tab-panels';

  const tabLabels: Record<ConfigTabId, string> = {
    overview: 'Overview and patch topology',
    project: 'Show file and stream playback settings',
    diagnostics: 'Readiness, displays, and audio routing',
    advanced: 'Advanced (placeholder)',
  };

  for (const id of CONFIG_TAB_ORDER) {
    const section = document.createElement('section');
    section.className = 'config-tab-panel';
    section.id = `config-tab-${id}`;
    section.hidden = id !== configActiveTab;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-label', tabLabels[id]);
    if (id === configActiveTab) {
      section.append(panelForTab(id, state, options));
    }
    panels.append(section);
  }

  upperMount.replaceChildren(tabRow, panels);
  layoutRefs.logPane!.replaceChildren(renderShowOpenProfileLogCard());
}

async function renderStreamPlaybackSettings(card: HTMLElement, options: ConfigSurfaceOptions): Promise<void> {
  const streamState = await window.xtream.stream.getState();
  const settings: StreamPlaybackSettings = streamState.stream.playbackSettings ?? {
    pausedPlayBehavior: 'selection-aware',
    runningEditOrphanPolicy: 'fade-out',
    runningEditOrphanFadeOutMs: 500,
  };
  const commit = async (playbackSettings: Partial<StreamPlaybackSettings>) => {
    await window.xtream.stream.edit({ type: 'update-stream', playbackSettings });
    options.renderState(await window.xtream.director.getState());
  };
  const pausedPlay = createSelect(
    'Paused global Play',
    [
      ['selection-aware', 'Selection-aware resume'],
      ['preserve-paused-cursor', 'Preserve paused cursor'],
    ],
    settings.pausedPlayBehavior,
    (pausedPlayBehavior) => void commit({ pausedPlayBehavior: pausedPlayBehavior as StreamPausedPlayBehavior }),
  );
  const orphanPolicy = createSelect(
    'Running edit removals',
    [
      ['fade-out', 'Fade removed running content'],
      ['let-finish', 'Let removed running content finish'],
    ],
    settings.runningEditOrphanPolicy,
    (runningEditOrphanPolicy) =>
      void commit({ runningEditOrphanPolicy: runningEditOrphanPolicy as StreamPlaybackSettings['runningEditOrphanPolicy'] }),
  );
  card.append(
    pausedPlay,
    orphanPolicy,
    createNumberDetailControl(
      'Removed content fade (s)',
      settings.runningEditOrphanFadeOutMs / 1000,
      0.05,
      60,
      0.05,
      (seconds) => commit({ runningEditOrphanFadeOutMs: Math.round(seconds * 1000) }),
      options.renderState,
    ),
  );
}

function createNumberDetailControl(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onCommit: (value: number) => Promise<unknown>,
  renderState: (state: DirectorState) => void,
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

function getLiveStateLabel(state: DirectorState): 'LIVE' | 'STANDBY' | 'BLOCKED' | 'DEGRADED' {
  if (state.readiness.issues.some((issue) => issue.severity === 'error')) {
    return 'BLOCKED';
  }
  if (state.readiness.issues.some((issue) => issue.severity === 'warning') || Object.values(state.displays).some((display) => display.health === 'degraded')) {
    return 'DEGRADED';
  }
  return state.paused ? 'STANDBY' : 'LIVE';
}
