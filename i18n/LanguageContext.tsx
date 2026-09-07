import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { en } from './en';
import { id } from './id';

export type Language = 'en' | 'id';

// Flat dot-path key dictionaries (e.g. 'nav.overview', 'market.disclaimer') rather than a deeply
// nested typed interface - pragmatic given the sheer number of strings across the app, and easy
// to extend with more languages later (just add another dictionary file + register it below).
// Scope note: this covers the public-facing terminal UI (Navbar, Overview/Market/Signal/Intel/
// Calendar/History views, Footer, modals). AdminDashboard (internal-only tool) and the
// server-generated analysisReasoning/userAdvice/riskGuidance text (signal logic, out of this
// task's scope) are NOT covered - both stay Indonesian for now, see final summary.
const dictionaries: Record<Language, Record<string, string>> = { en, id };

const STORAGE_KEY = 'hev_language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'id') return saved;
    }
    // Default to Indonesian: HEVORA's actual target audience is Indonesian traders (brand copy,
    // disclaimers, and most of id.ts's phrasing are written Indonesian-first, not translated from
    // English) - a first-time visitor with no saved preference should land on 'id', not 'en'. The
    // previous default here ("per Bagian 7") traced back to a planning doc's module-registry
    // section, not an actual language-choice rationale - no real justification for 'en' as default
    // was found anywhere in the repo/docs. Anyone who explicitly picks 'en' still gets it back on
    // their next visit via the saved-preference check above; this only changes the FIRST visit.
    return 'id';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = (lang: Language) => setLanguageState(lang);

  const t = useMemo(() => {
    const dict = dictionaries[language];
    // Falls back to English, then to the raw key itself, so a missing translation never renders
    // blank - it renders in English (or the literal key as a last resort, making gaps obvious).
    return (key: string): string => dict[key] ?? en[key] ?? key;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useTranslation = (): LanguageContextValue => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return ctx;
};
