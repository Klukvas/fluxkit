import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { Suspense } from "react";
import { HEADER_CATEGORY_LIMIT, headerLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { AccountLink } from "./account-link";
import { CartBadge } from "./cart-badge";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { MenuIcon } from "./icons";
import { LocaleSwitcher } from "./locale-switcher";
import { SearchBox } from "./search-box";
import { navLink } from "./styles";

export interface NavigationCategory {
  slug: string;
  name: string;
}

function mainLinks(
  locale: Locale,
  t: Translator,
  categories: readonly NavigationCategory[] | null,
): { key: string; href: string; label: string }[] {
  return [
    ...(categories ?? []).slice(0, HEADER_CATEGORY_LIMIT).map((category) => ({
      key: `c:${category.slug}`,
      href: localizedHref(locale, `/c/${encodeURIComponent(category.slug)}`),
      label: category.name,
    })),
    ...headerLinks.map((link) => ({
      key: link.href,
      href: localizedHref(locale, link.href),
      label: t(link.labelKey),
    })),
  ];
}

/**
 * Server-rendered header, ONE row of controls in every language (owner request 2026-11-02): the menu button (below `xl`),
 * the logo, the category links (from `xl`, a row that scrolls instead of wrapping when a shop has many or long names), the
 * search box (in the row from `lg`; below it a full-width second row, so it is never cut), then the language, cart and
 * account icons. The main navigation exists twice in the markup (inline and inside the menu); one of them is always
 * `display: none`, so assistive technology meets one. `categories` is `null` when the API could not be read (the page still
 * renders, without the category links; the failure is logged where it happened). The cart, account, language and search
 * parts are client islands; `searchEnabled` false means NO search box (and no results page). Needs an `I18nProvider`.
 */
export function SiteHeader({
  locale,
  t,
  categories,
  searchEnabled,
}: {
  locale: Locale;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
  searchEnabled: boolean;
}) {
  const links = mainLinks(locale, t, categories);
  return (
    <header className="border-b border-border bg-background">
      <Container className="flex flex-wrap items-center gap-x-2 gap-y-2 py-2 lg:flex-nowrap lg:gap-x-4">
        <HeaderDisclosure
          label={t("nav.menu")}
          summary={<MenuIcon />}
          align="start"
          className="shrink-0 xl:hidden"
        >
          <nav aria-label={t("nav.main.label")}>
            <ul className="flex flex-col">
              {links.map((link) => (
                <li key={link.key}>
                  <Link href={link.href} className={menuItem}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </HeaderDisclosure>
        <Link
          href={localizedHref(locale, "/")}
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-lg font-bold text-foreground"
        >
          {t("site.name")}
        </Link>
        <nav aria-label={t("nav.main.label")} className="hidden min-w-0 shrink xl:block">
          <ul className="flex flex-nowrap items-center gap-x-1 overflow-x-auto">
            {links.map((link) => (
              <li key={link.key} className="shrink-0">
                <Link href={link.href} className={`${navLink} whitespace-nowrap`}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {searchEnabled ? (
          <div className="order-last w-full lg:order-none lg:w-auto lg:min-w-72 lg:flex-1">
            {/* `useSearchParams` in the box needs a boundary; the page is rendered per request, so it is never the fallback. */}
            <Suspense fallback={null}>
              <SearchBox locale={locale} />
            </Suspense>
          </div>
        ) : null}
        <div className="ms-auto flex shrink-0 items-center gap-1">
          <LocaleSwitcher />
          <CartBadge />
          <AccountLink />
        </div>
      </Container>
    </header>
  );
}
