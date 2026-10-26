import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import { startStubResend, type StubResend } from "./test-support/stub-resend.js";

/*
 * Idempotency as the stub models Resend (R4): one key, the same body -> the first answer again (no second mail); the same
 * key with another body -> `409 invalid_idempotent_request`; the same key while the first request is in flight -> `409
 * concurrent_idempotent_requests`. The plugin never repeats a request on its own: a retry is the outbox's decision and
 * carries the same key.
 */
describe("idempotency", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("replays the first answer for the same key and body: one accepted mail", async () => {
    const { provider } = providerOn(stub);
    const first = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    const again = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(first).toEqual(again);
    expect(first.ok).toBe(true);
    expect(stub.requests).toHaveLength(2);
    expect(stub.accepted).toHaveLength(1);
  });

  it("answers idempotency_conflict when the key comes back with another body", async () => {
    const { provider } = providerOn(stub);
    await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    const changed = await provider.send(
      message({ subject: "Another subject" }),
      { idempotencyKey: MESSAGE_ID },
      live(),
    );
    expect(changed).toEqual({
      ok: false,
      reason: "idempotency_conflict",
      providerCodes: ["invalid_idempotent_request", "409"],
    });
    expect(stub.accepted).toHaveLength(1);
  });

  it("answers unavailable (retry with the same key) while the first request is in flight", async () => {
    stub.setLatency(300);
    const { provider } = providerOn(stub);
    const first = provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const concurrent = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(concurrent).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["concurrent_idempotent_requests", "409"],
    });
    expect((await first).ok).toBe(true);
    // The retry the outbox would make later gets the first answer.
    const retry = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(retry).toEqual(await first);
    expect(stub.accepted).toHaveLength(1);
  });

  it("keeps two messages apart by their keys", async () => {
    const { provider } = providerOn(stub);
    const a = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    const b = await provider.send(
      message(),
      { idempotencyKey: "0b7a6c51-2d1e-4f3a-9b8c-7d6e5f4a3b2c" },
      live(),
    );
    expect(a.ok && b.ok && a.value.providerMessageId !== b.value.providerMessageId).toBe(true);
    expect(stub.accepted).toHaveLength(2);
  });

  it("makes exactly one request per send, whatever the answer (no retry inside the plugin)", async () => {
    const { provider } = providerOn(stub);
    for (const status of [429, 500, 503, 409]) {
      stub.override(() => ({ status, json: { name: "application_error" } }));
      const before = stub.requests.length;
      await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
      expect(stub.requests.length - before).toBe(1);
    }
  });
});
