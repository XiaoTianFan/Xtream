import type { ControlSurface } from '../shared/types';
import type { SessionProblemStripItem } from './sessionProblems';

function sortStripItemsForSurface(items: SessionProblemStripItem[], surface: ControlSurface): SessionProblemStripItem[] {
  const rank = (d: SessionProblemStripItem['domain']): number => {
    if (d === 'global') {
      return 0;
    }
    if (surface === 'patch' && d === 'patch') {
      return 1;
    }
    if (surface === 'stream' && d === 'stream') {
      return 1;
    }
    if (surface === 'performance' || surface === 'config') {
      return d === 'patch' ? 1 : 2;
    }
    return 2;
  };
  return [...items].sort((a, b) => {
    const dr = rank(a.domain) - rank(b.domain);
    if (dr !== 0) {
      return dr;
    }
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1;
    }
    return a.text.localeCompare(b.text);
  });
}

export function renderGlobalSessionProblems(
  container: HTMLElement,
  items: SessionProblemStripItem[],
  surface: ControlSurface,
): void {
  const sorted = sortStripItemsForSurface(items, surface);
  if (sorted.length === 0) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.replaceChildren(
    ...sorted.map((item) => {
      const row = document.createElement('span');
      row.className = `session-problem-chip session-problem-chip--${item.severity} session-problem-chip--domain-${item.domain}`;
      row.title = item.text;
      const badge = document.createElement('span');
      badge.className = 'session-problem-domain';
      badge.textContent = item.domain === 'global' ? 'ALL' : item.domain.toUpperCase();
      const text = document.createElement('span');
      text.className = 'session-problem-text';
      text.textContent = item.text;
      row.append(badge, text);
      return row;
    }),
  );
}

export function setGlobalSessionHint(el: HTMLElement, message: string | undefined): void {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) {
    el.textContent = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = trimmed;
}
