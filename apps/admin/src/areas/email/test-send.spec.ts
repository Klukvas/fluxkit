import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import type { WriteOutcome } from "../../lib/run-write";
import { testSendViewFrom } from "./test-send";

type Outcome = WriteOutcome<{ messageId: string }>;

function refused(
  status: number,
  code: string,
  rule?: string,
  retryAfter: string | null = null,
): Outcome {
  const problem = {
    type: "about:blank",
    title: "x",
    status,
    code,
    detail: "d",
    ...(rule ? { rule } : {}),
  } as ProblemDetails;
  return { kind: "problem", status, problem, retryAfter };
}

describe("testSendViewFrom", () => {
  it("links the queued message", () => {
    expect(testSendViewFrom({ kind: "ok", status: 202, data: { messageId: "m1" } })).toEqual({
      kind: "queued",
      messageId: "m1",
    });
  });
  it("explains the 409 refusals and the 429 limit", () => {
    expect(testSendViewFrom(refused(409, "rule_violation", "email_not_configured"))).toEqual({
      kind: "refused",
      descriptor: { key: "mail.refusal.email_not_configured" },
    });
    expect(testSendViewFrom(refused(409, "rule_violation", "address_undeliverable"))).toEqual({
      kind: "refused",
      descriptor: { key: "mail.refusal.address_undeliverable" },
    });
    expect(testSendViewFrom(refused(429, "too_many_requests", undefined, "600"))).toEqual({
      kind: "refused",
      descriptor: { key: "mail.refusal.rateLimitedWait", values: { minutes: 10 } },
    });
  });
  it("says nothing was learned when no answer came, and nothing for an aborted write", () => {
    expect(testSendViewFrom({ kind: "unknown", failure: { kind: "network" } })).toEqual({
      kind: "unknown",
    });
    expect(testSendViewFrom({ kind: "aborted" })).toEqual({ kind: "idle" });
  });
});
