import { describe, expect, it } from "vitest";
import { localeForHandoff } from "./payment-handoff.service.js";

describe("localeForHandoff", () => {
  const locales = ["uk", "en"] as const;

  it("prefers the locale embedded in the attempt redirect URL over the order locale", () => {
    expect(
      localeForHandoff(
        "https://shop.example/en/payment/handoff?payment=6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
        "uk",
        locales,
      ),
    ).toBe("en");
  });

  it("falls back to the order locale when the redirect URL has no locale path", () => {
    expect(localeForHandoff("https://pay.example/checkout", "uk", locales)).toBe("uk");
    expect(localeForHandoff(null, "en", locales)).toBe("en");
  });

  it("falls back to the first configured locale when neither is known", () => {
    expect(localeForHandoff(null, "de", locales)).toBe("uk");
  });
});
