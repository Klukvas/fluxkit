import type { StoreClient } from "@fluxkit/api-client";

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
