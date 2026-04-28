import { resolveFollowsSceneId } from '../../../../shared/streamSchedule';
import type {
  PersistedSceneConfig,
  PersistedStreamConfig,
  SceneId,
  SceneLoopPolicy,
  SceneTrigger,
} from '../../../../shared/types';
import { createButton, createHint, createSelect } from '../../shared/dom';
import { formatTriggerSummary } from '../formatting';
import { createStreamDetailField, createStreamDetailLine } from '../streamDom';

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
  form.append(createStreamDetailField('Title', titleInput));

  const noteInput = document.createElement('textarea');
  noteInput.className = 'label-input stream-scene-note-input';
  noteInput.rows = 3;
  noteInput.value = scene.note ?? '';
  noteInput.placeholder = 'Scene note';
  noteInput.addEventListener('change', () => {
    const v = noteInput.value.trim();
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { note: v || undefined } });
  });
  form.append(createStreamDetailField('Note', noteInput));

  const disabledLabel = document.createElement('label');
  disabledLabel.className = 'stream-checkbox-field';
  const disabledBox = document.createElement('input');
  disabledBox.type = 'checkbox';
  disabledBox.checked = !!scene.disabled;
  disabledBox.addEventListener('change', () => {
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { disabled: disabledBox.checked } });
  });
  disabledLabel.append(disabledBox, document.createTextNode(' Scene disabled'));
  form.append(disabledLabel);

  const triggerType = scene.trigger.type;
  const triggerSelect = createSelect(
    'Trigger mode',
    [
      ['manual', 'Manual'],
      ['simultaneous-start', 'Simultaneous start'],
      ['follow-end', 'Follow end'],
      ['time-offset', 'Time offset'],
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
      } else if (nextType === 'time-offset') {
        const prev =
          scene.trigger.type === 'time-offset'
            ? scene.trigger
            : { offsetMs: 1000, followsSceneId: resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }) };
        nextTrigger = {
          type: 'time-offset',
          offsetMs: 'offsetMs' in prev ? prev.offsetMs : 1000,
          followsSceneId: 'followsSceneId' in prev ? prev.followsSceneId : undefined,
        };
      } else if (nextType === 'simultaneous-start') {
        nextTrigger = {
          type: 'simultaneous-start',
          followsSceneId:
            scene.trigger.type === 'simultaneous-start' ? scene.trigger.followsSceneId : resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }),
        };
      } else {
        nextTrigger = {
          type: 'follow-end',
          followsSceneId: scene.trigger.type === 'follow-end' ? scene.trigger.followsSceneId : resolveFollowsSceneId(stream, scene.id, { type: 'follow-end' }),
        };
      }
      void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: nextTrigger } });
    },
  );
  form.append(triggerSelect);

  const followOptions: Array<[string, string]> = stream.sceneOrder
    .filter((id) => id !== scene.id)
    .map((id) => [id, stream.scenes[id]?.title ?? id]);
  const needsFollow = triggerType === 'simultaneous-start' || triggerType === 'follow-end' || triggerType === 'time-offset';
  const explicitFollowId =
    needsFollow && (scene.trigger.type === 'simultaneous-start' || scene.trigger.type === 'follow-end' || scene.trigger.type === 'time-offset')
      ? scene.trigger.followsSceneId
      : undefined;
  const followSelect = createSelect(
    'Follow scene',
    [['', '(implicit: previous row)'], ...followOptions],
    explicitFollowId ?? '',
    (value) => {
      const id = value || undefined;
      const t = scene.trigger;
      if (t.type === 'simultaneous-start') {
        void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'simultaneous-start', followsSceneId: id } } });
      } else if (t.type === 'follow-end') {
        void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { trigger: { type: 'follow-end', followsSceneId: id } } });
      } else if (t.type === 'time-offset') {
        void window.xtream.stream.edit({
          type: 'update-scene',
          sceneId: scene.id,
          update: { trigger: { type: 'time-offset', offsetMs: t.offsetMs, followsSceneId: id } },
        });
      }
    },
  );
  followSelect.hidden = !needsFollow;
  form.append(followSelect);

  const offsetWrap = document.createElement('div');
  offsetWrap.className = 'stream-scene-form-row';
  offsetWrap.hidden = triggerType !== 'time-offset';
  const offsetMs = scene.trigger.type === 'time-offset' ? scene.trigger.offsetMs : 0;
  const offsetInput = document.createElement('input');
  offsetInput.type = 'number';
  offsetInput.min = '0';
  offsetInput.step = '100';
  offsetInput.className = 'label-input';
  offsetInput.value = String(offsetMs);
  offsetInput.addEventListener('change', () => {
    if (scene.trigger.type !== 'time-offset') {
      return;
    }
    const ms = Math.max(0, Number(offsetInput.value) || 0);
    void window.xtream.stream.edit({
      type: 'update-scene',
      sceneId: scene.id,
      update: { trigger: { type: 'time-offset', offsetMs: ms, followsSceneId: scene.trigger.followsSceneId } },
    });
  });
  offsetWrap.append(createStreamDetailField('Offset (ms)', offsetInput));
  form.append(offsetWrap);

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
  form.append(tcWrap);

  const loopLabel = document.createElement('label');
  loopLabel.className = 'stream-checkbox-field';
  const loopBox = document.createElement('input');
  loopBox.type = 'checkbox';
  loopBox.checked = scene.loop.enabled;
  loopBox.addEventListener('change', () => {
    const next: SceneLoopPolicy = loopBox.checked
      ? scene.loop.enabled
        ? scene.loop
        : { enabled: true, iterations: { type: 'count', count: 1 } }
      : { enabled: false };
    void window.xtream.stream.edit({ type: 'update-scene', sceneId: scene.id, update: { loop: next } });
  });
  loopLabel.append(loopBox, document.createTextNode(' Scene loop'));
  form.append(loopLabel);

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
  form.append(loopDetail);

  const preloadLabel = document.createElement('label');
  preloadLabel.className = 'stream-checkbox-field';
  const preloadBox = document.createElement('input');
  preloadBox.type = 'checkbox';
  preloadBox.checked = scene.preload.enabled;
  preloadBox.addEventListener('change', () => {
    void window.xtream.stream.edit({
      type: 'update-scene',
      sceneId: scene.id,
      update: { preload: { enabled: preloadBox.checked, leadTimeMs: scene.preload.leadTimeMs } },
    });
  });
  preloadLabel.append(preloadBox, document.createTextNode(' Preload'));
  form.append(preloadLabel);

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
  form.append(leadWrap);

  form.append(
    createStreamDetailLine('Trigger summary', formatTriggerSummary(stream, scene)),
    createStreamDetailLine('Sub-cues', String(scene.subCueOrder.length)),
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
  form.append(actions);
  return form;
}
