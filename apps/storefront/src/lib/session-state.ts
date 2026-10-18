import type { StoreClient } from "@fluxkit/api-client";
import { subscribeToCartChanges } from "./cart-events";

/**
 * What the header's browser islands learn from the API: the cart badge (`GET /store/cart`) and the account link
 * (`GET /store/account/me`). Both cookies have `Path=/store`, so only the browser can send them (ADR 0026); each island
 * calls once per page load, same origin, `cache: "no-store"`. A failure is a visible state (and a console error with the
 * code only, never a body), not a hidden one; an aborted request (the island unmounted) is rethrown for the caller to drop.
 */

export type CartBadgeState =
  { status: "loading" } | { status: "ready"; count: number } | { status: "error" };

export type AccountLinkState =
  { status: "loading" } | { status: "guest" } | { status: "signedIn" } | { status: "error" };

const NO_STORE = { cache: "no-store" } as const;

export async function loadCartBadgeState(
  client: Pick<StoreClient, "getCart">,
  signal?: AbortSignal,
): Promise<Exclude<CartBadgeState, { status: "loading" }>> {
  try {
    const result = await client.getCart({
      fetchOptions: NO_STORE,
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.ok) return { status: "ready", count: result.data.itemCount };
    console.error(
      `The cart badge could not read the cart: ${result.status} ${result.problem.code}.`,
    );
    return { status: "error" };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("The cart badge could not read the cart.", error);
    return { status: "error" };
  }
}

export async function loadAccountLinkState(
  client: Pick<StoreClient, "getAccount">,
  signal?: AbortSignal,
): Promise<Exclude<AccountLinkState, { status: "loading" }>> {
  try {
    const result = await client.getAccount({
      fetchOptions: NO_STORE,
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.ok) return { status: "signedIn" };
    // 401 is the normal answer for a guest.
    if (result.status === 401) return { status: "guest" };
    console.error(
      `The account link could not read the account: ${result.status} ${result.problem.code}.`,
    );
    return { status: "error" };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("The account link could not read the account.", error);
    return { status: "error" };
  }
}

/**
 * Keeps the cart badge current: one read of the cart for the first value, then every `fluxkit:cart-changed` event the page
 * publishes (the product page after an add; step 6's cart page after any change). A change that arrives while the first
 * read is still in flight is newer than that read, so it wins and the late read is dropped. Returns the function that
 * stops both; an aborted read after that is ignored, any other rejection stays loud.
 */
export function watchCartBadge(options: {
  client: Pick<StoreClient, "getCart">;
  onState: (state: Exclude<CartBadgeState, { status: "loading" }>) => void;
  signal?: AbortSignal;
  /** Where cart-changed events are published; the browser's `window` unless a test passes its own. */
  target?: EventTarget;
}): () => void {
  let changedByEvent = false;
  let stopped = false;
  const unsubscribe = subscribeToCartChanges((change) => {
    changedByEvent = true;
    options.onState({ status: "ready", count: change.itemCount });
  }, options.target);
  loadCartBadgeState(options.client, options.signal).then(
    (state) => {
      if (!stopped && !changedByEvent) options.onState(state);
    },
    (error: unknown) => {
      // Only an abort (unmount, strict-mode remount) is expected to reject; anything else is a bug and stays loud.
      if (!options.signal?.aborted && !stopped) throw error;
    },
  );
  return () => {
    stopped = true;
    unsubscribe();
  };
}
