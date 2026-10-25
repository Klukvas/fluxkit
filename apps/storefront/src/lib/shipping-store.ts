import type { StoreClient } from "@fluxkit/api-client";
import type { CartStore } from "./cart-store";
import { failureFromResult, failureFromThrown } from "./failure";
import { initialShippingState, type ShippingState } from "./shipping-model";

/**
 * The shipping options of the current cart as the browser knows them (shipping plan step 10): `GET /store/shipping/options`
 * and nothing else. One small store per checkout page, no state library. Rules, each with a test:
 * - The prices are the server's. Nothing here computes money; the checkout sends the option's own `total`.
 * - Reads are numbered when they START; only the newest read's answer is applied ("last request wins"), so a slow older
 *   answer cannot show a price the shopper has already moved past. While a read is in flight the previous answer stays for
 *   display, but `pending` makes the checkout wait for the new price (`deliveryPlan`).
 * - A read whose cart changed: the store follows the cart store and re-reads at once, in the same notification, so there is
 *   no render in which the new cart is shown with the old shipping price.
 * - A failed read keeps the previous answer for display and sets `failure`; nothing may be ordered on it.
 * - No cache: every read is `no-store` (the answer depends on the cart).
 */

/** What the options depend on. A blank string is "not given" and is not sent. */
export interface ShippingReadParams {
  /** The destination country of the address the shopper entered (ISO 3166-1 alpha-2). */
  country: string;
  /** A carrier city: asks for the carrier's estimate. */
  cityRef: string;
  /** A carrier pickup point: its country and the carrier's estimate. */
  pickupPointRef: string;
}

export interface ShippingStoreOptions {
  client: Pick<StoreClient, "getShippingOptions">;
  cart: Pick<CartStore, "getState" | "subscribe">;
  locale: string;
}

export interface ShippingStore {
  getState(): ShippingState;
  subscribe(listener: () => void): () => void;
  /** Reads the options for these parameters now (the first call also starts following the cart). */
  read(params: ShippingReadParams): Promise<void>;
  /** Reads again with the parameters of the last `read`; nothing happens before the first one. */
  refresh(): Promise<void>;
  /** Stops following the cart. A read in flight still finishes and applies. */
  dispose(): void;
}

const NO_STORE = { cache: "no-store" } as const;

function query(params: ShippingReadParams) {
  return {
    ...(params.country === "" ? {} : { country: params.country }),
    ...(params.cityRef === "" ? {} : { cityRef: params.cityRef }),
    ...(params.pickupPointRef === "" ? {} : { pickupPointRef: params.pickupPointRef }),
  };
}

export function createShippingStore(options: ShippingStoreOptions): ShippingStore {
  const { client, cart, locale } = options;
  let state = initialShippingState;
  let params: ShippingReadParams | null = null;
  let seq = 0;
  let lastCart = cart.getState().cart;
  let unsubscribeCart: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function set(patch: Partial<ShippingState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  async function run(): Promise<void> {
    if (params === null) return;
    seq += 1;
    const mine = seq;
    set({ started: true, pending: true });
    let result: Awaited<ReturnType<StoreClient["getShippingOptions"]>>;
    try {
      result = await client.getShippingOptions({
        locale,
        ...query(params),
        fetchOptions: NO_STORE,
      });
    } catch (thrown) {
      if (mine !== seq) return;
      try {
        set({ pending: false, failure: failureFromThrown(thrown), appliedSeq: mine });
      } catch (bug) {
        // A caller's abort or a bug: free the page, stay loud.
        set({ pending: false });
        throw bug;
      }
      return;
    }
    if (mine !== seq) return;
    if (result.ok) {
      set({ pending: false, answer: result.data, failure: null, appliedSeq: mine });
    } else {
      set({ pending: false, failure: failureFromResult(result), appliedSeq: mine });
    }
  }

  function follow(): void {
    if (unsubscribeCart !== null) return;
    lastCart = cart.getState().cart;
    unsubscribeCart = cart.subscribe(() => {
      const current = cart.getState().cart;
      if (current === lastCart) return;
      lastCart = current;
      if (current !== null) void run();
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read(next) {
      params = next;
      follow();
      return run();
    },
    refresh: run,
    dispose() {
      unsubscribeCart?.();
      unsubscribeCart = null;
    },
  };
}
