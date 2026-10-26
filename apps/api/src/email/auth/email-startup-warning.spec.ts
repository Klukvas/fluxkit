import { describe, expect, it } from "vitest";
import { emailProviderStartupWarning } from "./email-startup-warning.js";

describe("the production warning without a mail provider (ADR 0031 decision 11)", () => {
  it("warns in production with none (or unset), never otherwise", () => {
    for (const provider of ["none", undefined]) {
      expect(emailProviderStartupWarning(provider, "production")).toContain(
        "customers cannot reset passwords",
      );
      expect(emailProviderStartupWarning(provider, " Production ")).toBeDefined();
    }
    expect(emailProviderStartupWarning("resend", "production")).toBeUndefined();
    expect(emailProviderStartupWarning("none", "development")).toBeUndefined();
    expect(emailProviderStartupWarning("none", undefined)).toBeUndefined();
  });
});
