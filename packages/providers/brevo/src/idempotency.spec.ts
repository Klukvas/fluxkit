import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { live, message, MESSAGE_ID, providerOn, within } from "./test-support/fixtures.js";
import { startStubBrevo, type StubBrevo } from "./test-support/stub-brevo.js";

describe("documented deduplication model (not live-verified)", () => {
  let stub: StubBrevo;
  beforeEach(async () => {
    stub = await startStubBrevo();
  });
  afterEach(async () => {
    await stub?.close();
  });
  it("models duplicates, changed bodies and exact 30-minute expiry without manufacturing success", async () => {
    const { provider } = providerOn(stub);
    await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    for (const subject of [message().subject, "Changed body"]) {
      expect(
        await provider.send(message({ subject }), { idempotencyKey: MESSAGE_ID }, live()),
      ).toMatchObject({
        reason: "idempotency_conflict",
        providerCodes: ["duplicate_parameter", "400"],
      });
    }
    stub.advance(1800_000 - 1);
    expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toMatchObject({
      reason: "idempotency_conflict",
      providerCodes: ["duplicate_parameter", "400"],
    });
    stub.advance(1);
    expect((await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).ok).toBe(true);
    expect(stub.accepted).toHaveLength(2);
  });
  it("models a concurrent duplicate while the first response is in flight", async () => {
    stub.setLatency(100);
    const { provider } = providerOn(stub);
    const first = provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    for (let tries = 0; tries < 200 && stub.requests.length === 0; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stub.requests).toHaveLength(1);
    expect(await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live())).toMatchObject({
      reason: "idempotency_conflict",
      providerCodes: ["duplicate_parameter", "400"],
    });
    expect((await first).ok).toBe(true);
    expect(stub.accepted).toHaveLength(1);
  });
  it("models a lost answer after acceptance and never retries inside send", async () => {
    stub.loseNextResponse();
    const { provider } = providerOn(stub);
    expect(
      await provider.send(message(), { idempotencyKey: MESSAGE_ID }, within(100)),
    ).toMatchObject({ reason: "unavailable" });
    expect(stub.requests).toHaveLength(1);
    expect(stub.accepted).toHaveLength(1);
    expect(provider.capabilities.idempotencyKeys).toBe(false);
  });
  it("models unsupported deduplication: forwarding a UUID is no proof of protection", async () => {
    stub.setIdempotency(false);
    const { provider } = providerOn(stub);
    for (let attempt = 0; attempt < 2; attempt++)
      await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(stub.accepted).toHaveLength(2);
    expect(provider.capabilities.idempotencyKeys).toBe(false);
  });
});
