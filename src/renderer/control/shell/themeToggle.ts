import { decorateIconButton } from '../shared/icons';

const STORAGE_KEY = 'xtream-theme';

type Theme = 'dark' | 'light';

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* localStorage may be unavailable */
  }
  return null;
}

function getSystemTheme(): Theme {
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function getCurrentTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  if (theme === 'light') {
    html.setAttribute('data-theme', 'light');
  } else {
    html.removeAttribute('data-theme');
  }
}

function updateButtonIcon(button: HTMLButtonElement, theme: Theme): void {
  const iconName: 'Moon' | 'Sun' = theme === 'light' ? 'Moon' : 'Sun';
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  decorateIconButton(button, iconName, label);
}

export function installThemeToggle(button: HTMLButtonElement): void {
  let theme = getCurrentTheme();
  applyTheme(theme);
  updateButtonIcon(button, theme);

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    updateButtonIcon(button, theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  });
}
