"use client";

import { createStoreClient } from "@fluxkit/api-client";
import { Badge, Skeleton, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { loadCartBadgeState, type CartBadgeState } from "../lib/session-state";
import { useI18n } from "./i18n-provider";
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
      <span className="inline-flex min-w-8 justify-center" aria-live="polite">
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
      </span>
    </Link>
  );
}

/** Reads the cart once per page load, from the browser: the cart cookie has `Path=/store` and never reaches the server. */
export function CartBadge() {
  const { locale, t } = useI18n();
  const [state, setState] = useState<CartBadgeState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadCartBadgeState(createStoreClient({ baseUrl: "" }), controller.signal).then(
      setState,
      (error: unknown) => {
        // Only an abort (unmount, strict-mode remount) is expected to reject; anything else is a bug and stays loud.
        if (!controller.signal.aborted) throw error;
      },
    );
    return () => controller.abort();
  }, []);

  return <CartBadgeView state={state} t={t} locale={locale} />;
}
