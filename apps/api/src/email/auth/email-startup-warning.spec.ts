import { DEFAULT_STOREFRONT_PUBLIC_URL } from "@fluxkit/config";
import { describe, expect, it } from "vitest";
import {
  emailProviderStartupWarning,
  storefrontUrlStartupWarning,
} from "./email-startup-warning.js";

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

describe("the warning when mail links would point at the storefront's dev origin (email review F9)", () => {
  it("warns outside production when a real provider is set and STOREFRONT_PUBLIC_URL is unset or blank", () => {
    for (const url of [undefined, "", "  "]) {
      for (const nodeEnv of ["development", "staging", undefined]) {
        expect(storefrontUrlStartupWarning("resend", url, nodeEnv)).toContain(
          DEFAULT_STOREFRONT_PUBLIC_URL,
        );
      }
    }
  });

  it("says nothing with the variable set, without a provider, with the test-only provider, or in production (refused there)", () => {
    expect(
      storefrontUrlStartupWarning("resend", "https://shop.example", "staging"),
    ).toBeUndefined();
    expect(storefrontUrlStartupWarning("none", undefined, "development")).toBeUndefined();
    expect(storefrontUrlStartupWarning(undefined, undefined, "development")).toBeUndefined();
    expect(storefrontUrlStartupWarning("fake", undefined, "test")).toBeUndefined();
    expect(storefrontUrlStartupWarning("resend", undefined, "production")).toBeUndefined();
  });
});
