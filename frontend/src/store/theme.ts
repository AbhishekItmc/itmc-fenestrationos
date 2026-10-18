import { create } from 'zustand';

/** Application colour theme. Light is the default; the choice is remembered per browser. */
export type AppTheme = 'light' | 'dark';
const KEY = 'fos.theme';

function initial(): AppTheme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'light';
}

export function applyTheme(t: AppTheme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', t);
}

interface ThemeState {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial(),
  setTheme(t) {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    applyTheme(t);
    set({ theme: t });
  },
  toggle() {
    get().setTheme(get().theme === 'light' ? 'dark' : 'light');
  },
}));

applyTheme(useTheme.getState().theme);
