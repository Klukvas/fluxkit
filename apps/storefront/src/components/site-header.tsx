import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { headerConfig } from "../config/header";
import {
  headerView,
  type HeaderBlockView,
  type HeaderConfig,
  type HeaderControlName,
  type HeaderLink,
  type NavigationCategory,
} from "../layout/header-layout";
import { AccountLink } from "./account-link";
import { BrandLogo } from "./brand-logo";
import { CartBadge } from "./cart-badge";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { HeaderSearchToggle } from "./header-search-toggle";
import { MenuIcon } from "./icons";
import { LocaleSwitcher } from "./locale-switcher";
import { SearchBox } from "./search-box";

export type { NavigationCategory };

function MenuBlock({ links, t }: { links: readonly HeaderLink[]; t: Translator }) {
  return (
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
  );
}

function NavigationBlock({ links, t }: { links: readonly HeaderLink[]; t: Translator }) {
  return (
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
  );
}

function control(name: HeaderControlName): ReactNode {
  switch (name) {
    case "language":
      return <LocaleSwitcher key={name} />;
    case "cart":
      return <CartBadge key={name} />;
    case "account":
      return <AccountLink key={name} />;
    default: {
      const unknown: never = name;
      throw new RangeError(`Unknown header control ${String(unknown)}`);
    }
  }
}

function block(view: HeaderBlockView, locale: Locale, t: Translator): ReactNode {
  switch (view.kind) {
    case "menu":
      return <MenuBlock key={view.kind} links={view.links} t={t} />;
    case "logo":
      return <BrandLogo key={view.kind} locale={locale} t={t} />;
    case "navigation":
      return <NavigationBlock key={view.kind} links={view.links} t={t} />;
    case "search":
      return (
        <HeaderSearchToggle key={view.kind} label={t("nav.search")}>
          {/* No Suspense boundary here (ADR 0048): `useSearchParams` does not suspend in a request render (every page is
              rendered per request), so a boundary only made React move the finished box out of place once the shell passed
              12 800 bytes; the browser then swapped it in after the shopper had typed into the placeholder, and the text was
              lost (catalog pages and big shells). Inside the shell the box is the same GET form without a script. */}
          <SearchBox locale={locale} />
        </HeaderSearchToggle>
      );
    case "controls":
      return (
        <div key={view.kind} className="fk-header-end">
          {view.controls.map(control)}
        </div>
      );
    default: {
      const unknown: never = view;
      throw new RangeError(`Unknown header block ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * Server-rendered header, ONE row of controls in every language (owner request 2026-11-02). Its blocks and their order come
 * from `config/header.ts` through `headerView` (`layout/header-layout.ts`, plan L3); the defaults: the menu button (below `xl`),
 * the logo (`brand-logo.tsx`, `config/brand.ts`), the category links (from `xl`, a row that scrolls instead of wrapping when a shop has many or long names), the
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
  config = headerConfig,
}: {
  locale: Locale;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
  searchEnabled: boolean;
  /** `config/header.ts`; a prop for tests. */
  config?: HeaderConfig;
}) {
  const blocks = headerView(config, { locale, t, categories, searchEnabled });
  return (
    <header className="fk-site-header">
      <Container className="fk-header-row">
        {blocks.map((view) => block(view, locale, t))}
      </Container>
    </header>
  );
}
