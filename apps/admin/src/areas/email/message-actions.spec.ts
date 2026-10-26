import type { AdminEmailMessage } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { offeredActions } from "./message-actions";

function message(overrides: Partial<AdminEmailMessage>): AdminEmailMessage {
  return { canCancel: false, canResend: false, ...overrides } as AdminEmailMessage;
}

describe("offeredActions", () => {
  it("offers cancel for a pending mail and resend for a final one, as the API says", () => {
    expect(offeredActions(message({ canCancel: true }), true)).toEqual(["cancel"]);
    expect(offeredActions(message({ canResend: true }), true)).toEqual(["resend"]);
    expect(offeredActions(message({}), true)).toEqual([]);
  });
  it("offers nothing to an admin who may not manage email", () => {
    expect(offeredActions(message({ canCancel: true, canResend: true }), false)).toEqual([]);
  });
});
