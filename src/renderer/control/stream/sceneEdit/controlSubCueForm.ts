import { PATCH_COMPAT_SCENE_ID } from '../../../../shared/streamWorkspace';
import type {
  DirectorState,
  PersistedControlSubCueConfig,
  PersistedStreamConfig,
  SceneId,
  SubCueId,
  SubCueRef,
} from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailLine } from '../streamDom';
import { createOptionalNumberField, createRequiredNumberField } from './numericField';
import {
  createSubCueFieldGrid,
  createSubCuePanField,
  createSubCueSection,
  createSubCueToggleButton,
  createSubCueToggleRow,
} from './subCueFormControls';

export type ControlSubCueFormDeps = {
  stream: PersistedStreamConfig;
  sceneId: SceneId;
  subCueId: SubCueId;
  sub: PersistedControlSubCueConfig;
  currentState: DirectorState;
  patchSubCue: (update: Partial<PersistedControlSubCueConfig>) => void;
};

type ActionDiscriminant = PersistedControlSubCueConfig['action']['type'];

const ACTION_KINDS: Array<[ActionDiscriminant, string]> = [
  ['stop-scene', 'Stop scene'],
  ['pause-scene', 'Pause scene'],
  ['resume-scene', 'Resume scene'],
  ['set-audio-subcue-level', 'Set audio sub-cue level'],
  ['set-audio-subcue-pan', 'Set audio sub-cue pan'],
  ['stop-subcue', 'Stop sub-cue'],
  ['set-global-audio-muted', 'Set global audio muted'],
  ['set-global-display-blackout', 'Set global display blackout'],
];

function scenePickerChoices(stream: PersistedStreamConfig): Array<[string, string]> {
  return stream.sceneOrder.filter((id) => id !== PATCH_COMPAT_SCENE_ID).map((id) => [id, stream.scenes[id]?.title ?? id]);
}

function audioSubCueChoices(
  stream: PersistedStreamConfig,
  director: DirectorState,
): Array<{ json: string; label: string; ref: SubCueRef }> {
  const out: Array<{ json: string; label: string; ref: SubCueRef }> = [];
  for (const sid of stream.sceneOrder) {
    const scene = stream.scenes[sid];
    if (!scene) {
      continue;
    }
    for (const cueId of scene.subCueOrder) {
      const c = scene.subCues[cueId];
      if (c?.kind !== 'audio') {
        continue;
      }
      const ref: SubCueRef = { sceneId: sid, subCueId: cueId };
      const label = `${scene.title ?? sid} › ${director.audioSources[c.audioSourceId]?.label ?? c.audioSourceId}`;
      out.push({ json: JSON.stringify(ref), label, ref });
    }
  }
  return out;
}

export function createControlSubCueForm(deps: ControlSubCueFormDeps): HTMLElement {
  const { stream, sceneId, subCueId, sub, currentState, patchSubCue } = deps;
  const form = document.createElement('div');
  form.className = 'detail-card stream-subcue-form stream-control-subcue-form';

  const warnEl = document.createElement('div');
  warnEl.className = 'stream-control-warnings hint';

  const action = sub.action;
  const scenes = scenePickerChoices(stream);
  const audOpts = audioSubCueChoices(stream, currentState);
  const targetFields: HTMLElement[] = [];
  const automationFields: HTMLElement[] = [];

  function selfRefDanger(ref?: SubCueRef): void {
    if (ref?.sceneId === sceneId && ref.subCueId === subCueId) {
      warnEl.textContent = 'This control sub-cue targets itself; authoring may produce impossible runtime.';
    } else {
      warnEl.replaceChildren();
    }
  }

  form.append(
    createSubCueSection(
      'Action',
      warnEl,
      createSelect('Action kind', ACTION_KINDS as Array<[string, string]>, action.type as string, (v) =>
        patchSubCue(makeDefault(stream, scenes, audOpts, v as ActionDiscriminant)),
      ),
    ),
  );

  if (action.type === 'stop-scene' || action.type === 'pause-scene' || action.type === 'resume-scene') {
    targetFields.push(
      createSelect(
        'Target scene',
        scenes.length ? scenes : [['', '—']],
        action.sceneId,
        (sid) => patchSubCue({ action: { ...action, sceneId: sid as SceneId } }),
      ),
    );
    if (action.type === 'stop-scene') {
      automationFields.push(
        createOptionalNumberField('Fade out (ms)', action.fadeOutMs, (ms) =>
          patchSubCue({ action: { type: 'stop-scene', sceneId: action.sceneId, fadeOutMs: ms } }),
        ),
      );
    }
  }

  if (action.type === 'set-audio-subcue-level') {
    const opts = audOpts.map((o) => [o.json, o.label] as [string, string]);
    targetFields.push(
      createSelect('Audio target', opts.length ? opts : [['', '—']], JSON.stringify(action.subCueRef), (raw) => {
        if (!raw) {
          return;
        }
        patchSubCue({ action: { ...action, subCueRef: JSON.parse(raw) as SubCueRef } });
        selfRefDanger(JSON.parse(raw) as SubCueRef);
      }),
    );
    selfRefDanger(action.subCueRef);
    automationFields.push(
      createRequiredNumberField(
        'Target level (dB)',
        action.targetDb,
        (targetDb) => patchSubCue({ action: { ...action, targetDb } }),
        undefined,
      ),
      createOptionalNumberField(
        'Duration (ms)',
        action.durationMs,
        (durationMs) => patchSubCue({ action: { ...action, durationMs } }),
        { min: 0 },
      ),
      createSelect(
        'Fade curve',
        [
          ['linear', 'linear'],
          ['equal-power', 'equal power'],
          ['log', 'log'],
        ],
        action.curve ?? 'linear',
        (curve) =>
          patchSubCue({
            action: { ...action, curve: curve as typeof action.curve },
          }),
      ),
    );
  }

  if (action.type === 'set-audio-subcue-pan') {
    const opts = audOpts.map((o): [string, string] => [o.json, o.label]);
    targetFields.push(
      createSelect(
        'Audio target',
        opts.length ? opts : [['', '—']],
        JSON.stringify(action.subCueRef),
        (raw) => {
          if (!raw) {
            return;
          }
          patchSubCue({ action: { ...action, subCueRef: JSON.parse(raw) as SubCueRef } });
          selfRefDanger(JSON.parse(raw) as SubCueRef);
        },
      ),
    );
    selfRefDanger(action.subCueRef);
    automationFields.push(
      createSubCuePanField('Target pan', 'Control target audio sub-cue pan', action.targetPan, (targetPan) =>
        patchSubCue({ action: { ...action, targetPan } }),
      ),
      createOptionalNumberField(
        'Duration (ms)',
        action.durationMs,
        (durationMs) => patchSubCue({ action: { ...action, durationMs } }),
        { min: 0 },
      ),
    );
  }

  if (action.type === 'stop-subcue') {
    const opts = audOpts.map((o): [string, string] => [o.json, o.label]);
    targetFields.push(
      createSelect(
        'Audio sub-cue target',
        opts.length ? opts : [['', '—']],
        JSON.stringify(action.subCueRef),
        (raw) => {
          if (!raw) {
            return;
          }
          patchSubCue({ action: { ...action, subCueRef: JSON.parse(raw) as SubCueRef } });
          selfRefDanger(JSON.parse(raw) as SubCueRef);
        },
      ),
    );
    automationFields.push(
      createOptionalNumberField(
        'Fade out (ms)',
        action.fadeOutMs,
        (fadeOutMs) => patchSubCue({ action: { ...action, fadeOutMs } }),
        { min: 0 },
      ),
    );
    selfRefDanger(action.subCueRef);
  }

  if (action.type === 'set-global-audio-muted') {
    automationFields.push(
      createSubCueToggleRow(
        createSubCueToggleButton('Muted', action.muted, (muted) => patchSubCue({ action: { type: 'set-global-audio-muted', muted } })),
      ),
      createOptionalNumberField('Fade (ms)', action.fadeMs, (fadeMs) => patchSubCue({ action: { ...action, fadeMs } }), { min: 0 }),
    );
  }

  if (action.type === 'set-global-display-blackout') {
    automationFields.push(
      createSubCueToggleRow(
        createSubCueToggleButton('Blackout', action.blackout, (blackout) =>
          patchSubCue({ action: { type: 'set-global-display-blackout', blackout } }),
        ),
      ),
      createOptionalNumberField(
        'Fade (ms)',
        action.fadeMs,
        (fadeMs) => patchSubCue({ action: { ...action, fadeMs } }),
        { min: 0 },
      ),
    );
  }

  if (targetFields.length > 0) {
    form.append(createSubCueSection('Target', createSubCueFieldGrid(...targetFields)));
  }

  if (automationFields.length > 0) {
    form.append(createSubCueSection('Automation', createSubCueFieldGrid(...automationFields)));
  }

  form.append(createSubCueSection('Metadata', createStreamDetailLine('Sub-cue ref', `${sceneId} · ${subCueId}`)));
  return form;
}

function makeDefault(
  stream: PersistedStreamConfig,
  scenes: Array<[string, string]>,
  audOpts: Array<{ json: string; label: string; ref: SubCueRef }>,
  next: ActionDiscriminant,
): Partial<PersistedControlSubCueConfig> {
  const fallbackScene = (scenes[0]?.[0] as SceneId) ?? stream.sceneOrder[0]!;
  if (
    audOpts.length === 0 &&
    (next === 'stop-subcue' || next === 'set-audio-subcue-level' || next === 'set-audio-subcue-pan')
  ) {
    return { action: { type: 'set-global-audio-muted', muted: false } };
  }
  if (next === 'stop-scene') {
    return { action: { type: 'stop-scene', sceneId: fallbackScene } };
  }
  if (next === 'pause-scene') {
    return { action: { type: 'pause-scene', sceneId: fallbackScene } };
  }
  if (next === 'resume-scene') {
    return { action: { type: 'resume-scene', sceneId: fallbackScene } };
  }
  const ref = audOpts[0]!.ref;

  if (next === 'set-audio-subcue-level') {
    return { action: { type: 'set-audio-subcue-level', subCueRef: ref, targetDb: 0 } };
  }
  if (next === 'set-audio-subcue-pan') {
    return { action: { type: 'set-audio-subcue-pan', subCueRef: ref, targetPan: 0 } };
  }
  if (next === 'stop-subcue') {
    return { action: { type: 'stop-subcue', subCueRef: ref } };
  }
  if (next === 'set-global-audio-muted') {
    return { action: { type: 'set-global-audio-muted', muted: false } };
  }
  return { action: { type: 'set-global-display-blackout', blackout: false } };
}
