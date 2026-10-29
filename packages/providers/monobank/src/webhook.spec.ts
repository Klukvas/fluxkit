import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult } from "@fluxkit/core";
import {
  KEY_REFETCH_INTERVAL_MS,
  publicKeyOf,
  signatureOf,
  signatureVerifies,
} from "./signature.js";
import {
  DOCUMENTED_BODY,
  DOCUMENTED_PUBKEY_BASE64,
  DOCUMENTED_X_SIGN,
} from "./test-support/documented-example.js";
import {
  createdInvoice,
  live,
  PAYMENT_ID,
  providerOn,
  TestClock,
} from "./test-support/fixtures.js";
import { startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/*
 * Webhook verification (ADR 0032 decisions 12 and 14; M8, M12): `X-Sign` over the exact raw bytes with the key of
 * `GET /api/merchant/pubkey` only, verified BEFORE anything is parsed; the key cached per process and refetched only
 * after a failed verification, at most once per 60 s.
 */

const encode = (text: string) => new TextEncoder().encode(text);

function outcome(result: PaymentProviderResult<unknown>): unknown {
  return result.ok ? "ok" : { reason: result.reason, codes: result.providerCodes };
}

const pubkeyCalls = (stub: StubMonobank) =>
  stub.requests.filter((request) => request.path === "/api/merchant/pubkey").length;

describe("the documented example (M12) as a fixed vector", () => {
  it("verifies with node:crypto; a one-character change to the body or the signature fails", () => {
    const key = publicKeyOf({ key: DOCUMENTED_PUBKEY_BASE64 });
    expect(key).toBeDefined();
    if (key === undefined) return;
    const signature = signatureOf(DOCUMENTED_X_SIGN);
    expect(signature).toBeDefined();
    if (signature === undefined) return;
    expect(signatureVerifies(key, encode(DOCUMENTED_BODY), signature)).toBe(true);
    expect(signatureVerifies(key, encode(DOCUMENTED_BODY.replace("4200", "4201")), signature)).toBe(
      false,
    );
    expect(
      signatureVerifies(key, encode(DOCUMENTED_BODY.replace('"created"', '"success"')), signature),
    ).toBe(false);
    expect(signatureVerifies(key, encode(`${DOCUMENTED_BODY}\n`), signature)).toBe(false);
    // The parsed and re-serialized JSON is NOT what was signed: only the raw bytes verify.
    expect(
      signatureVerifies(key, encode(JSON.stringify(JSON.parse(DOCUMENTED_BODY))), signature),
    ).toBe(false);
    const changed = Buffer.from(signature);
    changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 0x01;
    expect(signatureVerifies(key, encode(DOCUMENTED_BODY), changed)).toBe(false);
  });

  it("goes through verifyWebhook end to end when Monobank serves the documented key", async () => {
    const stub = await startStubMonobank();
    try {
      stub.override((request) =>
        request.path === "/api/merchant/pubkey"
          ? { status: 200, json: { key: DOCUMENTED_PUBKEY_BASE64 } }
          : undefined,
      );
      const { provider } = providerOn(stub);
      const result = await provider.verifyWebhook(
        { headers: { "x-sign": DOCUMENTED_X_SIGN }, rawBody: encode(DOCUMENTED_BODY) },
        live(),
      );
      expect(result.ok && result.value).toEqual({
        providerPaymentId: "p2_9ZgpZVsl3",
        reference: "84d0070ee4e44667b31371d8f8813947",
        status: "created",
        providerStatus: "created",
        amount: { amount: 4200, currency: "UAH" },
        finalAmount: { amount: 4200, currency: "UAH" },
        modifiedAt: new Date("2019-08-24T14:15:22Z"),
        failureCode: null,
        refunds: [
          {
            refundId: "635ace02599849e981b2cd7a65f417fe",
            status: "processing",
            amount: { amount: 4200, currency: "UAH" },
            modifiedAt: new Date("2019-08-24T14:15:22Z"),
          },
        ],
        card: null,
      });
      const tampered = await provider.verifyWebhook(
        {
          headers: { "x-sign": DOCUMENTED_X_SIGN },
          rawBody: encode(DOCUMENTED_BODY.replace("4200", "4201")),
        },
        live(),
      );
      expect(outcome(tampered)).toEqual({
        reason: "invalid_signature",
        codes: ["signature_mismatch"],
      });
    } finally {
      await stub.close();
    }
  });
});

describe("verifyWebhook", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("returns the fact of a correctly signed webhook, after one key fetch, then from the cache", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    stub.pay(invoiceId);
    const first = await provider.verifyWebhook(stub.webhookFor(invoiceId), live());
    expect(first.ok && [first.value.status, first.value.reference, first.value.card]).toEqual([
      "succeeded",
      PAYMENT_ID,
      { system: "visa", last4: "1902" },
    ]);
    await provider.verifyWebhook(stub.webhookFor(invoiceId), live());
    expect(pubkeyCalls(stub)).toBe(1);
    const keyRequest = stub.requests.find((request) => request.path === "/api/merchant/pubkey");
    expect(keyRequest?.method).toBe("GET");
    expect(keyRequest?.headers["x-token"]).toBeDefined();
  });

  it("refuses a changed body, a missing, empty or malformed signature, without trusting anything in the request", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    const webhook = stub.webhookFor(invoiceId);
    const tampered = Uint8Array.from(webhook.rawBody);
    tampered[10] = (tampered[10] as number) ^ 0x01;
    expect(
      outcome(
        await provider.verifyWebhook({ headers: webhook.headers, rawBody: tampered }, live()),
      ),
    ).toEqual({
      reason: "invalid_signature",
      codes: ["signature_mismatch"],
    });
    const before = stub.requests.length;
    const malformed: Record<string, string>[] = [
      {},
      { "x-sign": "" },
      { "x-sign": "   " },
      { "x-sign": "not base64!!" },
      { "x-sign": "QUJD" }, // valid base64, too short for a DER signature
      { "x-sign": Buffer.from("x".repeat(70)).toString("base64") }, // not a DER SEQUENCE
      { "x-sign": "A".repeat(400) },
      { "X-Sign": webhook.headers["x-sign"] as string }, // names arrive lower-case; any other spelling is not read
      { "x-signature": webhook.headers["x-sign"] as string },
    ];
    for (const headers of malformed) {
      expect(
        outcome(await provider.verifyWebhook({ headers, rawBody: webhook.rawBody }, live())),
        JSON.stringify(headers).slice(0, 60),
      ).toEqual({ reason: "invalid_signature", codes: ["malformed_signature"] });
    }
    // None of them made the plugin call Monobank.
    expect(stub.requests.length).toBe(before);
  });

  it("refuses an empty or oversized body before any key fetch", async () => {
    const { provider } = providerOn(stub);
    const signature = stub.sign(encode("{}"));
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": signature }, rawBody: new Uint8Array() },
          live(),
        ),
      ),
    ).toEqual({
      reason: "invalid_signature",
      codes: ["empty_body"],
    });
    const huge = encode(`{"pad":"${"x".repeat(64 * 1024)}"}`);
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": stub.sign(huge) }, rawBody: huge },
          live(),
        ),
      ),
    ).toEqual({ reason: "invalid_signature", codes: ["body_too_large"] });
    expect(stub.requests).toHaveLength(0);
  });

  it("never takes a key from the webhook itself", async () => {
    const { provider } = providerOn(stub);
    const attacker = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = encode(
      JSON.stringify({ ...stub.statusJson(await createdInvoice(provider)), status: "success" }),
    );
    const forged = sign("sha256", body, { key: attacker.privateKey, dsaEncoding: "der" }).toString(
      "base64",
    );
    const pem = attacker.publicKey.export({ type: "spki", format: "pem" }).toString();
    const result = await provider.verifyWebhook(
      {
        headers: {
          "x-sign": forged,
          "x-key": Buffer.from(pem).toString("base64"),
          "x-pubkey": pem,
          key: Buffer.from(pem).toString("base64"),
        },
        rawBody: body,
      },
      live(),
    );
    expect(outcome(result)).toEqual({ reason: "invalid_signature", codes: ["signature_mismatch"] });
  });

  it("verifies the signature before it parses anything", async () => {
    const { provider } = providerOn(stub);
    const notJson = encode("this is not json");
    // Unsigned garbage: invalid signature, never "unreadable".
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": DOCUMENTED_X_SIGN }, rawBody: notJson },
          live(),
        ),
      ),
    ).toEqual({ reason: "invalid_signature", codes: ["signature_mismatch"] });
    // Signed, but not a status object: the signature holds, the body cannot be read.
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": stub.sign(notJson) }, rawBody: notJson },
          live(),
        ),
      ),
    ).toEqual({ reason: "unavailable", codes: ["malformed_answer", "webhook"] });
    const latin1 = Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": stub.sign(latin1) }, rawBody: latin1 },
          live(),
        ),
      ),
    ).toEqual({ reason: "unavailable", codes: ["malformed_answer", "webhook"] });
  });

  it("follows a key rotation: one refetch after a failed verification", async () => {
    const clock = new TestClock();
    const { provider } = providerOn(stub, { clock });
    const invoiceId = await createdInvoice(provider);
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
    clock.advance(KEY_REFETCH_INTERVAL_MS);
    stub.rotateKey();
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
    expect(pubkeyCalls(stub)).toBe(2);
    // The new key is cached: no further fetch.
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
    expect(pubkeyCalls(stub)).toBe(2);
  });

  it("refetches at most once per 60 s, so forged webhooks cannot make the shop call Monobank per request", async () => {
    const clock = new TestClock();
    const { provider } = providerOn(stub, { clock });
    const invoiceId = await createdInvoice(provider);
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
    expect(pubkeyCalls(stub)).toBe(1);
    const attacker = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = stub.webhookFor(invoiceId).rawBody;
    const forged = {
      headers: {
        "x-sign": sign("sha256", body, { key: attacker.privateKey, dsaEncoding: "der" }).toString(
          "base64",
        ),
      },
      rawBody: body,
    };
    // The first fetch was just now: no refetch within the interval.
    for (let index = 0; index < 20; index += 1) {
      expect(outcome(await provider.verifyWebhook(forged, live()))).toEqual({
        reason: "invalid_signature",
        codes: ["signature_mismatch"],
      });
    }
    expect(pubkeyCalls(stub)).toBe(1);
    clock.advance(KEY_REFETCH_INTERVAL_MS - 1);
    await provider.verifyWebhook(forged, live());
    expect(pubkeyCalls(stub)).toBe(1);
    clock.advance(1);
    await provider.verifyWebhook(forged, live());
    expect(pubkeyCalls(stub)).toBe(2);
    for (let index = 0; index < 20; index += 1) {
      await provider.verifyWebhook(forged, live());
    }
    expect(pubkeyCalls(stub)).toBe(2);
    // A genuine webhook still verifies with the cached key.
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
  });

  it("shares one key fetch between concurrent webhooks", async () => {
    const { provider } = providerOn(stub);
    const invoiceId = await createdInvoice(provider);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => provider.verifyWebhook(stub.webhookFor(invoiceId), live())),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(pubkeyCalls(stub)).toBe(1);
  });

  it("answers unavailable when the key cannot be fetched, and throttles fetches after a failure", async () => {
    const clock = new TestClock();
    const { provider } = providerOn(stub, { clock });
    const invoiceId = await createdInvoice(provider);
    stub.override((request) =>
      request.path === "/api/merchant/pubkey"
        ? { status: 503, body: "down", headers: { "content-type": "text/plain" } }
        : undefined,
    );
    expect(outcome(await provider.verifyWebhook(stub.webhookFor(invoiceId), live()))).toEqual({
      reason: "unavailable",
      codes: ["503"],
    });
    expect(outcome(await provider.verifyWebhook(stub.webhookFor(invoiceId), live()))).toEqual({
      reason: "unavailable",
      codes: ["key_unavailable"],
    });
    expect(pubkeyCalls(stub)).toBe(1);
    stub.override(undefined);
    clock.advance(KEY_REFETCH_INTERVAL_MS);
    expect((await provider.verifyWebhook(stub.webhookFor(invoiceId), live())).ok).toBe(true);
    expect(pubkeyCalls(stub)).toBe(2);
  });

  it("uses only an EC P-256 key (decision 14) and never caches another", async () => {
    const clock = new TestClock();
    const { provider } = providerOn(stub, { clock });
    const invoiceId = await createdInvoice(provider);
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey;
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
    const keys = [
      {
        key: Buffer.from(p384.export({ type: "spki", format: "pem" }).toString()).toString(
          "base64",
        ),
      },
      {
        key: Buffer.from(rsa.export({ type: "spki", format: "pem" }).toString()).toString("base64"),
      },
      { key: "not base64 at all ***" },
      {
        key: Buffer.from(
          "-----BEGIN PUBLIC KEY-----\ngarbage\n-----END PUBLIC KEY-----\n",
        ).toString("base64"),
      },
      { key: "" },
      {},
    ];
    for (const json of keys) {
      stub.override((request) =>
        request.path === "/api/merchant/pubkey" ? { status: 200, json } : undefined,
      );
      clock.advance(KEY_REFETCH_INTERVAL_MS);
      expect(
        outcome(await provider.verifyWebhook(stub.webhookFor(invoiceId), live())),
        JSON.stringify(json).slice(0, 40),
      ).toEqual({
        reason: "unavailable",
        codes: ["invalid_key", "200"],
      });
    }
    expect(
      publicKeyOf({ key: DOCUMENTED_PUBKEY_BASE64 })?.equals(
        createPublicKey(Buffer.from(DOCUMENTED_PUBKEY_BASE64, "base64").toString()),
      ),
    ).toBe(true);
  });

  it("answers not_sent with an aborted signal and sends nothing", async () => {
    const { provider } = providerOn(stub);
    const controller = new AbortController();
    controller.abort();
    expect(
      outcome(
        await provider.verifyWebhook(
          { headers: { "x-sign": DOCUMENTED_X_SIGN }, rawBody: encode(DOCUMENTED_BODY) },
          controller.signal,
        ),
      ),
    ).toEqual({ reason: "not_sent", codes: ["aborted"] });
    expect(stub.requests).toHaveLength(0);
  });
});
