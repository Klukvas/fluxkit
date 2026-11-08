import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { Suspense } from "react";
import { HEADER_CATEGORY_LIMIT, headerLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { AccountLink } from "./account-link";
import { CartBadge } from "./cart-badge";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { HeaderSearchToggle } from "./header-search-toggle";
import { MenuIcon } from "./icons";
import { LocaleSwitcher } from "./locale-switcher";
import { SearchBox, SearchBoxFallback } from "./search-box";

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
 * search box (in the row from `lg`; below it a search icon that opens a full-width second row, `HeaderSearchToggle`), then
 * the language, cart and account icons. Below `lg` the header is sticky (`.fk-site-header`: the cart count stays in view
 * while scrolling; `scroll-padding-top` keeps anchors and focused fields out from under it). The main navigation exists twice in the markup (inline and inside the menu); one of them is always
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
    <header className="fk-site-header">
      <Container className="fk-header-row">
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
        <Link href={localizedHref(locale, "/")} title={t("site.name")} className="fk-logo">
          {t("site.name")}
        </Link>
        <nav aria-label={t("nav.main.label")} className="hidden min-w-0 shrink xl:block">
          <ul className="fk-header-nav">
            {links.map((link) => (
              <li key={link.key}>
                <Link href={link.href} className="fk-nav-link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {searchEnabled ? (
          <HeaderSearchToggle label={t("nav.search")}>
            {/* `useSearchParams` in the box needs a boundary. On dynamic pages (catalog, product, results) the box streams in
                after the shell, so the fallback is the same GET form: without a script it is the search (review M2). */}
            <Suspense fallback={<SearchBoxFallback />}>
              <SearchBox locale={locale} />
            </Suspense>
          </HeaderSearchToggle>
        ) : null}
        <div className="fk-header-end">
          <LocaleSwitcher />
          <CartBadge />
          <AccountLink />
        </div>
      </Container>
    </header>
  );
}
