import { Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { HEADER_CATEGORY_LIMIT, headerLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { AccountLink } from "./account-link";
import { CartBadge } from "./cart-badge";
import { LocaleSwitcher } from "./locale-switcher";
import { navLink } from "./styles";

export interface NavigationCategory {
  slug: string;
  name: string;
}

/**
 * Server-rendered header. `categories` is `null` when the API could not be read (the page still renders, without the
 * category links; the failure is logged where it happened). The cart badge, the account link and the locale switcher are
 * client islands. Needs an `I18nProvider` above it.
 */
export function SiteHeader({
  locale,
  t,
  categories,
}: {
  locale: Locale;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
}) {
  return (
    <header className="border-b border-border bg-background">
      <Container className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
        <Link
          href={localizedHref(locale, "/")}
          className="inline-flex min-h-11 items-center text-lg font-bold text-foreground"
        >
          {t("site.name")}
        </Link>
        <nav aria-label={t("nav.main.label")}>
          <ul className="flex flex-wrap items-center gap-x-2">
            {(categories ?? []).slice(0, HEADER_CATEGORY_LIMIT).map((category) => (
              <li key={category.slug}>
                <Link
                  href={localizedHref(locale, `/c/${encodeURIComponent(category.slug)}`)}
                  className={navLink}
                >
                  {category.name}
                </Link>
              </li>
            ))}
            {headerLinks.map((link) => (
              <li key={link.href}>
                <Link href={localizedHref(locale, link.href)} className={navLink}>
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex flex-wrap items-center gap-x-4">
          <LocaleSwitcher />
          <CartBadge />
          <AccountLink />
        </div>
      </Container>
    </header>
  );
}
