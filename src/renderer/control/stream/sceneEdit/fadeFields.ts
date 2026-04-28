import type { FadeSpec } from '../../../../shared/types';
import { createSelect } from '../../shared/dom';
import { createStreamDetailField } from '../streamDom';

const FADE_CURVES: Array<[FadeSpec['curve'], string]> = [
  ['linear', 'Linear'],
  ['equal-power', 'Equal power'],
  ['log', 'Log'],
];

export function createFadeFields(label: string, spec: FadeSpec | undefined, emit: (next: FadeSpec | undefined) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'stream-subcue-fade-group';
  const title = document.createElement('div');
  title.className = 'stream-subcue-fade-group-title';
  title.textContent = label;
  box.append(title);

  let curve: FadeSpec['curve'] = spec?.curve ?? 'linear';

  const dur = document.createElement('input');
  dur.type = 'number';
  dur.min = '0';
  dur.step = '1';
  dur.className = 'label-input';
  dur.value = spec ? String(spec.durationMs) : '';
  dur.placeholder = 'ms (optional)';
  dur.addEventListener('change', () => {
    const raw = dur.value.trim();
    if (raw === '') {
      emit(undefined);
      return;
    }
    const ms = Math.max(0, Number(raw) || 0);
    emit({ durationMs: ms, curve });
  });

  const curveSel = createSelect(
    'Curve',
    FADE_CURVES as Array<[string, string]>,
    spec?.curve ?? 'linear',
    (c) => {
      curve = c as FadeSpec['curve'];
      const raw = dur.value.trim();
      if (raw === '') {
        emit(undefined);
        return;
      }
      emit({ durationMs: Math.max(0, Number(raw) || 0), curve });
    },
  );

  box.append(createStreamDetailField('Duration (ms)', dur), curveSel);
  return box;
}
