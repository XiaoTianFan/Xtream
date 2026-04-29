import type { SceneLoopPolicy } from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailField } from '../streamDom';
import { createSubCueToggleButton } from './subCueFormControls';

/** Loop controls — parent re-mounts after each `emit` so `policy` stays fresh. */

export function createLoopPolicyEditor(policy: SceneLoopPolicy, labelText: string, emit: (next: SceneLoopPolicy) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stream-subcue-loop-policy';

  const loopButton = createSubCueToggleButton(labelText, policy.enabled, (enabled) => {
    if (enabled) {
      emit(policy.enabled ? policy : { enabled: true, iterations: { type: 'count', count: 1 } });
    } else {
      emit({ enabled: false });
    }
  });
  wrap.append(loopButton);

  const loopDetail = document.createElement('div');
  loopDetail.className = 'stream-scene-form-row stream-scene-loop-detail';
  loopDetail.hidden = !policy.enabled;

  if (policy.enabled) {
    const iterTypeSelect = createSelect(
      'Loop iterations',
      [
        ['count', 'Count'],
        ['infinite', 'Infinite'],
      ],
      policy.iterations.type,
      (value) => {
        const iterations =
          value === 'infinite' ? ({ type: 'infinite' } as const) : { type: 'count' as const, count: policy.iterations.type === 'count' ? policy.iterations.count : 1 };
        emit({ ...policy, iterations });
      },
    );
    loopDetail.append(iterTypeSelect);

    if (policy.iterations.type === 'count') {
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '1';
      countInput.step = '1';
      countInput.className = 'label-input';
      countInput.value = String(policy.iterations.count);
      countInput.addEventListener('change', () => {
        const c = Math.max(1, Math.floor(Number(countInput.value) || 1));
        emit({ ...policy, iterations: { type: 'count', count: c } });
      });
      loopDetail.append(createStreamDetailField('Loop count', countInput));
    }

    const rangeStart = document.createElement('input');
    rangeStart.type = 'number';
    rangeStart.min = '0';
    rangeStart.step = '100';
    rangeStart.className = 'label-input';
    rangeStart.value = String(policy.range?.startMs ?? 0);
    rangeStart.addEventListener('change', () => {
      const startMs = Math.max(0, Number(rangeStart.value) || 0);
      emit({ ...policy, range: { startMs, endMs: policy.range?.endMs } });
    });

    const rangeEnd = document.createElement('input');
    rangeEnd.type = 'number';
    rangeEnd.min = '0';
    rangeEnd.step = '100';
    rangeEnd.className = 'label-input';
    rangeEnd.placeholder = 'optional end';
    rangeEnd.value = policy.range?.endMs !== undefined ? String(policy.range.endMs) : '';
    rangeEnd.addEventListener('change', () => {
      const raw = rangeEnd.value.trim();
      const endMs = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
      const startMs = policy.range?.startMs ?? 0;
      emit({ ...policy, range: endMs !== undefined ? { startMs, endMs } : { startMs } });
    });
    loopDetail.append(createStreamDetailField('Loop range start (ms)', rangeStart), createStreamDetailField('Loop range end (ms)', rangeEnd));
  }

  wrap.append(loopDetail);
  return wrap;
}
