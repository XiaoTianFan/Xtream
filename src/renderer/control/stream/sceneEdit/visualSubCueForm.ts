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
import {
  createSubCueChip,
  createSubCueChipGroup,
  createSubCueEmptyNote,
  createSubCueFieldGrid,
  createSubCueSection,
} from './subCueFormControls';

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
    createSubCueSection(
      'Visual',
      createSelect(
        'Visual',
        visualOpts.length ? visualOpts : [['', '(no visuals)']],
        sub.visualId,
        (vid) =>
          patchSubCue({
            visualId: vid as VisualId,
          }),
      ),
    ),
  );

  const selected = new Set(sub.targets.map(targetKey));

  const targetGrid = document.createElement('div');
  targetGrid.className = 'stream-visual-target-grid';

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
    const displayGroup = document.createElement('div');
    displayGroup.className = 'stream-visual-target-display-group';
    const heading = document.createElement('div');
    heading.className = 'stream-visual-target-display';
    heading.textContent = d.label ?? d.id;

    if (d.layout.type === 'single') {
      displayGroup.append(
        heading,
        createSubCueChipGroup(
          createSubCueChip('Full surface', selected.has(`${d.id}:single`), (on) => applyTargetPresence({ displayId: d.id }, on)),
        ),
      );
    } else {
      displayGroup.append(
        heading,
        createSubCueChipGroup(
          createSubCueChip('Left zone', selected.has(`${d.id}:L`), (on) => applyTargetPresence({ displayId: d.id, zoneId: 'L' }, on)),
          createSubCueChip('Right zone', selected.has(`${d.id}:R`), (on) => applyTargetPresence({ displayId: d.id, zoneId: 'R' }, on)),
        ),
      );
    }
    targetGrid.append(displayGroup);
  }

  if (displays.length === 0) {
    targetGrid.append(createSubCueEmptyNote('No display windows - add one in Displays tab.'));
  }

  form.append(createSubCueSection('Display Routing', targetGrid));

  form.append(
    createSubCueSection(
      'Timing',
      createSubCueFieldGrid(
        createOptionalNumberField('Freeze frame (ms)', sub.freezeFrameMs, (v) => patchSubCue({ freezeFrameMs: v }), { min: 0 }),
        createOptionalNumberField('Start offset (ms)', sub.startOffsetMs, (v) => patchSubCue({ startOffsetMs: v }), { min: 0 }),
        createOptionalNumberField('Duration override (ms)', sub.durationOverrideMs, (v) => patchSubCue({ durationOverrideMs: v }), { min: 0 }),
        createRequiredNumberField('Playback rate', sub.playbackRate ?? 1, (v) => patchSubCue({ playbackRate: v }), 0.01),
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
