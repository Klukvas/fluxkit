"use client";

import { VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { sessionLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { cartBadgeState, type CartBadgeState } from "../lib/cart-model";
import { useI18n } from "./i18n-provider";
import { CartIcon } from "./icons";
import { useCart } from "./session-provider";

/**
 * The cart as an icon (owner request 2026-11-02). The count sits in a round badge on the icon (`danger` fill, its own
 * `danger-foreground` text token) ONLY when the cart holds something; at 0 there is no badge. The link's accessible name is
 * "Cart" plus the count in words (plural forms), in a polite live region so a change is announced. While the cart loads the
 * icon shows alone (no grey placeholder pill: it read as broken, review N9); the badge sits on the icon, so nothing shifts.
 */
export function CartBadgeView({
  state,
  t,
  locale,
}: {
  state: CartBadgeState;
  t: Translator;
  locale: Locale;
}) {
  return (
    <Link href={localizedHref(locale, sessionLinks.cart)} className="fk-header-button">
      <CartIcon />
      <VisuallyHidden>{t("nav.cart")}</VisuallyHidden>
      <span aria-live="polite">
        {state.status === "loading" ? (
          <VisuallyHidden>{t("nav.cart.loading")}</VisuallyHidden>
        ) : null}
        {state.status === "ready" ? (
          <VisuallyHidden>{t.plural("nav.cart.items", state.count)}</VisuallyHidden>
        ) : null}
      </span>
      {state.status === "ready" && state.count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute end-0 top-0 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold leading-none tabular-nums text-danger-foreground"
        >
          {state.count > 99 ? t("nav.cart.overflow") : state.count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The count comes from the shared cart store (`SessionProvider`): the one `GET /store/cart` of the page load, and every later
 * change of the cart (the product page, the cart page, a sign-in). It makes no request of its own.
 */
export function CartBadge() {
  const { locale, t } = useI18n();
  const { state } = useCart();
  return <CartBadgeView state={cartBadgeState(state)} t={t} locale={locale} />;
}
