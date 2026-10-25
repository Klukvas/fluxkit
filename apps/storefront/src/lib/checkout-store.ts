import type { Cart, Money, StoreClient } from "@fluxkit/api-client";
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
import {
  SHIPPING_METHOD_FIELD,
  SHIPPING_POINT_FIELD,
  buildCheckoutBody,
  type CheckoutValues,
  type DeliverySelection,
} from "./checkout-form";
import { clientFailure, type Failure } from "./failure";
import { deliveryPlan, type DeliveryPlan } from "./shipping-model";
import type { ShippingStore } from "./shipping-store";

/**
 * The checkout page's state and its one action, submitting (plan step 7). The cart is the shared cart store's
 * (`lib/cart-store.ts`): the page shows it, and `expectedTotal` is the total of the cart in the store AT SUBMIT TIME,
 * so it is always the most recent cart the shopper sees. Money is never computed here.
 *
 * Shipping (shipping plan step 10): when the shop has an active method and the cart ships goods, the order is delivered
 * with the chosen option of `GET /store/shipping/options` and `expectedTotal` is that option's own server `total` (NEVER the
 * cart's total plus a price, never a sum). With no method in the shop the submit is exactly the one without shipping. A
 * `409 shipping_changed` re-reads the options and waits for the shopper to agree to the new price (`shippingConsent`); it
 * is never resubmitted by itself.
 *
 * - A submit while one is in flight returns the same promise (one request); the key makes a repeat harmless anyway.
 * - Blocked without a request: the cart is loading, empty or not purchasable, a line shows a price change that was not
 *   acknowledged, or the API answered `cart_changed` and the shopper has not confirmed the new total yet.
 * - The outcome table (`checkoutOutcome`) decides about the key; this store applies the side effects to the cart store.
 */

export type CheckoutBlock =
  | "loading"
  | "empty"
  | "notPurchasable"
  | "pricesChanged"
  | "confirmTotal"
  | "shippingLoading"
  | "shippingError"
  | "confirmShipping"
  | "shippingMethod";

/** What the shopper agreed to before a `409 shipping_changed`: the method and the price and total they had seen. */
export interface ShippingConsent {
  methodCode: string;
  previousTotal: Money;
  previousPrice: Money;
}

export interface CheckoutState {
  pending: boolean;
  /** Set by a `409 cart_changed`: the cart (and total) changed and the shopper must confirm it before the next submit. */
  needsConfirmation: boolean;
  /** Set by a `409 shipping_changed`: the delivery price changed and the shopper must agree to the new one first. */
  shippingConsent: ShippingConsent | null;
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
  shippingConsent: null,
  lineErrors: null,
  attemptPersistent: true,
  insecure: false,
};

export type SubmitResult =
  | CheckoutOutcome
  | { kind: "blocked"; reason: CheckoutBlock }
  | { kind: "insecure"; failure: Failure };

/**
 * Why the order cannot be submitted now, or `null`. Flags of the API and the delivery plan only; nothing about money is
 * compared or added.
 */
export function checkoutBlock(
  cart: Cart | null,
  state: CheckoutState,
  delivery: DeliveryPlan,
): CheckoutBlock | null {
  if (cart === null) return "loading";
  if (cart.lines.length === 0) return "empty";
  if (!cart.purchasable) return "notPurchasable";
  if (hasPriceChange(cart)) return "pricesChanged";
  if (delivery.kind === "blocked" && delivery.reason === "loading") return "shippingLoading";
  if (delivery.kind === "blocked" && delivery.reason === "error") return "shippingError";
  if (state.needsConfirmation) return "confirmTotal";
  // The consent belongs to the method it was asked for; a method that is not orderable any more has nothing to confirm.
  if (
    delivery.kind === "ship" &&
    state.shippingConsent?.methodCode === delivery.option.methodCode
  ) {
    return "confirmShipping";
  }
  if (delivery.kind === "blocked") return "shippingMethod";
  return null;
}

export interface CheckoutStoreOptions {
  client: Pick<StoreClient, "checkout">;
  cart: CartStore;
  shipping: ShippingStore;
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
  /** The shopper accepts the delivery price shown after a `shipping_changed`. */
  confirmShipping(): void;
  /** The shopper chose another method: the consent that was asked for the old one is moot. */
  forgetShippingConsent(): void;
  /** `POST /store/cart/acknowledge` through the cart store; an acknowledged cart is also a confirmed one. */
  acknowledge(): Promise<void>;
}

const NO_STORE = { cache: "no-store" } as const;

export function createCheckoutStore(options: CheckoutStoreOptions): CheckoutStore {
  const { client, cart, shipping, locale, config } = options;
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

  function apply(
    outcome: CheckoutOutcome,
    attempt: AttemptManager,
    consent: ShippingConsent | null,
  ): void {
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
      case "shippingChanged":
        // The price the shopper agreed to is gone: read the options again and ask. Nothing is sent by itself.
        void shipping.refresh();
        set({
          pending: false,
          attemptPersistent: persistent,
          shippingConsent: consent,
          lineErrors: null,
        });
        return;
      case "shippingRejected":
        // The shop and the form disagree about delivery (a method was added or removed meanwhile): show what is true now.
        void shipping.refresh();
        set({ pending: false, attemptPersistent: persistent });
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

  /** The delivery the form's values choose, for a plan that can be ordered. */
  function selectionOf(values: CheckoutValues, plan: DeliveryPlan): DeliverySelection | null {
    if (plan.kind !== "ship") return null;
    return {
      methodCode: plan.option.methodCode,
      kind: plan.option.kind,
      pickupPointRef: (values[SHIPPING_POINT_FIELD] ?? "").trim(),
    };
  }

  async function run(values: CheckoutValues, signedIn: boolean): Promise<SubmitResult> {
    const current = cart.getState().cart;
    const methodCode = (values[SHIPPING_METHOD_FIELD] ?? "").trim();
    const plan: DeliveryPlan =
      current === null ? { kind: "none" } : deliveryPlan(current, shipping.getState(), methodCode);
    const block = checkoutBlock(current, state, plan);
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
          // The server's total of the chosen option; the cart's total only when there is no delivery to choose.
          expectedTotal: plan.kind === "ship" ? plan.total : current.total,
          delivery: selectionOf(values, plan),
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
      apply(
        outcome,
        attempt,
        plan.kind === "ship" && plan.option.price !== null
          ? {
              methodCode: plan.option.methodCode,
              previousTotal: plan.total,
              previousPrice: plan.option.price,
            }
          : null,
      );
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
    confirmShipping() {
      if (state.shippingConsent !== null) set({ shippingConsent: null });
    },
    forgetShippingConsent() {
      if (state.shippingConsent !== null) set({ shippingConsent: null });
    },
    async acknowledge() {
      const outcome = await cart.acknowledge();
      if (outcome.status === "ok") set({ needsConfirmation: false });
    },
  };
}
