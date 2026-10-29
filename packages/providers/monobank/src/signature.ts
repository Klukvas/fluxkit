import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { paymentProviderFailure, type PaymentProviderFailure } from "@fluxkit/core";

/*
 * Webhook signatures (ADR 0032 decisions 12 and 14; M12). Monobank signs the RAW body of every webhook: `X-Sign` is the
 * base64 of a DER ECDSA signature over SHA-256 of the exact bytes, verifiable with the public key of
 * `GET /api/merchant/pubkey` (`{key}` = base64 of a PEM X.509 public key; the documented example is P-256). The key:
 * - comes ONLY from that route, called with the shop's token; nothing in a webhook can name, carry or replace it;
 * - is checked to be an EC P-256 key before use, and kept in memory per process;
 * - is refetched only after a verification with the cached key failed, and at most once per `KEY_REFETCH_INTERVAL_MS`
 *   per process (Monobank: "cache the key and fetch a new one when verification stops working"), so a flood of forged
 *   webhooks cannot make the shop call Monobank per request. A failed fetch is throttled the same way.
 */

/** Smallest time between two key fetches after the first one (ADR 0032 decision 14: "at most once per 60 s"). */
export const KEY_REFETCH_INTERVAL_MS = 60_000;

/** The webhook header (M8, M12); header names arrive lower-case. */
export const MONOBANK_SIGNATURE_HEADER = "x-sign";

/** A DER ECDSA P-256 signature is at most 72 bytes; its base64 at most 96 characters. Anything far longer is refused. */
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{8,192}={0,2}$/;

const pubkeySchema = z.looseObject({ key: z.string().min(1).max(8192) });

/** The signature bytes of a header value, or `undefined` when it cannot be a base64 DER signature. */
export function signatureOf(header: string | undefined): Uint8Array | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = header.trim();
  if (!SIGNATURE_BASE64.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const bytes = Buffer.from(value, "base64");
  // A DER signature starts with a SEQUENCE tag; shorter than 8 bytes it cannot hold two integers.
  return bytes.byteLength >= 8 && bytes.byteLength <= 144 && bytes[0] === 0x30 ? bytes : undefined;
}

/** The P-256 public key of a `GET /api/merchant/pubkey` answer, or `undefined` when it is not one. */
export function publicKeyOf(json: unknown): KeyObject | undefined {
  const parsed = pubkeySchema.safeParse(json);
  if (!parsed.success || !/^[A-Za-z0-9+/=\s]+$/.test(parsed.data.key)) {
    return undefined;
  }
  const pem = Buffer.from(parsed.data.key, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN PUBLIC KEY-----")) {
    return undefined;
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: pem, format: "pem" });
  } catch {
    // Not a parsable public key: refused as a malformed answer by the caller.
    return undefined;
  }
  return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
    ? key
    : undefined;
}

/** Whether `signature` is a valid DER ECDSA-SHA256 signature of `body` under `key`. Never throws. */
export function signatureVerifies(
  key: KeyObject,
  body: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return verify("sha256", body, { key, dsaEncoding: "der" }, signature);
  } catch {
    // A signature that is not valid DER for this key cannot verify; that is the answer, not an error.
    return false;
  }
}

export type KeyLoad = { readonly ok: true; readonly key: KeyObject } | PaymentProviderFailure;

export type Verification =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid" }
  /** The key could not be read (Monobank unreachable, an unreadable key): the caller answers this failure. */
  | { readonly kind: "unavailable"; readonly failure: PaymentProviderFailure };

/**
 * The per-process key cache; `nowMs` is the clock. Each verification passes `load`, which fetches the key (the
 * provider's `GET /api/merchant/pubkey` under that webhook's signal); concurrent verifications share one fetch.
 */
export class MonobankKeyCache {
  private current: KeyObject | undefined;
  private lastFetchAt: number | undefined;
  private inFlight: Promise<KeyLoad> | undefined;

  constructor(private readonly nowMs: () => number) {}

  /** Whether a fetch may start now: never one before, or the last one started at least the interval ago. */
  private mayFetch(): boolean {
    return (
      this.lastFetchAt === undefined || this.nowMs() - this.lastFetchAt >= KEY_REFETCH_INTERVAL_MS
    );
  }

  private fetchKey(load: () => Promise<KeyLoad>): Promise<KeyLoad> {
    if (this.inFlight === undefined) {
      this.lastFetchAt = this.nowMs();
      this.inFlight = load().then((result) => {
        this.inFlight = undefined;
        if (result.ok) {
          this.current = result.key;
        }
        return result;
      });
    }
    return this.inFlight;
  }

  /**
   * Verifies `signature` over `body`. With no cached key it fetches one (unless the last fetch failed within the
   * interval). When the cached key does not verify, it refetches once if the interval allows and tries the new key if it
   * differs; otherwise the signature is invalid.
   */
  async verify(
    body: Uint8Array,
    signature: Uint8Array,
    load: () => Promise<KeyLoad>,
  ): Promise<Verification> {
    let key = this.current;
    let fresh = false;
    if (key === undefined) {
      if (this.inFlight === undefined && !this.mayFetch()) {
        return {
          kind: "unavailable",
          failure: paymentProviderFailure("unavailable", { providerCodes: ["key_unavailable"] }),
        };
      }
      const loaded = await this.fetchKey(load);
      if (!loaded.ok) {
        return { kind: "unavailable", failure: loaded };
      }
      key = loaded.key;
      fresh = true;
    }
    if (signatureVerifies(key, body, signature)) {
      return { kind: "valid" };
    }
    if (fresh || (this.inFlight === undefined && !this.mayFetch())) {
      return { kind: "invalid" };
    }
    const reloaded = await this.fetchKey(load);
    if (!reloaded.ok) {
      return { kind: "unavailable", failure: reloaded };
    }
    const next = reloaded.key;
    if (next.equals(key)) {
      return { kind: "invalid" };
    }
    return signatureVerifies(next, body, signature) ? { kind: "valid" } : { kind: "invalid" };
  }
}
