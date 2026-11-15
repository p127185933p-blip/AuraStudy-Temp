export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'aurastudy.theme.v1';

export const THEME_COLOR_BY_MODE: Record<ThemeMode, string> = {
  light: '#1d4ed8',
  dark: '#0b1120',
};

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function getStoredTheme(): ThemeMode {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return 'light';
  }
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', THEME_COLOR_BY_MODE[theme]);
  }
}

export function setStoredTheme(theme: ThemeMode): void {
  const storage = getSafeLocalStorage();
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage quota errors
    }
  }
  applyTheme(theme);
}

export function initializeTheme(): ThemeMode {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
