import type { ThemeMode } from "@fluxkit/theme";
import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { headerConfig } from "../config/header";
import { slots } from "../config/slots";
import { themeConfig } from "../config/theme";
import {
  headerView,
  type HeaderBlockView,
  type HeaderCategoryLink,
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
import { ChevronDownIcon, MenuIcon, MoonIcon, SunIcon } from "./icons";
import { LocaleSwitcher } from "./locale-switcher";
import { SearchBox } from "./search-box";
import { ThemeSwitch, type ThemeSwitchLabels } from "./theme-switch";

export type { NavigationCategory };

/** What every block may need besides its view. */
interface HeaderContext {
  locale: Locale;
  t: Translator;
  themeMode: ThemeMode;
}

function themeLabels(t: Translator): ThemeSwitchLabels {
  return {
    group: t("theme.label"),
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
}

/**
 * The theme switch inside the menu's panel, shown below `sm` only: there the `theme` control is hidden so the phone's row keeps
 * room for the logo (`themeInMenu`, `layout/header-layout.ts`).
 */
function MenuTheme({ context }: { context: HeaderContext }) {
  return (
    <div className="fk-menu-theme">
      <ThemeSwitch initialMode={context.themeMode} labels={themeLabels(context.t)} variant="menu" />
    </div>
  );
}

function LinkItems({ links }: { links: readonly HeaderLink[] }) {
  return links.map((link) => (
    <li key={link.key}>
      <Link href={link.href} className={menuItem}>
        {link.label}
      </Link>
    </li>
  ));
}

function MenuBlock({
  links,
  align,
  withTheme,
  context,
}: {
  links: readonly HeaderLink[];
  align: PanelAlign;
  withTheme: boolean;
  context: HeaderContext;
}) {
  const { t } = context;
  return (
    <HeaderDisclosure
      label={t("nav.menu")}
      summary={<MenuIcon />}
      align={align}
      className="shrink-0 xl:hidden"
    >
      <nav aria-label={t("nav.main.label")}>
        <ul className="flex flex-col">
          <LinkItems links={links} />
        </ul>
      </nav>
      {withTheme ? <MenuTheme context={context} /> : null}
    </HeaderDisclosure>
  );
}

/**
 * The `picker` display (round 4): ONE disclosure for every width, so the category list is in the page once. Below `xl` it is
 * the menu button with the flat list of top-level categories and links, as in the `row` display; from `xl` the summary reads
 * "Categories" with a chevron and the panel shows each category with its children, in columns, then the links. The summary is
 * named by its content (no `aria-label`), so the name is "Menu" while the icon shows and "Categories" while the text does.
 * Plain links in lists, no menu roles; Escape and an outside click close it (`HeaderDisclosure`).
 */
function PickerBlock({
  categories,
  links,
  align,
  withTheme,
  context,
}: {
  categories: readonly HeaderCategoryLink[];
  links: readonly HeaderLink[];
  align: PanelAlign;
  withTheme: boolean;
  context: HeaderContext;
}) {
  const { t } = context;
  return (
    <HeaderDisclosure
      summary={
        <>
          <MenuIcon className="xl:hidden" />
          <span className="sr-only xl:hidden">{t("nav.menu")}</span>
          <span className="max-xl:hidden">{t("nav.categories")}</span>
          <ChevronDownIcon className="fk-chevron max-xl:hidden" />
        </>
      }
      align={align}
      className="shrink-0"
      panelClassName="fk-picker-panel"
    >
      <nav aria-label={t("nav.main.label")}>
        {categories.length > 0 ? (
          <ul className="fk-picker">
            {categories.map((category) => (
              <li key={category.key}>
                <Link href={category.href} className={menuItem}>
                  {category.label}
                </Link>
                {category.children.length > 0 ? (
                  <ul>
                    <LinkItems links={category.children} />
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {links.length > 0 ? (
          <ul className="fk-picker-links">
            <LinkItems links={links} />
          </ul>
        ) : null}
      </nav>
      {withTheme ? <MenuTheme context={context} /> : null}
    </HeaderDisclosure>
  );
}

/**
 * The `theme` control: a disclosure whose icon is the sun or the moon of the theme `<html data-theme>` resolves to (CSS only,
 * `.fk-light-only` / `.fk-dark-only`; the system mode follows the device without a script, so nothing flashes), its panel the
 * three `aria-pressed` buttons, a `/theme` form without a script. Hidden below `sm` when the menu's panel carries the switch.
 */
function ThemeControl({ themeInMenu, context }: { themeInMenu: boolean; context: HeaderContext }) {
  return (
    <HeaderDisclosure
      label={context.t("theme.label")}
      summary={
        <>
          <SunIcon className="fk-light-only" />
          <MoonIcon className="fk-dark-only" />
        </>
      }
      className={themeInMenu ? "max-sm:hidden" : ""}
    >
      <ThemeSwitch initialMode={context.themeMode} labels={themeLabels(context.t)} variant="menu" />
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

function control(name: HeaderControlName, themeInMenu: boolean, context: HeaderContext): ReactNode {
  switch (name) {
    case "language":
      return <LocaleSwitcher key={name} />;
    case "theme":
      return <ThemeControl key={name} themeInMenu={themeInMenu} context={context} />;
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

function block(view: HeaderBlockView, context: HeaderContext): ReactNode {
  const { locale, t } = context;
  switch (view.kind) {
    case "menu":
      return (
        <MenuBlock
          key={view.kind}
          links={view.links}
          align={view.align}
          withTheme={view.withTheme}
          context={context}
        />
      );
    case "picker":
      return (
        <PickerBlock
          key={view.kind}
          categories={view.categories}
          links={view.links}
          align={view.align}
          withTheme={view.withTheme}
          context={context}
        />
      );
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
          {view.controls.map((name) => control(name, view.themeInMenu, context))}
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
 * from `config/header.ts` through `headerView` (`layout/header-layout.ts`, plan L3); the defaults: the menu button (below `xl`;
 * the same button is the "Categories" picker from `xl` (`PickerBlock`, round 4)), the logo (`brand-logo.tsx`, `config/brand.ts`), the
 * search box (in the row from `lg`; below it a search icon that opens a full-width second row, `HeaderSearchToggle`), then
 * the language, theme, cart and account icons. Below `lg` the header is sticky (`.fk-site-header`: the cart count stays in view
 * while scrolling; `scroll-padding-top` keeps anchors and focused fields out from under it). In the `row` display the main
 * navigation exists twice in the markup (inline from `xl` and inside the menu); one of them is always `display: none`, so
 * assistive technology meets one; the `picker` display has it once. `categories` is `null` when the API could not be read
 * (the page still renders, without the category links; the failure is logged where it happened). The cart, account,
 * language, theme and search parts are client islands; `searchEnabled` false means NO search box (and no results page). The
 * `header.top` slot's components (`config/slots.tsx`, `docs/contracts/slots.md`) render above the row, inside the header.
 * Needs an `I18nProvider`.
 */
export function SiteHeader({
  locale,
  t,
  categories,
  searchEnabled,
  themeMode,
  showThemeSwitch = themeConfig.showToggle,
  config = headerConfig,
}: {
  locale: Locale;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
  searchEnabled: boolean;
  /** What `<html data-theme>` says (from the cookie or `config/theme.ts`); the theme control starts from it. */
  themeMode: ThemeMode;
  /** `showToggle` of `config/theme.ts`; a prop for tests. */
  showThemeSwitch?: boolean;
  /** `config/header.ts`; a prop for tests. */
  config?: HeaderConfig;
}) {
  const blocks = headerView(config, { locale, t, categories, searchEnabled, showThemeSwitch });
  const context: HeaderContext = { locale, t, themeMode };
  const row = (
    <Container className="fk-header-row">{blocks.map((view) => block(view, context))}</Container>
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
