import type { Cart, StoreClient, StoreResult } from "@fluxkit/api-client";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "./add-to-cart";
import { publishCartChange, subscribeToCartChanges } from "./cart-events";
import { clientFailure, failureFromResult, failureFromThrown, type Failure } from "./failure";

/**
 * The cart as the browser knows it (plan, step 6): one small store per page, no state or fetching library. The header
 * badge, the cart page and the add-to-cart island all read and write through it, so a page load costs ONE `GET /store/cart`
 * (the badge used to make its own read; it now reads this state).
 *
 * Rules, each with a test:
 * - Money is the server's. There are no optimistic updates: a quantity or an amount changes only when an answer arrives.
 * - Every answer that has a cart in it (a `200`, and the `cart` inside a `409 cart_changed`) replaces the state and tells
 *   the page through `fluxkit:cart-changed` (`lib/cart-events.ts`, the event of step 5).
 * - Requests are numbered when they START. An answer replaces the state only when its number is higher than the last
 *   applied one, so a slow older answer cannot undo a newer one ("last request wins").
 * - A failed write (429, network, a refused rule) keeps the previous cart and shows a translated message.
 */

export type CartAnnouncement = "updated" | "removed" | "cleared" | "acknowledged";

export interface CartState {
  /** `loading` until the first answer; `error` only when the first read failed and there is no cart to show. */
  status: "loading" | "ready" | "error";
  cart: Cart | null;
  /** The last failed action of the cart page, or the failed first read; `null` after the next success or a dismissal. */
  failure: Failure | null;
  /** Variant ids with a write in flight, `CART_BUSY_KEY` for a whole-cart write, `LOAD_BUSY_KEY` for a read. */
  busy: readonly string[];
  /** What the last user action did, for the live region; a plain read sets none. */
  announcement: CartAnnouncement | null;
  /** The number of the newest request whose answer was applied. */
  appliedSeq: number;
}

export const CART_BUSY_KEY = "cart";
export const LOAD_BUSY_KEY = "load";

export const initialCartState: CartState = {
  status: "loading",
  cart: null,
  failure: null,
  busy: [],
  announcement: null,
  appliedSeq: 0,
};

export type CartAction =
  | { type: "started"; key: string }
  | {
      type: "applied";
      seq: number;
      key: string;
      cart: Cart;
      announcement: CartAnnouncement | null;
      failure: Failure | null;
    }
  | { type: "failed"; seq: number; key: string | null; failure: Failure }
  | { type: "released"; key: string }
  | { type: "dismissed" };

function withoutOne(keys: readonly string[], key: string | null): readonly string[] {
  if (key === null) return keys;
  const index = keys.indexOf(key);
  return index === -1 ? keys : [...keys.slice(0, index), ...keys.slice(index + 1)];
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "started":
      return { ...state, busy: [...state.busy, action.key] };
    case "released":
      return { ...state, busy: withoutOne(state.busy, action.key) };
    case "dismissed":
      return state.failure === null && state.announcement === null
        ? state
        : { ...state, failure: null, announcement: null };
    case "applied": {
      const busy = withoutOne(state.busy, action.key);
      // An older answer arriving late: its cart is outdated, drop it (the busy mark still ends).
      if (action.seq <= state.appliedSeq) return { ...state, busy };
      return {
        ...state,
        status: "ready",
        cart: action.cart,
        failure: action.failure,
        announcement: action.announcement,
        busy,
        appliedSeq: action.seq,
      };
    }
    case "failed": {
      const busy = withoutOne(state.busy, action.key);
      if (action.seq < state.appliedSeq) return { ...state, busy };
      return {
        ...state,
        status: state.cart === null ? "error" : state.status,
        failure: action.failure,
        announcement: null,
        busy,
      };
    }
  }
}

export type CartOutcome = { status: "ok"; cart: Cart } | { status: "failed"; failure: Failure };

type CartClient = Pick<
  StoreClient,
  | "getCart"
  | "addCartItem"
  | "setCartItemQuantity"
  | "removeCartItem"
  | "clearCart"
  | "acknowledgeCart"
>;

export interface CartStoreOptions {
  client: CartClient;
  /** The page's locale, so the texts in the cart answer (titles, option names) match the page. */
  locale: string;
  /** Where cart-changed events go; the browser's `window` unless a test passes its own. */
  events?: EventTarget;
}

export interface CartStore {
  getState(): CartState;
  subscribe(listener: () => void): () => void;
  /** Reads the cart once (idempotent) and starts following cart-changed events from other publishers. */
  start(): void;
  /** Stops following events. A request in flight still finishes and applies. */
  stop(): void;
  refresh(): Promise<CartOutcome>;
  /** Failure of the call is returned, not kept in the shared state: the product page shows it itself. */
  add(variantId: string, quantity: number): Promise<CartOutcome>;
  setQuantity(variantId: string, quantity: number): Promise<CartOutcome>;
  remove(variantId: string): Promise<CartOutcome>;
  /** `DELETE /store/cart`, then a read: the empty cart (with its currency) is the server's, never built here. */
  clear(): Promise<CartOutcome>;
  acknowledge(): Promise<CartOutcome>;
  dismissFailure(): void;
}

const NO_STORE = { cache: "no-store" } as const;

function validQuantity(quantity: number): boolean {
  return (
    Number.isInteger(quantity) && quantity >= MIN_LINE_QUANTITY && quantity <= MAX_LINE_QUANTITY
  );
}

export function createCartStore(options: CartStoreOptions): CartStore {
  const { client, locale, events } = options;
  const call = { locale, fetchOptions: NO_STORE };
  let state = initialCartState;
  let lastSeq = 0;
  let started = false;
  let stopListening: (() => void) | null = null;
  let publishing = false;
  const listeners = new Set<() => void>();

  function dispatch(action: CartAction): void {
    const next = cartReducer(state, action);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function publish(cart: Cart): void {
    // Our own event must not come back as "another publisher changed the cart".
    publishing = true;
    try {
      publishCartChange({ itemCount: cart.itemCount }, events);
    } finally {
      publishing = false;
    }
  }

  /**
   * One numbered request. `reportFailure` false keeps a failure out of the shared state (the caller shows it). The answer is
   * applied only when its number beats the applied one; only an applied answer is published.
   */
  async function run(
    key: string,
    announcement: CartAnnouncement | null,
    request: () => Promise<StoreResult<Cart>>,
    reportFailure: boolean,
  ): Promise<CartOutcome> {
    const seq = (lastSeq += 1);
    dispatch({ type: "started", key });
    let result: StoreResult<Cart>;
    try {
      result = await request();
    } catch (error) {
      let failure: Failure;
      try {
        failure = failureFromThrown(error);
      } catch (unexpected) {
        dispatch({ type: "released", key });
        throw unexpected;
      }
      if (reportFailure) dispatch({ type: "failed", seq, key, failure });
      else dispatch({ type: "released", key });
      return { status: "failed", failure };
    }
    if (result.ok || result.problem.cart !== undefined) {
      const cart = result.ok ? result.data : (result.problem.cart as Cart);
      const failure = result.ok ? null : failureFromResult(result);
      dispatch({
        type: "applied",
        seq,
        key,
        cart,
        announcement: result.ok ? announcement : null,
        // A 409 with a fresh cart is both: the cart replaces the state and the reason is still shown.
        failure: reportFailure ? failure : null,
      });
      if (state.appliedSeq === seq) publish(cart);
      return result.ok ? { status: "ok", cart } : { status: "failed", failure: failure as Failure };
    }
    const failure = failureFromResult(result);
    if (reportFailure) dispatch({ type: "failed", seq, key, failure });
    else dispatch({ type: "released", key });
    return { status: "failed", failure };
  }

  function refuse(failure: Failure, reportFailure: boolean): CartOutcome {
    if (reportFailure) dispatch({ type: "failed", seq: (lastSeq += 1), key: null, failure });
    return { status: "failed", failure };
  }

  const invalidQuantity = () => clientFailure("errors.field.invalid_quantity");

  const store: CartStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (stopListening === null) {
        stopListening = subscribeToCartChanges((change) => {
          if (publishing) return;
          if (state.cart?.itemCount !== change.itemCount) void store.refresh();
        }, events);
      }
      if (!started) {
        started = true;
        void store.refresh();
      }
    },
    stop() {
      stopListening?.();
      stopListening = null;
    },
    refresh: () => run(LOAD_BUSY_KEY, null, () => client.getCart(call), true),
    add(variantId, quantity) {
      if (!validQuantity(quantity)) return Promise.resolve(refuse(invalidQuantity(), false));
      return run(
        variantId,
        "updated",
        () => client.addCartItem({ variantId, quantity }, call),
        false,
      );
    },
    setQuantity(variantId, quantity) {
      if (!validQuantity(quantity)) return Promise.resolve(refuse(invalidQuantity(), true));
      return run(
        variantId,
        "updated",
        () => client.setCartItemQuantity(variantId, { quantity }, call),
        true,
      );
    },
    remove: (variantId) =>
      run(variantId, "removed", () => client.removeCartItem(variantId, call), true),
    clear: () =>
      run(
        CART_BUSY_KEY,
        "cleared",
        async () => {
          const cleared = await client.clearCart({ fetchOptions: NO_STORE });
          return cleared.ok ? client.getCart(call) : cleared;
        },
        true,
      ),
    acknowledge: () => run(CART_BUSY_KEY, "acknowledged", () => client.acknowledgeCart(call), true),
    dismissFailure: () => dispatch({ type: "dismissed" }),
  };
  return store;
}
