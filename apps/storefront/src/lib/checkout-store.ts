import type { Cart, StoreClient } from "@fluxkit/api-client";
import type { Locale } from "@fluxkit/ui";
import type { CheckoutConfig } from "../config/checkout";
import { hasPriceChange } from "./cart-model";
import type { CartStore } from "./cart-store";
import {
  InsecureContextError,
  checkoutOutcome,
  type AttemptManager,
  type CheckoutAnswer,
  type CheckoutOutcome,
  type LineError,
} from "./checkout-attempt";
import { buildCheckoutBody, type CheckoutValues } from "./checkout-form";
import { clientFailure, type Failure } from "./failure";

/**
 * The checkout page's state and its one action, submitting (plan step 7). The cart is the shared cart store's
 * (`lib/cart-store.ts`): the page shows it, and `expectedTotal` is the total of the cart in the store AT SUBMIT TIME,
 * so it is always the most recent cart the shopper sees. Money is never computed here.
 *
 * - A submit while one is in flight returns the same promise (one request); the key makes a repeat harmless anyway.
 * - Blocked without a request: the cart is loading, empty or not purchasable, a line shows a price change that was not
 *   acknowledged, or the API answered `cart_changed` and the shopper has not confirmed the new total yet.
 * - The outcome table (`checkoutOutcome`) decides about the key; this store applies the side effects to the cart store.
 */

export type CheckoutBlock =
  "loading" | "empty" | "notPurchasable" | "pricesChanged" | "confirmTotal";

export interface CheckoutState {
  pending: boolean;
  /** Set by a `409 cart_changed`: the cart (and total) changed and the shopper must confirm it before the next submit. */
  needsConfirmation: boolean;
  /** Lines refused by `checkout_refused`, for the cart they were refused in (another cart shows none). */
  lineErrors: { cart: Cart | null; errors: readonly LineError[] } | null;
  /** False once the attempt could not be kept in `sessionStorage`; the page warns that a reload loses it. */
  attemptPersistent: boolean;
  /** No Web Crypto (not a secure context): the checkout cannot submit. */
  insecure: boolean;
}

export const initialCheckoutState: CheckoutState = {
  pending: false,
  needsConfirmation: false,
  lineErrors: null,
  attemptPersistent: true,
  insecure: false,
};

export type SubmitResult =
  | CheckoutOutcome
  | { kind: "blocked"; reason: CheckoutBlock }
  | { kind: "insecure"; failure: Failure };

/** Why the order cannot be submitted now, or `null`. Flags of the API only; nothing about money is compared. */
export function checkoutBlock(cart: Cart | null, state: CheckoutState): CheckoutBlock | null {
  if (cart === null) return "loading";
  if (cart.lines.length === 0) return "empty";
  if (!cart.purchasable) return "notPurchasable";
  if (hasPriceChange(cart)) return "pricesChanged";
  if (state.needsConfirmation) return "confirmTotal";
  return null;
}

export interface CheckoutStoreOptions {
  client: Pick<StoreClient, "checkout">;
  cart: CartStore;
  locale: Locale;
  config: CheckoutConfig;
  /** Creates the attempt manager on the first submit (browser only); throws `InsecureContextError` without Web Crypto. */
  attempts: () => AttemptManager;
}

export interface CheckoutStore {
  getState(): CheckoutState;
  subscribe(listener: () => void): () => void;
  /** Creates the attempt manager when the page opens (browser only), so a missing secure context is shown before a submit. */
  prepare(): void;
  submit(values: CheckoutValues, context: { signedIn: boolean }): Promise<SubmitResult>;
  /** The shopper accepts the cart and total shown after a `cart_changed`. */
  confirmTotal(): void;
  /** `POST /store/cart/acknowledge` through the cart store; an acknowledged cart is also a confirmed one. */
  acknowledge(): Promise<void>;
}

const NO_STORE = { cache: "no-store" } as const;

export function createCheckoutStore(options: CheckoutStoreOptions): CheckoutStore {
  const { client, cart, locale, config } = options;
  let state = initialCheckoutState;
  let manager: AttemptManager | null = null;
  let inFlight: Promise<SubmitResult> | null = null;
  const listeners = new Set<() => void>();

  function set(patch: Partial<CheckoutState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function attempts(): AttemptManager | null {
    if (manager !== null) return manager;
    try {
      manager = options.attempts();
      return manager;
    } catch (error) {
      if (!(error instanceof InsecureContextError)) throw error;
      // Loud for the operator (no personal data in it), translated for the shopper.
      console.error(error.message);
      set({ insecure: true });
      return null;
    }
  }

  function apply(outcome: CheckoutOutcome, attempt: AttemptManager): void {
    if (outcome.attempt === "clear") attempt.clear();
    const persistent = attempt.isPersistent();
    switch (outcome.kind) {
      case "placed":
        void cart.refresh();
        // The page navigates away: the form stays disabled.
        set({ attemptPersistent: persistent, needsConfirmation: false, lineErrors: null });
        return;
      case "cartChanged":
        cart.applyCart(outcome.cart);
        set({
          pending: false,
          attemptPersistent: persistent,
          needsConfirmation: true,
          lineErrors: null,
        });
        return;
      case "refused":
        set({
          pending: false,
          attemptPersistent: persistent,
          lineErrors: { cart: cart.getState().cart, errors: outcome.lineErrors },
        });
        return;
      case "cartEmpty":
        void cart.refresh();
        set({ pending: false, attemptPersistent: persistent });
        return;
      default:
        set({ pending: false, attemptPersistent: persistent });
    }
  }

  async function run(values: CheckoutValues, signedIn: boolean): Promise<SubmitResult> {
    const current = cart.getState().cart;
    const block = checkoutBlock(current, state);
    if (block !== null || current === null) return { kind: "blocked", reason: block ?? "loading" };
    const attempt = attempts();
    if (attempt === null) {
      return { kind: "insecure", failure: clientFailure("checkout.error.insecureContext") };
    }
    set({ pending: true });
    try {
      const body = buildCheckoutBody(
        values,
        {
          signedIn,
          requiresShipping: current.requiresShipping,
          locale,
          expectedTotal: current.total,
        },
        config,
      );
      const key = await attempt.keyFor(body);
      set({ attemptPersistent: attempt.isPersistent() });
      let answer: CheckoutAnswer;
      try {
        answer = await client.checkout(body, { idempotencyKey: key, fetchOptions: NO_STORE });
      } catch (thrown) {
        answer = { thrown };
      }
      const outcome = checkoutOutcome(answer, { locale, signedIn });
      apply(outcome, attempt);
      return outcome;
    } catch (error) {
      // A bug or an abort: free the form and stay loud.
      set({ pending: false });
      throw error;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prepare() {
      const attempt = attempts();
      if (attempt !== null && !attempt.isPersistent()) set({ attemptPersistent: false });
    },
    submit(values, context) {
      if (inFlight !== null) return inFlight;
      const promise = run(values, context.signedIn).finally(() => {
        inFlight = null;
      });
      inFlight = promise;
      return promise;
    },
    confirmTotal() {
      if (state.needsConfirmation) set({ needsConfirmation: false });
    },
    async acknowledge() {
      const outcome = await cart.acknowledge();
      if (outcome.status === "ok") set({ needsConfirmation: false });
    },
  };
}
