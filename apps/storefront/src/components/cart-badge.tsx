"use client";

import { NumberRoll, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { useCartDrawer } from "./cart-drawer-provider";
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
  onClick,
  animated = false,
  bump = 0,
}: {
  state: CartBadgeState;
  t: Translator;
  locale: Locale;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  animated?: boolean;
  bump?: number;
}) {
  return (
    <Link
      href={localizedHref(locale, sessionLinks.cart)}
      className="fk-header-button"
      onClick={onClick}
    >
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
          className={`${bump === 0 ? "" : bump % 2 === 1 ? "fk-badge-bump " : "fk-badge-bump-alt "}absolute end-0 top-0 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold leading-none tabular-nums text-danger-foreground`}
        >
          {state.count > 99 ? (
            t("nav.cart.overflow")
          ) : animated ? (
            <NumberRoll value={state.count} decorative />
          ) : (
            state.count
          )}
        </span>
      ) : null}
    </Link>
  );
}

/** A plain primary click opens the drawer; modified links and the checkout funnel keep normal navigation. */
export function opensCartDrawer(
  event: Pick<
    MouseEvent,
    "button" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented"
  >,
  pathname: string,
  locale: Locale,
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    pathname !== localizedHref(locale, "/cart") &&
    pathname !== localizedHref(locale, "/checkout")
  );
}

/** No subscription of its own: this only separates the frozen server markup from browser enhancements. */
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export interface BadgeMotionState {
  count: number | null;
  revision: number;
}

/** The first ready value establishes a baseline; subsequent changes restart the bump without remounting the digits. */
export function nextBadgeMotion(previous: BadgeMotionState, count: number): BadgeMotionState {
  if (previous.count === count) return previous;
  return { count, revision: previous.count === null ? 0 : previous.revision + 1 };
}

function HydratedCartBadge({ state, t, locale }: Parameters<typeof CartBadgeView>[0]) {
  const drawer = useCartDrawer();
  const pathname = usePathname();
  // The first ready count is a baseline, including a delayed first cart read; only later answers bump the badge.
  const [seen, setSeen] = useState<BadgeMotionState>({
    count: state.status === "ready" ? state.count : null,
    revision: 0,
  });
  if (state.status === "ready" && seen.count !== state.count) {
    setSeen(nextBadgeMotion(seen, state.count));
  }
  return (
    <CartBadgeView
      state={state}
      t={t}
      locale={locale}
      animated
      bump={seen.revision}
      onClick={(event) => {
        if (!opensCartDrawer(event, pathname, locale)) return;
        event.preventDefault();
        drawer.open(event.currentTarget);
      }}
    />
  );
}

/** The shared cart supplies every count; browser-only enhancement preserves the header's frozen server markup. */
export function CartBadge() {
  const { locale, t } = useI18n();
  const { state } = useCart();
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const badge = cartBadgeState(state);
  return hydrated ? (
    <HydratedCartBadge state={badge} t={t} locale={locale} />
  ) : (
    <CartBadgeView state={badge} t={t} locale={locale} />
  );
}
