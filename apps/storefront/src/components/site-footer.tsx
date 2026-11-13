import type { ThemeMode } from "@fluxkit/theme";
import { Container, textStyles, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { footerConfig } from "../config/footer";
import { headerConfig } from "../config/header";
import { slots } from "../config/slots";
import { themeConfig } from "../config/theme";
import {
  FOOTER_CONTACTS_HEADING,
  footerView,
  type FooterBlockView,
  type FooterConfig,
} from "../layout/footer-layout";
import { headerHasThemeControl } from "../layout/header-layout";
import { footerLinks, footerShopLinks, type NavigationLink } from "../layout/navigation";
import { contactsView, type ContactsView } from "../lib/contacts";
import { localizedHref } from "../lib/locale-path";
import { renderSlot, type SlotLink } from "../lib/slots";
import { FooterContacts } from "./contact-details";
import { ThemeSwitch } from "./theme-switch";

function LinkList({
  links,
  locale,
  t,
}: {
  links: readonly NavigationLink[];
  locale: Locale;
  t: Translator;
}) {
  return (
    <ul>
      {links.map((link) => (
        <li key={link.href}>
          <Link href={localizedHref(locale, link.href)}>{t(link.labelKey)}</Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The grid of the `footer.columns` slot by its number of columns: one column, then two side by side from `sm`, and up to four
 * per row from `lg` (more wrap into further rows). Literal classes: Tailwind generates only classes written out in the source.
 */
const COLUMN_GRIDS = [
  "grid gap-6",
  "grid gap-6 sm:grid-cols-2",
  "grid gap-6 sm:grid-cols-2 lg:grid-cols-3",
  "grid gap-6 sm:grid-cols-2 lg:grid-cols-4",
] as const;

function slotLinks(links: readonly NavigationLink[], locale: Locale, t: Translator): SlotLink[] {
  return links.map((link) => ({ label: t(link.labelKey), href: localizedHref(locale, link.href) }));
}

function block(
  view: FooterBlockView,
  locale: Locale,
  t: Translator,
  year: number,
  themeMode: ThemeMode,
): ReactNode {
  switch (view.kind) {
    case "navigation":
      return (
        <nav key={view.kind} aria-label={t("footer.nav.label")}>
          {view.groups.map((group, index) =>
            group.headingKey === null ? (
              <LinkList key={index} links={group.links} locale={locale} t={t} />
            ) : (
              <Fragment key={index}>
                <h2 className={textStyles.navGroupTitle}>{t(group.headingKey)}</h2>
                <LinkList links={group.links} locale={locale} t={t} />
              </Fragment>
            ),
          )}
        </nav>
      );
    case "contacts":
      return <FooterContacts key={view.kind} contacts={view.contacts} />;
    case "themeSwitch":
      return (
        <ThemeSwitch
          key={view.kind}
          initialMode={themeMode}
          labels={{
            group: t("theme.label"),
            light: t("theme.light"),
            dark: t("theme.dark"),
            system: t("theme.system"),
          }}
        />
      );
    case "copyright":
      return <p key={view.kind}>{t("footer.copyright", { year, name: t("site.name") })}</p>;
    case "text":
      return <p key={`text:${view.textKey}`}>{t(view.textKey)}</p>;
    default: {
      const unknown: never = view;
      throw new RangeError(`Unknown footer block ${JSON.stringify(unknown)}`);
    }
  }
}

function hasFooterContacts(contacts: ContactsView): boolean {
  return contacts.phones.length > 0 || contacts.email !== null;
}

/**
 * The `columns` layout's grid cells: one labelled navigation per link group (`aria-labelledby` its visible heading) and the
 * contacts with their heading, in the order of their blocks. Ids are fixed: the footer is on a page once.
 */
function footerColumns(
  blocks: readonly FooterBlockView[],
  t: Translator,
  locale: Locale,
): ReactNode[] {
  return blocks.flatMap((view): ReactNode[] => {
    if (view.kind === "contacts") {
      if (!hasFooterContacts(view.contacts)) return [];
      return [
        <div key="contacts">
          <h2>{t(FOOTER_CONTACTS_HEADING)}</h2>
          <FooterContacts contacts={view.contacts} />
        </div>,
      ];
    }
    if (view.kind !== "navigation") return [];
    return view.groups.map((group, index) => {
      if (group.headingKey === null) {
        // `footerConfigProblems` refuses a heading-less group in this layout, and `footerView` throws before this point.
        throw new RangeError("footer link group without a heading in the columns layout");
      }
      const id = `footer-group-${String(index + 1)}`;
      return (
        <nav key={id} aria-labelledby={id}>
          <h2 id={id}>{t(group.headingKey)}</h2>
          <LinkList links={group.links} locale={locale} t={t} />
        </nav>
      );
    });
  });
}

/**
 * The `columns` layout (round 4): the slot's grid, then the link groups and the contacts as columns (`.fk-footer-grid`: two on
 * a phone, four from `lg`), then a bottom row with the other blocks in their order (text lines, a theme switch a fork still
 * lists, the copyright) and the "powered by" line.
 */
function ColumnsFooter({
  blocks,
  slotGrid,
  locale,
  t,
  year,
  themeMode,
}: {
  blocks: readonly FooterBlockView[];
  slotGrid: readonly ReactNode[];
  locale: Locale;
  t: Translator;
  year: number;
  themeMode: ThemeMode;
}) {
  const columns = footerColumns(blocks, t, locale);
  const bottom = blocks.filter((view) => view.kind !== "navigation" && view.kind !== "contacts");
  return (
    <footer className="fk-site-footer">
      <Container className="fk-footer-columns">
        {[
          ...slotGrid,
          ...(columns.length > 0
            ? [
                <div key="grid" className="fk-footer-grid">
                  {columns}
                </div>,
              ]
            : []),
          <div key="bottom" className="fk-footer-bottom">
            {[
              ...bottom.map((view) => block(view, locale, t, year, themeMode)),
              <p key="powered">{t("footer.powered")}</p>,
            ]}
          </div>,
        ]}
      </Container>
    </footer>
  );
}

/**
 * The footer: its blocks and their order come from `config/footer.ts` through `footerView` (`layout/footer-layout.ts`, plan
 * L3); by default (round 4) the `columns` layout with the shop pages, the legal pages and the contacts as columns and the
 * copyright below; the theme switch is the header's `theme` control. The "powered by" line always closes it (not a block: the
 * template's attribution). The `footer.columns` slot's components (`config/slots.tsx`, `docs/contracts/slots.md`) render
 * first, as the columns of one grid.
 */
export function SiteFooter({
  locale,
  t,
  year,
  themeMode,
  showThemeSwitch = themeConfig.showToggle,
  themeInHeader = headerHasThemeControl(headerConfig),
  shopLinks = footerShopLinks,
  contacts = contactsView(),
  config = footerConfig,
  featureLinks = [],
}: {
  locale: Locale;
  t: Translator;
  year: number;
  /** What `<html data-theme>` says (from the cookie or `config/theme.ts`). */
  themeMode: ThemeMode;
  /** `showToggle` of `config/theme.ts`; a prop for tests. */
  showThemeSwitch?: boolean;
  /** Whether `config/header.ts` lists the `theme` control (then the footer may leave its switch out); a prop for tests. */
  themeInHeader?: boolean;
  /** The shop pages with `inFooter` (`config/shop-pages.ts`); a prop for tests. */
  shopLinks?: readonly NavigationLink[];
  /** `config/contacts.ts`; a prop for tests. */
  contacts?: ContactsView;
  /** `config/footer.ts`; a prop for tests. */
  config?: FooterConfig;
  /** The footer links of the enabled feature slices (`features/registry.ts`); none by default. */
  featureLinks?: readonly NavigationLink[];
}) {
  const blocks = footerView(config, {
    shopLinks,
    legalLinks: footerLinks,
    contacts,
    showThemeSwitch,
    themeInHeader,
    featureLinks,
  });
  // The `footer.columns` slot (`config/slots.tsx`): its components as the columns of one grid, before the blocks. Empty, it
  // adds nothing to the list below (not even a `null`), so the footer's markup and React payload stay as without slots.
  const columns = renderSlot(
    "footer.columns",
    {
      locale,
      t,
      shopLinks: slotLinks(shopLinks, locale, t),
      legalLinks: slotLinks(footerLinks, locale, t),
      contacts,
    },
    slots,
  );
  const columnGrid =
    columns === null
      ? []
      : [
          <div
            key="slot:footer.columns"
            className={COLUMN_GRIDS[Math.min(columns.length, COLUMN_GRIDS.length) - 1]}
          >
            {columns}
          </div>,
        ];
  if (config.layout === "columns") {
    return (
      <ColumnsFooter
        blocks={blocks}
        slotGrid={columnGrid}
        locale={locale}
        t={t}
        year={year}
        themeMode={themeMode}
      />
    );
  }
  return (
    <footer className="fk-site-footer">
      <Container className="flex flex-col gap-2">
        {/* No class on the lists, links and contacts (`.fk-site-footer ul`, `nav`, `address` in app/globals.css) and a compact
            switch: the footer is in every page's first HTML. Since ADR 0048 its size no longer hides a page (only a loose cap in
            shell.spec.tsx), but small stays cheaper for every page. */}
        {/* One flat list, as the footer's JSX children were before `config/footer.ts`: `useId` (the theme switch's label) derives
            from the position among siblings, so the default markup stays byte for byte the same. */}
        {[
          ...columnGrid,
          ...blocks.map((view) => block(view, locale, t, year, themeMode)),
          <p key="powered">{t("footer.powered")}</p>,
        ]}
      </Container>
    </footer>
  );
}
