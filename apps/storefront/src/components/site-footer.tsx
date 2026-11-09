import type { ThemeMode } from "@fluxkit/theme";
import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { themeConfig } from "../config/theme";
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

export function SiteFooter({
  locale,
  t,
  year,
  themeMode,
  showThemeSwitch = themeConfig.showToggle,
  shopLinks = footerShopLinks,
  contacts = contactsView(),
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
}) {
  return (
    <footer className="fk-site-footer">
      <Container className="flex flex-col gap-2">
        {/* No class on the lists, links and contacts (`.fk-site-footer ul`, `nav`, `address` in app/globals.css) and a compact
            switch: the footer is in every page's first HTML. Since ADR 0048 its size no longer hides a page (only a loose cap in
            shell.spec.tsx), but small stays cheaper for every page. */}
        <nav aria-label={t("footer.nav.label")}>
          {shopLinks.length === 0 ? null : <LinkList links={shopLinks} locale={locale} t={t} />}
          <LinkList links={footerLinks} locale={locale} t={t} />
        </nav>
        <FooterContacts contacts={contacts} />
        {showThemeSwitch ? (
          <ThemeSwitch
            initialMode={themeMode}
            labels={{
              group: t("theme.label"),
              light: t("theme.light"),
              dark: t("theme.dark"),
              system: t("theme.system"),
            }}
          />
        ) : null}
        <p>{t("footer.copyright", { year, name: t("site.name") })}</p>
        <p>{t("footer.powered")}</p>
      </Container>
    </footer>
  );
}
