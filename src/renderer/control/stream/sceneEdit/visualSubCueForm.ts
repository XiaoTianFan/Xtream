import type {
  DirectorState,
  PersistedVisualSubCueConfig,
  SceneId,
  SceneLoopPolicy,
  SubCueId,
  VisualDisplayTarget,
  VisualId,
} from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailLine } from '../streamDom';
import { createFadeFields } from './fadeFields';
import { createLoopPolicyEditor } from './loopPolicyEditors';
import { createOptionalNumberField, createRequiredNumberField } from './numericField';

export type VisualSubCueFormDeps = {
  sceneId: SceneId;
  subCueId: SubCueId;
  sub: PersistedVisualSubCueConfig;
  currentState: DirectorState;
  patchSubCue: (update: Partial<PersistedVisualSubCueConfig>) => void;
};

function targetSetsEqual(a: VisualDisplayTarget[], b: VisualDisplayTarget[]): boolean {
  return JSON.stringify([...normalizeTargets(a)].sort((x, y) => targetKey(x).localeCompare(targetKey(y)))) ===
    JSON.stringify([...normalizeTargets(b)].sort((x, y) => targetKey(x).localeCompare(targetKey(y))));
}

function normalizeTargets(targets: VisualDisplayTarget[]): VisualDisplayTarget[] {
  return targets.map((t) => ({
    displayId: t.displayId,
    ...(t.zoneId ? { zoneId: t.zoneId } : {}),
  }));
}

function targetKey(t: VisualDisplayTarget): string {
  const z = t.zoneId ?? 'single';
  return `${t.displayId}:${z}`;
}

export function createVisualSubCueForm(deps: VisualSubCueFormDeps): HTMLElement {
  const { sceneId, subCueId, sub, currentState, patchSubCue } = deps;
  const form = document.createElement('div');
  form.className = 'detail-card stream-subcue-form stream-visual-subcue-form';

  const visualOpts: Array<[string, string]> = Object.keys(currentState.visuals)
    .sort()
    .map((id) => [id, currentState.visuals[id]?.label ?? id]);
  form.append(
    createSelect(
      'Visual',
      visualOpts.length ? visualOpts : [['', '(no visuals)']],
      sub.visualId,
      (vid) =>
        patchSubCue({
          visualId: vid as VisualId,
        }),
    ),
  );

  const selected = new Set(sub.targets.map(targetKey));

  const targetGrid = document.createElement('div');
  targetGrid.className = 'stream-visual-target-grid';
  const tgLabel = document.createElement('div');
  tgLabel.className = 'stream-subcue-multi-label';
  tgLabel.textContent = 'Display routing';
  targetGrid.append(tgLabel);

  const displays = Object.values(currentState.displays).sort((a, b) => a.id.localeCompare(b.id));

  function emitTargets(next: VisualDisplayTarget[]): void {
    patchSubCue({ targets: next });
  }

  function cloneTargets(): VisualDisplayTarget[] {
    return [...sub.targets];
  }

  function applyTargetPresence(entry: VisualDisplayTarget, on: boolean): void {
    const key = targetKey(entry);
    const list = cloneTargets().filter((t) => targetKey(t) !== key);
    if (on) {
      list.push(entry);
    }
    if (!targetSetsEqual(sub.targets, list)) {
      emitTargets(list);
    }
  }

  for (const d of displays) {
    const heading = document.createElement('div');
    heading.className = 'stream-visual-target-display';
    heading.textContent = d.label ?? d.id;
    targetGrid.append(heading);

    if (d.layout.type === 'single') {
      targetGrid.append(targetCheckbox('Full surface', selected.has(`${d.id}:single`), (on) => applyTargetPresence({ displayId: d.id }, on)));
    } else {
      targetGrid.append(
        targetCheckbox('Left zone', selected.has(`${d.id}:L`), (on) => applyTargetPresence({ displayId: d.id, zoneId: 'L' }, on)),
        targetCheckbox('Right zone', selected.has(`${d.id}:R`), (on) => applyTargetPresence({ displayId: d.id, zoneId: 'R' }, on)),
      );
    }
  }

  if (displays.length === 0) {
    targetGrid.append(document.createTextNode('No display windows — add one in Displays tab.'));
  }

  form.append(targetGrid);

  form.append(createOptionalNumberField('Freeze frame (ms)', sub.freezeFrameMs, (v) => patchSubCue({ freezeFrameMs: v }), { min: 0 }));

  form.append(createOptionalNumberField('Start offset (ms)', sub.startOffsetMs, (v) => patchSubCue({ startOffsetMs: v }), { min: 0 }));
  form.append(createOptionalNumberField('Duration override (ms)', sub.durationOverrideMs, (v) => patchSubCue({ durationOverrideMs: v }), { min: 0 }));

  form.append(createRequiredNumberField('Playback rate', sub.playbackRate ?? 1, (v) => patchSubCue({ playbackRate: v }), 0.01));

  form.append(createFadeFields('Fade in', sub.fadeIn, (next) => patchSubCue({ fadeIn: next })));
  form.append(createFadeFields('Fade out', sub.fadeOut, (next) => patchSubCue({ fadeOut: next })));

  const loopPol: SceneLoopPolicy = sub.loop ?? { enabled: false };
  form.append(createLoopPolicyEditor(loopPol, 'Loop', (next) => patchSubCue({ loop: next })));

  form.append(createStreamDetailLine('Sub-cue', `${sceneId} · ${subCueId}`));

  return form;
}

function targetCheckbox(label: string, checked: boolean, onBox: (on: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'stream-checkbox-field stream-visual-target-chip';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  row.append(box, document.createTextNode(` ${label}`));
  box.addEventListener('change', () => onBox(box.checked));
  return row;
}
