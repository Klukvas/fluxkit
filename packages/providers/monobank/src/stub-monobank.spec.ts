import { verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STUB_TOKEN, startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/** The stub itself is strict where the plugin's specs rely on it (a lenient stub would hide a sloppy request). */
describe("the stub Monobank", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  const post = (path: string, body: unknown, token: string | null = STUB_TOKEN) =>
    fetch(`${stub.origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { "x-token": token }),
      },
      body: JSON.stringify(body),
    });

  it("refuses a missing token (400), a wrong one (403), a wrong method (405) and unknown create members", async () => {
    expect((await post("/api/merchant/invoice/create", { amount: 1 }, null)).status).toBe(400);
    expect((await post("/api/merchant/invoice/create", { amount: 1 }, "wrong")).status).toBe(403);
    expect(
      (
        await fetch(`${stub.origin}/api/merchant/invoice/create`, {
          headers: { "x-token": STUB_TOKEN },
        })
      ).status,
    ).toBe(405);
    const unknown = await post("/api/merchant/invoice/create", { amount: 1, comment: "x" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      errCode: "BAD_REQUEST",
      errText: "unknown field 'comment'",
    });
    expect((await post("/api/merchant/invoice/create", { amount: 1, ccy: 840 })).status).toBe(400);
  });

  it("is not idempotent on create and does not deduplicate extRef on cancel (the stricter readings of M5 and M13)", async () => {
    const first = (await (await post("/api/merchant/invoice/create", { amount: 1000 })).json()) as {
      invoiceId: string;
    };
    const second = (await (
      await post("/api/merchant/invoice/create", { amount: 1000 })
    ).json()) as { invoiceId: string };
    expect(first.invoiceId).not.toBe(second.invoiceId);
    stub.pay(first.invoiceId);
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await post("/api/merchant/invoice/cancel", {
            invoiceId: first.invoiceId,
            extRef: "r1",
            amount: 100,
          })
        ).status,
      ).toBe(200);
    }
    expect(stub.invoices.get(first.invoiceId)?.cancelList).toHaveLength(2);
  });

  it("signs webhooks over the raw body with the key it serves", async () => {
    const created = (await (
      await post("/api/merchant/invoice/create", { amount: 1000 })
    ).json()) as { invoiceId: string };
    const webhook = stub.webhookFor(created.invoiceId);
    const signature = Buffer.from(webhook.headers["x-sign"] as string, "base64");
    expect(
      verify("sha256", webhook.rawBody, { key: stub.publicKey, dsaEncoding: "der" }, signature),
    ).toBe(true);
    const served = (await (
      await fetch(`${stub.origin}/api/merchant/pubkey`, { headers: { "x-token": STUB_TOKEN } })
    ).json()) as { key: string };
    expect(Buffer.from(served.key, "base64").toString()).toContain("-----BEGIN PUBLIC KEY-----");
  });
});
