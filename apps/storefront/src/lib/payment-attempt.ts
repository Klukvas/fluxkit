import {
  canonicalJson,
  type AttemptCrypto,
  type AttemptStorage,
} from "./checkout-attempt";

/**
 * The idempotency key of "Pay now" (ADR 0032 decision 6; same model as `checkout-attempt.ts`). One attempt `{key, salt,
 * requestHash}` lives in `sessionStorage`: the `Idempotency-Key` of `POST /store/orders/payments` (or the account twin), a
 * random salt, and the SHA-256 of the salt and the canonical request identity (order number, provider, locale). The SAME
 * request reuses the key, so a double click, a retry after a lost answer and a reload are ONE attempt: the API answers a
 * repeat with the same payment. Another order, provider or locale is a new request and gets a new key.
 *
 * The page calls `clear()` as soon as the API gave a DEFINITIVE answer (it created the attempt, or refused it), because a
 * replay of an old key would hand back that old attempt, even a failed one: a new payment needs a new key. A lost answer
 * (network failure, timeout, a 5xx, a 503 whose `canRetry` is false) keeps the key, so the retry can only find the attempt
 * the API may already have made, never create a second one.
 *
 * The access token is NOT part of the identity or the stored entry. Pure: storage and crypto are injected.
 */

export const PAYMENT_ATTEMPT_STORAGE_KEY = "fluxkit.paymentAttempt";

/** What makes two "Pay now" requests the same request. */
export interface PaymentRequestIdentity {
  orderNumber: string;
  /** `null` while one provider is enabled (the API picks it). */
  provider: string | null;
  locale: string;
}

interface StoredAttempt {
  key: string;
  salt: string;
  requestHash: string;
}

function parse(text: string | null): StoredAttempt | null {
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
  const { key, salt, requestHash } = record;
  return typeof key === "string" && typeof salt === "string" && typeof requestHash === "string"
    ? { key, salt, requestHash }
    : null;
}

export interface PaymentAttemptManager {
  /** The key for this request: the kept one when the request is the same, else a new one (which is kept). */
  keyFor(identity: PaymentRequestIdentity): Promise<string>;
  /** Forget the attempt (the API answered definitively). */
  clear(): void;
  /** False once the attempt could not be written to `sessionStorage` (a reload would lose it). */
  isPersistent(): boolean;
}

export function createPaymentAttemptManager(options: {
  storage: AttemptStorage | null;
  crypto: AttemptCrypto;
}): PaymentAttemptManager {
  const { crypto } = options;
  let storage = options.storage;
  let memory: StoredAttempt | null = null;

  const hashOf = (identity: PaymentRequestIdentity, salt: string): Promise<string> =>
    crypto.sha256Hex(`${salt}\n${canonicalJson({ payment: identity })}`);

  function read(): StoredAttempt | null {
    if (storage === null) return memory;
    try {
      return parse(storage.getItem(PAYMENT_ATTEMPT_STORAGE_KEY)) ?? memory;
    } catch {
      storage = null;
      return memory;
    }
  }

  function write(attempt: StoredAttempt | null): void {
    memory = attempt;
    if (storage === null) return;
    try {
      if (attempt === null) storage.removeItem(PAYMENT_ATTEMPT_STORAGE_KEY);
      else storage.setItem(PAYMENT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
    } catch {
      // From now on the attempt lives in memory only; `isPersistent()` tells the page.
      storage = null;
    }
  }

  return {
    async keyFor(identity) {
      const kept = read();
      if (kept !== null && kept.requestHash === (await hashOf(identity, kept.salt))) {
        return kept.key;
      }
      const salt = crypto.randomUUID();
      const attempt = { key: crypto.randomUUID(), salt, requestHash: await hashOf(identity, salt) };
      write(attempt);
      return attempt.key;
    },
    clear() {
      write(null);
    },
    isPersistent: () => storage !== null,
  };
}
