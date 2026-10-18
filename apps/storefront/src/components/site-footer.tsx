import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { footerLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { navLink } from "./styles";

export function SiteFooter({ locale, t, year }: { locale: Locale; t: Translator; year: number }) {
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
        <p>{t("footer.copyright", { year, name: t("site.name") })}</p>
        <p>{t("footer.powered")}</p>
      </Container>
    </footer>
  );
}
