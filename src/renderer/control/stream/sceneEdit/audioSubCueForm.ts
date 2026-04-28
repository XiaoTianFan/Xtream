import type {
  AudioSourceId,
  DirectorState,
  PersistedAudioSubCueConfig,
  SceneId,
  SceneLoopPolicy,
  SubCueId,
  VirtualOutputId,
} from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailLine } from '../streamDom';
import { createFadeFields } from './fadeFields';
import { createLoopPolicyEditor } from './loopPolicyEditors';
import { createOptionalNumberField, createRequiredNumberField } from './numericField';

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

  form.append(
    createSelect(
      'Audio source',
      audioOptions.length ? audioOptions : [['', '(no sources)']],
      sub.audioSourceId ?? '',
      (audioSourceId) =>
        patchSubCue({
          audioSourceId: audioSourceId as AudioSourceId,
        }),
    ),
  );

  const outWrap = document.createElement('div');
  outWrap.className = 'stream-subcue-output-checkboxes';
  const outLabel = document.createElement('div');
  outLabel.className = 'stream-subcue-multi-label';
  outLabel.textContent = 'Virtual outputs';
  outWrap.append(outLabel);

  const outputIdsSorted = Object.keys(currentState.outputs).sort();
  const selected = new Set(sub.outputIds ?? []);
  for (const oid of outputIdsSorted) {
    const ob = currentState.outputs[oid];
    const row = flagCheckbox(ob?.label ?? oid, selected.has(oid), (checked) => {
      const next = new Set(sub.outputIds ?? []);
      if (checked) {
        next.add(oid);
      } else {
        next.delete(oid);
      }
      patchSubCue({ outputIds: [...next] as VirtualOutputId[] });
    });
    outWrap.append(row);
  }
  if (outputIdsSorted.length === 0) {
    outWrap.append(document.createTextNode('No outputs — create one in the mixer tab.'));
  }
  form.append(outWrap);

  const routing = document.createElement('div');
  routing.className = 'stream-subcue-routing-flags';
  routing.append(flagCheckbox('Muted', !!sub.muted, (v) => patchSubCue({ muted: v })), flagCheckbox('Solo', !!sub.solo, (v) => patchSubCue({ solo: v })));
  form.append(routing);

  form.append(
    createRequiredNumberField(
      'Level (dB)',
      sub.levelDb ?? 0,
      (v) => patchSubCue({ levelDb: v }),
      undefined,
    ),
    createRequiredNumberField(
      'Pan',
      sub.pan ?? 0,
      (v) => patchSubCue({ pan: v }),
      undefined,
    ),
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
  );

  form.append(createFadeFields('Fade in', sub.fadeIn, (next) => patchSubCue({ fadeIn: next })));
  form.append(createFadeFields('Fade out', sub.fadeOut, (next) => patchSubCue({ fadeOut: next })));

  const loopPol: SceneLoopPolicy = sub.loop ?? { enabled: false };
  form.append(createLoopPolicyEditor(loopPol, 'Loop', (next) => patchSubCue({ loop: next })));

  form.append(createStreamDetailLine('Sub-cue', `${sceneId} · ${subCueId}`));

  return form;
}

function flagCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'stream-checkbox-field';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  row.append(box, document.createTextNode(` ${label}`));
  return row;
}
