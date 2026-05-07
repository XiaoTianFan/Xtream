import type {
  DirectorState,
  VirtualOutputId,
  VirtualOutputSourceSelection,
  VirtualOutputSourceSelectionUpdate,
  VirtualOutputState,
} from '../../../../shared/types';
import { createButton, createDbFader, createHint, createPanKnob, createSelect } from '../../shared/dom';
import { formatAudioChannelLabel } from '../../shared/formatters';

type OutputSourceControlsDeps = {
  renderState: (state: DirectorState) => void;
  refreshDetails: (state: DirectorState) => void;
};

async function resolveOutputSourceSelectionId(
  outputId: VirtualOutputId,
  selection: VirtualOutputSourceSelection,
  selectionIndex: number,
): Promise<string> {
  if (selection.id) {
    return selection.id;
  }
  const currentOutput = (await window.xtream.director.getState()).outputs[outputId];
  const currentSelection = currentOutput?.sources[selectionIndex];
  if (currentSelection?.id) {
    return currentSelection.id;
  }
  throw new Error(`Unable to resolve output source selection for ${selection.audioSourceId}.`);
}

async function updateOutputSourceSelection(
  outputId: VirtualOutputId,
  selection: VirtualOutputSourceSelection,
  selectionIndex: number,
  update: VirtualOutputSourceSelectionUpdate,
): Promise<VirtualOutputState> {
  const selectionId = await resolveOutputSourceSelectionId(outputId, selection, selectionIndex);
  return window.xtream.outputs.updateSource(outputId, selectionId, update);
}

export function createOutputSourceControls(
  output: VirtualOutputState,
  state: DirectorState,
  deps: OutputSourceControlsDeps,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'output-source-list';
  const availableSources = Object.values(state.audioSources).filter(
    (source) => !output.sources.some((selection) => selection.audioSourceId === source.id),
  );
  const addSourceControl =
    availableSources.length > 0
      ? createSelect(
          'Add source',
          [['', 'Choose source'], ...availableSources.map((source): [string, string] => [source.id, source.label])],
          '',
          (audioSourceId) => {
            if (audioSourceId) {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              void window.xtream.outputs
                .addSource(output.id, audioSourceId)
                .then(async () => {
                  const nextState = await window.xtream.director.getState();
                  deps.renderState(nextState);
                  deps.refreshDetails(nextState);
                });
            }
          },
        )
      : undefined;
  if (output.sources.length === 0) {
    wrapper.append(createHint('No sources selected.'));
  }
  for (const [selectionIndex, selection] of output.sources.entries()) {
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
      void updateOutputSourceSelection(output.id, selection, selectionIndex, { levelDb });
    });
    levelControl.classList.add('output-source-level');

    const sourcePan = createPanKnob({
      name: `Pan ${source?.label ?? selection.audioSourceId}`,
      value: selection.pan ?? 0,
      variant: 'row',
      onChange: (pan) => {
        void updateOutputSourceSelection(output.id, selection, selectionIndex, { pan });
      },
    });
    sourcePan.classList.add('output-source-pan');

    const removeButton = createButton('Remove', 'secondary', async () => {
      await window.xtream.outputs.removeSource(output.id, await resolveOutputSourceSelectionId(output.id, selection, selectionIndex));
      const nextState = await window.xtream.director.getState();
      deps.renderState(nextState);
      deps.refreshDetails(nextState);
    });
    const soloButton = createButton('S', selection.solo ? 'secondary active' : 'secondary', async () => {
      const nextOutput = await updateOutputSourceSelection(output.id, selection, selectionIndex, { solo: !selection.solo });
      const nextState = await window.xtream.director.getState();
      nextState.outputs[nextOutput.id] = nextOutput;
      deps.renderState(nextState);
      deps.refreshDetails(nextState);
    });
    soloButton.title = `${selection.solo ? 'Unsolo' : 'Solo'} ${source?.label ?? selection.audioSourceId}`;
    soloButton.setAttribute('aria-label', soloButton.title);
    soloButton.setAttribute('aria-pressed', String(Boolean(selection.solo)));
    const muteButton = createButton('M', selection.muted ? 'secondary active' : 'secondary', async () => {
      const nextOutput = await updateOutputSourceSelection(output.id, selection, selectionIndex, { muted: !selection.muted });
      const nextState = await window.xtream.director.getState();
      nextState.outputs[nextOutput.id] = nextOutput;
      deps.renderState(nextState);
      deps.refreshDetails(nextState);
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
  if (addSourceControl) {
    wrapper.append(addSourceControl);
  }
  return wrapper;
}
