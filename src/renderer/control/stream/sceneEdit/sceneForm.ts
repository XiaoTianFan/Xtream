import { resolveFollowsSceneId } from '../../../../shared/streamSchedule';
import type {
  DirectorState,
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  SceneTrigger,
  SubCueId,
} from '../../../../shared/types';
import { createButton, createHint, createSelect } from '../../shared/dom';
import { createStreamDetailField, createStreamDetailLine } from '../streamDom';
import {
  createSubCueFieldGrid,
  createSubCueSection,
} from './subCueFormControls';
import { createSceneMiniGantt } from './sceneMiniGantt';

export type SceneFormDeps = {
  stream: PersistedStreamConfig;
  scene: PersistedSceneConfig;
  currentState?: DirectorState;
  removeSubCue?: (subCueId: SubCueId) => void;
  requestRender?: () => void;
  editsDisabled?: boolean;
  duplicateScene: (sceneId: SceneId) => void;
  removeScene: (sceneId: SceneId) => void;
};

export function createStreamSceneForm(deps: SceneFormDeps): HTMLElement {
  const { stream, scene, currentState, duplicateScene, removeScene, editsDisabled = false } = deps;
  const requestRender = deps.requestRender ?? (() => undefined);
  const removeSubCue = deps.removeSubCue ?? (() => undefined);
  const form = document.createElement('div');
  form.className = 'detail-card stream-scene-form';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'label-input';
  titleInput.value = scene.title ?? '';
  titleInput.placeholder = 'Scene title';
  titleInput.addEventListener('change', () => {
    const v = titleInput.value.trim();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { title: v || undefined } });
  });
  const titleField = createStreamDetailField('Title', titleInput);

  const noteInput = document.createElement('textarea');
  noteInput.className = 'label-input';
  noteInput.rows = 1;
  noteInput.value = scene.note ?? '';
  noteInput.placeholder = 'Scene note';
  noteInput.addEventListener('change', () => {
    const v = noteInput.value.trim();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { note: v || undefined } });
  });
  const noteField = createStreamDetailField('Note', noteInput);

  const toolbar = document.createElement('div');
  toolbar.className = 'detail-toolbar';
  
  const toolbarStart = document.createElement('div');
  toolbarStart.className = 'detail-toolbar-start';

  const inputsWrap = document.createElement('div');
  inputsWrap.style.display = 'flex';
  inputsWrap.style.gap = 'var(--gutter)';
  inputsWrap.style.width = '100%';
  
  titleField.style.flex = '0 0 12rem';
  noteField.style.flex = '1 1 0';
  noteField.style.minWidth = '0';
  
  inputsWrap.append(titleField, noteField);
  toolbarStart.append(inputsWrap);
  
  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'detail-toolbar-actions button-row';
  
  const removeDisabled = stream.sceneOrder.length <= 1;
  const removeBtn = createButton('Remove', 'secondary', () => removeScene(scene.id));
  removeBtn.disabled = removeDisabled;

  toolbarActions.append(
    createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary', () =>
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: !scene.disabled } }),
    ),
    createButton('Duplicate', 'secondary', () => duplicateScene(scene.id)),
    removeBtn,
  );
  toolbar.append(toolbarStart, toolbarActions);

  form.append(
    createSubCueSection(
      'Details',
      toolbar
    ),
  );

  const triggerType = scene.trigger.type;
  const triggerSelect = createSelect(
    'Mode',
    [
      ['manual', 'Manual'],
      ['follow-start', 'Follow start'],
      ['follow-end', 'Follow end'],
      ['at-timecode', 'At timecode'],
    ],
    triggerType,
    (value) => {
      const nextType = value as SceneTrigger['type'];
      let nextTrigger: SceneTrigger;
      if (nextType === 'manual') {
        nextTrigger = { type: 'manual' };
      } else if (nextType === 'at-timecode') {
        nextTrigger = { type: 'at-timecode', timecodeMs: scene.trigger.type === 'at-timecode' ? scene.trigger.timecodeMs : 0 };
      } else if (nextType === 'follow-start') {
        const carryFollow =
          scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end'
            ? scene.trigger.followsSceneId
            : resolveFollowsSceneId(stream, scene.id, { type: 'follow-start' });
        const carryDelay =
          scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end' ? scene.trigger.delayMs : undefined;
        nextTrigger =
          carryDelay !== undefined && carryDelay > 0
            ? { type: 'follow-start', followsSceneId: carryFollow, delayMs: carryDelay }
            : { type: 'follow-start', followsSceneId: carryFollow };
      } else {
        const carryFollow =
          scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end'
            ? scene.trigger.followsSceneId
            : resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' });
        const carryDelay =
          scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end' ? scene.trigger.delayMs : undefined;
        nextTrigger =
          carryDelay !== undefined && carryDelay > 0
            ? { type: 'follow-end', followsSceneId: carryFollow, delayMs: carryDelay }
            : { type: 'follow-end', followsSceneId: carryFollow };
      }
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: nextTrigger } });
    },
  );

  const followOptions: Array<[string, string]> = stream.sceneOrder
    .filter((id) => id !== scene.id)
    .map((id) => [id, stream.scenes[id]?.title ?? id]);
  const needsFollow = triggerType === 'follow-start' || triggerType === 'follow-end';
  const explicitFollowId =
    needsFollow && (scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end') ? scene.trigger.followsSceneId : undefined;
  const followSelect = createSelect(
    'Follow scene',
    [['', '(implicit: previous row)'], ...followOptions],
    explicitFollowId ?? '',
    (value) => {
      const id = value || undefined;
      const t = scene.trigger;
      if (t.type === 'follow-start') {
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: {
            trigger:
              t.delayMs !== undefined && t.delayMs > 0
                ? { type: 'follow-start', followsSceneId: id, delayMs: t.delayMs }
                : { type: 'follow-start', followsSceneId: id },
          },
        });
      } else if (t.type === 'follow-end') {
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: {
            trigger:
              t.delayMs !== undefined && t.delayMs > 0
                ? { type: 'follow-end', followsSceneId: id, delayMs: t.delayMs }
                : { type: 'follow-end', followsSceneId: id },
          },
        });
      }
    },
  );
  followSelect.hidden = !needsFollow;

  const delayWrap = document.createElement('div');
  delayWrap.className = 'stream-scene-form-row';
  delayWrap.hidden = triggerType !== 'follow-start' && triggerType !== 'follow-end';
  const delayMsVal =
    scene.trigger.type === 'follow-start' || scene.trigger.type === 'follow-end' ? (scene.trigger.delayMs ?? 0) : 0;
  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.min = '0';
  delayInput.step = '100';
  delayInput.className = 'label-input';
  delayInput.value = String(delayMsVal);
  delayInput.addEventListener('change', () => {
    const t = scene.trigger;
    if (t.type !== 'follow-start' && t.type !== 'follow-end') {
      return;
    }
    const ms = Math.max(0, Number(delayInput.value) || 0);
    const base = { followsSceneId: t.followsSceneId };
    const trigger: SceneTrigger =
      ms > 0
        ? t.type === 'follow-start'
          ? { type: 'follow-start', ...base, delayMs: ms }
          : { type: 'follow-end', ...base, delayMs: ms }
        : t.type === 'follow-start'
          ? { type: 'follow-start', ...base }
          : { type: 'follow-end', ...base };
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger } });
  });
  delayWrap.append(createStreamDetailField('Delay (ms)', delayInput));

  const tcWrap = document.createElement('div');
  tcWrap.className = 'stream-scene-form-row';
  tcWrap.hidden = triggerType !== 'at-timecode';
  const tcMs = scene.trigger.type === 'at-timecode' ? scene.trigger.timecodeMs : 0;
  const tcInput = document.createElement('input');
  tcInput.type = 'number';
  tcInput.min = '0';
  tcInput.step = '100';
  tcInput.className = 'label-input';
  tcInput.value = String(tcMs);
  tcInput.addEventListener('change', () => {
    const ms = Math.max(0, Number(tcInput.value) || 0);
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'at-timecode', timecodeMs: ms } } });
  });
  const tcReminder = createHint(
    'This trigger follows the Stream main timeline. The main timeline can be recalculated or reordered during Pro playback by operator interaction, so this timecode may not be stable until an external timecode source is added.',
  );
  tcReminder.classList.add('stream-at-timecode-reminder');
  tcWrap.append(createStreamDetailField('Timecode (ms)', tcInput), tcReminder);
  form.append(
    createSubCueSection(
      'Trigger',
      createSubCueFieldGrid(triggerSelect, followSelect, delayWrap, tcWrap),
    ),
  );

  form.append(
    createSubCueSection(
      'Playback',
      createSceneMiniGantt({
        scene,
        currentState,
        removeSubCue,
        requestRender,
        editsDisabled,
      }),
    ),
  );

  form.append(createSubCueSection('Metadata', createStreamDetailLine('Sub-cues', String(scene.subCueOrder.length))));
  return form;
}
