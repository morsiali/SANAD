import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { applyDocument, getLang, setLangGlobal, startDomTranslator, type Lang } from './i18n';

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => undefined });

/** Owns the language. Changing it re-mounts the app so every string re-renders in the new language. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang());
  const ref = useRef<HTMLDivElement>(null);
  const setLang = (l: Lang) => {
    setLangGlobal(l);
    setLangState(l);
  };
  useLayoutEffect(() => {
    applyDocument();
    if (ref.current) startDomTranslator(ref.current);
  }, [lang]);
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div ref={ref} key={lang} className="lang-root">
        {children}
      </div>
    </LangCtx.Provider>
  );
}

export const useLanguage = () => useContext(LangCtx);

export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const next: Lang = lang === 'ar' ? 'en' : 'ar';
  return (
    <button type="button" className={`lang-btn ${className}`} onClick={() => setLang(next)} lang={next} aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'} data-raw="">
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}
