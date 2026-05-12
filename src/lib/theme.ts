export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'joblog:theme';

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function initTheme(): Theme {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}
