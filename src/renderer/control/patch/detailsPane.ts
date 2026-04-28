import type {
  AudioSourceState,
  DirectorState,
  DisplayMonitorInfo,
  DisplayWindowState,
  VisualId,
  VisualState,
  VirtualOutputState,
} from '../../../shared/types';
import { OUTPUT_BUS_DELAY_MAX_MS, playOutputTestTone } from '../media/audioRuntime';
import { createButton, createHint, createSelect, createSlider, syncSliderProgress } from '../shared/dom';
import { patchElements as elements } from './elements';
import type { SelectedEntity } from '../shared/types';
import { attachAudioMediaDetailMount, attachVisualMediaDetailMount, type MediaDetailSharedDeps } from './mediaDetailSharedForms';
import { applyMediaDetailLivePreview } from './mediaDetailLivePreview';

type DetailsPaneControllerOptions = {
  getSelectedEntity: () => SelectedEntity | undefined;
  setSelectedEntity: (entity: SelectedEntity | undefined) => void;
  getDisplayMonitors: () => DisplayMonitorInfo[];
  getAudioDevices: () => MediaDeviceInfo[];
  isPanelInteractionActive: (panel: HTMLElement) => boolean;
  renderState: (state: DirectorState) => void;
  clearSelectionIf: (entity: SelectedEntity) => void;
  confirmPoolRecordRemoval: (label: string) => boolean;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
  getDisplayStatusLabel: (display: DisplayWindowState) => string;
  getDisplayTelemetry: (display: DisplayWindowState) => string;
  createMappingControls: (display: DisplayWindowState, visualIds: VisualId[], enabled?: boolean) => HTMLDivElement;
  createOutputDetailMixerStrip: (output: VirtualOutputState, state: DirectorState) => HTMLElement;
  createOutputSourceControls: (output: VirtualOutputState, state: DirectorState) => HTMLElement;
};

export type DetailsPaneController = {
  render: (state: DirectorState, force?: boolean) => void;
};

export function createDetailsPaneController(options: DetailsPaneControllerOptions): DetailsPaneController {
  let detailsRenderSignature = '';
  let disposeMediaPreview: (() => void) | undefined;
  let lastDirectorState: DirectorState | undefined;

  function clearMediaPreview(): void {
    disposeMediaPreview?.();
    disposeMediaPreview = undefined;
  }

  function render(state: DirectorState, force = false): void {
    lastDirectorState = state;
    const selectedEntity = options.getSelectedEntity();
    const signature = JSON.stringify({
      selectedEntity,
      state: createDetailsSignature(state),
      devices: options.getDisplayMonitors(),
      audioDevices: options.getAudioDevices().length,
    });
    if (!force && detailsRenderSignature === signature) {
      return;
    }
    if (!force && options.isPanelInteractionActive(elements.detailsContent)) {
      const ent = options.getSelectedEntity();
      if (ent?.type === 'visual' || ent?.type === 'audio-source') {
        applyMediaDetailLivePreview(elements.detailsContent, state, ent);
        detailsRenderSignature = signature;
      }
      return;
    }
    detailsRenderSignature = signature;
    clearMediaPreview();
    updateDetailsHeading();
    if (!selectedEntity) {
      renderDefaultDetails(state);
      return;
    }
    if (selectedEntity.type === 'visual') {
      const visual = state.visuals[selectedEntity.id];
      if (!visual) {
        options.setSelectedEntity(undefined);
        renderDefaultDetails(state);
        return;
      }
      renderVisualDetails(visual, state);
      return;
    }
    if (selectedEntity.type === 'audio-source') {
      const source = state.audioSources[selectedEntity.id];
      if (!source) {
        options.setSelectedEntity(undefined);
        renderDefaultDetails(state);
        return;
      }
      renderAudioSourceDetails(source, state);
      return;
    }
    if (selectedEntity.type === 'display') {
      const display = state.displays[selectedEntity.id];
      if (!display) {
        options.setSelectedEntity(undefined);
        renderDefaultDetails(state);
        return;
      }
      renderDisplayDetails(display, state);
      return;
    }
    const output = state.outputs[selectedEntity.id];
    if (!output) {
      options.setSelectedEntity(undefined);
      renderDefaultDetails(state);
      return;
    }
    renderOutputDetails(output, state);
  }

  function updateDetailsHeading(): void {
    const selectedEntity = options.getSelectedEntity();
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
    const selectedEntity = options.getSelectedEntity();
    const stableDisplays = Object.fromEntries(
      Object.entries(state.displays).map(([id, display]) => [id, stableDisplayForDetailsSignature(display)]),
    );
    const base = {
      performanceMode: state.performanceMode,
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

  function sharedMediaDeps(): MediaDetailSharedDeps {
    return {
      renderState: options.renderState,
      clearSelectionIf: options.clearSelectionIf,
      confirmPoolRecordRemoval: options.confirmPoolRecordRemoval,
      queueEmbeddedAudioImportPrompt: options.queueEmbeddedAudioImportPrompt,
      probeVisualMetadata: options.probeVisualMetadata,
      reportVisualMetadataFromVideo: options.reportVisualMetadataFromVideo,
    };
  }

  function renderVisualDetails(visual: VisualState, state: DirectorState): void {
    const disposeRef: { current?: () => void } = {};
    disposeMediaPreview = () => {
      disposeRef.current?.();
      disposeRef.current = undefined;
    };
    const layout = attachVisualMediaDetailMount(state, visual, sharedMediaDeps(), disposeRef);
    elements.detailsContent.replaceChildren(layout);
    applyMediaDetailLivePreview(elements.detailsContent, state, { type: 'visual', id: visual.id });
  }

  function renderAudioSourceDetails(source: AudioSourceState, state: DirectorState): void {
    const disposeRef: { current?: () => void } = {};
    disposeMediaPreview = () => {
      disposeRef.current?.();
      disposeRef.current = undefined;
    };
    const layout = attachAudioMediaDetailMount(state, source, sharedMediaDeps(), disposeRef);
    elements.detailsContent.replaceChildren(layout);
    applyMediaDetailLivePreview(elements.detailsContent, state, { type: 'audio-source', id: source.id });
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
      options.renderState(await window.xtream.director.getState());
    });
    pinOnTop.title = 'Keep this display window above other application windows';
    toolbarActions.append(
      pinOnTop,
      createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', async () => {
        await window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
        options.renderState(await window.xtream.director.getState());
      }),
    );
    if (display.health === 'closed') {
      toolbarActions.append(
        createButton('Reopen', 'secondary', async () => {
          await window.xtream.displays.reopen(display.id);
          options.renderState(await window.xtream.director.getState());
        }),
      );
    } else {
      toolbarActions.append(
        createButton('Close', 'secondary', async () => {
          await window.xtream.displays.close(display.id);
          options.renderState(await window.xtream.director.getState());
        }),
      );
    }
    toolbarActions.append(
      createButton('Remove', 'secondary', async () => {
        if (confirm(`Remove ${display.id}?`)) {
          await window.xtream.displays.remove(display.id);
          options.clearSelectionIf({ type: 'display', id: display.id });
          options.renderState(await window.xtream.director.getState());
        }
      }),
    );
    toolbar.append(toolbarStart, toolbarActions);
    const mapping = options.createMappingControls(display, visualIds, display.health !== 'closed');
    const monitorSelect = createSelect(
      'Monitor',
      [['', 'Current/default'], ...options.getDisplayMonitors().map((monitor): [string, string] => [monitor.id, monitor.label])],
      display.displayId ?? '',
      (displayId) => {
        void window.xtream.displays.update(display.id, { displayId: displayId || undefined });
      },
    );
    card.append(
      toolbar,
      createDetailLine('Display', display.id),
      createDetailLine('Status', options.getDisplayStatusLabel(display)),
      createDetailLine('Telemetry', options.getDisplayTelemetry(display)),
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
          options.clearSelectionIf({ type: 'output', id: output.id });
          options.renderState(await window.xtream.director.getState());
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
      const sinkLabel = options.getAudioDevices().find((device) => device.deviceId === sinkId)?.label;
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
    const sourceControls = options.createOutputSourceControls(output, state);
    const mainColumn = document.createElement('div');
    mainColumn.className = 'output-detail-main';
    mainColumn.append(routingRow, sourceControls);
    const stripWrap = document.createElement('div');
    stripWrap.className = 'output-detail-strip';
    stripWrap.append(options.createOutputDetailMixerStrip(output, state));
    const body = document.createElement('div');
    body.className = 'output-detail-body';
    body.append(mainColumn, stripWrap);
    card.append(toolbar, body);
    elements.detailsContent.replaceChildren(card);
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
      void onCommit(nextValue).then(async () => options.renderState(await window.xtream.director.getState()));
    };
    range.addEventListener('input', () => {
      number.value = range.value;
    });
    range.addEventListener('change', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    wrapper.append(title, range, number);
    return wrapper;
  }

  /** Range + number only, for the output routing 2x2 layout (headings on the row above). */
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
      void onCommit(nextValue).then(async () => options.renderState(await window.xtream.director.getState()));
    };
    range.addEventListener('input', () => {
      number.value = range.value;
    });
    range.addEventListener('change', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    wrapper.append(range, number);
    return wrapper;
  }

  function getAudioSinkOptions(): Array<[string, string]> {
    const sinkOptions: Array<[string, string]> = [['', 'System default output']];
    for (const device of options.getAudioDevices()) {
      sinkOptions.push([device.deviceId, device.label || `Audio output ${sinkOptions.length}`]);
    }
    return sinkOptions;
  }

  function createLabelInput(value: string, onCommit: (label: string) => Promise<unknown>): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'label-input';
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => {
      const label = input.value.trim() || value;
      input.value = label;
      void onCommit(label).then(async () => options.renderState(await window.xtream.director.getState()));
    });
    return input;
  }

  elements.detailsContent.addEventListener('input', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') {
      return;
    }
    if (!target.closest('.media-detail-layout__meta')) {
      return;
    }
    const selected = options.getSelectedEntity();
    if (!selected || (selected.type !== 'visual' && selected.type !== 'audio-source')) {
      return;
    }
    if (!lastDirectorState) {
      return;
    }
    applyMediaDetailLivePreview(elements.detailsContent, lastDirectorState, selected);
  });

  return { render };
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
