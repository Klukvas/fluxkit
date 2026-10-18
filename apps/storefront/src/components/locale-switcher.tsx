"use client";

import { locales, type Locale, type Translator } from "@fluxkit/ui";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { switchLocalePath } from "../lib/locale-path";
import { useI18n } from "./i18n-provider";
import { navLink } from "./styles";

/**
 * Each locale named in its own language. The current one is plain text with `aria-current`; the others are ordinary links
 * (not `next/link`): a language change should be a full page load, so `<html lang>`, the messages and every island start
 * from the new locale.
 */
export function LocaleSwitcherView({
  locale,
  t,
  pathname,
  search,
}: {
  locale: Locale;
  t: Translator;
  pathname: string;
  search: string;
}) {
  return (
    <nav aria-label={t("locale.switcher.label")}>
      <ul className="flex items-center gap-1">
        {locales.map((target) => (
          <li key={target}>
            {target === locale ? (
              <span
                lang={target}
                aria-current="true"
                className="inline-flex min-h-11 items-center px-2 font-semibold text-foreground"
              >
                {t(`locale.name.${target}`)}
              </span>
            ) : (
              <a
                lang={target}
                hrefLang={target}
                href={switchLocalePath(pathname, target, search)}
                className={navLink}
              >
                {t(`locale.name.${target}`)}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function WithSearch({ pathname }: { pathname: string }) {
  const { locale, t } = useI18n();
  const query = useSearchParams().toString();
  return (
    <LocaleSwitcherView
      locale={locale}
      t={t}
      pathname={pathname}
      search={query === "" ? "" : `?${query}`}
    />
  );
}

/** Keeps the page and the query string. TODO(fluxkit): the URL fragment is not kept (the guest order page, step 7, needs it). */
export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;
  return (
    <Suspense fallback={<LocaleSwitcherView locale={locale} t={t} pathname={pathname} search="" />}>
      <WithSearch pathname={pathname} />
    </Suspense>
  );
}
