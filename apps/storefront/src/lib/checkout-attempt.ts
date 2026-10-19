import type {
  Cart,
  CheckoutBody,
  CheckoutResult,
  StoreFailure,
  StoreResult,
} from "@fluxkit/api-client";
import type { Locale } from "@fluxkit/ui";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";
import { accountOrderHref, accountOrdersHref, guestOrderHref } from "./order-links";
import { fieldErrorMessageKey } from "./problem-messages";

/**
 * The checkout attempt (plan, "Checkout idempotency and retries"; ADR 0026 point 5, ADR 0023).
 *
 * One attempt `{key, salt, requestHash}` lives in `sessionStorage`: the `Idempotency-Key` of `POST /store/checkout`, a
 * random salt, and the SHA-256 of the salt and the canonical request body (which holds the expected total). The same body
 * reuses the key, so a double submit, a retry after a network error and a reload of the tab are ONE attempt: the API
 * answers a repeat with `200` and the same order and token. A different body (another email, address, or a new total after
 * a price change) gets a new random key and a new salt. Nothing personal is stored: the hash cannot be turned back into the
 * body, and the per-attempt salt means it cannot be used to CONFIRM a guess of the email, phone or address either (an
 * unsalted hash of a guessable body could be compared with candidates, or precomputed); the salt is random, not secret
 * from a reader of the same storage entry, so a targeted guess still costs one hash per candidate and needs the entry.
 *
 * Secure context: `crypto.randomUUID` and `crypto.subtle` exist only on HTTPS and `localhost`. Without them the checkout
 * refuses to submit (`InsecureContextError`, a translated message); it never falls back to a weaker key such as
 * `Math.random`, which could collide and replay someone else's order.
 *
 * Pure: the storage and the crypto are injected, so every rule is tested without a browser.
 */

export const ATTEMPT_STORAGE_KEY = "fluxkit.checkoutAttempt";

export interface CheckoutAttempt {
  key: string;
  /** Random per attempt (`crypto.randomUUID`), stored next to the hash. */
  salt: string;
  requestHash: string;
}

/** The slice of `Storage` the manager uses; any call may throw (private mode, blocked site data, a full quota). */
export type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AttemptCrypto {
  randomUUID(): string;
  /** Lower-case hex SHA-256 of the UTF-8 text. */
  sha256Hex(text: string): Promise<string>;
}

/** Thrown when the page is not a secure context: no Web Crypto, so no safe idempotency key. */
export class InsecureContextError extends Error {
  constructor() {
    super(
      "The checkout needs a secure context (HTTPS or localhost) for crypto.randomUUID and crypto.subtle.",
    );
    this.name = "InsecureContextError";
  }
}

/** The browser's Web Crypto as `AttemptCrypto`; throws `InsecureContextError` when a part is missing. */
export function webAttemptCrypto(source: Crypto | undefined): AttemptCrypto {
  const subtle = source?.subtle;
  if (
    source === undefined ||
    typeof source.randomUUID !== "function" ||
    subtle === undefined ||
    typeof subtle.digest !== "function"
  ) {
    throw new InsecureContextError();
  }
  return {
    randomUUID: () => source.randomUUID(),
    async sha256Hex(text) {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}

/**
 * `window.sessionStorage` if it can be used, else `null`. Reading the property throws when site data is blocked, and a
 * write throws in some private modes, so both are probed once here.
 */
export function sessionAttemptStorage(get: () => AttemptStorage): AttemptStorage | null {
  try {
    const storage = get();
    const probe = `${ATTEMPT_STORAGE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    // Reported to the shopper through `isPersistent()`: the attempt then lives in memory only.
    return null;
  }
}

/** JSON with the keys of every object sorted and `undefined` members dropped, so equal requests give equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) => {
    if (member === null || typeof member !== "object" || Array.isArray(member)) return member;
    const record = member as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, record[key]]),
    );
  });
}

/**
 * The salted hash of the request: the salt, then the whole body and, named on its own, the expected total (it is in the body
 * too; naming it keeps the rule "a new total is a new attempt" visible even if the body shape changes).
 */
export function requestHash(
  body: CheckoutBody,
  crypto: AttemptCrypto,
  salt: string,
): Promise<string> {
  return crypto.sha256Hex(
    `${salt}\n${canonicalJson({ request: body, expectedTotal: body.expectedTotal })}`,
  );
}

function parseAttempt(text: string | null): CheckoutAttempt | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const { key, salt, requestHash: hash } = record;
  return typeof key === "string" && typeof salt === "string" && typeof hash === "string"
    ? { key, salt, requestHash: hash }
    : null;
}

export interface AttemptManager {
  /** The `Idempotency-Key` for this body: the kept one when the body is the same, else a new one (which is kept). */
  keyFor(body: CheckoutBody): Promise<string>;
  /** Forget the attempt (after an order was placed, or when the API says the key cannot be used again). */
  clear(): void;
  /** False once the attempt could not be written to `sessionStorage`: a reload would then lose it (the page says so). */
  isPersistent(): boolean;
}

export function createAttemptManager(options: {
  storage: AttemptStorage | null;
  crypto: AttemptCrypto;
}): AttemptManager {
  const { crypto } = options;
  let storage = options.storage;
  // The attempt of this page; the stored one wins when it can be read (another load of the same tab wrote it).
  let memory: CheckoutAttempt | null = null;

  function read(): CheckoutAttempt | null {
    if (storage === null) return memory;
    try {
      return parseAttempt(storage.getItem(ATTEMPT_STORAGE_KEY)) ?? memory;
    } catch {
      storage = null;
      return memory;
    }
  }

  function write(attempt: CheckoutAttempt | null): void {
    memory = attempt;
    if (storage === null) return;
    try {
      if (attempt === null) storage.removeItem(ATTEMPT_STORAGE_KEY);
      else storage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
    } catch {
      // From now on the attempt lives in memory only; `isPersistent()` tells the page, which warns the shopper.
      storage = null;
    }
  }

  return {
    async keyFor(body) {
      const kept = read();
      // The kept attempt's own salt: the same body gives the same hash, so it keeps its key.
      if (kept !== null && kept.requestHash === (await requestHash(body, crypto, kept.salt))) {
        return kept.key;
      }
      const salt = crypto.randomUUID();
      const attempt = {
        key: crypto.randomUUID(),
        salt,
        requestHash: await requestHash(body, crypto, salt),
      };
      write(attempt);
      return attempt.key;
    },
    clear() {
      write(null);
    },
    isPersistent: () => storage !== null,
  };
}

// ------------------------------------------------------------------ outcome table

export interface LineError {
  /** Position of the line in the cart (`lines.N` of the problem). */
  index: number;
  code: string;
  messageKey: string;
}

/**
 * What the checkout page does with an answer. `attempt` says whether the key is kept for the next submit ("keep": the next
 * submit of the same body replays safely) or forgotten ("clear"). Every outcome but `placed` carries the message to show.
 */
export type CheckoutOutcome =
  | { kind: "placed"; attempt: "clear"; refreshCart: true; replay: boolean; href: string }
  | { kind: "retry"; attempt: "keep"; failure: Failure }
  | { kind: "rateLimited"; attempt: "keep"; failure: Failure }
  | { kind: "cartChanged"; attempt: "keep"; cart: Cart; failure: Failure }
  | { kind: "refused"; attempt: "keep"; lineErrors: LineError[]; failure: Failure }
  | { kind: "cartEmpty"; attempt: "clear"; refreshCart: true; href: string; failure: Failure }
  | { kind: "tooManyOpenOrders"; attempt: "keep"; ordersHref: string | null; failure: Failure }
  | { kind: "keyReused"; attempt: "clear"; failure: Failure }
  | { kind: "invalid"; attempt: "keep"; failure: Failure }
  | { kind: "failed"; attempt: "keep"; failure: Failure };

export type CheckoutAnswer = StoreResult<CheckoutResult> | { thrown: unknown };

export interface OutcomeContext {
  locale: Locale;
  /** A signed-in customer gets links into the account; a guest gets the private order link. */
  signedIn: boolean;
}

const LINE_PATH = /^lines\.(\d{1,4})$/;

function lineErrors(result: StoreFailure): LineError[] {
  const found: LineError[] = [];
  for (const error of result.problem.errors ?? []) {
    const match = LINE_PATH.exec(error.path);
    if (match === null) continue;
    found.push({
      index: Number(match[1]),
      code: error.code,
      messageKey: fieldErrorMessageKey(error.code),
    });
  }
  return found;
}

function problemOutcome(result: StoreFailure, context: OutcomeContext): CheckoutOutcome {
  const failure = failureFromResult(result);
  const { code } = result.problem;
  if (result.status === 429) return { kind: "rateLimited", attempt: "keep", failure };
  // A 5xx (503 deadlock retry, 500) may or may not have committed: only the same key can find out, so keep it.
  if (result.status >= 500) return { kind: "retry", attempt: "keep", failure };
  if (result.status === 400) return { kind: "invalid", attempt: "keep", failure };
  if (result.status === 409) {
    if (code === "cart_changed" && result.problem.cart !== undefined) {
      return { kind: "cartChanged", attempt: "keep", cart: result.problem.cart, failure };
    }
    if (code === "checkout_refused") {
      return { kind: "refused", attempt: "keep", lineErrors: lineErrors(result), failure };
    }
    if (code === "cart_empty") {
      return {
        kind: "cartEmpty",
        attempt: "clear",
        refreshCart: true,
        href: `/${context.locale}/cart`,
        failure,
      };
    }
    if (code === "too_many_open_orders") {
      return {
        kind: "tooManyOpenOrders",
        attempt: "keep",
        ordersHref: context.signedIn ? accountOrdersHref(context.locale) : null,
        failure,
      };
    }
    if (code === "idempotency_key_reused") return { kind: "keyReused", attempt: "clear", failure };
  }
  return { kind: "failed", attempt: "keep", failure };
}

/**
 * The outcome table of the plan as one pure function. A thrown network failure or an unreadable answer keeps the key
 * (the order may exist: the next submit of the same body gets it back as a `200`); an abort or any other error is a bug
 * and is rethrown by `failureFromThrown`.
 */
export function checkoutOutcome(answer: CheckoutAnswer, context: OutcomeContext): CheckoutOutcome {
  if ("thrown" in answer) {
    return { kind: "retry", attempt: "keep", failure: failureFromThrown(answer.thrown) };
  }
  if (!answer.ok) return problemOutcome(answer, context);
  const { order, accessToken } = answer.data;
  const href =
    accessToken === undefined
      ? accountOrderHref(context.locale, order.number)
      : guestOrderHref(context.locale, order.number, accessToken);
  return {
    kind: "placed",
    attempt: "clear",
    refreshCart: true,
    replay: answer.status === 200,
    href,
  };
}
