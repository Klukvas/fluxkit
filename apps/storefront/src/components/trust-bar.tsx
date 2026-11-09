import { cn, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { trustBarItems, type TrustBarIconKey, type TrustBarItemConfig } from "../config/trust-bar";
import { shopPageLinks } from "../lib/shop-pages";
import { ChatIcon, DeliveryIcon, LockIcon, ReturnIcon } from "./icons";
import { focusRing } from "./styles";

const icons: Record<TrustBarIconKey, () => ReactNode> = {
  delivery: () => <DeliveryIcon />,
  payment: () => <LockIcon />,
  contact: () => <ChatIcon />,
  returns: () => <ReturnIcon />,
};

/**
 * The shop's trust bar from `config/trust-bar.ts` (no state, no request; server and client components both render it). Renders
 * nothing when the config lists no item. `items` exists for tests; pages use the config.
 *
 * An item with a `page` is a link to that shop page (the contact line goes to the contacts page, repair batch 2); a page that is
 * not enabled leaves the line as plain text. The markup is the one of `@fluxkit/ui` `TrustBar` (same classes and
 * `data-trust-bar`), drawn here because that component takes a plain text per item: giving it an optional link is a follow-up
 * in `packages/ui` (plan 2026-11-06-storefront-shop-pages.md, decision 6).
 */
export function StoreTrustBar({
  t,
  locale,
  items = trustBarItems,
  className,
}: {
  t: Translator;
  locale: Locale;
  items?: readonly TrustBarItemConfig[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={t("trust.label")}
      data-trust-bar=""
      className={cn(
        "flex flex-col gap-2 rounded-panel border border-border bg-background p-3 text-sm text-foreground",
        className,
      )}
    >
      {items.map((item) => {
        const link = item.page === undefined ? undefined : shopPageLinks(locale, [item.page])[0];
        return (
          <li key={item.messageKey} className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-flex shrink-0 text-muted-foreground">
              {icons[item.icon]()}
            </span>
            {link === undefined ? (
              <span>{t(item.messageKey)}</span>
            ) : (
              <Link
                href={link.href}
                className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
              >
                {t(item.messageKey)}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
