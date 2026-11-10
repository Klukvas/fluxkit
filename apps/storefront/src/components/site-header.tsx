import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { headerConfig } from "../config/header";
import { slots } from "../config/slots";
import {
  headerView,
  type HeaderBlockView,
  type HeaderConfig,
  type HeaderControlName,
  type HeaderLink,
  type NavigationCategory,
  type PanelAlign,
} from "../layout/header-layout";
import { renderSlot } from "../lib/slots";
import { AccountLink } from "./account-link";
import { BrandLogo } from "./brand-logo";
import { CartBadge } from "./cart-badge";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { HeaderSearchToggle } from "./header-search-toggle";
import { MenuIcon } from "./icons";
import { LocaleSwitcher } from "./locale-switcher";
import { SearchBox } from "./search-box";

export type { NavigationCategory };

function MenuBlock({
  links,
  align,
  t,
}: {
  links: readonly HeaderLink[];
  align: PanelAlign;
  t: Translator;
}) {
  return (
    <HeaderDisclosure
      label={t("nav.menu")}
      summary={<MenuIcon />}
      align={align}
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

function NavigationBlock({
  links,
  t,
  label = t("nav.main.label"),
}: {
  links: readonly HeaderLink[];
  t: Translator;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="hidden min-w-0 shrink xl:block">
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
      return <MenuBlock key={view.kind} links={view.links} align={view.align} t={t} />;
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
 * CORE-EDIT (fork a1-reshape): the `centred` layout. From `lg` three equal columns (start: the first half of the navigation
 * links; middle: the logo; end: the second half and the controls) and the search box in a full-width row below
 * (`.fk-header-centred` in app/globals.css). Below `lg` the same one row as the default header: menu, logo, search icon,
 * controls. The two halves are two `nav` landmarks with their own names.
 */
function CentredRow({
  blocks,
  locale,
  t,
}: {
  blocks: readonly HeaderBlockView[];
  locale: Locale;
  t: Translator;
}) {
  const find = <K extends HeaderBlockView["kind"]>(kind: K) =>
    blocks.find((view): view is Extract<HeaderBlockView, { kind: K }> => view.kind === kind);
  const menu = find("menu");
  const navigation = find("navigation");
  const search = find("search");
  const controls = find("controls");
  const half = navigation === undefined ? 0 : Math.ceil(navigation.links.length / 2);
  const before = navigation?.links.slice(0, half) ?? [];
  const after = navigation?.links.slice(half) ?? [];
  return (
    <Container className="fk-header-centred">
      <div className="fk-header-side">
        {menu === undefined ? null : block(menu, locale, t)}
        {before.length === 0 ? null : <NavigationBlock links={before} t={t} />}
      </div>
      <div className="fk-header-middle">{block({ kind: "logo" }, locale, t)}</div>
      {search === undefined ? null : block(search, locale, t)}
      <div className="fk-header-side justify-end">
        {after.length === 0 ? null : (
          <NavigationBlock links={after} t={t} label={t("custom.header.navMore")} />
        )}
        {controls === undefined ? null : block(controls, locale, t)}
      </div>
    </Container>
  );
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
 * parts are client islands; `searchEnabled` false means NO search box (and no results page). The `header.top` slot's components
 * (`config/slots.tsx`, `docs/contracts/slots.md`) render above the row, inside the header. Needs an `I18nProvider`.
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
  const row =
    config.layout === "centred" ? (
      <CentredRow blocks={blocks} locale={locale} t={t} />
    ) : (
      <Container className="fk-header-row">
        {blocks.map((view) => block(view, locale, t))}
      </Container>
    );
  // The `header.top` slot (`config/slots.tsx`) before the row. Empty, the header's only child stays the row: the same markup
  // and the same React payload as without slots (no `null` child).
  const top = renderSlot("header.top", { locale, t }, slots);
  return (
    <header className="fk-site-header">
      {top === null ? (
        row
      ) : (
        <>
          {top}
          {row}
        </>
      )}
    </header>
  );
}
