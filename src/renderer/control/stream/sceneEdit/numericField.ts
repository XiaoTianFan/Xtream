import { createStreamDetailField } from '../streamDom';

export function createOptionalNumberField(
  label: string,
  value: number | undefined,
  commit: (n: number | undefined) => void,
  options?: { min?: number; step?: string },
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'label-input';
  input.step = options?.step ?? 'any';
  if (options?.min !== undefined) {
    input.min = String(options.min);
  }
  if (value !== undefined && !Number.isNaN(value)) {
    input.value = String(value);
  }
  input.placeholder = '(optional)';
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '') {
      commit(undefined);
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v)) {
      commit(undefined);
      return;
    }
    const floor = options?.min;
    commit(floor !== undefined ? Math.max(floor, v) : v);
  });
  return createStreamDetailField(label, input);
}

export function createRequiredNumberField(label: string, value: number, commit: (n: number) => void, min?: number): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'label-input';
  input.step = 'any';
  if (min !== undefined) {
    input.min = String(min);
  }
  input.value = String(value);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isNaN(v)) {
      return;
    }
    commit(min !== undefined ? Math.max(min, v) : v);
  });
  return createStreamDetailField(label, input);
}
