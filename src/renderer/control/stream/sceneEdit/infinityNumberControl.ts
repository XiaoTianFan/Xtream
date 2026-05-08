import { createStreamDetailField } from '../streamDom';

export type InfinityNumberValue = { type: 'count'; count: number } | { type: 'infinite' };

export type InfinityNumberControl = HTMLElement & {
  sync: (value: InfinityNumberValue, options?: { disabled?: boolean; infinityDisabled?: boolean }) => void;
};

export function createInfinityNumberToggle(
  labelText: string,
  value: InfinityNumberValue,
  commit: (value: InfinityNumberValue) => void,
  options: { min: number; step?: number; disabled?: boolean; infinityDisabled?: boolean } = { min: 0 },
): InfinityNumberControl {
  const wrap = document.createElement('div') as unknown as InfinityNumberControl;
  wrap.className = 'stream-infinity-number';

  const infinity = document.createElement('button');
  infinity.type = 'button';
  infinity.className = 'stream-infinity-number-toggle';
  infinity.textContent = labelText;
  infinity.setAttribute('aria-label', `${labelText} infinity`);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'label-input stream-infinity-number-input';
  input.setAttribute('aria-label', labelText);
  input.step = String(options.step ?? 1);

  const normalizeCount = (raw: number | undefined): number => Math.max(options.min, Math.round(Number.isFinite(raw) ? (raw as number) : options.min));

  const sync = (next: InfinityNumberValue, syncOptions: { disabled?: boolean; infinityDisabled?: boolean } = {}) => {
    const disabled = syncOptions.disabled ?? options.disabled === true;
    const infinityDisabled = syncOptions.infinityDisabled ?? options.infinityDisabled === true;
    const isInfinite = next.type === 'infinite';
    wrap.classList.toggle('is-infinite', isInfinite);
    infinity.classList.toggle('active', isInfinite);
    infinity.setAttribute('aria-pressed', String(isInfinite));
    infinity.disabled = disabled || infinityDisabled;
    input.disabled = disabled || isInfinite;
    input.value = isInfinite ? '∞' : String(normalizeCount(next.count));
  };

  infinity.addEventListener('click', () => {
    const pressed = infinity.getAttribute('aria-pressed') === 'true';
    commit(pressed ? { type: 'count', count: normalizeCount(undefined) } : { type: 'infinite' });
  });

  input.addEventListener('change', () => {
    const raw = input.value.trim();
    const count = normalizeCount(raw === '' ? undefined : Number(raw));
    input.value = String(count);
    commit({ type: 'count', count });
  });

  wrap.sync = sync;
  wrap.append(infinity, input);
  sync(value);
  const field = createStreamDetailField(labelText, wrap) as InfinityNumberControl;
  field.sync = sync;
  return field;
}
