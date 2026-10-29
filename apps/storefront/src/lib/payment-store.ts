import type { CreatedPayment, PaymentState, StoreClient, StoreResult } from "@fluxkit/api-client";
import { InsecureContextError, type AttemptStorage } from "./checkout-attempt";
import type { PaymentAttemptManager, PaymentRequestIdentity } from "./payment-attempt";
import { createPaymentOutcome, type PayOutcome } from "./payment-model";
import { providerRedirectUrl } from "./payment-redirect";
import { savePaymentReturn, type PaymentReturn } from "./payment-return";

/**
 * "Pay now" as a plain store, and the two modules that talk to the payment routes of the API (the only ones in the
 * storefront: a source guard checks it). The views render its state; the page passes the browser parts in (`navigate`,
 * the storage) so every rule is tested without a DOM.
 *
 * The flow (ADR 0032 decision 6): take the idempotency key of this request (`payment-attempt.ts`), `POST` the create route
 * with it, turn the answer into an outcome (`createPaymentOutcome`), forget or keep the key as the outcome says, save the
 * hand-off for the return page, and navigate to the provider's page. The browser never sends an amount, a currency, a return
 * URL or a provider status, and never builds the provider URL: it only follows one the API gave and the redirect check
 * accepted. The guest's access token goes into the POST body and nowhere else (not a URL, a log or this store's state).
 */

const NO_STORE = { cache: "no-store" } as const;

export interface PaySource {
  /** What makes two requests the same request, for the idempotency key. */
  identity: PaymentRequestIdentity;
  create(idempotencyKey: string): Promise<StoreResult<CreatedPayment>>;
  /** What the return page needs to ask about the attempt `paymentId` of this order. */
  returnEntry(paymentId: string): PaymentReturn;
}

export function guestPaySource(
  client: Pick<StoreClient, "createOrderPayment">,
  number: string,
  accessToken: string,
  locale: string,
): PaySource {
  return {
    identity: { orderNumber: number, provider: null, locale },
    create: (idempotencyKey) =>
      client.createOrderPayment(
        { number, accessToken, locale },
        { idempotencyKey, fetchOptions: NO_STORE },
      ),
    returnEntry: (paymentId) => ({ kind: "guest", number, accessToken, paymentId }),
  };
}

export function accountPaySource(
  client: Pick<StoreClient, "createAccountOrderPayment">,
  number: string,
  locale: string,
): PaySource {
  return {
    identity: { orderNumber: number, provider: null, locale },
    create: (idempotencyKey) =>
      client.createAccountOrderPayment(
        number,
        { locale },
        { idempotencyKey, fetchOptions: NO_STORE },
      ),
    returnEntry: (paymentId) => ({ kind: "account", number, paymentId }),
  };
}

/** The status read of one attempt for `createPaymentWatch`: the guest route by body, the customer route by path. */
export function statusReadFor(
  client: Pick<StoreClient, "getOrderPaymentStatus" | "getAccountOrderPayment">,
  entry: PaymentReturn,
): () => Promise<StoreResult<PaymentState>> {
  if (entry.kind === "guest") {
    const body = {
      number: entry.number,
      accessToken: entry.accessToken,
      paymentId: entry.paymentId,
    };
    return () => client.getOrderPaymentStatus(body, { fetchOptions: NO_STORE });
  }
  return () =>
    client.getAccountOrderPayment(entry.number, entry.paymentId, { fetchOptions: NO_STORE });
}

// ------------------------------------------------------------------ the store

export interface PayState {
  /** `redirecting`: the browser is on its way to the provider; the button stays disabled until the page unloads. */
  phase: "idle" | "pending" | "redirecting" | "failed";
  /** What the last request ended in (a message for the shopper), `null` before the first. */
  outcome: PayOutcome | null;
  /** Epoch milliseconds at which the wait of a `503` ends; `null` when there is none. */
  waitUntil: number | null;
  /** No Web Crypto (not HTTPS or localhost): nothing is sent, the page says why. */
  insecure: boolean;
  /** False when the hand-off for the return page could not be saved: the page warns that the link must be opened again. */
  returnSaved: boolean;
}

export const initialPayState: PayState = {
  phase: "idle",
  outcome: null,
  waitUntil: null,
  insecure: false,
  returnSaved: true,
};

export interface PayStore {
  getState(): PayState;
  subscribe(listener: () => void): () => void;
  /** Starts the payment. A repeat while one runs (a double click) joins it; after the redirect started it does nothing. */
  pay(): Promise<void>;
  /** Opens the provider's page of the attempt that waits, without creating a new attempt. */
  continuePayment(url: string, paymentId: string): void;
  /** Saves the hand-off so the status page can find the order; `false` when the browser refused. */
  rememberReturn(paymentId: string): boolean;
  /** Hides the message of the last failure (and its wait). */
  dismiss(): void;
}

export function createPayStore(options: {
  source: PaySource;
  /** Lazy, because it throws `InsecureContextError` outside HTTPS and localhost. */
  attempts: () => PaymentAttemptManager;
  /** Where the hand-off for the return page is saved (`sessionStorage`); `null` when the browser has none. */
  returnStorage: AttemptStorage | null;
  /** Navigates the browser to a provider page; the page passes `goToProvider(window, url)`. Returns whether it did. */
  navigate: (url: string) => boolean;
  /** The order changed under the page (not payable any more, a payment is in progress): read it again. */
  onOrderChanged?: () => void;
  /** A customer route answered 401: tell the account store, so the account gate takes over. */
  onSignedOut?: () => void;
  now?: () => number;
}): PayStore {
  const { source } = options;
  const now = options.now ?? (() => Date.now());
  let state = initialPayState;
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function set(next: PayState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function remember(paymentId: string): boolean {
    return savePaymentReturn(options.returnStorage, source.returnEntry(paymentId));
  }

  /** Saves the hand-off, then navigates; a refused navigation is the "page could not be opened" message. */
  function go(url: string, paymentId: string, outcome: PayOutcome): void {
    const returnSaved = remember(paymentId);
    if (options.navigate(url)) {
      set({ ...state, phase: "redirecting", outcome, waitUntil: null, returnSaved });
    } else {
      set({
        ...state,
        phase: "failed",
        outcome: { kind: "noPage", attempt: "clear" },
        returnSaved,
      });
    }
  }

  function apply(outcome: PayOutcome): void {
    switch (outcome.kind) {
      case "redirect":
        go(outcome.url, outcome.paymentId, outcome);
        return;
      case "processing":
        remember(outcome.paymentId);
        set({ ...state, phase: "failed", outcome, waitUntil: null });
        options.onOrderChanged?.();
        return;
      case "paymentInProgress":
      case "notPayable":
        set({ ...state, phase: "failed", outcome, waitUntil: null });
        options.onOrderChanged?.();
        return;
      case "providerUnavailable":
        remember(outcome.paymentId);
        set({ ...state, phase: "failed", outcome, waitUntil: now() + outcome.waitSeconds * 1000 });
        return;
      case "signedOut":
        set({ ...state, phase: "failed", outcome, waitUntil: null });
        options.onSignedOut?.();
        return;
      default:
        set({ ...state, phase: "failed", outcome, waitUntil: null });
    }
  }

  async function run(): Promise<void> {
    let manager: PaymentAttemptManager;
    try {
      manager = options.attempts();
    } catch (error) {
      if (!(error instanceof InsecureContextError)) throw error;
      set({ ...state, phase: "idle", insecure: true });
      return;
    }
    set({ ...state, phase: "pending", outcome: null, waitUntil: null, insecure: false });
    try {
      const key = await manager.keyFor(source.identity);
      let outcome: PayOutcome;
      try {
        outcome = createPaymentOutcome(await source.create(key));
      } catch (error) {
        // A network failure or a timeout keeps the key; an abort or a bug is rethrown by `createPaymentOutcome`.
        outcome = createPaymentOutcome({ thrown: error });
      }
      if (outcome.attempt === "clear") manager.clear();
      apply(outcome);
    } catch (error) {
      set({ ...state, phase: "idle" });
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
    pay() {
      if (running !== null) return running;
      if (state.phase === "redirecting" || state.phase === "pending") return Promise.resolve();
      running = run().finally(() => {
        running = null;
      });
      return running;
    },
    continuePayment(url, paymentId) {
      if (state.phase === "redirecting" || state.phase === "pending") return;
      const safe = providerRedirectUrl(url);
      if (safe === null) {
        set({ ...state, phase: "failed", outcome: { kind: "noPage", attempt: "clear" } });
        return;
      }
      go(safe, paymentId, { kind: "redirect", attempt: "clear", url: safe, paymentId });
    },
    rememberReturn(paymentId) {
      return remember(paymentId);
    },
    dismiss() {
      if (state.phase === "failed") {
        set({ ...state, phase: "idle", outcome: null, waitUntil: null });
      }
    },
  };
}

/**
 * Where the keyboard focus goes after the state changed: a refused or lost start puts the message (which is also announced)
 * in front of the shopper, because the button they pressed is disabled and nothing else says what happened. Pure, so every
 * transition has a test; `components/order-payment.tsx` applies the answer.
 */
export type PayFocusTarget = "message" | "action";

export function payFocusTarget(before: PayState, after: PayState): PayFocusTarget | null {
  if (before.phase === "pending" && after.phase === "failed") return "message";
  // The message was dismissed: back to the control that asks again.
  if (before.phase === "failed" && after.phase === "idle") return "action";
  return null;
}
