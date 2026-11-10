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

/**
 * The fork's header: the logo centred, the navigation split into a left and a right half, the controls after the right half,
 * and the search box on a row of its own below (always shown from `lg`; a search icon below it, as in the template). It reads the
 * same `config/header.ts` through `headerView`, so the blocks, the categories and the links stay configuration; only the
 * arrangement is this file's. Written as a NEW file because the template's `site-header.tsx` has one row by construction
 * (`docs/customization.md`, section 3: "needs a code edit"); `SiteShell` renders this instead of `SiteHeader`
 * (CORE-EDIT R3 in the fork's history).
 *
 * Arrangement: below `lg` one wrapping flex row exactly like the template's (menu button, logo growing, search icon, controls;
 * the opened search row below). From `lg` a three column grid: the menu button (below `xl`) or the left navigation (from `xl`),
 * the logo, the right navigation with the controls; the search row spans all three columns, last. The search wrapper is
 * `contents` below `lg`, so its icon and its row take part in the flex row as before.
 *
 * Landmarks: the left half is "Main navigation", the right half "More navigation" (two `nav` landmarks need two names), and the
 * menu panel below `xl` holds all links under "Main navigation" (the inline halves are hidden then, so assistive technology meets
 * one set).
 */
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

function NavigationHalf({
  links,
  label,
  className,
}: {
  links: readonly HeaderLink[];
  label: string;
  className: string;
}) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={label} className={className}>
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

export function CentredHeader({
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
  const views = headerView(config, { locale, t, categories, searchEnabled });
  const find = <Kind extends HeaderBlockView["kind"]>(kind: Kind) =>
    views.find((view): view is Extract<HeaderBlockView, { kind: Kind }> => view.kind === kind);
  const menu = find("menu");
  const navigation = find("navigation");
  const controls = find("controls");
  const hasSearch = find("search") !== undefined;
  const links = navigation?.links ?? [];
  const half = Math.ceil(links.length / 2);
  const top = renderSlot("header.top", { locale, t }, slots);
  const row = (
    <Container className="flex flex-wrap items-center gap-x-2 gap-y-2 py-2 lg:grid lg:grid-cols-3 lg:gap-x-4">
      {menu === undefined ? null : (
        <HeaderDisclosure
          label={t("nav.menu")}
          summary={<MenuIcon />}
          align="start"
          className="shrink-0 xl:hidden"
        >
          <nav aria-label={t("nav.main.label")}>
            <ul className="flex flex-col">
              {menu.links.map((link) => (
                <li key={link.key}>
                  <Link href={link.href} className={menuItem}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </HeaderDisclosure>
      )}
      <NavigationHalf
        links={links.slice(0, half)}
        label={t("nav.main.label")}
        className="hidden min-w-0 xl:block"
      />
      <div className="min-w-0 max-lg:grow max-lg:basis-0 lg:justify-self-center">
        <BrandLogo locale={locale} t={t} />
      </div>
      {hasSearch ? (
        <div className="contents lg:order-last lg:mx-auto lg:block lg:w-full lg:max-w-3xl lg:col-span-3">
          <HeaderSearchToggle label={t("nav.search")}>
            <SearchBox locale={locale} />
          </HeaderSearchToggle>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center justify-end gap-2 max-lg:ms-auto">
        <NavigationHalf
          links={links.slice(half)}
          label={t("custom.header.moreNav")}
          className="hidden min-w-0 xl:block"
        />
        {controls === undefined ? null : (
          <div className="flex shrink-0 items-center gap-1">{controls.controls.map(control)}</div>
        )}
      </div>
    </Container>
  );
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
