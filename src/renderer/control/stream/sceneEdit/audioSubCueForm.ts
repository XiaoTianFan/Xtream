import type {
  AudioSourceId,
  DirectorState,
  PersistedAudioSubCueConfig,
  SceneId,
  SceneLoopPolicy,
  SubCueId,
  VirtualOutputId,
} from '../../../../shared/types';
import { createDbFader, createPanKnob, createSelect } from '../../shared/dom';
import { formatAudioChannelLabel, formatDuration } from '../../shared/formatters';
import { createStreamDetailLine } from '../streamDom';
import { createFadeFields } from './fadeFields';
import { createLoopPolicyEditor } from './loopPolicyEditors';
import { createOptionalNumberField, createRequiredNumberField } from './numericField';
import {
  createSubCueEmptyNote,
  createSubCueFieldGrid,
  createSubCueSection,
  createSubCueToggleButton,
} from './subCueFormControls';

export type AudioSubCueFormDeps = {
  sceneId: SceneId;
  subCueId: SubCueId;
  sub: PersistedAudioSubCueConfig;
  currentState: DirectorState;
  patchSubCue: (update: Partial<PersistedAudioSubCueConfig>) => void;
};

export function createAudioSubCueForm(deps: AudioSubCueFormDeps): HTMLElement {
  const { sceneId, subCueId, sub, currentState, patchSubCue } = deps;
  const form = document.createElement('div');
  form.className = 'detail-card stream-subcue-form stream-audio-subcue-form';

  const audioOptions: Array<[string, string]> = [];
  for (const id of Object.keys(currentState.audioSources).sort()) {
    const s = currentState.audioSources[id];
    audioOptions.push([id, s?.label ?? id]);
  }

  const sourceSelect = createSelect(
    'Source',
    audioOptions.length ? audioOptions : [['', '(no sources)']],
    sub.audioSourceId ?? '',
    (audioSourceId) =>
      patchSubCue({
        audioSourceId: audioSourceId as AudioSourceId,
      }),
  );
  sourceSelect.classList.add('stream-audio-subcue-source-select');
  sourceSelect.append(createSourceMeta(currentState, sub.audioSourceId));

  const outWrap = document.createElement('div');
  outWrap.className = 'stream-subcue-output-routing';

  const outputIdsSorted = Object.keys(currentState.outputs).sort();
  const selected = new Set(sub.outputIds ?? []);
  const outputButtons: HTMLButtonElement[] = [];
  for (const oid of outputIdsSorted) {
    const ob = currentState.outputs[oid];
    const button = createOutputBusButton(ob?.label ?? oid, selected.has(oid), (checked) => {
      const next = new Set(sub.outputIds ?? []);
      if (checked) {
        next.add(oid);
      } else {
        next.delete(oid);
      }
      patchSubCue({ outputIds: [...next] as VirtualOutputId[] });
    });
    outputButtons.push(button);
  }
  if (outputIdsSorted.length === 0) {
    outWrap.append(createSubCueEmptyNote('No outputs - create one in the mixer tab.'));
  } else {
    const outputGrid = document.createElement('div');
    outputGrid.className = 'stream-audio-output-bus-grid';
    outputGrid.append(...outputButtons);
    outWrap.append(outputGrid);
  }

  form.append(
    createSubCueSection(
      'I/O',
      sourceSelect,
      createAudioOutputBusField(outWrap),
    ),
  );

  form.append(createSubCueSection('Levels', createAudioLevelStrip(sub, patchSubCue)));

  const loopPol: SceneLoopPolicy = sub.loop ?? { enabled: false };
  form.append(
    createSubCueSection(
      'Timing',
      createSubCueFieldGrid(
        createRequiredNumberField(
          'Playback rate',
          sub.playbackRate ?? 1,
          (v) => patchSubCue({ playbackRate: Math.max(0.01, v) }),
          0.01,
        ),
        createOptionalNumberField('Start offset (ms)', sub.startOffsetMs, (v) => patchSubCue({ startOffsetMs: v }), { min: 0 }),
        createOptionalNumberField('Duration override (ms)', sub.durationOverrideMs, (v) => patchSubCue({ durationOverrideMs: v }), {
          min: 0,
        }),
        createFadeFields('Fade in', sub.fadeIn, (next) => patchSubCue({ fadeIn: next })),
        createFadeFields('Fade out', sub.fadeOut, (next) => patchSubCue({ fadeOut: next })),
      ),
      createLoopPolicyEditor(loopPol, 'Loop', (next) => patchSubCue({ loop: next })),
    ),
  );

  form.append(createStreamDetailLine('Sub-cue', `${sceneId} · ${subCueId}`));

  return form;
}

function createSourceMeta(currentState: DirectorState, audioSourceId: AudioSourceId): HTMLElement {
  const meta = document.createElement('small');
  meta.className = 'stream-audio-source-meta';
  const source = currentState.audioSources[audioSourceId];
  if (!source) {
    meta.textContent = 'missing source';
    return meta;
  }
  const sourceType = source.type === 'external-file' ? 'file' : 'embedded';
  const readyState = source.ready ? 'ready' : source.error ? 'error' : 'pending';
  meta.textContent = `${sourceType}${formatAudioChannelLabel(source)} | ${formatDuration(source.durationSeconds)} | ${readyState}`;
  meta.title = meta.textContent;
  return meta;
}

function createAudioOutputBusField(content: HTMLElement): HTMLElement {
  const field = document.createElement('div');
  field.className = 'stream-audio-output-bus-field';
  const label = document.createElement('div');
  label.className = 'stream-audio-output-bus-label';
  label.textContent = 'Output bus';
  field.append(label, content);
  return field;
}

function createOutputBusButton(label: string, selected: boolean, onToggle: (selected: boolean) => void): HTMLButtonElement {
  let isSelected = selected;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-audio-output-bus${isSelected ? ' active' : ''}`;
  button.setAttribute('aria-pressed', String(isSelected));
  const text = document.createElement('span');
  text.className = 'stream-audio-output-bus-name';
  text.textContent = label;
  text.title = label;
  const dot = document.createElement('span');
  dot.className = 'stream-audio-output-bus-dot';
  button.append(text, dot);
  button.addEventListener('click', () => {
    isSelected = !isSelected;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
    onToggle(isSelected);
  });
  return button;
}

function createAudioLevelStrip(
  sub: PersistedAudioSubCueConfig,
  patchSubCue: (update: Partial<PersistedAudioSubCueConfig>) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stream-audio-level-strip';

  const level = createDbFader('Base dB', sub.levelDb ?? 0, (levelDb) => patchSubCue({ levelDb }), { commitOn: 'change' });
  level.classList.add('stream-audio-level-fader');

  const pan = createPanKnob({
    name: 'Audio sub-cue pan',
    value: sub.pan ?? 0,
    variant: 'row',
    commitOn: 'change',
    onChange: (nextPan) => patchSubCue({ pan: nextPan }),
  });
  pan.classList.add('stream-audio-level-pan');

  const solo = createSubCueToggleButton('S', !!sub.solo, (soloed) => patchSubCue({ solo: soloed }));
  solo.classList.add('stream-audio-level-toggle');
  solo.title = sub.solo ? 'Unsolo audio sub-cue' : 'Solo audio sub-cue';
  solo.setAttribute('aria-label', solo.title);

  const mute = createSubCueToggleButton('M', !!sub.muted, (muted) => patchSubCue({ muted }));
  mute.classList.add('stream-audio-level-toggle');
  mute.title = sub.muted ? 'Unmute audio sub-cue' : 'Mute audio sub-cue';
  mute.setAttribute('aria-label', mute.title);

  row.append(level, pan, solo, mute);
  return row;
}
