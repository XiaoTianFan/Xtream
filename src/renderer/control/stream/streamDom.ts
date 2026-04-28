export function createStreamTabBar<T extends string>(
  label: string,
  entries: Array<[T, string]>,
  active: T,
  onSelect: (value: T) => void,
): HTMLElement {
  const tablist = document.createElement('div');
  tablist.className = 'stream-tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', label);
  entries.forEach(([value, text]) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `pool-tab ${active === value ? 'active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(active === value));
    tab.textContent = text;
    tab.addEventListener('click', () => onSelect(value));
    tablist.append(tab);
  });
  return tablist;
}

export function createStreamCell(text: string, className?: string): HTMLElement {
  const cell = document.createElement('span');
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

export function createStreamDetailLine(labelText: string, valueText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-line';
  const label = document.createElement('span');
  label.textContent = labelText;
  const value = document.createElement('strong');
  value.textContent = valueText;
  row.append(label, value);
  return row;
}

export function createStreamDetailField(labelText: string, field: HTMLElement): HTMLElement {
  const label = document.createElement('label');
  label.className = 'detail-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, field);
  return label;
}

export function createStreamTextInput(value: string, onCommit: (value: string) => Promise<unknown>): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'label-input';
  input.value = value;
  input.addEventListener('change', () => {
    const next = input.value.trim() || value;
    input.value = next;
    void onCommit(next);
  });
  return input;
}
