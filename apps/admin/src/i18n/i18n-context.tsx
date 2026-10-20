import { createTranslator, type Locale, type Translator } from "@fluxkit/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { messagesByLocale } from "../messages";
import { storeLocale, type StorageLike } from "./locale-preference";

export interface I18nValue {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/** The browser's storage, read lazily: touching `window.localStorage` itself can throw when site data is blocked. */
export const browserStorage = (): StorageLike => window.localStorage;

/** UI language for the whole SPA; `<html lang>` follows it. Content locales (what admins edit) are independent. */
export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const t = useMemo(() => createTranslator(messagesByLocale[locale], locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(browserStorage, next);
  }, []);

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}
