import type { DirectorState, DisplayWindowState, VirtualOutputState } from '../../../shared/types';
import type { DisplayWorkspaceController } from '../patch/displayWorkspace';
import type { MixerPanelController } from '../patch/mixerPanel';
import { createButton, createHint, createSelect } from '../shared/dom';
import { decorateIconButton } from '../shared/icons';
import type { BottomTab, DetailPane, StreamSurfaceOptions } from './streamTypes';
import { createStreamDetailField, createStreamDetailLine, createStreamTextInput } from './streamDom';

export type StreamDetailOverlayDeps = {
  detailPane: DetailPane;
  currentState: DirectorState;
  options: StreamSurfaceOptions;
  displayWorkspace: DisplayWorkspaceController | undefined;
  mixerPanel: MixerPanelController | undefined;
  setBottomTab: (tab: BottomTab) => void;
  clearDetailPane: () => void;
  requestRender: () => void;
  refreshDirector: () => Promise<void>;
};

export function createStreamDetailOverlay(deps: StreamDetailOverlayDeps): HTMLElement {
  const { detailPane, currentState, options, displayWorkspace, mixerPanel, setBottomTab, clearDetailPane, requestRender, refreshDirector } = deps;
  const wrap = document.createElement('section');
  wrap.className = 'stream-detail-pane';
  const header = document.createElement('div');
  header.className = 'panel-header';
  const title = document.createElement('h2');
  title.textContent = detailPane.type === 'display' ? 'Display Details' : 'Output Details';
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
        ? createStreamDisplayDetailCard(display, options, displayWorkspace, refreshDirector)
        : createHint('Display not found.'),
    );
  } else {
    const output = currentState.outputs[detailPane.id];
    body.append(
      output ? createStreamOutputDetailLayout(output, currentState, options, mixerPanel, refreshDirector) : createHint('Output not found.'),
    );
  }
  wrap.append(header, body);
  return wrap;
}

function createStreamDisplayDetailCard(
  display: DisplayWindowState,
  options: StreamSurfaceOptions,
  displayWorkspace: DisplayWorkspaceController | undefined,
  refreshDirector: () => Promise<void>,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'detail-card stream-display-detail-card';
  const label = createStreamTextInput(display.label ?? display.id, (value) => window.xtream.displays.update(display.id, { label: value }).then(refreshDirector));
  const monitor = createSelect(
    'Monitor',
    [['', 'Current/default'], ...options.getDisplayMonitors().map((m): [string, string] => [m.id, m.label])],
    display.displayId ?? '',
    (displayId) => void window.xtream.displays.update(display.id, { displayId: displayId || undefined }).then(refreshDirector),
  );
  const toolbar = document.createElement('div');
  toolbar.className = 'button-row';
  toolbar.append(
    createButton(display.fullscreen ? 'Leave Fullscreen' : 'Fullscreen', 'secondary', () =>
      window.xtream.displays.update(display.id, { fullscreen: !display.fullscreen }).then(refreshDirector),
    ),
    createButton(display.alwaysOnTop ? 'Normal Layer' : 'Always On Top', 'secondary', () =>
      window.xtream.displays.update(display.id, { alwaysOnTop: !display.alwaysOnTop }).then(refreshDirector),
    ),
  );
  card.append(
    createStreamDetailField('Label', label),
    monitor,
    toolbar,
    createStreamDetailLine('Status', displayWorkspace?.getDisplayStatusLabel(display) ?? 'Display'),
    createStreamDetailLine('Telemetry', displayWorkspace?.getDisplayTelemetry(display) ?? display.id),
  );
  return card;
}

function createStreamOutputDetailLayout(
  output: VirtualOutputState,
  state: DirectorState,
  options: StreamSurfaceOptions,
  mixerPanel: MixerPanelController | undefined,
  refreshDirector: () => Promise<void>,
): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'stream-output-detail-layout';
  const card = document.createElement('div');
  card.className = 'detail-card stream-output-detail-controls';
  const stripWrap = document.createElement('div');
  stripWrap.className = 'stream-output-detail-strip';
  const label = createStreamTextInput(output.label, (value) => window.xtream.outputs.update(output.id, { label: value }).then(refreshDirector));
  const sink = createSelect(
    'Physical output',
    [['', 'System default output'], ...options.getAudioDevices().map((device, index): [string, string] => [device.deviceId, device.label || `Audio output ${index + 1}`])],
    output.sinkId ?? '',
    (sinkId) => {
      const sinkLabel = options.getAudioDevices().find((device) => device.deviceId === sinkId)?.label;
      void window.xtream.outputs.update(output.id, { sinkId: sinkId || undefined, sinkLabel }).then(refreshDirector);
    },
  );
  card.append(createStreamDetailField('Label', label), sink);
  stripWrap.append(mixerPanel?.createOutputDetailMixerStrip(output, state) ?? createHint('Output strip unavailable.'));
  layout.append(card, stripWrap);
  return layout;
}
