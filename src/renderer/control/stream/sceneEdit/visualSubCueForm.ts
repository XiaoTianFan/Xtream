import type {
  DirectorState,
  PersistedVisualSubCueConfig,
  SceneId,
  SubCueId,
  VisualDisplayTarget,
  VisualId,
} from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailLine } from '../streamDom';
import {
  createSubCueEmptyNote,
  createSubCueSection,
} from './subCueFormControls';
import { createVisualSubCuePreviewLaneEditor } from './visualSubCuePreviewLaneEditor';

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

  form.append(
    createVisualSubCuePreviewLaneEditor({
      sub,
      currentState,
      patchSubCue,
    }),
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
