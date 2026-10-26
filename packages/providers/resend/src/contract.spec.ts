import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEmailProviderContract } from "@fluxkit/core";
import { aborted, live, message, providerOn } from "./test-support/fixtures.js";
import {
  addressOf,
  STUB_PERSONAL,
  startStubResend,
  type StubResend,
} from "./test-support/stub-resend.js";

/* The core email provider contract (ADR 0031 decision 3), run against the plugin and the stub Resend. */
describe("the core email provider contract", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("is kept", async () => {
    const { provider } = providerOn(stub);
    const violations = await checkEmailProviderContract(provider, {
      message: message(),
      refusedMessage: message({ to: { address: STUB_PERSONAL.refused, displayName: null } }),
      observed: () =>
        stub.requests.map((request) => {
          const key = request.headers["idempotency-key"];
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
