import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { type Lang, detectLang, translate } from '../lib/i18n';

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, ...args: (string | number)[]) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('lang', newLang);
  }, []);

  const t = useCallback((key: string, ...args: (string | number)[]) => {
    return translate(key, lang, ...args);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
