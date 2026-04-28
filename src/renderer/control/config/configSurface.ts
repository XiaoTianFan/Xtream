import { XTREAM_RUNTIME_VERSION } from '../../../shared/version';
import type { AudioExtractionFormat, DirectorState } from '../../../shared/types';
import type { SurfaceController } from '../app/surfaceRouter';
import { createSurfaceStateSignature } from '../app/surfaceSignatures';
import { createButton, createHint, createSelect, createSlider, syncSliderProgress } from '../shared/dom';
import { createDetailLine, createSurfaceCard, wrapSurfaceGrid } from '../shared/surfaceCards';
import { elements } from '../shell/elements';

type ConfigSurfaceOptions = {
  renderState: (state: DirectorState) => void;
  setShowStatus: (message: string) => void;
};

export function createConfigSurfaceController(options: ConfigSurfaceOptions): SurfaceController {
  return {
    id: 'config',
    createRenderSignature: (state) => createSurfaceStateSignature('config', state),
    render: (state) => renderConfigSurface(state, options),
  };
}

function renderConfigSurface(state: DirectorState, options: ConfigSurfaceOptions): void {
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
      void window.xtream.show.updateSettings({ audioExtractionFormat: audioExtractionFormat as AudioExtractionFormat }).then(options.renderState);
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

  const actions = createSurfaceCard('System Actions');
  const actionRow = document.createElement('div');
  actionRow.className = 'button-row';
  actionRow.append(
    createButton('Save Show', 'secondary', () => elements.saveShowButton.click()),
    createButton('Open Show', 'secondary', () => elements.openShowButton.click()),
    createButton('Export Diagnostics', 'secondary', async () => {
      const filePath = await window.xtream.show.exportDiagnostics();
      if (filePath) {
        options.setShowStatus(`Exported diagnostics: ${filePath}`);
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
