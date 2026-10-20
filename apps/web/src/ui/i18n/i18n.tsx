import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ro } from './ro';

/**
 * Minimal i18n: typed message catalogs, `{name}` interpolation and locale-aware date/number
 * formatting via `Intl` (UI.md §9). Catalogs are bundled; no runtime fetches.
 */
export type Locale = 'en' | 'ro';

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, ro };

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  time: (ms: number) => string;
  date: (ms: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const catalog = catalogs[locale];
    const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    return {
      locale,
      t: (key, params) =>
        (catalog[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`)),
      time: (ms) => timeFormat.format(ms),
      date: (ms) => dateFormat.format(ms),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Accesses translations; must be used under {@link I18nProvider}. */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}

/** Picks the initial locale from the browser when the user has not chosen one. */
export function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}
