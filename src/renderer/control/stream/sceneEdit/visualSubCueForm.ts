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
  const visualSelect = createSelect(
    'Visual',
    visualOpts.length ? visualOpts : [['', '(no visuals)']],
    sub.visualId,
    (vid) =>
      patchSubCue({
        visualId: vid as VisualId,
      }),
  );

  const selected = new Set(sub.targets.map(targetKey));

  const targetGrid = document.createElement('div');
  targetGrid.className = 'stream-visual-target-grid stream-audio-output-bus-grid';

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
    if (d.layout.type === 'single') {
      targetGrid.append(
        createDotToggle(
          d.label ?? d.id,
          selected.has(`${d.id}:single`),
          (on) => applyTargetPresence({ displayId: d.id }, on),
        ),
      );
    } else {
      targetGrid.append(
        createDotToggle(
          `${d.label ?? d.id} L`,
          selected.has(`${d.id}:L`),
          (on) => applyTargetPresence({ displayId: d.id, zoneId: 'L' }, on),
        ),
        createDotToggle(
          `${d.label ?? d.id} R`,
          selected.has(`${d.id}:R`),
          (on) => applyTargetPresence({ displayId: d.id, zoneId: 'R' }, on),
        ),
      );
    }
  }

  if (displays.length === 0) {
    targetGrid.append(createSubCueEmptyNote('No display windows - add one in Displays tab.'));
  }

  form.append(
    createSubCueSection(
      'I/O',
      visualSelect,
      createDisplayTargetField(targetGrid),
    ),
  );

  const loopPol: SceneLoopPolicy = sub.loop ?? { enabled: false };
  form.append(
    createSubCueSection(
      'Timing',
      createSubCueFieldGrid(
        createRequiredNumberField('Playback rate', sub.playbackRate ?? 1, (v) => patchSubCue({ playbackRate: v }), 0.01),
        createOptionalNumberField('Freeze frame (ms)', sub.freezeFrameMs, (v) => patchSubCue({ freezeFrameMs: v }), { min: 0 }),
        createOptionalNumberField('Start offset (ms)', sub.startOffsetMs, (v) => patchSubCue({ startOffsetMs: v }), { min: 0 }),
        createOptionalNumberField('Duration override (ms)', sub.durationOverrideMs, (v) => patchSubCue({ durationOverrideMs: v }), { min: 0 }),
        createFadeFields('Fade in', sub.fadeIn, (next) => patchSubCue({ fadeIn: next })),
        createFadeFields('Fade out', sub.fadeOut, (next) => patchSubCue({ fadeOut: next })),
      ),
      createLoopPolicyEditor(loopPol, 'Loop', (next) => patchSubCue({ loop: next })),
    ),
  );

  form.append(createStreamDetailLine('Sub-cue', `${sceneId} · ${subCueId}`));

  return form;
}

function createDisplayTargetField(content: HTMLElement): HTMLElement {
  const field = document.createElement('div');
  field.className = 'stream-audio-output-bus-field';
  const label = document.createElement('div');
  label.className = 'stream-audio-output-bus-label';
  label.textContent = 'Display target';
  field.append(label, content);
  return field;
}

function createDotToggle(label: string, selected: boolean, onToggle: (selected: boolean) => void): HTMLButtonElement {
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
