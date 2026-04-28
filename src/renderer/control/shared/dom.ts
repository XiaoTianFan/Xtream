export function assertElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing control element: ${name}`);
  }
  return element;
}

export function createSectionHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement('h3');
  heading.textContent = text;
  return heading;
}

export function createHint(text: string): HTMLParagraphElement {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = text;
  return hint;
}

export function createButton(label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) {
    button.className = className;
  }
  button.textContent = label;
  button.addEventListener('click', () => void onClick());
  return button;
}

export function createSelect(labelText: string, options: Array<[string, string]>, value: string, onChange: (value: string) => void): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'mapping-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  field.append(label, select);
  return field;
}

export function setSelectEnabled(wrapper: HTMLDivElement, enabled: boolean): void {
  const select = wrapper.querySelector('select');
  if (select) {
    select.disabled = !enabled;
  }
}

type SliderOptions = {
  min: string;
  max: string;
  step: string;
  value: string;
  ariaLabel?: string;
  className?: string;
};

export function createSlider({ min, max, step, value, ariaLabel, className = '' }: SliderOptions): HTMLInputElement {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = `mini-slider ${className}`.trim();
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = value;
  if (ariaLabel) {
    slider.setAttribute('aria-label', ariaLabel);
  }
  syncSliderProgress(slider);
  slider.addEventListener('input', () => syncSliderProgress(slider));
  return slider;
}

export function syncSliderProgress(slider: HTMLInputElement): void {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const value = Number(slider.value || min);
  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--progress', `${Math.min(100, Math.max(0, progress))}%`);
}

export function createDbFader(labelText: string, value: number, onChange: (value: number) => void): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'db-control';
  const label = document.createElement('label');
  label.textContent = labelText;
  const range = createSlider({ min: '-60', max: '12', step: '1', value: String(value), ariaLabel: labelText });
  const number = document.createElement('input');
  number.type = 'number';
  number.min = '-60';
  number.max = '12';
  number.step = '1';
  number.value = String(value);
  const commit = (rawValue: string) => {
    const nextValue = Math.min(12, Math.max(-60, Number(rawValue)));
    if (Number.isFinite(nextValue)) {
      range.value = String(nextValue);
      number.value = String(nextValue);
      syncSliderProgress(range);
      onChange(nextValue);
    }
  };
  range.addEventListener('input', () => {
    number.value = range.value;
    commit(range.value);
  });
  number.addEventListener('change', () => commit(number.value));
  field.append(label, range, number);
  return field;
}

export function formatPanLabel(pan: number): { title: string; valuetext: string } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const pct = Math.round(Math.abs(clamped) * 100);
  if (pct < 1) {
    return { title: 'Pan: center', valuetext: 'C' };
  }
  if (clamped < 0) {
    return { title: `Pan: ${pct}% left`, valuetext: `L ${pct}%` };
  }
  return { title: `Pan: ${pct}% right`, valuetext: `R ${pct}%` };
}

type PanKnobOptions = {
  /** Shown in aria-label / title, e.g. "Main bus pan" or "Pan SourceName". */
  name: string;
  value: number;
  onChange: (pan: number) => void;
  /** 'mixer' = compact strip, 'row' = output detail row. */
  variant?: 'mixer' | 'row';
};

const PAN_KNOB_ROTATION_DEGREES = 120;

export function createPanKnob({ name, value, onChange, variant = 'row' }: PanKnobOptions): HTMLDivElement {
  const field = document.createElement('div');
  field.className = `pan-knob pan-knob--${variant}`;

  const face = document.createElement('div');
  face.className = 'pan-knob-face';
  const pointer = document.createElement('div');
  pointer.className = 'pan-knob-pointer';
  const dial = document.createElement('div');
  dial.className = 'pan-knob-dial';
  dial.append(pointer);
  face.append(dial);

  const { title, valuetext } = formatPanLabel(value);
  const range = createSlider({
    min: '-1',
    max: '1',
    step: '0.01',
    value: String(Math.max(-1, Math.min(1, value))),
    className: 'pan-knob-input',
  });
  range.setAttribute('aria-label', name);
  range.setAttribute('aria-valuemin', '-1');
  range.setAttribute('aria-valuemax', '1');
  range.setAttribute('aria-valuetext', valuetext);
  range.title = title;

  const applyRotation = (raw: number) => {
    const pan = Math.max(-1, Math.min(1, raw));
    pointer.style.setProperty('--pan-knob-rotate', String(pan * PAN_KNOB_ROTATION_DEGREES));
  };
  applyRotation(Number(range.value));
  const commit = (raw: string) => {
    const next = Math.max(-1, Math.min(1, Number(raw)));
    if (Number.isFinite(next)) {
      const labels = formatPanLabel(next);
      range.value = String(next);
      range.setAttribute('aria-valuetext', labels.valuetext);
      range.title = labels.title;
      applyRotation(next);
      onChange(next);
    }
  };
  range.addEventListener('input', () => commit(range.value));
  const reset = () => {
    range.value = '0';
    commit('0');
  };
  range.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    reset();
  });
  range.addEventListener('click', (event) => {
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      reset();
    }
  });

  field.append(face, range);
  return field;
}

export function createPreviewLabel(label: string, detail: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'preview-empty';
  const title = document.createElement('strong');
  title.textContent = label;
  const description = document.createElement('small');
  description.textContent = detail;
  wrapper.append(title, description);
  return wrapper;
}
