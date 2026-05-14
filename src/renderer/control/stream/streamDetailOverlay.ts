import type {
  DirectorState,
  DisplayWindowState,
  StreamEnginePublicState,
  VirtualOutputState,
  VisualId,
  VisualMingleAlgorithm,
  VisualMingleMode,
} from '../../../shared/types';
import type { SelectedEntity } from '../shared/types';
import { applyMediaDetailLivePreview } from '../patch/mediaDetailLivePreview';
import { attachAudioMediaDetailMount, attachVisualMediaDetailMount, type MediaDetailSharedDeps } from '../patch/mediaDetailSharedForms';
import type { DisplayWorkspaceController } from '../patch/displayWorkspace';
import type { MixerPanelController } from '../patch/mixerPanel';
import { playOutputTestTone } from '../media/audioRuntime';
import { createButton, createHint, createSelect } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import { shellShowConfirm } from '../shell/shellModalPresenter';
import type { BottomTab, DetailPane, StreamSurfaceOptions } from './streamTypes';
import { createStreamDetailField, createStreamDetailLine, createStreamTextInput } from './streamDom';
import { createDisplayWindowGantt } from './displayWindowGantt';
import { createOutputBusGantt } from './outputBusGantt';

type StreamTempDetailActions = {
  returnTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
};

export type StreamDetailOverlayDeps = {
  detailPane: DetailPane;
  currentState: DirectorState;
  streamState: StreamEnginePublicState | undefined;
  getDirectorState: () => DirectorState | undefined;
  options: StreamSurfaceOptions;
  displayWorkspace: DisplayWorkspaceController | undefined;
  mixerPanel: MixerPanelController | undefined;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
  refreshDirector: () => Promise<void>;
  mediaDetailDeps: MediaDetailSharedDeps;
  registerStreamDetailUnmount: (cleanup: () => void) => void;
};

const detailTitleByType: Record<DetailPane['type'], string> = {
  display: 'Display Details',
  output: 'Output Details',
  visual: 'Visual Details',
  'audio-source': 'Audio Source Details',
};

export function createStreamDetailOverlay(deps: StreamDetailOverlayDeps): HTMLElement {
  const {
    detailPane,
    currentState,
    streamState,
    getDirectorState,
    options,
    displayWorkspace,
    mixerPanel,
    setBottomTab,
    clearDetailPane,
    requestRender,
    refreshDirector,
    mediaDetailDeps,
    registerStreamDetailUnmount,
  } = deps;
  const tempDetailActions: StreamTempDetailActions = {
    returnTab: detailPane.returnTab,
    setBottomTab,
    clearDetailPane,
    requestRender,
  };
  const wrap = document.createElement('section');
  wrap.className = 'stream-detail-pane';
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('h2');
  title.textContent = detailTitleByType[detailPane.type];
  const close = createButton('Close', 'secondary', () => {
    setBottomTab(detailPane.returnTab);
    clearDetailPane();
    requestRender();
  });
  decorateIconButton(close, 'X', 'Close details');
  header.append(title, close);
  const body = document.createElement('div');
  body.className = 'stream-detail-body';
  if (detailPane.type === 'display') {
    const display = currentState.displays[detailPane.id];
    body.append(
      display
        ? createStreamDisplayDetailCard(display, currentState, streamState, options, displayWorkspace, refreshDirector, tempDetailActions)
        : createHint('Display not found.'),
    );
  } else if (detailPane.type === 'output') {
    const output = currentState.outputs[detailPane.id];
    body.append(
      output ? createStreamOutputDetailLayout(output, currentState, streamState, options, mixerPanel, refreshDirector, tempDetailActions) : createHint('Output not found.'),
    );
  } else if (detailPane.type === 'visual') {
    const visual = currentState.visuals[detailPane.id];
    if (!visual) {
      body.append(createHint('Visual not found.'));
    } else {
      const disposeRef: { current?: () => void } = {};
      registerStreamDetailUnmount(() => {
        disposeRef.current?.();
        disposeRef.current = undefined;
      });
      body.append(attachVisualMediaDetailMount(currentState, visual, mediaDetailDeps, disposeRef));
      const selected: SelectedEntity = { type: 'visual', id: visual.id };
      applyMediaDetailLivePreview(body, currentState, selected);
      wireStreamMediaSliderLive(body, getDirectorState, selected);
    }
  } else {
    const source = currentState.audioSources[detailPane.id];
    if (!source) {
      body.append(createHint('Audio source not found.'));
    } else {
      const disposeRef: { current?: () => void } = {};
      registerStreamDetailUnmount(() => {
        disposeRef.current?.();
        disposeRef.current = undefined;
      });
      body.append(attachAudioMediaDetailMount(currentState, source, mediaDetailDeps, disposeRef));
      const selected: SelectedEntity = { type: 'audio-source', id: source.id };
      applyMediaDetailLivePreview(body, currentState, selected);
      wireStreamMediaSliderLive(body, getDirectorState, selected);
    }
  }
  wrap.append(header, body);
  return wrap;
}

function wireStreamMediaSliderLive(
  root: HTMLElement,
  getDirectorState: () => DirectorState | undefined,
  selected: SelectedEntity,
): void {
  if (selected.type !== 'visual' && selected.type !== 'audio-source') {
    return;
  }
  root.addEventListener('input', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') {
      return;
    }
    if (!target.closest('.media-detail-layout__meta')) {
      return;
    }
    const state = getDirectorState();
    if (!state) {
      return;
    }
    applyMediaDetailLivePreview(root, state, selected);
  });
}

function createStreamDisplayDetailCard(
  display: DisplayWindowState,
  state: DirectorState,
  streamState: StreamEnginePublicState | undefined,
  options: StreamSurfaceOptions,
  displayWorkspace: DisplayWorkspaceController | undefined,
  refreshDirector: () => Promise<void>,
  paneActions: StreamTempDetailActions,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'detail-card stream-display-detail-card';
  const label = createStreamTextInput(display.label ?? display.id, (value) => window.xtream.displays.update(display.id, { label: value }).then(refreshDirector));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createStreamDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  const pinOnTop = createButton(display.alwaysOnTop ? 'Normal layer' : 'Always on top', 'secondary', async () => {
    await window.xtream.displays.update(display.id, { alwaysOnTop: !display.alwaysOnTop });
    await refreshDirector();
  });
  pinOnTop.title = 'Keep this display window above other application windows';
  toolbarActions.append(
    pinOnTop,
    createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', async () => {
      await window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen });
      await refreshDirector();
    }),
  );
  if (display.health === 'closed') {
    toolbarActions.append(
      createButton('Reopen', 'secondary', async () => {
        await window.xtream.displays.reopen(display.id);
        await refreshDirector();
      }),
    );
  } else {
    toolbarActions.append(
      createButton('Close', 'secondary', async () => {
        await window.xtream.displays.close(display.id);
        await refreshDirector();
      }),
    );
  }
  toolbarActions.append(
    createButton('Remove', 'secondary', async () => {
      if (!(await shellShowConfirm('Remove display?', `Remove ${display.id}?`))) {
        return;
      }
      await window.xtream.displays.remove(display.id);
      paneActions.setBottomTab(paneActions.returnTab);
      paneActions.clearDetailPane();
      paneActions.requestRender();
      await refreshDirector();
    }),
  );
  toolbar.append(toolbarStart, toolbarActions);

  const monitor = createSelect(
    'Monitor',
    [['', 'Current/default'], ...options.getDisplayMonitors().map((m): [string, string] => [m.id, m.label])],
    display.displayId ?? '',
    (displayId) => void window.xtream.displays.update(display.id, { displayId: displayId || undefined }).then(refreshDirector),
  );
  const visualIds = Object.keys(state.visuals).sort() as VisualId[];
  const layoutControl =
    displayWorkspace?.createLayoutControl(display, visualIds, display.health !== 'closed') ?? createHint('Layout control unavailable.');
  const monitorLayoutRow = document.createElement('div');
  monitorLayoutRow.className = 'stream-display-monitor-layout-row';
  monitorLayoutRow.append(monitor, layoutControl);

  const minglePersist = state.displayVisualMingle?.[display.id];
  const mingleMode = minglePersist?.mode ?? 'prioritize-latest';
  const mingleAlgorithm = minglePersist?.algorithm ?? 'latest';
  const mingleAlgo: VisualMingleAlgorithm[] = ['latest', 'alpha-over', 'additive', 'multiply', 'screen', 'lighten', 'darken', 'crossfade'];
  const mingleModeSelect = createSelect(
    'Visual conflict mode',
    [
      ['prioritize-latest', 'Prioritize latest'],
      ['layered', 'Layered rendering'],
    ],
    mingleMode,
    (mode) =>
      void window.xtream.displays
        .update(display.id, {
          visualMingle: {
            mode: mode as VisualMingleMode,
            algorithm: mingleAlgorithm,
            defaultTransitionMs: minglePersist?.defaultTransitionMs,
          },
        })
        .then(refreshDirector),
  );
  const mingleSelect = createSelect(
    'Visual mingle algorithm',
    mingleAlgo.map((alg): [VisualMingleAlgorithm, string] => [
      alg,
      alg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    ]),
    mingleAlgorithm,
    (algorithm) =>
      void window.xtream.displays
        .update(display.id, {
          visualMingle: {
            mode: mingleMode,
            algorithm: algorithm as VisualMingleAlgorithm,
            defaultTransitionMs: minglePersist?.defaultTransitionMs,
          },
        })
        .then(refreshDirector),
  );

  const transWrap = document.createElement('div');
  transWrap.className = 'detail-field stream-display-mingle-trans';
  const transLabel = document.createElement('label');
  transLabel.textContent = 'Crossfade transition (ms)';
  const transInput = document.createElement('input');
  transInput.type = 'number';
  transInput.min = '0';
  transInput.step = '50';
  transInput.className = 'label-input';
  transInput.placeholder = '(optional)';
  transInput.value = minglePersist?.defaultTransitionMs !== undefined ? String(minglePersist.defaultTransitionMs) : '';
  transInput.addEventListener('change', () => {
    const raw = transInput.value.trim();
    const ms = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
    void window.xtream.displays
      .update(display.id, {
        visualMingle: {
          mode: mingleMode,
          algorithm: mingleAlgorithm,
          ...(ms !== undefined ? { defaultTransitionMs: ms } : {}),
        },
      })
      .then(refreshDirector);
  });
  transWrap.append(transLabel, transInput);

  card.append(
    toolbar,
    monitorLayoutRow,
    mingleModeSelect,
    mingleSelect,
    transWrap,
    createStreamDetailLine('Status', displayWorkspace?.getDisplayStatusLabel(display) ?? 'Display'),
    createStreamDetailLine('Telemetry', displayWorkspace?.getDisplayTelemetry(display) ?? display.id),
    createDisplayWindowGantt(display.id, { streamState, directorState: state }),
  );
  return card;
}

function createStreamOutputDetailLayout(
  output: VirtualOutputState,
  state: DirectorState,
  streamState: StreamEnginePublicState | undefined,
  options: StreamSurfaceOptions,
  mixerPanel: MixerPanelController | undefined,
  refreshDirector: () => Promise<void>,
  paneActions: StreamTempDetailActions,
): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'stream-output-detail-layout';
  const card = document.createElement('div');
  card.className = 'detail-card stream-output-detail-controls';
  const stripWrap = document.createElement('div');
  stripWrap.className = 'stream-output-detail-strip';
  const label = createStreamTextInput(output.label, (value) => window.xtream.outputs.update(output.id, { label: value }).then(refreshDirector));
  const toolbar = document.createElement('div');
  toolbar.className = 'output-detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'output-detail-toolbar-start';
  toolbarStart.append(createStreamDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'output-detail-toolbar-actions button-row';
  toolbarActions.append(
    createButton('Test Tone', 'secondary', () => playOutputTestTone(output)),
    createButton('Remove', 'secondary', async () => {
      if (!(await shellShowConfirm('Remove output?', `Remove ${output.label}?`))) {
        return;
      }
      await window.xtream.outputs.remove(output.id);
      paneActions.setBottomTab(paneActions.returnTab);
      paneActions.clearDetailPane();
      paneActions.requestRender();
      await refreshDirector();
    }),
  );
  toolbar.append(toolbarStart, toolbarActions);

  const sink = createSelect(
    'Physical output',
    [['', 'System default output'], ...options.getAudioDevices().map((device, index): [string, string] => [device.deviceId, device.label || `Audio output ${index + 1}`])],
    output.sinkId ?? '',
    (sinkId) => {
      const sinkLabel = options.getAudioDevices().find((device) => device.deviceId === sinkId)?.label;
      void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel }).then(refreshDirector);
    },
  );
  card.append(toolbar, sink, createOutputBusGantt(output.id, { streamState, directorState: state }));
  stripWrap.append(mixerPanel?.createOutputDetailMixerStrip(output, state) ?? createHint('Output strip unavailable.'));
  layout.append(card, stripWrap);
  return layout;
}
