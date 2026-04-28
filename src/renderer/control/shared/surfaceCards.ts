export function createSurfaceCard(title: string, className = ''): HTMLElement {
  const card = document.createElement('section');
  card.className = `surface-card ${className}`.trim();
  card.append(createDetailTitle(title));
  return card;
}

export function wrapSurfaceGrid(...children: HTMLElement[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'surface-grid';
  grid.append(...children);
  return grid;
}

export function createDetailTitle(text: string): HTMLHeadingElement {
  const title = document.createElement('h3');
  title.textContent = text;
  return title;
}

export function createDetailLine(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-line';
  const key = document.createElement('span');
  key.textContent = label;
  const val = document.createElement('strong');
  val.textContent = value;
  row.append(key, val);
  return row;
}
