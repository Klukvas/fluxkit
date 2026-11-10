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
  label,
}: {
  links: readonly HeaderLink[];
  t: Translator;
  /** FORK (CORE-EDIT R3): the name of a second inline navigation (the centred header has two halves). */
  label?: string;
}) {
  return (
    <nav aria-label={label ?? t("nav.main.label")} className="hidden min-w-0 shrink xl:block">
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
 * FORK (CORE-EDIT R3): the row of `layout: "centred"` (`config/header.ts`, `layout/header-layout.ts`). From `lg` a grid of
 * three columns (`.fk-header-centred` in app/globals.css): the menu button (below `xl`) or the first half of the inline
 * navigation, the logo in the middle, then the second half of the navigation and the controls; the search box is a second row
 * below, always shown. Below `lg` the two side groups are `display: contents`, so the row is the template's one sticky row
 * (menu, logo, controls, search icon). The two inline navigations carry different names; the menu still lists every link.
 */
function centredRow(blocks: readonly HeaderBlockView[], locale: Locale, t: Translator): ReactNode {
  const find = <Kind extends HeaderBlockView["kind"]>(kind: Kind) =>
    blocks.find((view): view is Extract<HeaderBlockView, { kind: Kind }> => view.kind === kind);
  const menu = find("menu");
  const logo = find("logo");
  const search = find("search");
  const controls = find("controls");
  const links = find("navigation")?.links ?? [];
  const half = Math.ceil(links.length / 2);
  return (
    <Container className="fk-header-row fk-header-centred">
      <div className="fk-header-side fk-header-side-start">
        {menu === undefined ? null : block(menu, locale, t)}
        {half === 0 ? null : <NavigationBlock links={links.slice(0, half)} t={t} />}
      </div>
      {logo === undefined ? null : block(logo, locale, t)}
      <div className="fk-header-side">
        {links.length <= half ? null : (
          <NavigationBlock
            links={links.slice(half)}
            t={t}
            label={t("custom.header.navigationMore")}
          />
        )}
        {controls === undefined ? null : block(controls, locale, t)}
      </div>
      {search === undefined ? null : block(search, locale, t)}
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
      centredRow(blocks, locale, t)
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
