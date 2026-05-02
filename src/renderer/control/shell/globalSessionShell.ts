import type { ControlSurface } from '../shared/types';
import type { SessionProblemStripItem } from './sessionProblems';

/** Visible duration after the hint is shown or after shell refresh settles. */
const GLOBAL_SESSION_HINT_HOLD_MS = 3000;
/** Wait this long with no shell refresh before starting the hold timer (coalesces burst updates). */
const GLOBAL_SESSION_HINT_REFRESH_DEBOUNCE_MS = 150;

let hintHideTimer: number | undefined;
let hintRefreshDebounce: number | undefined;

function clearGlobalSessionHintTimers(): void {
  if (hintHideTimer !== undefined) {
    window.clearTimeout(hintHideTimer);
    hintHideTimer = undefined;
  }
  if (hintRefreshDebounce !== undefined) {
    window.clearTimeout(hintRefreshDebounce);
    hintRefreshDebounce = undefined;
  }
}

function scheduleGlobalSessionHintHide(el: HTMLElement): void {
  if (hintHideTimer !== undefined) {
    window.clearTimeout(hintHideTimer);
  }
  hintHideTimer = window.setTimeout(() => {
    hintHideTimer = undefined;
    el.textContent = '';
    el.hidden = true;
  }, GLOBAL_SESSION_HINT_HOLD_MS);
}

/**
 * After the problem strip / shell refreshes, keep any visible hint up, then hide it
 * `GLOBAL_SESSION_HINT_HOLD_MS` after updates settle (debounced).
 */
export function bumpGlobalSessionHintAfterShellRefresh(el: HTMLElement): void {
  if (el.hidden || (el.textContent?.trim().length ?? 0) === 0) {
    return;
  }
  if (hintHideTimer !== undefined) {
    window.clearTimeout(hintHideTimer);
    hintHideTimer = undefined;
  }
  if (hintRefreshDebounce !== undefined) {
    window.clearTimeout(hintRefreshDebounce);
  }
  hintRefreshDebounce = window.setTimeout(() => {
    hintRefreshDebounce = undefined;
    if (el.hidden || (el.textContent?.trim().length ?? 0) === 0) {
      return;
    }
    scheduleGlobalSessionHintHide(el);
  }, GLOBAL_SESSION_HINT_REFRESH_DEBOUNCE_MS);
}

const panAbortByContainer = new WeakMap<HTMLElement, AbortController>();

function teardownSessionProblemsPan(container: HTMLElement): void {
  panAbortByContainer.get(container)?.abort();
  panAbortByContainer.delete(container);
}

function attachSessionProblemsPan(scrollEl: HTMLElement, track: HTMLElement): void {
  const container = scrollEl.parentElement as HTMLElement | null;
  if (!container) {
    return;
  }

  const ac = new AbortController();
  panAbortByContainer.set(container, ac);
  const { signal } = ac;

  const syncOverflowClass = (): void => {
    const overflow = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
    scrollEl.classList.toggle('is-overflowing', overflow);
    if (overflow) {
      scrollEl.title = 'Scroll: mouse wheel or drag sideways to see all messages';
    } else {
      scrollEl.removeAttribute('title');
    }
  };

  const ro = new ResizeObserver(() => {
    syncOverflowClass();
  });
  ro.observe(scrollEl);
  ro.observe(track);
  signal.addEventListener('abort', () => ro.disconnect());

  requestAnimationFrame(() => {
    syncOverflowClass();
  });

  scrollEl.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (scrollEl.scrollWidth <= scrollEl.clientWidth + 1) {
        return;
      }
      e.preventDefault();
      scrollEl.scrollLeft += e.deltaY + e.deltaX;
    },
    { passive: false, signal },
  );

  let dragging = false;
  let startX = 0;
  let startScroll = 0;

  const onDown = (e: MouseEvent): void => {
    if (e.button !== 0 || scrollEl.scrollWidth <= scrollEl.clientWidth + 1) {
      return;
    }
    dragging = true;
    startX = e.clientX;
    startScroll = scrollEl.scrollLeft;
    scrollEl.classList.add('is-dragging');
  };

  const onMove = (e: MouseEvent): void => {
    if (!dragging) {
      return;
    }
    scrollEl.scrollLeft = startScroll - (e.clientX - startX);
  };

  const onUp = (): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    scrollEl.classList.remove('is-dragging');
  };

  scrollEl.addEventListener('mousedown', onDown, { signal });
  window.addEventListener('mousemove', onMove, { signal });
  window.addEventListener('mouseup', onUp, { signal });
  signal.addEventListener('abort', onUp);
}

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
  teardownSessionProblemsPan(container);

  const sorted = sortStripItemsForSurface(items, surface);
  if (sorted.length === 0) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const scrollEl = document.createElement('div');
  scrollEl.className = 'global-session-problems-window';

  const track = document.createElement('div');
  track.className = 'global-session-problems-track';

  sorted.forEach((item, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'session-problem-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '·';
      track.appendChild(sep);
    }
    const line = document.createElement('span');
    line.className = `session-problem-inline session-problem-inline--${item.severity}`;
    line.title = item.text;
    const tag = document.createElement('span');
    tag.className = 'session-problem-tag';
    tag.textContent = item.domain === 'global' ? 'ALL' : item.domain.toUpperCase();
    line.append(tag, ' ', item.text);
    track.appendChild(line);
  });

  scrollEl.appendChild(track);
  container.replaceChildren(scrollEl);
  attachSessionProblemsPan(scrollEl, track);
}

export function setGlobalSessionHint(el: HTMLElement, message: string | undefined): void {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) {
    clearGlobalSessionHintTimers();
    el.textContent = '';
    el.hidden = true;
    return;
  }
  if (hintRefreshDebounce !== undefined) {
    window.clearTimeout(hintRefreshDebounce);
    hintRefreshDebounce = undefined;
  }
  el.hidden = false;
  el.textContent = trimmed;
  scheduleGlobalSessionHintHide(el);
}
