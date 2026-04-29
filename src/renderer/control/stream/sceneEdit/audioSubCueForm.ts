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
import {
  createSubCueChip,
  createSubCueChipGroup,
  createSubCueEmptyNote,
  createSubCueFieldGrid,
  createSubCuePanField,
  createSubCueSection,
  createSubCueToggleButton,
  createSubCueToggleRow,
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

  form.append(
    createSubCueSection(
      'Source',
      createSelect(
        'Audio source',
        audioOptions.length ? audioOptions : [['', '(no sources)']],
        sub.audioSourceId ?? '',
        (audioSourceId) =>
          patchSubCue({
            audioSourceId: audioSourceId as AudioSourceId,
          }),
      ),
    ),
  );

  const outWrap = document.createElement('div');
  outWrap.className = 'stream-subcue-output-routing';

  const outputIdsSorted = Object.keys(currentState.outputs).sort();
  const selected = new Set(sub.outputIds ?? []);
  const outputChips: HTMLButtonElement[] = [];
  for (const oid of outputIdsSorted) {
    const ob = currentState.outputs[oid];
    const chip = createSubCueChip(ob?.label ?? oid, selected.has(oid), (checked) => {
      const next = new Set(sub.outputIds ?? []);
      if (checked) {
        next.add(oid);
      } else {
        next.delete(oid);
      }
      patchSubCue({ outputIds: [...next] as VirtualOutputId[] });
    });
    outputChips.push(chip);
  }
  if (outputIdsSorted.length === 0) {
    outWrap.append(createSubCueEmptyNote('No outputs - create one in the mixer tab.'));
  } else {
    outWrap.append(createSubCueChipGroup(...outputChips));
  }

  const routing = createSubCueToggleRow(
    createSubCueToggleButton('Muted', !!sub.muted, (v) => patchSubCue({ muted: v })),
    createSubCueToggleButton('Solo', !!sub.solo, (v) => patchSubCue({ solo: v })),
  );
  form.append(createSubCueSection('Routing', outWrap, routing));

  form.append(
    createSubCueSection(
      'Levels',
      createSubCueFieldGrid(
        createRequiredNumberField(
          'Level (dB)',
          sub.levelDb ?? 0,
          (v) => patchSubCue({ levelDb: v }),
          undefined,
        ),
        createSubCuePanField('Pan', 'Audio sub-cue pan', sub.pan ?? 0, (pan) => patchSubCue({ pan })),
      ),
    ),
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
      ),
    ),
  );

  const loopPol: SceneLoopPolicy = sub.loop ?? { enabled: false };
  form.append(
    createSubCueSection(
      'Playback Shape',
      createSubCueFieldGrid(
        createFadeFields('Fade in', sub.fadeIn, (next) => patchSubCue({ fadeIn: next })),
        createFadeFields('Fade out', sub.fadeOut, (next) => patchSubCue({ fadeOut: next })),
      ),
      createLoopPolicyEditor(loopPol, 'Loop', (next) => patchSubCue({ loop: next })),
    ),
  );

  form.append(createStreamDetailLine('Sub-cue', `${sceneId} · ${subCueId}`));

  return form;
}
