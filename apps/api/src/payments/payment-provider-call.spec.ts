import { describe, expect, it } from "vitest";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";

describe("payment credential admission diagnostics", () => {
  it.each(["credential_revoked", "credential_unavailable"] as const)(
    "retains only the safe %s code without claiming an ambiguous operation was unsent",
    async (code) => {
      const error = Object.assign(new Error("SENSITIVE_PROVIDER_TEXT"), {
        name: "CredentialAdmissionDenied",
        code,
      });
      const result = await callPaymentProvider(() => Promise.reject(error));
      expect(result).toMatchObject({
        kind: "failed",
        result: { ok: false, reason: "unavailable", providerCodes: [code] },
      });
      expect(describePaymentCall(result)).toContain(code);
      expect(JSON.stringify(result)).not.toContain("SENSITIVE_PROVIDER_TEXT");
    },
  );
});
