import { createStreamDetailField } from '../streamDom';

export type DraggableNumberFieldOptions = {
  min?: number;
  max?: number;
  step?: number;
  dragStep?: number;
  disabled?: boolean;
  integer?: boolean;
  placeholder?: string;
};

export function createDraggableNumberField(
  labelText: string,
  value: number | undefined,
  commit: (value: number | undefined) => void,
  options: DraggableNumberFieldOptions = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stream-draggable-number';

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'stream-draggable-number-grip';
  grip.textContent = labelText;
  grip.disabled = options.disabled === true;
  grip.title = 'Drag horizontally to adjust';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'label-input';
  input.step = String(options.step ?? 'any');
  input.disabled = options.disabled === true;
  if (options.min !== undefined) {
    input.min = String(options.min);
  }
  if (options.max !== undefined) {
    input.max = String(options.max);
  }
  if (value !== undefined && Number.isFinite(value)) {
    input.value = String(value);
  }
  input.placeholder = options.placeholder ?? '';

  const normalize = (raw: number | undefined): number | undefined => {
    if (raw === undefined || !Number.isFinite(raw)) {
      return undefined;
    }
    const min = options.min ?? Number.NEGATIVE_INFINITY;
    const max = options.max ?? Number.POSITIVE_INFINITY;
    const clamped = Math.min(max, Math.max(min, raw));
    return options.integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
  };

  const commitInput = () => {
    const raw = input.value.trim();
    const next = raw === '' ? undefined : normalize(Number(raw));
    if (next === undefined) {
      input.value = '';
      commit(undefined);
      return;
    }
    input.value = String(next);
    commit(next);
  };
  input.addEventListener('change', commitInput);

  let dragStartX = 0;
  let dragStartValue = 0;
  let pointerId: number | undefined;
  let moved = false;

  grip.addEventListener('pointerdown', (event) => {
    if (grip.disabled || input.disabled) {
      return;
    }
    pointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartValue = Number(input.value || value || 0);
    moved = false;
    grip.setPointerCapture(event.pointerId);
  });

  grip.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }
    const modifier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const step = (options.dragStep ?? options.step ?? 1) * modifier;
    const next = normalize(dragStartValue + (event.clientX - dragStartX) * step);
    if (next === undefined) {
      return;
    }
    moved = true;
    input.value = String(next);
  });

  grip.addEventListener('pointerup', (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }
    grip.releasePointerCapture(event.pointerId);
    pointerId = undefined;
    if (moved) {
      commitInput();
    }
  });

  wrap.append(grip, input);
  return createStreamDetailField('', wrap);
}
