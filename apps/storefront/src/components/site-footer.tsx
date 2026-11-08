import type { ThemeMode } from "@fluxkit/theme";
import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { footerConfig, type SocialIcon } from "../config/footer";
import { themeConfig } from "../config/theme";
import { FacebookIcon, InstagramIcon, TelegramIcon } from "./icons";

const socialIcons: Record<SocialIcon, typeof InstagramIcon> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  telegram: TelegramIcon,
};
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
        {/* Reshape experiment (client request 5): four columns from `lg` (shop pages, legal pages, contacts and social links,
            newsletter), then the payment badges, the theme switch and the copyright. Few classes: `.fk-footer-*` in
            app/globals.css, because the footer is in every page's first HTML (README, "Keep the header small"). */}
        <div className="fk-footer-grid">
          {shopLinks.length === 0 ? null : (
            <nav aria-label={t("footer.shop.title")}>
              <h2>{t("footer.shop.title")}</h2>
              <LinkList links={shopLinks} locale={locale} t={t} />
            </nav>
          )}
          <nav aria-label={t("footer.nav.label")}>
            <h2>{t("footer.legal.title")}</h2>
            <LinkList links={footerLinks} locale={locale} t={t} />
          </nav>
          <div>
            <h2>{t("footer.contacts.title")}</h2>
            <FooterContacts contacts={contacts} />
            {footerConfig.social.length === 0 ? null : (
              <ul aria-label={t("footer.social.label")}>
                {footerConfig.social.map((link) => {
                  const SocialIcon = socialIcons[link.icon];
                  return (
                    <li key={link.href}>
                      <a href={link.href} aria-label={t(link.labelKey)}>
                        <SocialIcon />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {footerConfig.newsletter ? (
            // TODO(fluxkit): placeholder only. No newsletter feature exists; the button does nothing. A real one would be a
            // feature package (consent record, double opt-in, an email provider list) and a `<form method="post">`.
            <div>
              <h2>{t("footer.newsletter.title")}</h2>
              <label>
                <span className="sr-only">{t("footer.newsletter.email")}</span>
                <input type="email" placeholder={t("footer.newsletter.email")} />
              </label>
              <button type="button">{t("footer.newsletter.submit")}</button>
            </div>
          ) : null}
        </div>
        {footerConfig.paymentKeys.length === 0 ? null : (
          <ul aria-label={t("footer.payment.label")} className="fk-footer-pay">
            {footerConfig.paymentKeys.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        )}
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
