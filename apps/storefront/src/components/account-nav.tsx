"use client";

import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { accountLinks, currentAccountLink } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { useI18n } from "./i18n-provider";
import { focusRing } from "./styles";

/**
 * The account pages' own menu (owner decision 2026-11-02): a labelled `nav` of links with `aria-current="page"` on the
 * current section. From `lg` a vertical side menu beside the page; below it a row of tabs above the page that scrolls
 * sideways when it does not fit. They navigate, so they are links, not ARIA tabs.
 */
export function AccountNavView({
  t,
  locale,
  current,
}: {
  t: Translator;
  locale: Locale;
  /** The locale-less href of the current section, `null` for none. */
  current: string | null;
}) {
  return (
    <nav aria-label={t("nav.account.sections")}>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:flex-col lg:border-b-0 lg:px-0">
        {accountLinks.map((link) => {
          const isCurrent = link.href === current;
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={localizedHref(locale, link.href)}
                {...(isCurrent ? { "aria-current": "page" as const } : {})}
                className={`flex min-h-11 items-center whitespace-nowrap px-3 font-medium ${focusRing} ${
                  isCurrent
                    ? "border-b-2 border-primary text-foreground lg:rounded-md lg:border-b-0 lg:bg-muted"
                    : "border-b-2 border-transparent text-muted-foreground hover:text-foreground lg:rounded-md lg:border-b-0 lg:hover:bg-muted"
                }`}
              >
                {t(link.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The side menu (desktop) or tab row (phone) next to a signed-in account page. */
export function AccountLayoutView({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <Container className="flex flex-col gap-6 py-8 lg:flex-row lg:gap-10">
      <div className="lg:w-56 lg:shrink-0">{nav}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </Container>
  );
}

export function AccountNav() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? "";
  const prefix = `/${locale}`;
  const bare =
    pathname === prefix
      ? "/"
      : pathname.startsWith(`${prefix}/`)
        ? pathname.slice(prefix.length)
        : pathname;
  return <AccountNavView t={t} locale={locale} current={currentAccountLink(bare)} />;
}
