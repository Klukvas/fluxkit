import type { Order, OrderList, StoreClient, StoreResult } from "@fluxkit/api-client";
import { offsetForPage, pageCountFor } from "./catalog-query";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";
import { ACCOUNT_ORDERS_PAGE_SIZE, canCancel } from "./order-model";

/**
 * One order on a page, for the guest order page (token) and the customer's order page (session): read it, cancel it while
 * it awaits payment. The two differ only in their `OrderSource`. Plain store, no library; the views render its state.
 *
 * The guest token is held by the source's closure and goes into the POST body of the lookup and the cancel, nowhere else:
 * not into the state (which the views render), a URL, a log or browser storage.
 */

export type OrderLoad =
  | { status: "loading" }
  | { status: "ready"; order: Order }
  /** One state for every "no": unknown number, wrong or expired token, someone else's order. Nothing is revealed. */
  | { status: "notFound" }
  | { status: "error"; failure: Failure }
  /** A customer route answered 401: the session ended (the account gate takes over). */
  | { status: "signedOut" };

export interface CancelState {
  /** The shopper pressed "Cancel order" and is asked to confirm. */
  confirming: boolean;
  pending: boolean;
  failure: Failure | null;
  /** The last cancel succeeded (for the live region). */
  done: boolean;
}

export interface OrderState {
  load: OrderLoad;
  cancel: CancelState;
}

const idleCancel: CancelState = { confirming: false, pending: false, failure: null, done: false };

export const initialOrderState: OrderState = { load: { status: "loading" }, cancel: idleCancel };

export interface OrderSource {
  read(): Promise<StoreResult<Order>>;
  cancel(): Promise<StoreResult<Order>>;
}

const NO_STORE = { cache: "no-store" } as const;

export function guestOrderSource(
  client: Pick<StoreClient, "lookupOrder" | "cancelOrder">,
  number: string,
  accessToken: string,
  locale: string,
): OrderSource {
  const options = { locale, fetchOptions: NO_STORE };
  return {
    read: () => client.lookupOrder({ number, accessToken }, options),
    cancel: () => client.cancelOrder({ number, accessToken }, options),
  };
}

export function accountOrderSource(
  client: Pick<StoreClient, "getAccountOrder" | "cancelAccountOrder">,
  number: string,
  locale: string,
): OrderSource {
  const options = { locale, fetchOptions: NO_STORE };
  return {
    read: () => client.getAccountOrder(number, options),
    cancel: () => client.cancelAccountOrder(number, options),
  };
}

export interface OrderStore {
  getState(): OrderState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  askCancel(): void;
  keepOrder(): void;
  /** Sends the cancel; only after `askCancel` and only for an order that awaits payment. A repeat joins the first. */
  cancel(): Promise<void>;
}

type Answer<T> = { result: StoreResult<T> } | { failure: Failure };

async function ask<T>(request: () => Promise<StoreResult<T>>): Promise<Answer<T>> {
  try {
    return { result: await request() };
  } catch (error) {
    // A network failure or an unreadable answer is retryable; an abort or a bug is rethrown.
    return { failure: failureFromThrown(error) };
  }
}

export function createOrderStore(options: {
  source: OrderSource;
  /** A customer route answered 401: tell the account store, so the account gate redirects to the sign-in page. */
  onSignedOut?: () => void;
}): OrderStore {
  const { source } = options;
  let state = initialOrderState;
  let cancelling: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function set(next: OrderState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function signedOut(): void {
    set({ load: { status: "signedOut" }, cancel: idleCancel });
    options.onSignedOut?.();
  }

  /** The load state an answer of `read` gives. A 400 is the same "not found" as a 404 (a malformed number or token). */
  function loaded(answer: Answer<Order>): OrderLoad | "signedOut" {
    if ("failure" in answer) return { status: "error", failure: answer.failure };
    const { result } = answer;
    if (result.ok) return { status: "ready", order: result.data };
    if (result.status === 401) return "signedOut";
    if (result.status === 404 || result.status === 400) return { status: "notFound" };
    return { status: "error", failure: failureFromResult(result) };
  }

  async function load(cancel: CancelState): Promise<void> {
    const next = loaded(await ask(source.read));
    if (next === "signedOut") signedOut();
    else set({ load: next, cancel });
  }

  const store: OrderStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => load(idleCancel),
    askCancel() {
      if (state.load.status === "ready" && canCancel(state.load.order) && !state.cancel.pending) {
        set({ ...state, cancel: { ...idleCancel, confirming: true } });
      }
    },
    keepOrder() {
      if (state.cancel.confirming && !state.cancel.pending) set({ ...state, cancel: idleCancel });
    },
    cancel() {
      if (cancelling !== null) return cancelling;
      if (
        !state.cancel.confirming ||
        state.load.status !== "ready" ||
        !canCancel(state.load.order)
      ) {
        return Promise.resolve();
      }
      set({ ...state, cancel: { ...state.cancel, pending: true, failure: null } });
      cancelling = (async () => {
        const answer = await ask(source.cancel);
        if ("failure" in answer) {
          set({ ...state, cancel: { ...idleCancel, failure: answer.failure } });
          return;
        }
        const { result } = answer;
        if (result.ok) {
          set({
            load: { status: "ready", order: result.data },
            cancel: { ...idleCancel, done: true },
          });
          return;
        }
        if (result.status === 401) {
          signedOut();
          return;
        }
        if (result.status === 404 || result.status === 400) {
          set({ load: { status: "notFound" }, cancel: idleCancel });
          return;
        }
        const failure = failureFromResult(result);
        if (result.status === 409) {
          // The status changed meanwhile (paid, expired): show the order as it is now, with the reason.
          await load({ ...idleCancel, failure });
          return;
        }
        set({ ...state, cancel: { ...idleCancel, failure } });
      })().finally(() => {
        cancelling = null;
      });
      return cancelling;
    },
  };
  return store;
}

// ------------------------------------------------------------------ the order history

export type OrderListState =
  | { status: "loading" }
  | { status: "ready"; list: OrderList; pageCount: number }
  /** A later page without items (the list shrank, or a hand-typed `?page`): the view links to page 1. */
  | { status: "outOfRange" }
  | { status: "error"; failure: Failure }
  | { status: "signedOut" };

export interface OrderListStore {
  getState(): OrderListState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
}

export function createOrderListStore(options: {
  client: Pick<StoreClient, "listAccountOrders">;
  page: number;
  locale: string;
  onSignedOut?: () => void;
}): OrderListStore {
  const { client, page, locale } = options;
  let state: OrderListState = { status: "loading" };
  const listeners = new Set<() => void>();

  function set(next: OrderListState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      if (state.status !== "loading") set({ status: "loading" });
      const answer = await ask(() =>
        client.listAccountOrders({
          locale,
          limit: ACCOUNT_ORDERS_PAGE_SIZE,
          offset: offsetForPage(page, ACCOUNT_ORDERS_PAGE_SIZE),
          fetchOptions: NO_STORE,
        }),
      );
      if ("failure" in answer) {
        set({ status: "error", failure: answer.failure });
        return;
      }
      const { result } = answer;
      if (result.ok) {
        if (page > 1 && result.data.items.length === 0) {
          set({ status: "outOfRange" });
          return;
        }
        set({
          status: "ready",
          list: result.data,
          pageCount: pageCountFor(result.data.total, ACCOUNT_ORDERS_PAGE_SIZE),
        });
        return;
      }
      if (result.status === 401) {
        set({ status: "signedOut" });
        options.onSignedOut?.();
        return;
      }
      set({ status: "error", failure: failureFromResult(result) });
    },
  };
}
