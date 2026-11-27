import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPaymentProviderContract, type ManagedProviderContext } from "@fluxkit/core";
import * as managed from "./index.js";
import { aborted, createInput, live, NOW, PAYMENT_ID, REFUND_ID } from "./test-support/fixtures.js";
import { startStubMonobank, STUB_TOKEN, type StubMonobank } from "./test-support/stub-monobank.js";

const secrets = { token: STUB_TOKEN };
function context(deny = false): ManagedProviderContext {
  return {
    kind: "payment",
    providerCode: "monobank",
    versionId: "test-version",
    environment: "default",
    now: () => NOW,
    transport: {
      start: async (_signal, begin) => {
        if (deny)
          throw Object.assign(new Error("credential_revoked"), {
            name: "CredentialAdmissionDenied",
            code: "credential_revoked",
          });
        return begin().completion;
      },
    },
  };
}

describe("managed Monobank", () => {
  let stub: StubMonobank;
  beforeEach(async () => {
    stub = await startStubMonobank();
    const guardedFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://api.monobank.ua") throw new Error("unexpected origin");
      return guardedFetch(new URL(url.pathname + url.search, stub.origin), init);
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await stub.close();
  });

  it("satisfies the existing payment contract with the saved bundle", async () => {
    const provider = managed.createOutboundClient(secrets, context());
    const otherPaymentId = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    const made = await provider.createPayment(createInput({ paymentId: otherPaymentId }), live());
    if (!made.ok) throw new Error("create refused");
    const paidId = made.value.providerPaymentId;
    stub.pay(paidId);
    expect(
      await checkPaymentProviderContract(provider, {
        create: createInput(),
        succeededPayment: {
          providerPaymentId: paidId,
          reference: otherPaymentId,
          amount: { amount: 125_000, currency: "UAH" },
        },
        unknownProviderPaymentId: "p2_unknown000",
        webhookFor: (id) => stub.webhookFor(id),
        liveSignal: live,
        abortedSignal: aborted,
      }),
    ).toEqual([]);
  });

  it("clears a denied key load so a later admitted verification can retry", async () => {
    const base = context();
    let admissions = 0;
    let denyKey = true;
    const transport: ManagedProviderContext["transport"] = {
      start: async (_signal, begin) => {
        admissions += 1;
        if (denyKey && admissions === 3)
          throw Object.assign(new Error("credential_unavailable"), {
            name: "CredentialAdmissionDenied",
            code: "credential_unavailable",
          });
        return begin().completion;
      },
    };
    const provider = managed.createOutboundClient(secrets, { ...base, transport });
    const made = await provider.createPayment(createInput(), live());
    if (!made.ok) throw new Error("create refused");
    const webhook = stub.webhookFor(made.value.providerPaymentId);
    await expect(provider.verifyWebhook(webhook, live())).rejects.toMatchObject({
      code: "credential_unavailable",
    });
    denyKey = false;
    expect(await provider.verifyWebhook(webhook, live())).toMatchObject({ ok: true });
  });

  it("isolates verifier keys per client and refuses a revoked warm client", async () => {
    const base = context();
    let revoked = false;
    const first = managed.createOutboundClient(secrets, {
      ...base,
      transport: {
        start: async (_signal, begin) => {
          if (revoked)
            throw Object.assign(new Error("credential_revoked"), {
              name: "CredentialAdmissionDenied",
              code: "credential_revoked",
            });
          return begin().completion;
        },
      },
    });
    const made = await first.createPayment(createInput(), live());
    if (!made.ok) throw new Error("create refused");
    const oldWebhook = stub.webhookFor(made.value.providerPaymentId);
    expect(await first.verifyWebhook(oldWebhook, live())).toMatchObject({ ok: true });
    stub.rotateKey();
    const second = managed.createOutboundClient(secrets, { ...base, versionId: "second-version" });
    const newWebhook = stub.webhookFor(made.value.providerPaymentId);
    expect(await second.verifyWebhook(newWebhook, live())).toMatchObject({ ok: true });
    expect(await first.verifyWebhook(oldWebhook, live())).toMatchObject({ ok: true });
    expect(await first.verifyWebhook(newWebhook, live())).toMatchObject({
      ok: false,
      reason: "invalid_signature",
    });
    expect(await second.verifyWebhook(oldWebhook, live())).toMatchObject({
      ok: false,
      reason: "invalid_signature",
    });
    expect(stub.requests.filter(({ path }) => path === "/api/merchant/pubkey")).toHaveLength(2);
    revoked = true;
    const requests = stub.requests.length;
    await expect(first.verifyWebhook(oldWebhook, live())).rejects.toMatchObject({
      code: "credential_revoked",
    });
    expect(stub.requests).toHaveLength(requests);
  });

  it.each([
    [403, {}, undefined, { code: "invalid_credentials" }],
    [429, { errText: "must never escape" }, "7", { code: "rate_limited", retryAfterSeconds: 7 }],
    [429, {}, "86401", { code: "rate_limited" }],
    [500, { errText: "must never escape" }, undefined, { code: "unavailable" }],
    [200, { merchantId: "x".repeat(257) }, undefined, { code: "unavailable" }],
  ])(
    "maps merchant check status %s to a safe bounded code",
    async (status, json, retryAfter, expected) => {
      stub.override(() => ({
        status,
        json,
        ...(retryAfter === undefined ? {} : { headers: { "retry-after": retryAfter } }),
      }));
      expect(await managed.checkCredentials(secrets, context(), live())).toEqual(expected);
    },
  );

  it("starts merchant transport synchronously inside the admission thunk", async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const transport: ManagedProviderContext["transport"] = {
      start: async (_signal, begin) => {
        const before = fetchSpy.mock.calls.length;
        const started = begin();
        expect(fetchSpy.mock.calls.length).toBe(before + 1);
        return started.completion;
      },
    };
    stub.override(() => ({ status: 200, json: { merchantId: "12o4Vv7EWy" } }));
    expect(await managed.checkCredentials(secrets, { ...context(), transport }, live())).toEqual({
      code: "ok",
    });
  });

  it("reads merchantId only from gated GET merchant details", async () => {
    stub.override((request) =>
      request.path === "/api/merchant/details"
        ? {
            status: 200,
            json: { merchantId: "12o4Vv7EWy", merchantName: "ignored", edrpou: "ignored" },
          }
        : undefined,
    );
    expect(await managed.accountIdentity(secrets, context(), live())).toEqual({
      ok: true,
      identity: "12o4Vv7EWy",
    });
    expect(await managed.checkCredentials(secrets, context(), live())).toEqual({ code: "ok" });
    expect(stub.requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/api/merchant/details" },
      { method: "GET", path: "/api/merchant/details" },
    ]);
    stub.override(() => ({
      status: 200,
      json: { merchantName: "no identity", edrpou: "12345678" },
    }));
    expect(await managed.accountIdentity(secrets, context(), live())).toEqual({
      ok: false,
      code: "unavailable",
    });
  });

  it("locates bounded hints without verifying or requiring payment facts", () => {
    const input = {
      headers: {},
      rawBody: Buffer.from(JSON.stringify({ invoiceId: "p2_test", reference: PAYMENT_ID })),
    };
    expect(managed.locateWebhook(input)).toEqual({
      providerPaymentId: "p2_test",
      reference: PAYMENT_ID,
    });
    expect(managed.locateWebhook({ ...input, rawBody: Buffer.from("{") })).toBeNull();
    expect(managed.locateWebhook({ ...input, rawBody: Buffer.alloc(65537, 32) })).toBeNull();
    expect(
      managed.locateWebhook({
        ...input,
        rawBody: Buffer.from(
          JSON.stringify({ invoiceId: "x".repeat(65), reference: "invalid reference" }),
        ),
      }),
    ).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("starts every HTTP operation inside the synchronous admission thunk", async () => {
    let admitted = false;
    const paths: string[] = [];
    const fetchSpy = vi.mocked(globalThis.fetch);
    const request = fetchSpy.getMockImplementation();
    if (request === undefined) throw new Error("fetch boundary missing");
    fetchSpy.mockImplementation((input, init) => {
      expect(admitted).toBe(true);
      paths.push(new URL(String(input)).pathname);
      return request(input, init);
    });
    const transport: ManagedProviderContext["transport"] = {
      start: async (_signal, begin) => {
        const wasAdmitted = admitted;
        admitted = true;
        try {
          return begin().completion;
        } finally {
          admitted = wasAdmitted;
        }
      },
    };
    const provider = managed.createOutboundClient(secrets, { ...context(), transport });
    const made = await provider.createPayment(createInput(), live());
    if (!made.ok) throw new Error("create refused");
    const id = made.value.providerPaymentId;
    expect(await provider.getPayment(id, live())).toMatchObject({ ok: true });
    expect(await provider.verifyWebhook(stub.webhookFor(id), live())).toMatchObject({ ok: true });
    stub.pay(id);
    expect(
      await provider.refund(
        {
          providerPaymentId: id,
          refundId: REFUND_ID,
          amount: { amount: 100, currency: "UAH" },
          full: false,
        },
        live(),
      ),
    ).toMatchObject({ ok: true });
    const second = await provider.createPayment(createInput({ paymentId: REFUND_ID }), live());
    if (!second.ok) throw new Error("create refused");
    expect(await provider.invalidatePayment(second.value.providerPaymentId, live())).toMatchObject({
      ok: true,
    });
    expect(new Set(paths)).toEqual(
      new Set([
        "/api/merchant/invoice/create",
        "/api/merchant/invoice/status",
        "/api/merchant/invoice/cancel",
        "/api/merchant/invoice/remove",
        "/api/merchant/pubkey",
      ]),
    );
  });

  it("preserves gate denial and starts zero HTTP requests", async () => {
    const provider = managed.createOutboundClient(secrets, context(true));
    await expect(provider.getPayment(PAYMENT_ID, live())).rejects.toMatchObject({
      name: "CredentialAdmissionDenied",
      code: "credential_revoked",
    });
    await expect(
      provider.refund(
        {
          providerPaymentId: PAYMENT_ID,
          refundId: REFUND_ID,
          amount: { amount: 100, currency: "UAH" },
          full: false,
        },
        live(),
      ),
    ).rejects.toMatchObject({ code: "credential_revoked" });
    await expect(provider.createPayment(createInput(), live())).rejects.toMatchObject({
      code: "credential_revoked",
    });
    await expect(provider.invalidatePayment(PAYMENT_ID, live())).rejects.toMatchObject({
      code: "credential_revoked",
    });
    await expect(managed.accountIdentity(secrets, context(true), live())).rejects.toMatchObject({
      code: "credential_revoked",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
