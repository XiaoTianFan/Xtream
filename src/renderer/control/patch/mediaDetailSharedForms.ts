import type { AudioSourceState, DirectorState, VisualId, VisualState } from '../../../shared/types';
import { createButton, createSlider, syncSliderProgress } from '../shared/dom';
import { attachAudioPreviewColumn, attachVisualPreviewColumn, wrapMediaDetailTwoColumn } from './mediaDetailPane';
import { formatAudioChannelDetail, formatBytes, formatDuration } from '../shared/formatters';
import type { SelectedEntity } from '../shared/types';

export type MediaDetailSharedDeps = {
  renderState: (state: DirectorState) => void;
  clearSelectionIf: (entity: SelectedEntity) => void;
  confirmPoolRecordRemoval: (label: string) => Promise<boolean>;
  queueEmbeddedAudioImportPrompt: (visuals: VisualState[] | undefined) => void;
  probeVisualMetadata: (visual: VisualState) => void;
  reportVisualMetadataFromVideo: (visualId: VisualId, video: HTMLVideoElement) => void;
};

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

function createLabelInput(
  value: string,
  deps: Pick<MediaDetailSharedDeps, 'renderState'>,
  onCommit: (label: string) => Promise<unknown>,
): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'label-input';
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => {
    const label = input.value.trim() || value;
    input.value = label;
    void onCommit(label).then(async () => deps.renderState(await window.xtream.director.getState()));
  });
  return input;
}

function createNumberDetailControl(
  deps: Pick<MediaDetailSharedDeps, 'renderState'>,
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
    void onCommit(nextValue).then(async () => deps.renderState(await window.xtream.director.getState()));
  };
  range.addEventListener('input', () => {
    number.value = range.value;
  });
  range.addEventListener('change', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));
  wrapper.append(title, range, number);
  return wrapper;
}

export function createVisualDetailMetaCard(visual: VisualState, deps: MediaDetailSharedDeps): HTMLElement {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(visual.label, deps, (nextLabel) => window.xtream.visuals.update(visual.id, { label: nextLabel }));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  if (visual.kind === 'file') {
    toolbarActions.append(
      createButton('Replace', 'secondary', async () => {
        const replaced = await window.xtream.visuals.replace(visual.id);
        if (replaced) {
          deps.queueEmbeddedAudioImportPrompt([replaced]);
          deps.probeVisualMetadata(replaced);
        }
        deps.renderState(await window.xtream.director.getState());
      }),
    );
  }
  const removeFromPool = createButton('Remove', 'secondary', async () => {
    if (!(await deps.confirmPoolRecordRemoval(visual.label))) {
      return;
    }
    await window.xtream.visuals.remove(visual.id);
    deps.clearSelectionIf({ type: 'visual', id: visual.id });
    deps.renderState(await window.xtream.director.getState());
  });
  removeFromPool.title = `Remove ${visual.label} from the media pool (does not delete the file on disk)`;
  toolbarActions.append(removeFromPool);
  toolbar.append(toolbarStart, toolbarActions);
  card.append(
    toolbar,
    createDetailLine('Type', visual.kind === 'live' ? `live ${visual.capture.source}` : visual.type),
    createDetailLine('Path', visual.kind === 'file' ? visual.path ?? '--' : '--'),
    createDetailLine('Duration', formatDuration(visual.durationSeconds)),
    createDetailLine('Dimensions', visual.width && visual.height ? `${visual.width}x${visual.height}` : '--'),
    ...(visual.kind === 'live'
      ? [
          createDetailLine('Source', visual.capture.label ?? visual.capture.source),
          createDetailLine('Readiness', visual.ready ? 'ready' : visual.error ?? 'standby'),
        ]
      : [
          createDetailLine('File Size', formatBytes(visual.fileSizeBytes)),
          createDetailLine(
            'Embedded Audio',
            visual.hasEmbeddedAudio === undefined ? 'unknown' : visual.hasEmbeddedAudio ? 'yes' : 'no',
          ),
        ]),
    createNumberDetailControl(deps, 'Opacity', visual.opacity ?? 1, 0, 1, 0.01, (opacity) => window.xtream.visuals.update(visual.id, { opacity })),
    createNumberDetailControl(
      deps,
      'Brightness',
      visual.brightness ?? 1,
      0,
      2,
      0.01,
      (brightness) => window.xtream.visuals.update(visual.id, { brightness }),
    ),
    createNumberDetailControl(deps, 'Contrast', visual.contrast ?? 1, 0, 2, 0.01, (contrast) => window.xtream.visuals.update(visual.id, { contrast })),
    createNumberDetailControl(
      deps,
      'Playback Rate',
      visual.playbackRate ?? 1,
      0.1,
      4,
      0.01,
      (playbackRate) => window.xtream.visuals.update(visual.id, { playbackRate }),
    ),
  );
  return card;
}

export function createAudioDetailMetaCard(source: AudioSourceState, state: DirectorState, deps: MediaDetailSharedDeps): HTMLElement {
  const card = document.createElement('div');
  card.className = 'detail-card';
  const label = createLabelInput(source.label, deps, (nextLabel) => window.xtream.audioSources.update(source.id, { label: nextLabel }));
  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';
  toolbarStart.append(createDetailField('Label', label));
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  toolbarActions.append(
    ...(source.type === 'external-file'
      ? [
          createButton('Replace', 'secondary', async () => {
            await window.xtream.audioSources.replaceFile(source.id);
            deps.renderState(await window.xtream.director.getState());
          }),
        ]
      : []),
  );
  const removeFromPool = createButton('Remove', 'secondary', async () => {
    if (!(await deps.confirmPoolRecordRemoval(source.label))) {
      return;
    }
    await window.xtream.audioSources.remove(source.id);
    deps.clearSelectionIf({ type: 'audio-source', id: source.id });
    deps.renderState(await window.xtream.director.getState());
  });
  removeFromPool.title = `Remove ${source.label} from the audio pool (does not delete the file on disk)`;
  toolbarActions.append(removeFromPool);
  toolbar.append(toolbarStart, toolbarActions);
  card.append(
    toolbar,
    createDetailLine('Type', source.type),
    createDetailLine('Path', source.type === 'external-file' ? source.path ?? '--' : state.visuals[source.visualId]?.path ?? source.visualId),
    ...(source.type === 'embedded-visual'
      ? [
          createDetailLine('Extraction', source.extractionMode === 'file' ? `file ${source.extractionStatus ?? 'pending'}` : 'representation'),
          createDetailLine('Extracted File', source.extractedPath ?? '--'),
        ]
      : []),
    createDetailLine('Duration', formatDuration(source.durationSeconds)),
    createDetailLine('Channels', formatAudioChannelDetail(source)),
    createDetailLine('File Size', formatBytes(source.fileSizeBytes)),
    createDetailLine('Readiness', source.ready ? 'ready' : source.error ?? 'loading'),
    createNumberDetailControl(deps, 'Source Level dB', source.levelDb ?? 0, -60, 12, 1, (levelDb) => window.xtream.audioSources.update(source.id, { levelDb })),
    createNumberDetailControl(
      deps,
      'Playback Rate',
      source.playbackRate ?? 1,
      0.1,
      4,
      0.01,
      (playbackRate) => window.xtream.audioSources.update(source.id, { playbackRate }),
    ),
  );
  return card;
}

export function attachVisualMediaDetailMount(
  state: DirectorState,
  visual: VisualState,
  deps: MediaDetailSharedDeps,
  disposeRef: { current?: () => void },
): HTMLElement {
  const previewMount = document.createElement('div');
  previewMount.className = 'media-detail-preview-mount';
  disposeRef.current = attachVisualPreviewColumn(
    previewMount,
    visual,
    { reportVisualMetadataFromVideo: deps.reportVisualMetadataFromVideo },
    state.performanceMode,
  );
  const meta = createVisualDetailMetaCard(visual, deps);
  return wrapMediaDetailTwoColumn(previewMount, meta);
}

export function attachAudioMediaDetailMount(
  state: DirectorState,
  source: AudioSourceState,
  deps: MediaDetailSharedDeps,
  disposeRef: { current?: () => void },
): HTMLElement {
  const previewMount = document.createElement('div');
  previewMount.className = 'media-detail-preview-mount';
  disposeRef.current = attachAudioPreviewColumn(previewMount, source, state, state.performanceMode);
  const meta = createAudioDetailMetaCard(source, state, deps);
  return wrapMediaDetailTwoColumn(previewMount, meta);
}
