import { createTranslator, type Locale, type Messages, type Translator } from "@fluxkit/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadMessageFile, messagesWith, type LazyFile } from "../messages";
import { storeLocale, type StorageLike } from "./locale-preference";
import {
  NO_FILES,
  filesForSwitch,
  missingFiles,
  withFiles,
  type LoadedFiles,
} from "./message-state";

export interface I18nValue {
  locale: Locale;
  t: Translator;
  /**
   * Switches the UI language once every message file the current language shows is loaded for the new one (the screen
   * keeps its state and never shows a missing key). Rejects, with the language unchanged, when a file cannot be loaded.
   */
  setLocale: (locale: Locale) => Promise<void>;
  /** Whether these lazy files are loaded for the current language (an area renders only then). */
  hasMessages: (files: readonly LazyFile[]) => boolean;
  /** Loads these lazy files for the current language. */
  loadMessages: (files: readonly LazyFile[]) => Promise<void>;
}

const I18nContext = createContext<I18nValue | null>(null);

/** The browser's storage, read lazily: touching `window.localStorage` itself can throw when site data is blocked. */
export const browserStorage = (): StorageLike => window.localStorage;

export type MessageFileLoader = (file: LazyFile, locale: Locale) => Promise<Messages>;

/**
 * UI language for the whole SPA; `<html lang>` follows it. Content locales (what admins edit) are independent. The
 * translator holds the eager messages plus the lazy files loaded so far for the language (`messages/index.ts`).
 */
export function I18nProvider({
  initial,
  children,
  loadFile = loadMessageFile,
}: {
  initial: Locale;
  children: ReactNode;
  loadFile?: MessageFileLoader;
}) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const [loaded, setLoaded] = useState<LoadedFiles>(NO_FILES);
  // The async loaders read the newest values, not the ones of the render that started them.
  const loadedRef = useRef(loaded);
  const localeRef = useRef(locale);
  const ownFiles = loaded[locale];
  const t = useMemo(
    () => createTranslator(messagesWith(locale, ownFiles), locale),
    [locale, ownFiles],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const loadInto = useCallback(
    async (target: Locale, files: readonly LazyFile[]) => {
      const wanted = missingFiles(loadedRef.current, target, files);
      if (wanted.length === 0) return;
      const contents = await Promise.all(wanted.map((file) => loadFile(file, target)));
      const added: Partial<Record<LazyFile, Messages>> = {};
      wanted.forEach((file, index) => {
        added[file] = contents[index];
      });
      loadedRef.current = withFiles(loadedRef.current, target, added);
      setLoaded(loadedRef.current);
    },
    [loadFile],
  );

  const setLocale = useCallback(
    async (next: Locale) => {
      // An area may load a file while the switch waits; repeat until the new language has everything the old one shows.
      for (;;) {
        const needed = filesForSwitch(loadedRef.current, localeRef.current, next);
        if (needed.length === 0) break;
        await loadInto(next, needed);
      }
      localeRef.current = next;
      setLocaleState(next);
      storeLocale(browserStorage, next);
    },
    [loadInto],
  );

  const hasMessages = useCallback(
    (files: readonly LazyFile[]) => missingFiles(loaded, locale, files).length === 0,
    [loaded, locale],
  );
  const loadMessages = useCallback(
    (files: readonly LazyFile[]) => loadInto(localeRef.current, files),
    [loadInto],
  );

  const value = useMemo(
    () => ({ locale, t, setLocale, hasMessages, loadMessages }),
    [locale, t, setLocale, hasMessages, loadMessages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}
