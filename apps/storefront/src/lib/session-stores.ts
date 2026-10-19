import type { StoreClient } from "@fluxkit/api-client";
import { createAccountStore, type AccountStore } from "./account-store";
import { createCartStore, type CartStore } from "./cart-store";

export interface SessionStores {
  cart: CartStore;
  account: AccountStore;
}

/**
 * The two browser stores of a page, wired together: whenever the session changes (sign-in, registration, sign-out) the
 * cart is read again, because the guest cart was merged into the account's or the account's cart is no longer visible. That
 * is what keeps the header badge right after a sign-in or sign-out.
 */
export function createSessionStores(options: {
  client: StoreClient;
  locale: string;
  events?: EventTarget;
}): SessionStores {
  const cart = createCartStore({
    client: options.client,
    locale: options.locale,
    ...(options.events === undefined ? {} : { events: options.events }),
  });
  const account = createAccountStore({
    client: options.client,
    onSessionChanged: () => {
      void cart.refresh();
    },
  });
  return { cart, account };
}
