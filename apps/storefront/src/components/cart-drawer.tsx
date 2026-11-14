"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const checkoutAttempt = useRef(0);
  const cancelCheckout = useCallback(() => {
    checkoutAttempt.current += 1;
    setLeaving(false);
  }, []);
  useEffect(() => {
    if (!drawer.isOpen) cancelCheckout();
    return cancelCheckout;
  }, [drawer.isOpen, cancelCheckout]);
  function close() {
    cancelCheckout();
    drawer.close();
  }
  async function checkoutWhenSaved() {
    const attempt = ++checkoutAttempt.current;
    setLeaving(true);
    try {
      const saved = await registry.settled();
      if (attempt !== checkoutAttempt.current) return;
      const cart = store.getState().cart;
      if (saved && cart !== null && checkoutBlock(cart) === null) {
        drawer.close();
        router.push(localizedHref(locale, "/checkout"));
      }
    } finally {
      if (attempt === checkoutAttempt.current) setLeaving(false);
    }
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
      onCheckout={(event) => {
        if (registry.pending() || leaving) {
          event.preventDefault();
          if (!leaving) void checkoutWhenSaved();
        } else drawer.close();
      }}
    />
  );
}
