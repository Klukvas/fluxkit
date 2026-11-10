import type { ThemeMode } from "@fluxkit/theme";
import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { footerConfig } from "../config/footer";
import { themeConfig } from "../config/theme";
import { footerView, type FooterBlockView, type FooterConfig } from "../layout/footer-layout";
import { footerLinks, footerShopLinks, type NavigationLink } from "../layout/navigation";
import { contactsView, type ContactsView } from "../lib/contacts";
import { localizedHref } from "../lib/locale-path";
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
          {view.groups.map((links, index) => (
            <LinkList key={index} links={links} locale={locale} t={t} />
          ))}
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
    default: {
      const unknown: never = view;
      throw new RangeError(`Unknown footer block ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * The footer: its blocks and their order come from `config/footer.ts` through `footerView` (`layout/footer-layout.ts`, plan
 * L3); by default the navigation (the shop pages, then the legal pages), the contacts, the theme switch and the copyright. The
 * "powered by" line always closes it (not a block: the template's attribution).
 */
export function SiteFooter({
  locale,
  t,
  year,
  themeMode,
  showThemeSwitch = themeConfig.showToggle,
  shopLinks = footerShopLinks,
  contacts = contactsView(),
  config = footerConfig,
}: {
  locale: Locale;
  t: Translator;
  year: number;
  /** What `<html data-theme>` says (from the cookie or `config/theme.ts`). */
  themeMode: ThemeMode;
  /** `showToggle` of `config/theme.ts`; a prop for tests. */
  showThemeSwitch?: boolean;
  /** The shop pages with `inFooter` (`config/shop-pages.ts`); a prop for tests. */
  shopLinks?: readonly NavigationLink[];
  /** `config/contacts.ts`; a prop for tests. */
  contacts?: ContactsView;
  /** `config/footer.ts`; a prop for tests. */
  config?: FooterConfig;
}) {
  const blocks = footerView(config, {
    shopLinks,
    legalLinks: footerLinks,
    contacts,
    showThemeSwitch,
  });
  return (
    <footer className="fk-site-footer">
      <Container className="flex flex-col gap-2">
        {/* No class on the lists, links and contacts (`.fk-site-footer ul`, `nav`, `address` in app/globals.css) and a compact
            switch: the footer is in every page's first HTML. Since ADR 0048 its size no longer hides a page (only a loose cap in
            shell.spec.tsx), but small stays cheaper for every page. */}
        {/* One flat list, as the footer's JSX children were before `config/footer.ts`: `useId` (the theme switch's label) derives
            from the position among siblings, so the default markup stays byte for byte the same. */}
        {[
          ...blocks.map((view) => block(view, locale, t, year, themeMode)),
          <p key="powered">{t("footer.powered")}</p>,
        ]}
      </Container>
    </footer>
  );
}
