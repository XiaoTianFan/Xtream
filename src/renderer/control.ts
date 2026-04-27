import './styles.css';
import { describeLayout } from '../shared/layouts';
import { formatTimecode, getAudioEffectiveTime, getDirectorSeconds, getMediaEffectiveTime, parseTimecodeInput } from '../shared/timeline';
import type {
  AudioSourceState,
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  MediaValidationIssue,
  TransportCommand,
  VisualId,
  VisualLayoutProfile,
  VisualState,
  VirtualOutputState,
} from '../shared/types';

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputSourceRuntime = {
  audioSourceId: string;
  element: HTMLMediaElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
};

type OutputRuntime = {
  outputId: string;
  context: AudioContext;
  sources: OutputSourceRuntime[];
  busGain: GainNode;
  analyser: AnalyserNode;
  destination: MediaStreamAudioDestinationNode;
  sinkElement: SinkCapableAudioElement;
  meterData: Uint8Array<ArrayBuffer>;
  lastMeterReportMs: number;
};

const elements = {
  timecode: assertElement(document.querySelector<HTMLDivElement>('#timecode'), 'timecode'),
  stateView: assertElement(document.querySelector<HTMLPreElement>('#stateView'), 'stateView'),
  showStatus: assertElement(document.querySelector<HTMLDivElement>('#showStatus'), 'showStatus'),
  issueList: assertElement(document.querySelector<HTMLDivElement>('#issueList'), 'issueList'),
  visualList: assertElement(document.querySelector<HTMLDivElement>('#slotList'), 'slotList'),
  audioPanel: assertElement(document.querySelector<HTMLDivElement>('#audioPanel'), 'audioPanel'),
  displayList: assertElement(document.querySelector<HTMLDivElement>('#displayList'), 'displayList'),
  playButton: assertElement(document.querySelector<HTMLButtonElement>('#playButton'), 'playButton'),
  pauseButton: assertElement(document.querySelector<HTMLButtonElement>('#pauseButton'), 'pauseButton'),
  stopButton: assertElement(document.querySelector<HTMLButtonElement>('#stopButton'), 'stopButton'),
  timelineScrubber: assertElement(document.querySelector<HTMLInputElement>('#timelineScrubber'), 'timelineScrubber'),
  timelineSummary: assertElement(document.querySelector<HTMLDivElement>('#timelineSummary'), 'timelineSummary'),
  seekInput: assertElement(document.querySelector<HTMLInputElement>('#seekInput'), 'seekInput'),
  seekButton: assertElement(document.querySelector<HTMLButtonElement>('#seekButton'), 'seekButton'),
  rateInput: assertElement(document.querySelector<HTMLInputElement>('#rateInput'), 'rateInput'),
  rateButton: assertElement(document.querySelector<HTMLButtonElement>('#rateButton'), 'rateButton'),
  loopEnabledInput: assertElement(document.querySelector<HTMLInputElement>('#loopEnabledInput'), 'loopEnabledInput'),
  loopStartInput: assertElement(document.querySelector<HTMLInputElement>('#loopStartInput'), 'loopStartInput'),
  loopEndInput: assertElement(document.querySelector<HTMLInputElement>('#loopEndInput'), 'loopEndInput'),
  loopButton: assertElement(document.querySelector<HTMLButtonElement>('#loopButton'), 'loopButton'),
  saveShowButton: assertElement(document.querySelector<HTMLButtonElement>('#saveShowButton'), 'saveShowButton'),
  saveShowAsButton: assertElement(document.querySelector<HTMLButtonElement>('#saveShowAsButton'), 'saveShowAsButton'),
  openShowButton: assertElement(document.querySelector<HTMLButtonElement>('#openShowButton'), 'openShowButton'),
  exportDiagnosticsButton: assertElement(document.querySelector<HTMLButtonElement>('#exportDiagnosticsButton'), 'exportDiagnosticsButton'),
  applySplitButton: assertElement(document.querySelector<HTMLButtonElement>('#applyMode1Button'), 'applyMode1Button'),
  applyTwoButton: assertElement(document.querySelector<HTMLButtonElement>('#applyMode2Button'), 'applyMode2Button'),
  addVisualsButton: assertElement(document.querySelector<HTMLButtonElement>('#addVisualsButton'), 'addVisualsButton'),
  createSingleButton: assertElement(document.querySelector<HTMLButtonElement>('#createSingleButton'), 'createSingleButton'),
  createSplitButton: assertElement(document.querySelector<HTMLButtonElement>('#createSplitButton'), 'createSplitButton'),
};

let currentState: DirectorState | undefined;
let animationFrame: number | undefined;
let driftTimer: number | undefined;
let audioDevices: MediaDeviceInfo[] = [];
let displayMonitors: DisplayMonitorInfo[] = [];
let currentIssues: MediaValidationIssue[] = [];
let visualRenderSignature = '';
let audioRenderSignature = '';
let displayRenderSignature = '';
let audioGraphSignature = '';
let outputRuntimes = new Map<string, OutputRuntime>();
const activePanels = new WeakSet<HTMLElement>();

const transportDraftElements = new Set<HTMLInputElement>([
  elements.rateInput,
  elements.loopEnabledInput,
  elements.loopStartInput,
  elements.loopEndInput,
]);

function assertElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing control element: ${name}`);
  }
  return element;
}

function renderState(state: DirectorState): void {
  currentState = state;
  elements.stateView.textContent = JSON.stringify(state, null, 2);
  syncVirtualAudioGraph(state);
  syncTransportInputs(state);
  const nextVisualRenderSignature = createVisualRenderSignature(state);
  if (!isPanelInteractionActive(elements.visualList) && visualRenderSignature !== nextVisualRenderSignature) {
    visualRenderSignature = nextVisualRenderSignature;
    renderVisuals(Object.values(state.visuals));
  }
  const nextAudioRenderSignature = createAudioRenderSignature(state);
  if (!isPanelInteractionActive(elements.audioPanel) && audioRenderSignature !== nextAudioRenderSignature) {
    audioRenderSignature = nextAudioRenderSignature;
    renderAudio(state);
  }
  const nextDisplayRenderSignature = createDisplayRenderSignature(state);
  if (!isPanelInteractionActive(elements.displayList) && displayRenderSignature !== nextDisplayRenderSignature) {
    displayRenderSignature = nextDisplayRenderSignature;
    renderDisplays(Object.values(state.displays));
  } else {
    syncDisplayCardSummaries(Object.values(state.displays));
  }
  renderIssues([...state.readiness.issues, ...currentIssues]);
}

function isPanelInteractionActive(panel: HTMLElement): boolean {
  const activeElement = document.activeElement;
  return activePanels.has(panel) || (activeElement instanceof HTMLElement && panel.contains(activeElement) && activeElement.matches('button, select, input, textarea'));
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
      .map((output) => ({ ...output, meterDb: undefined })),
    devices: audioDevices.map((device) => `${device.deviceId}:${device.label}`).join('|'),
  });
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
    elements.loopStartInput.value = formatTimecode(state.loop.startSeconds);
  }
  if (!isTransportDraftActive(elements.loopEndInput)) {
    elements.loopEndInput.value = state.loop.endSeconds === undefined ? '' : formatTimecode(state.loop.endSeconds);
  }
  elements.showStatus.textContent = state.readiness.ready
    ? 'Show readiness: ready'
    : `Show readiness: blocked by ${state.readiness.issues.filter((issue) => issue.severity === 'error').length} issue(s)`;
  syncTimelineScrubber(state);
}

function syncTimelineScrubber(state: DirectorState): void {
  const duration = state.activeTimeline.durationSeconds;
  const currentSeconds = getDirectorSeconds(state);
  if (duration === undefined) {
    elements.timelineScrubber.disabled = true;
    elements.timelineScrubber.max = '0';
    elements.timelineScrubber.value = '0';
    elements.timelineSummary.textContent = 'No active timeline duration';
    return;
  }
  elements.timelineScrubber.disabled = false;
  elements.timelineScrubber.max = String(duration);
  if (document.activeElement !== elements.timelineScrubber) {
    elements.timelineScrubber.value = String(Math.min(currentSeconds, duration));
  }
  if (document.activeElement !== elements.seekInput) {
    elements.seekInput.value = formatTimecode(Math.min(currentSeconds, duration));
  }
  const loopLimit = state.activeTimeline.loopRangeLimit;
  elements.timelineSummary.textContent = `Timeline ${formatTimecode(Math.min(currentSeconds, duration))} / ${formatTimecode(duration)}${
    loopLimit ? ` | loop range limit: ${formatTimecode(loopLimit.startSeconds)}-${formatTimecode(loopLimit.endSeconds)}` : ''
  }`;
}

function isTransportDraftActive(input: HTMLInputElement): boolean {
  return document.activeElement === input || (transportDraftElements.has(input) && input.dataset.dirty === 'true');
}

function renderVisuals(visuals: VisualState[]): void {
  elements.visualList.replaceChildren(
    ...visuals.map((visual) => {
      const card = document.createElement('article');
      card.className = 'slot-card';
      const header = document.createElement('header');
      const title = createLabelInput(visual.label, (label) => window.xtream.visuals.update(visual.id, { label }));
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = visual.ready ? 'ready' : visual.path ? 'loading' : 'empty';
      header.append(title, badge);

      const preview = document.createElement('div');
      preview.className = 'visual-preview';
      if (visual.url && visual.type === 'image') {
        const image = document.createElement('img');
        image.src = visual.url;
        image.alt = visual.label;
        image.addEventListener('load', () => reportPreviewStatus(`visual-card:${visual.id}`, visual.id, true));
        image.addEventListener('error', () => reportPreviewStatus(`visual-card:${visual.id}`, visual.id, false, 'Visual card image preview failed to load.'));
        preview.append(image);
      } else if (visual.url && visual.type === 'video') {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = visual.url;
        video.dataset.visualId = visual.id;
        video.dataset.previewVideo = 'true';
        video.addEventListener('loadedmetadata', () => reportPreviewStatus(`visual-card:${visual.id}`, visual.id, true));
        video.addEventListener('error', () => reportPreviewStatus(`visual-card:${visual.id}`, visual.id, false, 'Visual card video preview failed to load.'));
        preview.append(video);
      }

      const pathText = document.createElement('div');
      pathText.className = 'path-text';
      pathText.title = visual.path ?? '';
      pathText.textContent = visual.path ?? 'No visual selected';

      const meta = document.createElement('div');
      meta.className = visual.error ? 'warning' : 'hint';
      meta.textContent = visual.error
        ? `Error: ${visual.error}`
        : `${visual.type} | duration: ${visual.durationSeconds?.toFixed(3) ?? 'n/a'}s | size: ${
            visual.width && visual.height ? `${visual.width}x${visual.height}` : 'n/a'
          } | embedded audio: ${visual.hasEmbeddedAudio === undefined ? 'unknown' : visual.hasEmbeddedAudio ? 'yes' : 'no'}`;

      const buttons = document.createElement('div');
      buttons.className = 'button-row';
      const replaceButton = createButton('Replace', 'secondary', async () => {
        await window.xtream.visuals.replace(visual.id);
        renderState(await window.xtream.director.getState());
      });
      const clearButton = createButton('Clear', 'secondary', async () => {
        await window.xtream.visuals.clear(visual.id);
        renderState(await window.xtream.director.getState());
      });
      const removeButton = createButton('Remove', 'secondary', async () => {
        await window.xtream.visuals.remove(visual.id);
        renderState(await window.xtream.director.getState());
      });
      buttons.append(replaceButton, clearButton, removeButton);
      card.append(header, preview, pathText, meta, buttons);
      return card;
    }),
  );
}

function renderAudio(state: DirectorState): void {
  const sourceSection = document.createElement('section');
  sourceSection.className = 'audio-section';
  sourceSection.append(createSectionHeading('Audio Pool'));
  const sourceButtons = document.createElement('div');
  sourceButtons.className = 'button-row';
  sourceButtons.append(createButton('Add External Audio', '', async () => {
    await window.xtream.audioSources.addFile();
    renderState(await window.xtream.director.getState());
  }));
  const embeddedSelect = createSelect(
    'Add Embedded Audio',
    [['', 'Choose visual'], ...Object.values(state.visuals).map((visual): [string, string] => [visual.id, visual.label])],
    '',
    (visualId) => {
      if (visualId) {
        void window.xtream.audioSources.addEmbedded(visualId).then(async () => renderState(await window.xtream.director.getState()));
      }
    },
  );
  sourceSection.append(sourceButtons, embeddedSelect);
  const sourceCards = Object.values(state.audioSources).map((source) => createAudioSourceCard(source, state));
  sourceSection.append(...(sourceCards.length > 0 ? sourceCards : [createHint('No audio sources yet.')]));

  const outputSection = document.createElement('section');
  outputSection.className = 'audio-section';
  outputSection.append(createSectionHeading('Virtual Outputs'));
  const outputButtons = document.createElement('div');
  outputButtons.className = 'button-row';
  outputButtons.append(
    createButton('Create Output', '', async () => {
      await window.xtream.outputs.create();
      renderState(await window.xtream.director.getState());
    }),
    createButton('Refresh Outputs', 'secondary', async () => {
      await loadAudioDevices();
      renderState(await window.xtream.director.getState());
    }),
  );
  outputSection.append(outputButtons, ...Object.values(state.outputs).map((output) => createVirtualOutputCard(output, state)));
  elements.audioPanel.replaceChildren(sourceSection, outputSection);
}

function createAudioSourceCard(source: AudioSourceState, state: DirectorState): HTMLElement {
  const card = document.createElement('article');
  card.className = 'audio-card';
  const header = document.createElement('header');
  const title = createLabelInput(source.label, (label) => window.xtream.audioSources.update(source.id, { label }));
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = source.ready ? 'ready' : 'loading';
  header.append(title, badge);
  const pathText = document.createElement('div');
  pathText.className = 'path-text';
  pathText.textContent =
    source.type === 'external-file' ? source.path ?? 'No file path' : `Embedded audio from ${state.visuals[source.visualId]?.label ?? source.visualId}`;
  const meta = document.createElement('div');
  meta.className = source.error ? 'warning' : 'hint';
  meta.textContent = source.error ? `Error: ${source.error}` : `duration: ${source.durationSeconds?.toFixed(3) ?? 'n/a'}s`;
  const buttons = document.createElement('div');
  buttons.className = 'button-row';
  buttons.append(
    createButton('Preview', 'secondary', () => playAudioSourcePreview(source, state)),
    ...(source.type === 'external-file'
      ? [
          createButton('Replace', 'secondary', async () => {
            await window.xtream.audioSources.replaceFile(source.id);
            renderState(await window.xtream.director.getState());
          }),
          createButton('Clear', 'secondary', async () => {
            await window.xtream.audioSources.clear(source.id);
            renderState(await window.xtream.director.getState());
          }),
        ]
      : [
          createButton('Clear', 'secondary', async () => {
            await window.xtream.audioSources.clear(source.id);
            renderState(await window.xtream.director.getState());
          }),
        ]),
    createButton('Remove', 'secondary', async () => {
      await window.xtream.audioSources.remove(source.id);
      renderState(await window.xtream.director.getState());
    }),
  );
  card.append(header, pathText, meta, buttons);
  return card;
}

function createVirtualOutputCard(output: VirtualOutputState, state: DirectorState): HTMLElement {
  const card = document.createElement('article');
  card.className = 'audio-card';
  const header = document.createElement('header');
  const title = createLabelInput(output.label, (label) => window.xtream.outputs.update(output.id, { label }));
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = output.ready ? 'ready' : output.sources.length > 0 ? 'blocked' : 'empty';
  header.append(title, badge);
  const sourceControls = createOutputSourceControls(output, state);
  const busControl = createDbFader('Bus level dB', output.busLevelDb, (busLevelDb) => {
    void window.xtream.outputs.update(output.id, { busLevelDb });
  });
  const sinkField = createSelect('Physical output', getAudioSinkOptions(), output.sinkId ?? '', (sinkId) => {
    const sinkLabel = audioDevices.find((device) => device.deviceId === sinkId)?.label;
    void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel });
  });
  const meter = document.createElement('div');
  meter.className = 'meter';
  const meterFill = document.createElement('div');
  meterFill.dataset.meterFill = output.id;
  meterFill.style.width = meterWidth(output.meterDb);
  meter.append(meterFill);
  const status = document.createElement('div');
  status.className = output.error ? 'warning' : 'hint';
  status.textContent = output.error ?? `Routing: ${output.physicalRoutingAvailable ? 'available' : 'fallback/default'} | meter: ${
    output.meterDb?.toFixed(1) ?? '-inf'
  } dB`;
  const buttons = document.createElement('div');
  buttons.className = 'button-row';
  buttons.append(
    createButton(output.muted ? 'Unmute Output' : 'Mute Output', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, { muted: !output.muted });
      renderState(await window.xtream.director.getState());
    }),
    createButton('Test Tone', 'secondary', () => playOutputTestTone(output)),
    createButton(output.fallbackAccepted ? 'Fallback Accepted' : 'Accept Fallback', 'secondary', async () => {
      await window.xtream.outputs.update(output.id, { fallbackAccepted: true });
      renderState(await window.xtream.director.getState());
    }),
    createButton('Remove', 'secondary', async () => {
      await window.xtream.outputs.remove(output.id);
      renderState(await window.xtream.director.getState());
    }),
  );
  card.append(header, sourceControls, busControl, sinkField, meter, status, buttons);
  return card;
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

function syncVirtualAudioGraph(state: DirectorState): void {
  const signature = JSON.stringify(
    Object.values(state.outputs)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((output) => ({
        id: output.id,
        sinkId: output.sinkId,
        sources: output.sources.map((selection) => ({
          id: selection.audioSourceId,
          url: getAudioSourceUrl(selection.audioSourceId, state),
        })),
      })),
  );
  if (signature !== audioGraphSignature) {
    audioGraphSignature = signature;
    void rebuildAudioGraph(state);
  }
  syncAudioRuntimeToDirector(state);
}

async function rebuildAudioGraph(state: DirectorState): Promise<void> {
  for (const runtime of outputRuntimes.values()) {
    runtime.sinkElement.pause();
    runtime.sinkElement.remove();
    for (const source of runtime.sources) {
      source.element.pause();
      source.element.remove();
    }
    await runtime.context.close().catch(() => undefined);
  }
  outputRuntimes = new Map();
  const AudioContextCtor = window.AudioContext;
  for (const output of Object.values(state.outputs)) {
    const context = new AudioContextCtor();
    const busGain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const destination = context.createMediaStreamDestination();
    const sinkElement = createHiddenAudioOutput();
    sinkElement.srcObject = destination.stream;
    busGain.connect(analyser);
    analyser.connect(destination);
    const runtime: OutputRuntime = {
      outputId: output.id,
      context,
      sources: [],
      busGain,
      analyser,
      destination,
      sinkElement,
      meterData: new Uint8Array(analyser.fftSize),
      lastMeterReportMs: 0,
    };
    for (const selection of output.sources) {
      const url = getAudioSourceUrl(selection.audioSourceId, state);
      if (!url) {
        continue;
      }
      const element = document.createElement('audio');
      element.preload = 'auto';
      element.style.display = 'none';
      element.src = url;
      document.body.append(element);
      const sourceNode = context.createMediaElementSource(element);
      const gainNode = context.createGain();
      sourceNode.connect(gainNode).connect(busGain);
      element.addEventListener('loadedmetadata', () => {
        void window.xtream.audioSources.reportMetadata({
          audioSourceId: selection.audioSourceId,
          durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
          ready: true,
        });
      });
      element.addEventListener('error', () => {
        void window.xtream.audioSources.reportMetadata({
          audioSourceId: selection.audioSourceId,
          durationSeconds: Number.isFinite(element.duration) ? element.duration : undefined,
          ready: false,
          error: element.error?.message ?? 'Audio failed to load.',
        });
      });
      runtime.sources.push({ audioSourceId: selection.audioSourceId, element, sourceNode, gainNode });
    }
    outputRuntimes.set(output.id, runtime);
    await applyOutputSink(output, runtime);
  }
}

async function applyOutputSink(output: VirtualOutputState, runtime: OutputRuntime): Promise<void> {
  if (!runtime.sinkElement.setSinkId) {
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: false,
      fallbackReason: 'setSinkId unavailable',
    });
    return;
  }
  try {
    await runtime.sinkElement.setSinkId(output.sinkId ?? '');
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: true,
      fallbackReason: 'none',
      error: undefined,
    });
  } catch (error) {
    await window.xtream.outputs.update(output.id, {
      physicalRoutingAvailable: false,
      fallbackReason: error instanceof Error ? error.message : 'sink assignment failed',
      error: error instanceof Error ? error.message : 'Audio sink assignment failed.',
    });
  }
}

function syncAudioRuntimeToDirector(state: DirectorState): void {
  const directorSeconds = getDirectorSeconds(state);
  for (const output of Object.values(state.outputs)) {
    const runtime = outputRuntimes.get(output.id);
    if (!runtime) {
      continue;
    }
    runtime.busGain.gain.value = output.muted ? 0 : dbToGain(output.busLevelDb);
    for (const sourceRuntime of runtime.sources) {
      const selection = output.sources.find((candidate) => candidate.audioSourceId === sourceRuntime.audioSourceId);
      const source = state.audioSources[sourceRuntime.audioSourceId];
      if (!selection || !source) {
        continue;
      }
      const target = getAudioEffectiveTime(directorSeconds, source.durationSeconds, state.loop);
      sourceRuntime.gainNode.gain.value = selection.muted || !target.audible ? 0 : dbToGain(selection.levelDb);
      if (sourceRuntime.element.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(sourceRuntime.element.currentTime - target.seconds) > 0.08) {
        sourceRuntime.element.currentTime = target.seconds;
      }
      sourceRuntime.element.playbackRate = state.rate;
      if (state.paused || !target.audible) {
        sourceRuntime.element.pause();
      } else if (sourceRuntime.element.paused) {
        void runtime.context.resume().then(() => sourceRuntime.element.play()).catch(() => undefined);
      }
    }
    if (state.paused) {
      runtime.sinkElement.pause();
    } else if (runtime.sinkElement.paused) {
      void runtime.sinkElement.play().catch(() => undefined);
    }
  }
}

function sampleMeters(state: DirectorState): void {
  const now = Date.now();
  for (const [outputId, runtime] of outputRuntimes) {
    runtime.analyser.getByteTimeDomainData(runtime.meterData);
    let peak = 0;
    for (const sample of runtime.meterData) {
      peak = Math.max(peak, Math.abs((sample - 128) / 128));
    }
    const meterDb = peak <= 0.00001 ? -60 : Math.max(-60, 20 * Math.log10(peak));
    const fill = elements.audioPanel.querySelector<HTMLElement>(`[data-meter-fill="${outputId}"]`);
    if (fill) {
      fill.style.width = meterWidth(meterDb);
    }
    if (now - runtime.lastMeterReportMs > 250 && currentState?.outputs[outputId]) {
      runtime.lastMeterReportMs = now;
      void window.xtream.outputs.reportMeter(outputId, meterDb);
    }
  }
}

function getAudioSourceUrl(audioSourceId: string, state: DirectorState): string {
  const source = state.audioSources[audioSourceId];
  if (!source) {
    return '';
  }
  if (source.type === 'external-file') {
    return source.url ?? '';
  }
  return state.visuals[source.visualId]?.url ?? '';
}

function createHiddenAudioOutput(): SinkCapableAudioElement {
  const output = document.createElement('audio') as SinkCapableAudioElement;
  output.autoplay = true;
  output.style.display = 'none';
  document.body.append(output);
  return output;
}

function playAudioSourcePreview(source: AudioSourceState, state: DirectorState): void {
  const url = source.type === 'external-file' ? source.url : state.visuals[source.visualId]?.url;
  if (!url) {
    setShowStatus(`Preview unavailable: ${source.label} has no playable URL.`);
    return;
  }
  const audio = createHiddenAudioOutput();
  audio.src = url;
  audio.currentTime = 0;
  audio.play().catch((error: unknown) => {
    setShowStatus(`Preview failed: ${error instanceof Error ? error.message : 'Unable to play audio source.'}`);
  });
  window.setTimeout(() => {
    audio.pause();
    audio.remove();
  }, 2500);
}

async function playOutputTestTone(output: VirtualOutputState): Promise<void> {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const toneOutput = createHiddenAudioOutput();
  oscillator.frequency.value = 660;
  gain.gain.value = dbToGain(output.busLevelDb) * 0.18;
  oscillator.connect(gain).connect(destination);
  toneOutput.srcObject = destination.stream;
  if (toneOutput.setSinkId) {
    await toneOutput.setSinkId(output.sinkId ?? '');
  }
  oscillator.start();
  await toneOutput.play();
  window.setTimeout(() => {
    oscillator.stop();
    toneOutput.pause();
    toneOutput.remove();
    void context.close();
  }, 850);
}

function dbToGain(db: number): number {
  return db <= -60 ? 0 : 10 ** (db / 20);
}

function meterWidth(db: number | undefined): string {
  return `${Math.max(0, Math.min(100, ((db ?? -60) + 60) * (100 / 72)))}%`;
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
  const visualIds = Object.keys(currentState?.visuals ?? {});
  elements.displayList.replaceChildren(
    ...displays.map((display) => {
      const card = document.createElement('article');
      card.className = 'display-card';
      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = display.id;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.displayBadge = display.id;
      badge.textContent = `${display.layout.type} / ${display.health}`;
      header.append(title, badge);
      const details = document.createElement('div');
      details.className = 'hint';
      details.dataset.displayDetails = display.id;
      details.textContent = `${describeLayout(display.layout)} | fullscreen: ${display.fullscreen ? 'yes' : 'no'} | drift: ${
        display.lastDriftSeconds?.toFixed(3) ?? 'n/a'
      }`;
      const preview = createDisplayPreview(display, currentState);
      const mapping = createMappingControls(display, visualIds, display.health !== 'closed');
      const monitorSelect = createSelect(
        'Monitor',
        [['', 'Current/default'], ...displayMonitors.map((monitor): [string, string] => [monitor.id, monitor.label])],
        display.displayId ?? '',
        (displayId) => {
          void window.xtream.displays.update(display.id, { displayId: displayId || undefined });
        },
      );
      const buttons = document.createElement('div');
      buttons.className = 'button-row';
      buttons.append(
        createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', () => {
          void window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
        }),
        createButton('Close Window', 'secondary', async () => {
          await window.xtream.displays.close(display.id);
          renderState(await window.xtream.director.getState());
        }),
        createButton('Reopen With Mapping', 'secondary', async () => {
          await window.xtream.displays.reopen(display.id);
          renderState(await window.xtream.director.getState());
        }),
        createButton('Remove Display', 'secondary', async () => {
          await window.xtream.displays.remove(display.id);
          renderState(await window.xtream.director.getState());
        }),
      );
      card.append(header, details, preview, mapping, monitorSelect, buttons);
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
        return `${visualId}:${visual?.type ?? 'missing'}:${visual?.url ?? ''}:${visual?.label ?? ''}:${visual?.ready ? 'ready' : 'not-ready'}:${visual?.error ?? ''}`;
      });
      return `${display.id}:${display.layout.type}:${JSON.stringify(display.layout)}:${display.health}:${display.fullscreen}:${display.displayId ?? ''}:${visualParts.join(',')}`;
    });
  const monitorSignature = displayMonitors.map((monitor) => `${monitor.id}:${monitor.label}`).join(',');
  return `${displayParts.join('|')}::${monitorSignature}`;
}

function syncDisplayCardSummaries(displays: DisplayWindowState[]): void {
  for (const display of displays) {
    const badge = elements.displayList.querySelector<HTMLElement>(`[data-display-badge="${display.id}"]`);
    if (badge) {
      badge.textContent = `${display.layout.type} / ${display.health}`;
    }
    const details = elements.displayList.querySelector<HTMLElement>(`[data-display-details="${display.id}"]`);
    if (details) {
      details.textContent = `${describeLayout(display.layout)} | fullscreen: ${
        display.fullscreen ? 'yes' : 'no'
      } | drift: ${display.lastDriftSeconds?.toFixed(3) ?? 'n/a'}`;
    }
  }
}

function createDisplayPreview(display: DisplayWindowState, state: DirectorState | undefined): HTMLElement {
  const preview = document.createElement('div');
  preview.className = `display-preview ${display.layout.type}`;
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
      image.addEventListener('load', () => reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, true, undefined, display.id));
      image.addEventListener('error', () =>
        reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, false, `${display.id} image preview failed to load.`, display.id),
      );
      pane.append(image);
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = visual.url;
      video.dataset.visualId = visualId;
      video.dataset.previewVideo = 'true';
      video.playbackRate = state.rate;
      video.addEventListener('loadedmetadata', () => reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, true, undefined, display.id));
      video.addEventListener('error', () =>
        reportPreviewStatus(`display:${display.id}:${visualId}`, visualId, false, `${display.id} video preview failed to load.`, display.id),
      );
      pane.append(video);
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

function createPreviewLabel(label: string, detail: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'preview-empty';
  const title = document.createElement('strong');
  title.textContent = label;
  const description = document.createElement('small');
  description.textContent = detail;
  wrapper.append(title, description);
  return wrapper;
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
    const visualSelect = createSelect(
      'Visual',
      visualIds.map((visualId) => [visualId, currentState?.visuals[visualId]?.label ?? visualId]),
      display.layout.visualId ?? '',
      (visualId) => void updateDisplayLayout(display.id, { type: 'single', visualId }),
    );
    setSelectEnabled(visualSelect, enabled);
    wrapper.append(visualSelect);
    return wrapper;
  }
  const [leftVisual, rightVisual] = display.layout.visualIds;
  const options = visualIds.map((visualId) => [visualId, currentState?.visuals[visualId]?.label ?? visualId] as [string, string]);
  const leftSelect = createSelect('Left visual', options, leftVisual ?? '', (visualId) => {
    void updateDisplayLayout(display.id, { type: 'split', visualIds: [visualId, rightVisual] });
  });
  const rightSelect = createSelect('Right visual', options, rightVisual ?? '', (visualId) => {
    void updateDisplayLayout(display.id, { type: 'split', visualIds: [leftVisual, visualId] });
  });
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

function createSelect(labelText: string, options: Array<[string, string]>, value: string, onChange: (value: string) => void): HTMLDivElement {
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

function createDbFader(labelText: string, value: number, onChange: (value: number) => void): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'db-control';
  const label = document.createElement('label');
  label.textContent = labelText;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '-60';
  range.max = '12';
  range.step = '1';
  range.value = String(value);
  const number = document.createElement('input');
  number.type = 'number';
  number.min = '-60';
  number.max = '12';
  number.step = '1';
  number.value = String(value);
  const commit = (rawValue: string) => {
    const nextValue = Math.min(12, Math.max(-60, Number(rawValue)));
    if (Number.isFinite(nextValue)) {
      range.value = String(nextValue);
      number.value = String(nextValue);
      onChange(nextValue);
    }
  };
  range.addEventListener('input', () => {
    number.value = range.value;
    commit(range.value);
  });
  number.addEventListener('change', () => commit(number.value));
  field.append(label, range, number);
  return field;
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

function tick(): void {
  if (currentState) {
    elements.timecode.textContent = formatTimecode(getDirectorSeconds(currentState));
    syncTimelineScrubber(currentState);
    syncAudioRuntimeToDirector(currentState);
    syncPreviewElements(currentState);
    sampleMeters(currentState);
  }
  animationFrame = window.requestAnimationFrame(tick);
}

function syncPreviewElements(state: DirectorState): void {
  const targetSeconds = getDirectorSeconds(state);
  const videos = document.querySelectorAll<HTMLVideoElement>('video[data-preview-video="true"]');
  for (const video of videos) {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      continue;
    }
    const visualId = video.dataset.visualId;
    const visualDuration = visualId ? state.visuals[visualId]?.durationSeconds : undefined;
    const effectiveTarget = getMediaEffectiveTime(targetSeconds, visualDuration ?? video.duration, state.loop);
    if (Math.abs(video.currentTime - effectiveTarget) > 0.12) {
      video.currentTime = effectiveTarget;
    }
    video.playbackRate = state.rate;
    if (state.paused) {
      video.pause();
    } else if (video.paused) {
      void video.play().catch(() => undefined);
    }
  }
}

async function sendTransport(command: TransportCommand): Promise<void> {
  renderState(await window.xtream.director.transport(command));
}

function readLoopDraft(): DirectorState['loop'] {
  const start = parseTimecodeInput(elements.loopStartInput.value);
  const end = elements.loopEndInput.value.trim() === '' ? undefined : parseTimecodeInput(elements.loopEndInput.value);
  return {
    enabled: elements.loopEnabledInput.checked,
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

async function commitRateDraft(): Promise<void> {
  await sendTransport({ type: 'set-rate', rate: Number(elements.rateInput.value) || 1 });
  clearTransportDrafts([elements.rateInput]);
}

async function commitLoopDraft(): Promise<void> {
  await sendTransport({ type: 'set-loop', loop: readLoopDraft() });
  clearTransportDrafts([elements.loopEnabledInput, elements.loopStartInput, elements.loopEndInput]);
}

function getAudioSinkOptions(): Array<[string, string]> {
  const options: Array<[string, string]> = [['', 'System default output']];
  for (const device of audioDevices) {
    options.push([device.deviceId, device.label || `Audio output ${options.length}`]);
  }
  return options;
}

function createSectionHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement('h3');
  heading.textContent = text;
  return heading;
}

function createHint(text: string): HTMLParagraphElement {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = text;
  return hint;
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

function createButton(label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) {
    button.className = className;
  }
  button.textContent = label;
  button.addEventListener('click', () => void onClick());
  return button;
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

installInteractionLock(elements.visualList);
installInteractionLock(elements.audioPanel);
installInteractionLock(elements.displayList);

elements.playButton.addEventListener('click', () => void sendTransport({ type: 'play' }));
elements.pauseButton.addEventListener('click', () => void sendTransport({ type: 'pause' }));
elements.stopButton.addEventListener('click', () => void sendTransport({ type: 'stop' }));
elements.timelineScrubber.addEventListener('input', () => {
  elements.seekInput.value = formatTimecode(Number(elements.timelineScrubber.value) || 0);
});
elements.timelineScrubber.addEventListener('change', () => {
  void sendTransport({ type: 'seek', seconds: Number(elements.timelineScrubber.value) || 0 });
});
elements.seekButton.addEventListener('click', () => {
  const result = parseTimecodeInput(elements.seekInput.value);
  if (!result.ok) {
    setShowStatus(`Seek timecode rejected: ${result.error}`);
    return;
  }
  void sendTransport({ type: 'seek', seconds: result.seconds });
});
elements.rateButton.addEventListener('click', () => void commitRateDraft());
elements.loopButton.addEventListener('click', () => void commitLoopDraft());
elements.rateInput.addEventListener('input', () => markTransportDraft(elements.rateInput));
elements.rateInput.addEventListener('change', () => void commitRateDraft());
for (const input of [elements.loopEnabledInput, elements.loopStartInput, elements.loopEndInput]) {
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
elements.applySplitButton.addEventListener('click', async () => {
  const result = await window.xtream.director.applyPreset('split-display-one-screen');
  renderState(result.state);
});
elements.applyTwoButton.addEventListener('click', async () => {
  const result = await window.xtream.director.applyPreset('two-displays');
  renderState(result.state);
});
elements.addVisualsButton.addEventListener('click', async () => {
  await window.xtream.visuals.add();
  renderState(await window.xtream.director.getState());
});
elements.createSingleButton.addEventListener('click', async () => {
  await window.xtream.displays.create({ layout: { type: 'single', visualId: Object.keys(currentState?.visuals ?? {})[0] } });
  renderState(await window.xtream.director.getState());
});
elements.createSplitButton.addEventListener('click', async () => {
  const [left, right] = Object.keys(currentState?.visuals ?? {});
  await window.xtream.displays.create({ layout: { type: 'split', visualIds: [left, right] } });
  renderState(await window.xtream.director.getState());
});
window.xtream.director.onState(renderState);
void window.xtream.renderer.ready({ kind: 'control' });
void loadAudioDevices();
void loadDisplayMonitors();
void window.xtream.director.getState().then(renderState);

animationFrame = window.requestAnimationFrame(tick);
driftTimer = window.setInterval(() => {
  if (!currentState) {
    return;
  }
  const firstRuntime = outputRuntimes.values().next().value as OutputRuntime | undefined;
  const firstSource = firstRuntime?.sources.find((source) => source.element.readyState >= HTMLMediaElement.HAVE_METADATA);
  if (!firstSource) {
    return;
  }
  const directorSeconds = getDirectorSeconds(currentState);
  void window.xtream.renderer.reportDrift({
    kind: 'control',
    observedSeconds: firstSource.element.currentTime,
    directorSeconds,
    driftSeconds: firstSource.element.currentTime - directorSeconds,
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
