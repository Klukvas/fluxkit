import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPaymentProviderContract, type ManagedProviderContext } from "@fluxkit/core";
import * as managed from "./index.js";
import { aborted, createInput, live, NOW, PAYMENT_ID, REFUND_ID } from "./test-support/fixtures.js";
import {
  startStubLiqPay,
  STUB_PUBLIC_KEY,
  STUB_PRIVATE_KEY,
  type StubLiqPay,
} from "./test-support/stub-liqpay.js";

const secrets = { public_key: STUB_PUBLIC_KEY, private_key: STUB_PRIVATE_KEY };
function context(deny = false): ManagedProviderContext {
  return {
    kind: "payment",
    providerCode: "liqpay",
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

describe("managed LiqPay", () => {
  let stub: StubLiqPay;
  beforeEach(async () => {
    stub = await startStubLiqPay();
    const guardedFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://www.liqpay.ua") throw new Error("unexpected origin");
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
    stub.register(otherPaymentId, 125_000);
    stub.register(PAYMENT_ID, 125_000);
    const paidId = otherPaymentId;
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

  it("locates bounded order hints without treating a signature as verified", () => {
    const input = {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      rawBody: Buffer.from(
        new URLSearchParams({
          data: Buffer.from(JSON.stringify({ order_id: PAYMENT_ID })).toString("base64"),
        }).toString(),
      ),
    };
    expect(managed.locateWebhook(input)).toEqual({
      providerPaymentId: PAYMENT_ID,
      reference: PAYMENT_ID,
    });
    expect(managed.locateWebhook({ ...input, rawBody: Buffer.from("data=%ZZ") })).toBeNull();
    expect(managed.locateWebhook({ ...input, rawBody: Buffer.alloc(65537, 32) })).toBeNull();
    expect(managed.locateWebhook({ ...input, rawBody: Buffer.from("data=e30=") })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses local create, handoff and signature work after revocation", async () => {
    const provider = managed.createOutboundClient(secrets, context(true));
    for (const operation of [
      () => provider.createPayment(createInput(), live()),
      () => provider.buildCheckoutHandoff(createInput(), live()),
      () => provider.verifyWebhook({ headers: {}, rawBody: new Uint8Array() }, live()),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: "CredentialAdmissionDenied",
        code: "credential_revoked",
      });
    }
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
    stub.register(PAYMENT_ID, 125_000);
    expect(await provider.getPayment(PAYMENT_ID, live())).toMatchObject({ ok: true });
    stub.pay(PAYMENT_ID);
    expect(
      await provider.refund(
        {
          providerPaymentId: PAYMENT_ID,
          refundId: REFUND_ID,
          amount: { amount: 100, currency: "UAH" },
          full: false,
        },
        live(),
      ),
    ).toMatchObject({ ok: true });
    expect(paths).toEqual(["/api/request", "/api/request"]);
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
