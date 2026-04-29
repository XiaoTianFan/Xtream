import { createPanKnob, formatPanLabel } from '../../shared/dom';

export function createSubCueSection(titleText: string, ...children: Array<HTMLElement | Text>): HTMLElement {
  const section = document.createElement('section');
  section.className = 'stream-subcue-section';

  const title = document.createElement('div');
  title.className = 'stream-subcue-section-title';
  title.textContent = titleText;

  section.append(title, ...children);
  return section;
}

export function createSubCueFieldGrid(...children: HTMLElement[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'stream-subcue-field-grid';
  grid.append(...children);
  return grid;
}

export function createSubCueToggleButton(label: string, pressed: boolean, onToggle: (pressed: boolean) => void): HTMLButtonElement {
  let isPressed = pressed;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `stream-subcue-toggle${isPressed ? ' active' : ''}`;
  button.textContent = label;
  button.setAttribute('aria-pressed', String(isPressed));
  button.addEventListener('click', () => {
    isPressed = !isPressed;
    button.classList.toggle('active', isPressed);
    button.setAttribute('aria-pressed', String(isPressed));
    onToggle(isPressed);
  });
  return button;
}

export function createSubCueToggleRow(...toggles: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stream-subcue-toggle-row';
  row.append(...toggles);
  return row;
}

export function createSubCueChip(label: string, selected: boolean, onToggle: (selected: boolean) => void): HTMLButtonElement {
  let isSelected = selected;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `stream-subcue-chip${isSelected ? ' active' : ''}`;
  chip.textContent = label;
  chip.setAttribute('aria-pressed', String(isSelected));
  chip.addEventListener('click', () => {
    isSelected = !isSelected;
    chip.classList.toggle('active', isSelected);
    chip.setAttribute('aria-pressed', String(isSelected));
    onToggle(isSelected);
  });
  return chip;
}

export function createSubCueChipGroup(...chips: HTMLButtonElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'stream-subcue-chip-group';
  group.append(...chips);
  return group;
}

export function createSubCueEmptyNote(text: string): HTMLElement {
  const note = document.createElement('div');
  note.className = 'stream-subcue-empty-note';
  note.textContent = text;
  return note;
}

export function createSubCuePanField(labelText: string, name: string, value: number, onChange: (pan: number) => void): HTMLElement {
  const field = document.createElement('div');
  field.className = 'stream-subcue-pan-field';

  const label = document.createElement('span');
  label.className = 'stream-subcue-pan-label';
  label.textContent = labelText;

  const valueLabel = document.createElement('strong');
  valueLabel.className = 'stream-subcue-pan-value';

  const setValueLabel = (pan: number) => {
    valueLabel.textContent = formatPanLabel(pan).valuetext;
  };
  setValueLabel(value);

  const knob = createPanKnob({
    name,
    value,
    variant: 'row',
    onChange: (pan) => {
      setValueLabel(pan);
      onChange(pan);
    },
  });

  const control = document.createElement('div');
  control.className = 'stream-subcue-pan-control';
  control.append(knob, valueLabel);

  field.append(label, control);
  return field;
}
