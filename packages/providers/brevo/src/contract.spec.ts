import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEmailProviderContract } from "@fluxkit/core";
import { aborted, live, message, providerOn } from "./test-support/fixtures.js";
import {
  addressOf,
  STUB_PERSONAL,
  startStubBrevo,
  type StubBrevo,
} from "./test-support/stub-brevo.js";

/* The core email provider contract (ADR 0031 decision 3), run against the plugin and the stub Brevo. */
describe("the core email provider contract", () => {
  let stub: StubBrevo;

  beforeEach(async () => {
    stub = await startStubBrevo();
  });

  afterEach(async () => {
    await stub?.close();
  });

  it("is kept", async () => {
    const { provider } = providerOn(stub);
    const violations = await checkEmailProviderContract(provider, {
      message: message(),
      refusedMessage: message({ to: { address: STUB_PERSONAL.refused, displayName: null } }),
      observed: () =>
        stub.requests.map((request) => {
          const key = (request.body as { headers?: { idempotencyKey?: string } })?.headers
            ?.idempotencyKey;
          const to = (request.body as { to?: unknown } | undefined)?.to;
          return {
            idempotencyKey: typeof key === "string" ? key : null,
            recipients: Array.isArray(to) ? to.map(addressOf) : [],
          };
        }),
      liveSignal: live,
      abortedSignal: aborted,
    });
    expect(violations).toEqual([]);
  });
});
