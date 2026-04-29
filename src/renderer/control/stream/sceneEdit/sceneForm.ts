import { resolveFollowsSceneId } from '../../../../shared/streamSchedule';
import type {
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  SceneLoopPolicy,
  SceneTrigger,
} from '../../../../shared/types';
import { createButton, createSelect } from '../../shared/dom';
import { formatTriggerSummary } from '../formatting';
import { createStreamDetailField, createStreamDetailLine } from '../streamDom';
import {
  createSubCueFieldGrid,
  createSubCueSection,
  createSubCueToggleButton,
  createSubCueToggleRow,
} from './subCueFormControls';

export type SceneFormDeps = {
  stream: PersistedStreamConfig;
  scene: PersistedSceneConfig;
  duplicateScene: (sceneId: SceneId) => void;
  removeScene: (sceneId: SceneId) => void;
};

export function createStreamSceneForm(deps: SceneFormDeps): HTMLElement {
  const { stream, scene, duplicateScene, removeScene } = deps;
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
  noteInput.className = 'label-input stream-scene-note-input';
  noteInput.rows = 3;
  noteInput.value = scene.note ?? '';
  noteInput.placeholder = 'Scene note';
  noteInput.addEventListener('change', () => {
    const v = noteInput.value.trim();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { note: v || undefined } });
  });
  const noteField = createStreamDetailField('Note', noteInput);
  noteField.classList.add('stream-scene-note-field');

  form.append(
    createSubCueSection(
      'Details',
      createSubCueFieldGrid(titleField, noteField),
      createSubCueToggleRow(
        createSubCueToggleButton('Scene disabled', !!scene.disabled, (disabled) =>
          void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled } }),
        ),
      ),
    ),
  );

  const triggerType = scene.trigger.type;
  const triggerSelect = createSelect(
    'Trigger mode',
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
  tcWrap.append(createStreamDetailField('Timecode (ms)', tcInput));
  form.append(
    createSubCueSection(
      'Trigger',
      createSubCueFieldGrid(triggerSelect, followSelect, delayWrap, tcWrap),
      createStreamDetailLine('Trigger summary', formatTriggerSummary(stream, scene)),
    ),
  );

  const loopDetail = document.createElement('div');
  loopDetail.className = 'stream-scene-form-row stream-scene-loop-detail';
  loopDetail.hidden = !scene.loop.enabled;
  if (scene.loop.enabled) {
    const iterTypeSelect = createSelect(
      'Loop iterations',
      [
        ['count', 'Count'],
        ['infinite', 'Infinite'],
      ],
      scene.loop.iterations.type,
      (value) => {
        if (!scene.loop.enabled) {
          return;
        }
        const iterations =
          value === 'infinite' ? ({ type: 'infinite' } as const) : { type: 'count' as const, count: scene.loop.iterations.type === 'count' ? scene.loop.iterations.count : 1 };
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: { loop: { ...scene.loop, iterations } },
        });
      },
    );
    loopDetail.append(iterTypeSelect);

    if (scene.loop.iterations.type === 'count') {
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '1';
      countInput.step = '1';
      countInput.className = 'label-input';
      countInput.value = String(scene.loop.iterations.count);
      countInput.addEventListener('change', () => {
        if (!scene.loop.enabled || scene.loop.iterations.type !== 'count') {
          return;
        }
        const c = Math.max(1, Math.floor(Number(countInput.value) || 1));
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: { loop: { ...scene.loop, iterations: { type: 'count', count: c } } },
        });
      });
      loopDetail.append(createStreamDetailField('Loop count', countInput));
    }

    const rangeStart = document.createElement('input');
    rangeStart.type = 'number';
    rangeStart.min = '0';
    rangeStart.step = '100';
    rangeStart.className = 'label-input';
    rangeStart.value = String(scene.loop.range?.startMs ?? 0);
    rangeStart.addEventListener('change', () => {
      if (!scene.loop.enabled) {
        return;
      }
      const startMs = Math.max(0, Number(rangeStart.value) || 0);
      const endMs = scene.loop.range?.endMs;
      void window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: scene.id,
        update: { loop: { ...scene.loop, range: { startMs, endMs } } },
      });
    });
    loopDetail.append(createStreamDetailField('Loop range start (ms)', rangeStart));

    const rangeEnd = document.createElement('input');
    rangeEnd.type = 'number';
    rangeEnd.min = '0';
    rangeEnd.step = '100';
    rangeEnd.className = 'label-input';
    rangeEnd.placeholder = 'optional end';
    rangeEnd.value = scene.loop.range?.endMs !== undefined ? String(scene.loop.range.endMs) : '';
    rangeEnd.addEventListener('change', () => {
      if (!scene.loop.enabled) {
        return;
      }
      const raw = rangeEnd.value.trim();
      const endMs = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
      const startMs = scene.loop.range?.startMs ?? 0;
      void window.xtream.stream.edit({
        type: 'update-scene',
        sceneId: scene.id,
        update: { loop: { ...scene.loop, range: endMs !== undefined ? { startMs, endMs } : { startMs } } },
      });
    });
    loopDetail.append(createStreamDetailField('Loop range end (ms)', rangeEnd));
  }

  const leadWrap = document.createElement('div');
  leadWrap.className = 'stream-scene-form-row';
  leadWrap.hidden = !scene.preload.enabled;
  const leadInput = document.createElement('input');
  leadInput.type = 'number';
  leadInput.min = '0';
  leadInput.step = '100';
  leadInput.className = 'label-input';
  leadInput.value = String(scene.preload.leadTimeMs ?? 0);
  leadInput.addEventListener('change', () => {
    const ms = Math.max(0, Number(leadInput.value) || 0);
    void window.xtream.stream.edit({
      type: 'update-scene',
      sceneId: scene.id,
      update: { preload: { enabled: true, leadTimeMs: ms } },
    });
  });
  leadWrap.append(createStreamDetailField('Preload lead time (ms)', leadInput));

  form.append(
    createSubCueSection(
      'Playback',
      createSubCueToggleRow(
        createSubCueToggleButton('Scene loop', scene.loop.enabled, (enabled) => {
          const next: SceneLoopPolicy = enabled
            ? scene.loop.enabled
              ? scene.loop
              : { enabled: true, iterations: { type: 'count', count: 1 } }
            : { enabled: false };
          void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { loop: next } });
        }),
        createSubCueToggleButton('Preload', scene.preload.enabled, (enabled) =>
          void window.xtream.stream.edit({
            type: 'update-scene',
            sceneId: scene.id,
            update: { preload: { enabled, leadTimeMs: scene.preload.leadTimeMs } },
          }),
        ),
      ),
      createSubCueFieldGrid(loopDetail, leadWrap),
    ),
  );

  const actions = document.createElement('div');
  actions.className = 'button-row';
  const removeDisabled = stream.sceneOrder.length <= 1;
  actions.append(
    createButton(scene.disabled ? 'Enable' : 'Disable', 'secondary', () =>
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: !scene.disabled } }),
    ),
    createButton('Duplicate', 'secondary', () => duplicateScene(scene.id)),
    createButton('Remove', 'secondary', () => removeScene(scene.id)),
  );
  const removeBtn = actions.querySelectorAll('button')[2] as HTMLButtonElement;
  removeBtn.disabled = removeDisabled;
  form.append(createSubCueSection('Metadata', createStreamDetailLine('Sub-cues', String(scene.subCueOrder.length)), actions));
  return form;
}
