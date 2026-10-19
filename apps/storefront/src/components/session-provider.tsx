"use client";

import { createStoreClient, type StoreClient } from "@fluxkit/api-client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { initialAccountState, type AccountState, type AccountStore } from "../lib/account-store";
import { initialCartState, type CartState, type CartStore } from "../lib/cart-store";
import { withTimeout } from "../lib/request-timeout";
import { createSessionStores, type SessionStores } from "../lib/session-stores";

/**
 * The browser stores of the page (`lib/cart-store.ts`, `lib/account-store.ts`) for every client island: the header badge
 * and account link, the cart page, the account pages and the add-to-cart button share ONE cart read and ONE session read
 * per page load. They live in the locale layout, so they survive navigation between pages and start over on a locale
 * switch (a full page load).
 *
 * The stores talk to the API from the browser, same origin (`baseUrl ""`): the cookies have `Path=/store`.
 */

/** Every browser call has a time limit (review M1): a hung request must free its form and say "try again". */
const browserFetch = withTimeout((url, init) => globalThis.fetch(url, init));

export const CartStoreContext = createContext<CartStore | null>(null);
/** The page's one store client, for islands that make calls outside the two stores (the checkout, the order pages). */
export const StoreClientContext = createContext<StoreClient | null>(null);
export const AccountStoreContext = createContext<AccountStore | null>(null);

export function SessionProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const [client] = useState<StoreClient>(() =>
    createStoreClient({ baseUrl: "", fetch: browserFetch }),
  );
  const [stores] = useState<SessionStores>(() => createSessionStores({ client, locale }));

  useEffect(() => {
    // Both are idempotent, so a strict-mode remount does not read twice.
    stores.cart.start();
    stores.account.start();
    return () => stores.cart.stop();
  }, [stores]);

  return (
    <StoreClientContext.Provider value={client}>
      <CartStoreContext.Provider value={stores.cart}>
        <AccountStoreContext.Provider value={stores.account}>
          {children}
        </AccountStoreContext.Provider>
      </CartStoreContext.Provider>
    </StoreClientContext.Provider>
  );
}

function required<T>(value: T | null, name: string): T {
  if (value === null)
    throw new Error(`${name} needs the SessionProvider above it (the locale layout).`);
  return value;
}

export function useCart(): { state: CartState; store: CartStore } {
  const store = required(useContext(CartStoreContext), "useCart");
  const state = useSyncExternalStore(store.subscribe, store.getState, () => initialCartState);
  return { state, store };
}

/** The same-origin store client of the page (`baseUrl ""`): the cookies have `Path=/store`. */
export function useStoreClient(): StoreClient {
  return required(useContext(StoreClientContext), "useStoreClient");
}

export function useAccount(): { state: AccountState; store: AccountStore } {
  const store = required(useContext(AccountStoreContext), "useAccount");
  const state = useSyncExternalStore(store.subscribe, store.getState, () => initialAccountState);
  return { state, store };
}
