"use client";

import { locales, type Locale, type Translator } from "@fluxkit/ui";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { switchLocalePath } from "../lib/locale-path";
import { flagClass } from "../config/locale-flags";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { useI18n } from "./i18n-provider";
import { ChevronDownIcon } from "./icons";

/**
 * A dropdown of the languages (owner request 2026-11-02): the summary shows the current language's flag and short name, the
 * panel each language with its flag and its name in its own language. The flags are decoration (`aria-hidden`, drawn by CSS);
 * the accessible name of the summary says "Site language: <name>". The current one is plain text with `aria-current`; the
 * others are ordinary links (not `next/link`): a language change should be a full page load, so `<html lang>`, the messages
 * and every island start from the new locale.
 */
export function LocaleSwitcherView({
  locale,
  t,
  pathname,
  search,
  hash = "",
}: {
  locale: Locale;
  t: Translator;
  pathname: string;
  search: string;
  /** `location.hash`, read in the browser after hydration; never known to (or sent to) the server. */
  hash?: string;
}) {
  return (
    <nav aria-label={t("locale.switcher.label")}>
      <HeaderDisclosure
        label={t("locale.switcher.current", { name: t(`locale.name.${locale}`) })}
        summary={
          <>
            <span aria-hidden="true" className={flagClass(locale)} />
            <span aria-hidden="true" className="text-sm font-semibold">
              {t(`locale.short.${locale}`)}
            </span>
            <ChevronDownIcon className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </>
        }
      >
        <ul className="flex flex-col">
          {locales.map((target) => (
            <li key={target}>
              {target === locale ? (
                <span lang={target} aria-current="true" className={`${menuItem} font-semibold`}>
                  <span aria-hidden="true" className={flagClass(target)} />
                  {t(`locale.name.${target}`)}
                </span>
              ) : (
                <a
                  lang={target}
                  hrefLang={target}
                  href={switchLocalePath(pathname, target, search, hash)}
                  className={menuItem}
                >
                  <span aria-hidden="true" className={flagClass(target)} />
                  {t(`locale.name.${target}`)}
                </a>
              )}
            </li>
          ))}
        </ul>
      </HeaderDisclosure>
    </nav>
  );
}

/**
 * The URL fragment of the current page. It exists only in the browser: the server render (and the first client render, so
 * hydration matches) has none, and it is read after every commit of a new path or query (the app router has updated the
 * history entry by then) and on `hashchange`. Nothing sends it anywhere: it only becomes part of the switcher's links,
 * and a browser never sends a fragment with a request.
 */
function useLocationHash(pathname: string, query: string): string {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname, query]);
  return hash;
}

function WithSearch({ pathname }: { pathname: string }) {
  const { locale, t } = useI18n();
  const query = useSearchParams().toString();
  const hash = useLocationHash(pathname, query);
  return (
    <LocaleSwitcherView
      locale={locale}
      t={t}
      pathname={pathname}
      search={query === "" ? "" : `?${query}`}
      hash={hash}
    />
  );
}

/**
 * Keeps the page, the query string and the fragment (the guest order page keeps its token in the fragment, owner answer
 * 8): the links are plain `<a>`, so the browser loads the other locale's page and still sends no fragment to the server.
 */
export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;
  return (
    <Suspense fallback={<LocaleSwitcherView locale={locale} t={t} pathname={pathname} search="" />}>
      <WithSearch pathname={pathname} />
    </Suspense>
  );
}
