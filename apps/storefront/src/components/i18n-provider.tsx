"use client";

import {
  createTranslator,
  isLocale,
  type Locale,
  type Messages,
  type Translator,
} from "@fluxkit/ui";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface I18nValue {
  locale: Locale;
  t: Translator;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Gives client components the translator of the page's locale. `messages` is the client subset (`pickClientMessages`). */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    if (!isLocale(locale)) throw new RangeError(`Unsupported locale "${locale}".`);
    return { locale, t: createTranslator(messages, locale) };
  }, [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null)
    throw new Error("useI18n needs an I18nProvider above it (the locale layout).");
  return value;
}
