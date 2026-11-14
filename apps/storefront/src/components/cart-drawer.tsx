"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { cartPageHandlers } from "../lib/cart-handlers";
import { checkoutBlock } from "../lib/cart-model";
import { createAutosaveRegistry } from "../lib/quantity-autosave";
import { localizedHref } from "../lib/locale-path";
import { useCartDrawer } from "./cart-drawer-provider";
import { CartDrawerView } from "./cart-drawer-view";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";

/** The shared cart and the cart page's save registry preserve pending edits across dismissal and navigation. */
export function CartDrawer({
  exponent,
  imageHosts,
}: {
  exponent: number;
  imageHosts: readonly string[];
}) {
  const { state, store } = useCart();
  const { locale, t } = useI18n();
  const drawer = useCartDrawer();
  const router = useRouter();
  const handlers = useMemo(() => cartPageHandlers(store), [store]);
  const registry = useMemo(() => createAutosaveRegistry(), []);
  const [leaving, setLeaving] = useState(false);
  const navigationAttempt = useRef(0);
  const cancelNavigation = useCallback(() => {
    navigationAttempt.current += 1;
    setLeaving(false);
    void registry.settled();
  }, [registry]);
  useEffect(() => {
    if (!drawer.isOpen) cancelNavigation();
    return cancelNavigation;
  }, [drawer.isOpen, cancelNavigation]);
  function close() {
    cancelNavigation();
    drawer.close();
  }
  async function navigateWhenSaved(target: "/cart" | "/checkout") {
    const attempt = ++navigationAttempt.current;
    setLeaving(true);
    try {
      const saved = await registry.settled();
      if (attempt !== navigationAttempt.current) return;
      const cart = store.getState().cart;
      if (saved && (target === "/cart" || (cart !== null && checkoutBlock(cart) === null))) {
        drawer.close();
        router.push(localizedHref(locale, target));
      }
    } finally {
      if (attempt === navigationAttempt.current) setLeaving(false);
    }
  }
  function navigate(event: MouseEvent<HTMLAnchorElement>, target: "/cart" | "/checkout") {
    if (registry.pending() || leaving) {
      event.preventDefault();
      if (!leaving) void navigateWhenSaved(target);
    } else close();
  }
  return (
    <CartDrawerView
      state={state}
      open={drawer.isOpen}
      opener={drawer.opener}
      onClose={close}
      t={t}
      locale={locale}
      exponent={exponent}
      imageHosts={imageHosts}
      {...handlers}
      registerLine={registry.register}
      leaving={leaving}
      onViewCart={(event) => navigate(event, "/cart")}
      onCheckout={(event) => navigate(event, "/checkout")}
    />
  );
}
