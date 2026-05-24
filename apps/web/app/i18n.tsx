'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type Lang = 'ar' | 'en';

type I18nContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  isRTL: boolean;
};

const I18nContext = createContext<I18nContextType | null>(null);

// Import translations
import { translations } from './translations';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  useEffect(() => {
    const saved = localStorage.getItem('lang') as Lang | null;
    if (saved === 'ar' || saved === 'en') setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('lang', l);
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const t = useCallback((key: string): string => {
    return translations[key]?.[lang] || key;
  }, [lang]);

  const isRTL = lang === 'ar';

  return (
    <I18nContext.Provider value={{ lang, setLang, t, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

// Toggle button component
export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      style={{
        background: 'none',
        border: '1px solid var(--line)',
        color: 'var(--text)',
        padding: '6px 14px',
        borderRadius: 10,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        minWidth: 42,
        textAlign: 'center',
      }}
      title={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
    >
      {lang === 'ar' ? 'EN' : 'عربي'}
    </button>
  );
}
