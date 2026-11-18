import { describe, expect, it } from "vitest";
import { emailProviderFailure, emailProviderOk, type EmailProviderPort } from "@fluxkit/core";
import { ManagedEmailProvider, type EmailSendAuthority } from "./managed-email-provider.js";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

function provider(result: Awaited<ReturnType<EmailProviderPort["send"]>>): {
  provider: ManagedEmailProvider;
  released: string[];
} {
  const released: string[] = [];
  const runtime: EmailSendAuthority = {
    admit: () => Promise.resolve(true),
    release: (messageId) => {
      released.push(messageId);
      return Promise.resolve();
    },
  };
  const client: EmailProviderPort = {
    code: "resend",
    capabilities: { idempotencyKeys: true, maxRecipients: 1 },
    send: () => Promise.resolve(result),
  };
  return {
    released,
    provider: new ManagedEmailProvider(
      { providerCode: "resend", versionId: "version-1", client },
      runtime,
    ),
  };
}

const message = {
  from: { address: "shop@example.com", displayName: null },
  to: { address: "owner@example.com", displayName: null },
  subject: "Hello",
  text: "Hello",
  html: "<p>Hello</p>",
  tags: { category: "admin" as const },
};

describe("ManagedEmailProvider binding", () => {
  it("releases the binding after a proven refusal so the next stored provider can send", async () => {
    const harness = provider(emailProviderFailure("quota_exceeded", { quotaPeriod: "daily" }));
    const result = await harness.provider.send(
      message,
      { idempotencyKey: MESSAGE_ID },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, reason: "quota_exceeded" });
    expect(harness.released).toEqual([MESSAGE_ID]);
  });

  it("keeps the binding when the provider may already have accepted the message", async () => {
    const harness = provider(emailProviderFailure("unavailable"));
    const result = await harness.provider.send(
      message,
      { idempotencyKey: MESSAGE_ID },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(harness.released).toEqual([]);
  });

  it("keeps the binding after an accept", async () => {
    const harness = provider(emailProviderOk({ providerMessageId: "accepted-1" }));
    const result = await harness.provider.send(
      message,
      { idempotencyKey: MESSAGE_ID },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true });
    expect(harness.released).toEqual([]);
  });
});
