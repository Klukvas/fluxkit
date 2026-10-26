import { describe, expect, it } from "vitest";
import {
  emailProviderFailure,
  emailProviderOk,
  type EmailProviderPort,
  type OutgoingEmail,
} from "@fluxkit/core";
import { callEmailProvider, failureOfCall } from "./email-provider-call.js";

const message: OutgoingEmail = {
  from: { address: "shop@example.com", displayName: null },
  to: { address: "buyer@example.net", displayName: null },
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  tags: { category: "account" },
};

function provider(send: EmailProviderPort["send"]): EmailProviderPort {
  return { code: "spec", capabilities: { idempotencyKeys: true, maxRecipients: 1 }, send };
}

const call = (send: EmailProviderPort["send"], timeoutMs = 50) =>
  callEmailProvider(provider(send), message, { idempotencyKey: "key-1" }, timeoutMs);

describe("callEmailProvider", () => {
  it("passes the idempotency key and answers the provider id", async () => {
    let key = "";
    const outcome = await call((_message, options) => {
      key = options.idempotencyKey;
      return Promise.resolve(emailProviderOk({ providerMessageId: "id-1" }));
    });
    expect(key).toBe("key-1");
    expect(outcome).toEqual({ kind: "ok", providerMessageId: "id-1" });
  });

  it("keeps a typed failure with its retry-after and quota period", async () => {
    const outcome = await call(() =>
      Promise.resolve(
        emailProviderFailure("quota_exceeded", {
          providerCodes: ["daily_quota_exceeded"],
          retryAfterSeconds: 9,
          quotaPeriod: "daily",
        }),
      ),
    );
    expect(outcome).toEqual({
      kind: "failed",
      failure: {
        ok: false,
        reason: "quota_exceeded",
        providerCodes: ["daily_quota_exceeded"],
        retryAfterSeconds: 9,
        quotaPeriod: "daily",
      },
    });
  });

  it("aborts after the timeout and does not wait for a provider that ignores the signal", async () => {
    let aborted = false;
    const outcome = await call((_message, _options, signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => undefined);
    });
    expect(outcome).toEqual({ kind: "timed_out" });
    expect(aborted).toBe(true);
    expect(failureOfCall({ kind: "timed_out" })).toMatchObject({
      reason: "unavailable",
      providerCodes: ["timeout"],
    });
  });

  it("maps a thrown error to its class name only, and malformed answers to MalformedProviderResult", async () => {
    class LeakyError extends Error {}
    expect(
      await call(() => Promise.reject(new LeakyError("buyer@example.net was refused"))),
    ).toEqual({ kind: "threw", errorName: "LeakyError" });
    expect(await call(() => Promise.resolve(null as never))).toEqual({
      kind: "threw",
      errorName: "MalformedProviderResult",
    });
    expect(
      await call(() => Promise.resolve({ ok: true, value: { providerMessageId: "has space" } })),
    ).toEqual({ kind: "threw", errorName: "MalformedProviderResult" });
    // A message text passed off as a code is refused by emailProviderFailure.
    expect(
      await call(() =>
        Promise.resolve({
          ok: false,
          reason: "rejected",
          providerCodes: ["buyer@example.net is not allowed"],
        } as never),
      ),
    ).toEqual({ kind: "threw", errorName: "MalformedProviderResult" });
    expect(failureOfCall({ kind: "threw", errorName: "LeakyError" })).toMatchObject({
      reason: "unavailable",
      providerCodes: ["LeakyError"],
    });
  });
});
