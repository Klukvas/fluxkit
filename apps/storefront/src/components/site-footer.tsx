import type { ThemeMode } from "@fluxkit/theme";
import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { themeConfig } from "../config/theme";
import { footerLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { navLink } from "./styles";
import { ThemeSwitch } from "./theme-switch";

export function SiteFooter({
  locale,
  t,
  year,
  themeMode,
  showThemeSwitch = themeConfig.showToggle,
}: {
  locale: Locale;
  t: Translator;
  year: number;
  /** What `<html data-theme>` says (from the cookie or `config/theme.ts`). */
  themeMode: ThemeMode;
  /** `showToggle` of `config/theme.ts`; a prop for tests. */
  showThemeSwitch?: boolean;
}) {
  return (
    <footer className="mt-12 border-t border-border py-6 text-muted-foreground">
      <Container className="flex flex-col gap-2">
        <nav aria-label={t("footer.nav.label")}>
          <ul className="flex flex-wrap gap-x-2">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <Link href={localizedHref(locale, link.href)} className={navLink}>
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
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
