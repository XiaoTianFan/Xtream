import './styles.css';
import { assessAudioCapabilities } from '../shared/audioCapabilities';
import { describeLayout } from '../shared/layouts';
import { getDirectorSeconds } from '../shared/timeline';
import type {
  AudioOutputPath,
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  LayoutProfile,
  MediaValidationIssue,
  SlotId,
  SlotState,
  TransportCommand,
} from '../shared/types';

const timecode = document.querySelector<HTMLDivElement>('#timecode');
const stateView = document.querySelector<HTMLPreElement>('#stateView');
const showStatus = document.querySelector<HTMLDivElement>('#showStatus');
const issueList = document.querySelector<HTMLDivElement>('#issueList');
const slotList = document.querySelector<HTMLDivElement>('#slotList');
const audioPanel = document.querySelector<HTMLDivElement>('#audioPanel');
const displayList = document.querySelector<HTMLDivElement>('#displayList');
const playButton = document.querySelector<HTMLButtonElement>('#playButton');
const pauseButton = document.querySelector<HTMLButtonElement>('#pauseButton');
const stopButton = document.querySelector<HTMLButtonElement>('#stopButton');
const seekInput = document.querySelector<HTMLInputElement>('#seekInput');
const seekButton = document.querySelector<HTMLButtonElement>('#seekButton');
const rateInput = document.querySelector<HTMLInputElement>('#rateInput');
const rateButton = document.querySelector<HTMLButtonElement>('#rateButton');
const loopEnabledInput = document.querySelector<HTMLInputElement>('#loopEnabledInput');
const loopStartInput = document.querySelector<HTMLInputElement>('#loopStartInput');
const loopEndInput = document.querySelector<HTMLInputElement>('#loopEndInput');
const loopButton = document.querySelector<HTMLButtonElement>('#loopButton');
const saveShowButton = document.querySelector<HTMLButtonElement>('#saveShowButton');
const saveShowAsButton = document.querySelector<HTMLButtonElement>('#saveShowAsButton');
const openShowButton = document.querySelector<HTMLButtonElement>('#openShowButton');
const exportDiagnosticsButton = document.querySelector<HTMLButtonElement>('#exportDiagnosticsButton');
const applyMode1Button = document.querySelector<HTMLButtonElement>('#applyMode1Button');
const applyMode2Button = document.querySelector<HTMLButtonElement>('#applyMode2Button');
const applyMode3Button = document.querySelector<HTMLButtonElement>('#applyMode3Button');
const createSingleButton = document.querySelector<HTMLButtonElement>('#createSingleButton');
const createSplitButton = document.querySelector<HTMLButtonElement>('#createSplitButton');

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let driftTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let audioUrl = '';
let lastReportedAudioCapabilitySignature = '';
let currentIssues: MediaValidationIssue[] = [];
let appliedAudioCorrectionRevision: number | undefined;

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

const audioElement: SinkCapableAudioElement = document.createElement('audio');
audioElement.preload = 'auto';
audioElement.style.display = 'none';
document.body.append(audioElement);

const audioOutputs = {
  main: createHiddenAudioOutput(),
  left: createHiddenAudioOutput(),
  right: createHiddenAudioOutput(),
};

type AudioGraph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  splitter: ChannelSplitterNode;
  mainDestination: MediaStreamAudioDestinationNode;
  leftDestination: MediaStreamAudioDestinationNode;
  rightDestination: MediaStreamAudioDestinationNode;
  leftMerger: ChannelMergerNode;
  rightMerger: ChannelMergerNode;
};

let audioGraph: AudioGraph | undefined;
let audioGraphMode: 'main' | 'split' | undefined;

function createHiddenAudioOutput(): SinkCapableAudioElement {
  const output = document.createElement('audio') as SinkCapableAudioElement;
  output.autoplay = true;
  output.style.display = 'none';
  document.body.append(output);
  return output;
}

function assertElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing control element: ${name}`);
  }

  return element;
}

const elements = {
  timecode: assertElement(timecode, 'timecode'),
  stateView: assertElement(stateView, 'stateView'),
  showStatus: assertElement(showStatus, 'showStatus'),
  issueList: assertElement(issueList, 'issueList'),
  slotList: assertElement(slotList, 'slotList'),
  audioPanel: assertElement(audioPanel, 'audioPanel'),
  displayList: assertElement(displayList, 'displayList'),
  playButton: assertElement(playButton, 'playButton'),
  pauseButton: assertElement(pauseButton, 'pauseButton'),
  stopButton: assertElement(stopButton, 'stopButton'),
  seekInput: assertElement(seekInput, 'seekInput'),
  seekButton: assertElement(seekButton, 'seekButton'),
  rateInput: assertElement(rateInput, 'rateInput'),
  rateButton: assertElement(rateButton, 'rateButton'),
  loopEnabledInput: assertElement(loopEnabledInput, 'loopEnabledInput'),
  loopStartInput: assertElement(loopStartInput, 'loopStartInput'),
  loopEndInput: assertElement(loopEndInput, 'loopEndInput'),
  loopButton: assertElement(loopButton, 'loopButton'),
  saveShowButton: assertElement(saveShowButton, 'saveShowButton'),
  saveShowAsButton: assertElement(saveShowAsButton, 'saveShowAsButton'),
  openShowButton: assertElement(openShowButton, 'openShowButton'),
  exportDiagnosticsButton: assertElement(exportDiagnosticsButton, 'exportDiagnosticsButton'),
  applyMode1Button: assertElement(applyMode1Button, 'applyMode1Button'),
  applyMode2Button: assertElement(applyMode2Button, 'applyMode2Button'),
  applyMode3Button: assertElement(applyMode3Button, 'applyMode3Button'),
  createSingleButton: assertElement(createSingleButton, 'createSingleButton'),
  createSplitButton: assertElement(createSplitButton, 'createSplitButton'),
};

const transportDraftElements = new Set<HTMLInputElement>([
  elements.rateInput,
  elements.loopEnabledInput,
  elements.loopStartInput,
  elements.loopEndInput,
]);

function formatTimecode(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);

  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(
    milliseconds,
  ).padStart(3, '0')}`;
}

function renderState(state: DirectorState): void {
  currentState = state;
  elements.stateView.textContent = JSON.stringify(state, null, 2);
  syncAudioSource(state);
  void configureAudioRoutingForState(state);
  syncTransportInputs(state);
  renderSlots(Object.values(state.slots));
  if (!isPanelInteractionActive(elements.audioPanel)) {
    renderAudio(state);
  }
  if (!isPanelInteractionActive(elements.displayList)) {
    renderDisplays(Object.values(state.displays));
  }
  renderIssues([...state.readiness.issues, ...currentIssues]);
}

function isPanelInteractionActive(panel: HTMLElement): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || !panel.contains(activeElement)) {
    return false;
  }

  return activeElement.matches('select, input, textarea');
}

function renderIssues(issues: MediaValidationIssue[]): void {
  elements.issueList.replaceChildren(
    ...issues.map((issue) => {
      const item = document.createElement('div');
      item.className = 'issue-item';
      item.textContent = `${issue.severity.toUpperCase()} ${issue.target}: ${issue.message}`;
      return item;
    }),
  );
}

function setShowStatus(message: string, issues: MediaValidationIssue[] = currentIssues): void {
  elements.showStatus.textContent = message;
  currentIssues = issues;
  renderIssues([...(currentState?.readiness.issues ?? []), ...currentIssues]);
}

function syncTransportInputs(state: DirectorState): void {
  elements.playButton.disabled = !state.readiness.ready;
  if (!isTransportDraftActive(elements.rateInput)) {
    elements.rateInput.value = String(state.rate);
  }
  if (!isTransportDraftActive(elements.loopEnabledInput)) {
    elements.loopEnabledInput.checked = state.loop.enabled;
  }
  if (!isTransportDraftActive(elements.loopStartInput)) {
    elements.loopStartInput.value = String(state.loop.startSeconds);
  }
  if (!isTransportDraftActive(elements.loopEndInput)) {
    elements.loopEndInput.value = state.loop.endSeconds === undefined ? '' : String(state.loop.endSeconds);
  }
  elements.showStatus.textContent = state.readiness.ready
    ? 'Show readiness: ready'
    : `Show readiness: blocked by ${state.readiness.issues.filter((issue) => issue.severity === 'error').length} issue(s)`;
}

function isTransportDraftActive(input: HTMLInputElement): boolean {
  return document.activeElement === input || (transportDraftElements.has(input) && input.dataset.dirty === 'true');
}

function syncAudioSource(state: DirectorState): void {
  const nextUrl = getAudioSourceUrl(state);
  if (audioUrl === nextUrl) {
    return;
  }

  audioUrl = nextUrl;
  audioElement.pause();
  audioElement.removeAttribute('src');

  if (nextUrl) {
    audioElement.src = nextUrl;
    audioElement.load();
  }
}

function getAudioSourceUrl(state: DirectorState): string {
  if (state.audio.sourceMode === 'embedded-slot' && state.audio.embeddedSlotId) {
    return state.slots[state.audio.embeddedSlotId]?.videoUrl ?? '';
  }

  return state.audio.url ?? '';
}

async function ensureAudioGraph(): Promise<AudioGraph | undefined> {
  if (audioGraph) {
    return audioGraph;
  }

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    return undefined;
  }

  const context = new AudioContextCtor();
  const source = context.createMediaElementSource(audioElement);
  const splitter = context.createChannelSplitter(2);
  const mainDestination = context.createMediaStreamDestination();
  const leftDestination = context.createMediaStreamDestination();
  const rightDestination = context.createMediaStreamDestination();
  const leftMerger = context.createChannelMerger(2);
  const rightMerger = context.createChannelMerger(2);

  audioOutputs.main.srcObject = mainDestination.stream;
  audioOutputs.left.srcObject = leftDestination.stream;
  audioOutputs.right.srcObject = rightDestination.stream;

  audioGraph = {
    context,
    source,
    splitter,
    mainDestination,
    leftDestination,
    rightDestination,
    leftMerger,
    rightMerger,
  };

  return audioGraph;
}

async function configureAudioGraphForMode(state: DirectorState): Promise<boolean> {
  const graph = await ensureAudioGraph();
  if (!graph) {
    return false;
  }

  const nextMode = state.mode === 3 && state.audio.physicalSplitAvailable ? 'split' : 'main';
  if (audioGraphMode === nextMode) {
    return true;
  }

  graph.source.disconnect();
  graph.splitter.disconnect();
  graph.leftMerger.disconnect();
  graph.rightMerger.disconnect();

  if (nextMode === 'split') {
    graph.source.connect(graph.splitter);
    graph.splitter.connect(graph.leftMerger, 0, 0);
    graph.splitter.connect(graph.leftMerger, 0, 1);
    graph.splitter.connect(graph.rightMerger, 1, 0);
    graph.splitter.connect(graph.rightMerger, 1, 1);
    graph.leftMerger.connect(graph.leftDestination);
    graph.rightMerger.connect(graph.rightDestination);
    audioOutputs.main.pause();
  } else {
    graph.source.connect(graph.mainDestination);
    audioOutputs.left.pause();
    audioOutputs.right.pause();
  }

  audioGraphMode = nextMode;
  return true;
}

function getActiveAudioOutputs(mode: DirectorState['mode']): SinkCapableAudioElement[] {
  const state = currentState;
  return mode === 3 && state?.audio.physicalSplitAvailable ? [audioOutputs.left, audioOutputs.right] : [audioOutputs.main];
}

async function configureAudioRoutingForState(state: DirectorState): Promise<void> {
  const graphReady = await configureAudioGraphForMode(state);
  await Promise.all([
    applyAudioSink('main', state.audio.sinkId),
    applyAudioSink('left', state.audio.leftSinkId),
    applyAudioSink('right', state.audio.rightSinkId),
  ]);

  const assessment = assessAudioCapabilities({
    graphReady,
    setSinkIdSupported: Boolean(audioOutputs.left.setSinkId) && Boolean(audioOutputs.right.setSinkId),
    outputDeviceCount: audioDevices.length,
    leftSinkId: state.audio.leftSinkId,
    rightSinkId: state.audio.rightSinkId,
  });
  const signature = JSON.stringify(assessment);

  if (lastReportedAudioCapabilitySignature !== signature) {
    lastReportedAudioCapabilitySignature = signature;
    await window.xtream.audio.reportCapabilities({
      ...assessment,
      fallbackAccepted: state.audio.fallbackAccepted,
    });
  }
}

function renderAudio(state: DirectorState): void {
  const card = document.createElement('article');
  card.className = 'audio-card';

  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = 'Audio source';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = state.audio.ready ? 'ready' : state.audio.sourceMode !== 'none' ? 'loading' : 'empty';
  header.append(title, badge);

  const pathText = document.createElement('div');
  pathText.className = 'path-text';
  pathText.title = state.audio.path ?? '';
  pathText.textContent =
    state.audio.sourceMode === 'embedded-slot'
      ? `Embedded audio from slot ${state.audio.embeddedSlotId ?? 'none'}`
      : state.audio.path ?? 'No audio selected';

  const meta = document.createElement('div');
  meta.className = 'hint';
  meta.textContent = state.audio.error
    ? `Error: ${state.audio.error}`
    : `duration: ${state.audio.durationSeconds?.toFixed(3) ?? 'n/a'}s | drift: ${
        state.audio.lastDriftSeconds?.toFixed(3) ?? 'n/a'
      }`;

  const sourceField = createSelect(
    'Audio source',
    [
      ['none', 'No audio source'],
      ['external-file', state.audio.path ? 'External audio file' : 'External audio file (choose below)'],
      ...Object.keys(state.slots).map((slotId): [string, string] => [`embedded:${slotId}`, `Slot ${slotId} embedded audio`]),
    ],
    state.audio.sourceMode === 'embedded-slot' && state.audio.embeddedSlotId
      ? `embedded:${state.audio.embeddedSlotId}`
      : state.audio.sourceMode,
    (value) => {
      if (value.startsWith('embedded:')) {
        void window.xtream.audio.setEmbeddedSource({ slotId: value.slice('embedded:'.length) }).then(async () => {
          renderState(await window.xtream.director.getState());
        });
        return;
      }

      if (value === 'none') {
        void window.xtream.audio.setEmbeddedSource({}).then(async () => {
          renderState(await window.xtream.director.getState());
        });
      }
    },
  );

  const sinkField = createSelect(
    'Main output',
    getAudioSinkOptions(),
    state.audio.sinkId ?? '',
    (sinkId) => {
      const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
      void setAudioSink('main', sinkId, sinkLabel);
    },
  );

  const leftSinkField = createSelect(
    'Mode 3 left output',
    getAudioSinkOptions(),
    state.audio.leftSinkId ?? '',
    (sinkId) => {
      const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
      void setAudioSink('left', sinkId, sinkLabel);
    },
  );

  const rightSinkField = createSelect(
    'Mode 3 right output',
    getAudioSinkOptions(),
    state.audio.rightSinkId ?? '',
    (sinkId) => {
      const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
      void setAudioSink('right', sinkId, sinkLabel);
    },
  );

  const splitStatus = document.createElement('div');
  splitStatus.className = state.mode === 3 && !state.audio.physicalSplitAvailable ? 'warning' : 'hint';
  splitStatus.textContent =
    state.mode === 3 && !state.audio.physicalSplitAvailable
      ? `Mode 3 fallback: stereo will use the main/default output until physical split is available. Reason: ${
          state.audio.fallbackReason ?? 'unknown'
        }.`
      : `Mode 3 split routing: ${state.audio.physicalSplitAvailable ? 'available' : 'not active'} (${
          state.audio.capabilityStatus ?? 'unknown'
        })`;

  const buttons = document.createElement('div');
  buttons.className = 'button-row';

  const chooseButton = document.createElement('button');
  chooseButton.type = 'button';
  chooseButton.textContent = state.audio.path ? 'Replace Audio' : 'Choose Audio';
  chooseButton.addEventListener('click', async () => {
    await window.xtream.audio.pickFile();
    renderState(await window.xtream.director.getState());
  });

  const refreshDevicesButton = document.createElement('button');
  refreshDevicesButton.type = 'button';
  refreshDevicesButton.className = 'secondary';
  refreshDevicesButton.textContent = 'Refresh Outputs';
  refreshDevicesButton.addEventListener('click', async () => {
    await loadAudioDevices();
    renderState(await window.xtream.director.getState());
  });

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'secondary';
  clearButton.textContent = 'Clear';
  clearButton.disabled = !state.audio.path && state.audio.sourceMode !== 'embedded-slot';
  clearButton.addEventListener('click', async () => {
    if (state.audio.path) {
      await window.xtream.audio.clearFile();
    } else {
      await window.xtream.audio.setEmbeddedSource({});
    }
    renderState(await window.xtream.director.getState());
  });

  const testMainButton = createTestToneButton('Test Main', 'main');
  const testLeftButton = createTestToneButton('Test Left', 'left');
  const testRightButton = createTestToneButton('Test Right', 'right');
  const acceptFallbackButton = document.createElement('button');
  acceptFallbackButton.type = 'button';
  acceptFallbackButton.className = 'secondary';
  acceptFallbackButton.textContent = state.audio.fallbackAccepted ? 'Fallback Accepted' : 'Accept Fallback';
  acceptFallbackButton.disabled = state.mode !== 3 || state.audio.physicalSplitAvailable;
  acceptFallbackButton.addEventListener('click', async () => {
    renderState(
      await window.xtream.audio.reportCapabilities({
        physicalSplitAvailable: state.audio.physicalSplitAvailable,
        fallbackAccepted: true,
      }),
    );
  });

  buttons.append(
    chooseButton,
    refreshDevicesButton,
    clearButton,
    testMainButton,
    testLeftButton,
    testRightButton,
    acceptFallbackButton,
  );
  card.append(header, pathText, meta, sourceField, sinkField, leftSinkField, rightSinkField, splitStatus, buttons);
  elements.audioPanel.replaceChildren(card);
}

function getAudioSinkOptions(): Array<[string, string]> {
  const options: Array<[string, string]> = [['', 'System default output']];
  for (const device of audioDevices) {
    options.push([device.deviceId, device.label || `Audio output ${options.length}`]);
  }

  return options;
}

function createTestToneButton(label: string, path: AudioOutputPath): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', () => {
    void playTestTone(path);
  });
  return button;
}

async function setAudioSink(path: AudioOutputPath, sinkId: string, sinkLabel?: string): Promise<void> {
  await applyAudioSink(path, sinkId);
  renderState(await window.xtream.audio.setSink({ path, sinkId: sinkId || undefined, sinkLabel }));
}

async function applyAudioSink(path: AudioOutputPath, sinkId: string | undefined): Promise<void> {
  const output = getOutputForPath(path);
  if (!output.setSinkId) {
    return;
  }

  try {
    await output.setSinkId(sinkId ?? '');
  } catch (error) {
    await window.xtream.audio.reportMetadata({
      durationSeconds: Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
      ready: false,
      error: error instanceof Error ? error.message : 'Audio sink assignment failed.',
    });
  }
}

function getOutputForPath(path: AudioOutputPath): SinkCapableAudioElement {
  return audioOutputs[path];
}

async function playTestTone(path: AudioOutputPath): Promise<void> {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const output = createHiddenAudioOutput();

  oscillator.frequency.value = path === 'right' ? 880 : path === 'left' ? 440 : 660;
  gain.gain.value = 0.18;
  oscillator.connect(gain).connect(destination);
  output.srcObject = destination.stream;

  const state = currentState;
  const sinkId =
    path === 'left' ? state?.audio.leftSinkId : path === 'right' ? state?.audio.rightSinkId : state?.audio.sinkId;
  if (output.setSinkId) {
    await output.setSinkId(sinkId ?? '');
  }

  oscillator.start();
  await output.play();
  window.setTimeout(() => {
    oscillator.stop();
    output.pause();
    output.remove();
    void context.close();
  }, 850);
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

function renderSlots(slots: SlotState[]): void {
  elements.slotList.replaceChildren(
    ...slots.map((slot) => {
      const card = document.createElement('article');
      card.className = 'slot-card';

      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = `Slot ${slot.id}`;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = slot.ready ? 'ready' : slot.videoPath ? 'loading' : 'empty';
      header.append(title, badge);

      const pathText = document.createElement('div');
      pathText.className = 'path-text';
      pathText.title = slot.videoPath ?? '';
      pathText.textContent = slot.videoPath ?? 'No video selected';

      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = slot.error
        ? `Error: ${slot.error}`
        : `duration: ${slot.durationSeconds?.toFixed(3) ?? 'n/a'}s`;

      const buttons = document.createElement('div');
      buttons.className = 'button-row';

      const chooseButton = document.createElement('button');
      chooseButton.type = 'button';
      chooseButton.textContent = slot.videoPath ? 'Replace Video' : 'Choose Video';
      chooseButton.addEventListener('click', async () => {
        await window.xtream.slots.pickVideo(slot.id);
        renderState(await window.xtream.director.getState());
      });

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'secondary';
      clearButton.textContent = 'Clear';
      clearButton.disabled = !slot.videoPath;
      clearButton.addEventListener('click', async () => {
        await window.xtream.slots.clearVideo(slot.id);
        renderState(await window.xtream.director.getState());
      });

      buttons.append(chooseButton, clearButton);
      card.append(header, pathText, meta, buttons);
      return card;
    }),
  );
}

function renderDisplays(displays: DisplayWindowState[]): void {
  const slots = Object.keys(currentState?.slots ?? {});
  elements.displayList.replaceChildren(
    ...displays.map((display) => {
      const hasLiveWindow = display.health !== 'closed';
      const card = document.createElement('article');
      card.className = 'display-card';

      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = display.id;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${display.layout.type} / ${display.health}`;

      header.append(title, badge);

      const details = document.createElement('div');
      details.textContent = `${describeLayout(display.layout)} | fullscreen: ${
        display.fullscreen ? 'yes' : 'no'
      } | drift: ${
        display.lastDriftSeconds?.toFixed(3) ?? 'n/a'
      }`;

      const mapping = createMappingControls(display, slots, hasLiveWindow);
      const monitorSelect = createSelect(
        'Monitor',
        [
          ['', 'Current / manual'],
          ...displayMonitors.map((monitor): [string, string] => [monitor.id, monitor.label]),
        ],
        display.displayId ?? '',
        (displayId) => {
          void window.xtream.displays.update(display.id, { displayId: displayId || undefined }).then(async () => {
            renderState(await window.xtream.director.getState());
          });
        },
      );
      const monitorControl = monitorSelect.querySelector('select');
      if (monitorControl) {
        monitorControl.disabled = !hasLiveWindow;
      }

      const buttons = document.createElement('div');
      buttons.className = 'button-row';

      const fullscreenButton = document.createElement('button');
      fullscreenButton.type = 'button';
      fullscreenButton.className = 'secondary';
      fullscreenButton.textContent = display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen';
      fullscreenButton.disabled = !hasLiveWindow;
      fullscreenButton.addEventListener('click', () => {
        void window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
      });

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'secondary';
      closeButton.textContent = 'Close Window';
      closeButton.disabled = !hasLiveWindow;
      closeButton.addEventListener('click', async () => {
        await window.xtream.displays.close(display.id);
        renderState(await window.xtream.director.getState());
      });

      const reopenButton = document.createElement('button');
      reopenButton.type = 'button';
      reopenButton.className = 'secondary';
      reopenButton.textContent = 'Reopen With Mapping';
      reopenButton.disabled = display.health !== 'closed' && display.health !== 'degraded';
      reopenButton.addEventListener('click', async () => {
        await window.xtream.displays.reopen(display.id);
        renderState(await window.xtream.director.getState());
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'secondary';
      removeButton.textContent = 'Remove Display';
      removeButton.addEventListener('click', async () => {
        await window.xtream.displays.remove(display.id);
        renderState(await window.xtream.director.getState());
      });

      buttons.append(fullscreenButton, closeButton, reopenButton, removeButton);
      card.append(header, details, mapping, monitorSelect, buttons);
      return card;
    }),
  );
}

function createMappingControls(display: DisplayWindowState, slots: SlotId[], enabled = true): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'mapping-grid';

  const layoutSelect = createSelect(
    'Layout',
    [
      ['single', 'Single slot'],
      ['split', 'Split A/B'],
    ],
    display.layout.type,
    (value) => {
      const nextLayout =
        value === 'split'
          ? ({ type: 'split', slots: getSplitSlots(display.layout, slots) } satisfies LayoutProfile)
          : ({ type: 'single', slot: getPrimarySlot(display.layout, slots) } satisfies LayoutProfile);
      void updateDisplayLayout(display.id, nextLayout);
    },
  );

  wrapper.append(layoutSelect);
  setSelectEnabled(layoutSelect, enabled);

  if (display.layout.type === 'single') {
    const slotSelect = createSelect(
        'Slot',
        slots.map((slot) => [slot, slot]),
        display.layout.slot,
        (slot) => {
          void updateDisplayLayout(display.id, { type: 'single', slot });
        },
    );
    setSelectEnabled(slotSelect, enabled);
    wrapper.append(slotSelect);
    return wrapper;
  }

  const [leftSlot, rightSlot] = display.layout.slots;

  const leftSelect = createSelect(
      'Left slot',
      slots.map((slot) => [slot, slot]),
      leftSlot,
      (slot) => {
        void updateDisplayLayout(display.id, { type: 'split', slots: [slot, rightSlot] });
      },
    );
  const rightSelect = createSelect(
      'Right slot',
      slots.map((slot) => [slot, slot]),
      rightSlot,
      (slot) => {
        void updateDisplayLayout(display.id, { type: 'split', slots: [leftSlot, slot] });
      },
    );
  setSelectEnabled(leftSelect, enabled);
  setSelectEnabled(rightSelect, enabled);
  wrapper.append(leftSelect, rightSelect);

  return wrapper;
}

function setSelectEnabled(wrapper: HTMLDivElement, enabled: boolean): void {
  const select = wrapper.querySelector('select');
  if (select) {
    select.disabled = !enabled;
  }
}

function createSelect(
  labelText: string,
  options: Array<[string, string]>,
  value: string,
  onChange: (value: string) => void,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'mapping-field';

  const label = document.createElement('label');
  label.textContent = labelText;

  const select = document.createElement('select');
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }

  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  field.append(label, select);
  return field;
}

function getPrimarySlot(layout: LayoutProfile, slots: SlotId[]): SlotId {
  return layout.type === 'single' ? layout.slot : layout.slots[0] ?? slots[0] ?? 'A';
}

function getSplitSlots(layout: LayoutProfile, slots: SlotId[]): [SlotId, SlotId] {
  if (layout.type === 'split') {
    return layout.slots;
  }

  const fallbackRight = slots.find((slot) => slot !== layout.slot) ?? layout.slot;
  return [layout.slot, fallbackRight];
}

async function updateDisplayLayout(displayId: string, layout: LayoutProfile): Promise<void> {
  await window.xtream.displays.update(displayId, { layout });
  renderState(await window.xtream.director.getState());
}

function tick(): void {
  if (currentState) {
    elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState));
    syncAudioToDirector(currentState);
  }

  animationFrame = window.requestAnimationFrame(tick);
}

function syncAudioToDirector(state: DirectorState): void {
  if (!getAudioSourceUrl(state) || audioElement.readyState < HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  const correction = state.corrections.audio;
  const shouldApplyCorrection =
    correction?.action === 'seek' &&
    correction.targetSeconds !== undefined &&
    appliedAudioCorrectionRevision !== correction.revision;
  const correctionTarget = shouldApplyCorrection ? correction.targetSeconds : undefined;
  const targetSeconds = clampAudioTime(correctionTarget ?? getDirectorSeconds(state));
  if (Math.abs(audioElement.currentTime - targetSeconds) > 0.08) {
    audioElement.currentTime = targetSeconds;
  }
  if (shouldApplyCorrection) {
    appliedAudioCorrectionRevision = correction.revision;
  }

  audioElement.playbackRate = state.rate;

  if (state.paused) {
    audioElement.pause();
    for (const output of Object.values(audioOutputs)) {
      output.pause();
    }
  } else if (audioElement.paused) {
    void playAudioRail(state).catch((error: unknown) => {
      void window.xtream.audio.reportMetadata({
        durationSeconds: Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
        ready: false,
        error: error instanceof Error ? error.message : 'Audio playback failed.',
      });
    });
  }
}

async function playAudioRail(state: DirectorState): Promise<void> {
  if (audioGraph?.context.state === 'suspended') {
    await audioGraph.context.resume();
  }

  await audioElement.play();
  await Promise.all(
    getActiveAudioOutputs(state.mode).map((output) => {
      return output.play().catch(() => undefined);
    }),
  );
}

function clampAudioTime(seconds: number): number {
  const safeSeconds = Math.max(0, seconds);
  if (!Number.isFinite(audioElement.duration)) {
    return safeSeconds;
  }

  return Math.min(safeSeconds, Math.max(0, audioElement.duration - 0.001));
}

async function sendTransport(command: TransportCommand): Promise<void> {
  renderState(await window.xtream.director.transport(command));
}

function readLoopDraft(): DirectorState['loop'] {
  const endSeconds = elements.loopEndInput.value === '' ? undefined : Number(elements.loopEndInput.value);
  return {
    enabled: elements.loopEnabledInput.checked,
    startSeconds: Number(elements.loopStartInput.value) || 0,
    endSeconds: Number.isFinite(endSeconds) ? endSeconds : undefined,
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

async function commitRateDraft(): Promise<void> {
  await sendTransport({ type: 'set-rate', rate: Number(elements.rateInput.value) || 1 });
  clearTransportDrafts([elements.rateInput]);
}

async function commitLoopDraft(): Promise<void> {
  await sendTransport({ type: 'set-loop', loop: readLoopDraft() });
  clearTransportDrafts([elements.loopEnabledInput, elements.loopStartInput, elements.loopEndInput]);
}

elements.playButton.addEventListener('click', () => {
  void sendTransport({ type: 'play' });
});

elements.pauseButton.addEventListener('click', () => {
  void sendTransport({ type: 'pause' });
});

elements.stopButton.addEventListener('click', () => {
  void sendTransport({ type: 'stop' });
});

elements.seekButton.addEventListener('click', () => {
  void sendTransport({ type: 'seek', seconds: Number(elements.seekInput.value) || 0 });
});

elements.rateButton.addEventListener('click', () => {
  void commitRateDraft();
});

elements.loopButton.addEventListener('click', () => {
  void commitLoopDraft();
});

elements.rateInput.addEventListener('input', () => markTransportDraft(elements.rateInput));
elements.rateInput.addEventListener('change', () => {
  void commitRateDraft();
});

for (const input of [elements.loopEnabledInput, elements.loopStartInput, elements.loopEndInput]) {
  input.addEventListener('input', () => markTransportDraft(input));
  input.addEventListener('change', () => {
    void commitLoopDraft();
  });
}

elements.saveShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.save();
  renderState(result.state);
  setShowStatus(`Saved show config: ${result.filePath ?? 'default location'}`, result.issues);
});

elements.saveShowAsButton.addEventListener('click', async () => {
  const result = await window.xtream.show.saveAs();
  if (!result) {
    return;
  }

  renderState(result.state);
  setShowStatus(`Saved show config: ${result.filePath ?? 'selected location'}`, result.issues);
});

elements.openShowButton.addEventListener('click', async () => {
  const result = await window.xtream.show.open();
  if (!result) {
    return;
  }

  renderState(result.state);
  setShowStatus(`Opened show config: ${result.filePath ?? 'selected file'}`, result.issues);
});

elements.exportDiagnosticsButton.addEventListener('click', async () => {
  const filePath = await window.xtream.show.exportDiagnostics();
  if (filePath) {
    setShowStatus(`Exported diagnostics: ${filePath}`);
  }
});

elements.applyMode1Button.addEventListener('click', async () => {
  const result = await window.xtream.director.applyModePreset(1);
  renderState(result.state);
});

elements.applyMode2Button.addEventListener('click', async () => {
  const result = await window.xtream.director.applyModePreset(2);
  renderState(result.state);
});

elements.applyMode3Button.addEventListener('click', async () => {
  const result = await window.xtream.director.applyModePreset(3);
  renderState(result.state);
});

elements.createSingleButton.addEventListener('click', async () => {
  await window.xtream.displays.create({ layout: { type: 'single', slot: 'A' } });
  renderState(await window.xtream.director.getState());
});

elements.createSplitButton.addEventListener('click', async () => {
  await window.xtream.displays.create({ layout: { type: 'split', slots: ['A', 'B'] } });
  renderState(await window.xtream.director.getState());
});

document.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (currentState) {
      renderState(currentState);
    }
  }, 0);
});

window.xtream.director.onState(renderState);
void window.xtream.renderer.ready({ kind: 'control' });
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then(renderState);

audioElement.addEventListener('loadedmetadata', () => {
  void window.xtream.audio.reportMetadata({
    durationSeconds: Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
    ready: true,
  });
});

audioElement.addEventListener('error', () => {
  void window.xtream.audio.reportMetadata({
    durationSeconds: Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
    ready: false,
    error: audioElement.error?.message ?? 'Audio failed to load.',
  });
});

animationFrame = window.requestAnimationFrame(tick);
driftTimer = window.setInterval(() => {
  if (!currentState || !getAudioSourceUrl(currentState) || audioElement.readyState < HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  const directorSeconds = getDirectorSeconds(currentState);
  void window.xtream.renderer.reportDrift({
    kind: 'control',
    observedSeconds: audioElement.currentTime,
    directorSeconds,
    driftSeconds: audioElement.currentTime - directorSeconds,
    reportedAtWallTimeMs: Date.now(),
  });
}, 1000);

window.addEventListener('beforeunload', () => {
  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
  }
  if (driftTimer !== undefined) {
    window.clearInterval(driftTimer);
  }
});
