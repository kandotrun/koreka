import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getResolvedTheme(pref: Theme): 'light' | 'dark' {
  return pref === 'system' ? getSystemTheme() : pref;
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', resolved);
}

export function useTheme() {
  const [preference, setPreference] = useState<Theme>(() => {
    const saved = localStorage.getItem('koreka-theme');
    return (saved as Theme) || 'system';
  });

  const resolved = getResolvedTheme(preference);

  // Apply on mount and when preference changes
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Listen for system theme changes when set to 'system'
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme(getSystemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setTheme = useCallback((theme: Theme) => {
    setPreference(theme);
    localStorage.setItem('koreka-theme', theme);
  }, []);

  const toggle = useCallback(() => {
    // Cycle: system → light → dark → system
    const next: Record<Theme, Theme> = {
      system: 'light',
      light: 'dark',
      dark: 'system',
    };
    setTheme(next[preference]);
  }, [preference, setTheme]);

  return { preference, resolved, setTheme, toggle };
}
