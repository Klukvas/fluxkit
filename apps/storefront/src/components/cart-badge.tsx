"use client";

import { Badge, Skeleton, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { sessionLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { cartBadgeState, type CartBadgeState } from "../lib/cart-model";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { navLink } from "./styles";

/**
 * The slot keeps its width in every state (a skeleton while loading, the count when ready, empty when the cart could not be
 * read), so the header does not shift when the answer arrives.
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
    <Link href={localizedHref(locale, sessionLinks.cart)} className={`${navLink} gap-2`}>
      <span>{t("nav.cart")}</span>
      <div className="inline-flex min-w-8 justify-center" aria-live="polite">
        {state.status === "loading" ? (
          <>
            <Skeleton className="h-6 w-8" />
            <VisuallyHidden>{t("nav.cart.loading")}</VisuallyHidden>
          </>
        ) : null}
        {state.status === "ready" ? (
          <>
            <Badge aria-hidden="true">{state.count}</Badge>
            <VisuallyHidden>{t.plural("nav.cart.items", state.count)}</VisuallyHidden>
          </>
        ) : null}
      </div>
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
