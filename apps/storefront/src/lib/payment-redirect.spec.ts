import { describe, expect, it, vi } from "vitest";
import { goToProvider, providerRedirectUrl } from "./payment-redirect";

describe("providerRedirectUrl: only an https page from the API's answer", () => {
  it("accepts an https URL and returns it normalized", () => {
    expect(providerRedirectUrl("https://pay.fake.invalid/pay/fake-pay-000001")).toBe(
      "https://pay.fake.invalid/pay/fake-pay-000001",
    );
    expect(providerRedirectUrl("HTTPS://Pay.Example.com/a?b=1#c")).toBe(
      "https://pay.example.com/a?b=1#c",
    );
  });

  it.each([
    ["http", "http://pay.example.com/pay/1"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a protocol-relative URL", "//pay.example.com/pay/1"],
    ["a relative path", "/pay/1"],
    ["an empty string", ""],
    ["blank text", "   "],
    ["a URL with credentials", "https://user:secret@pay.example.com/pay/1"],
    ["a URL with only a user", "https://user@pay.example.com/pay/1"],
    ["backslashes", "https:\\\\pay.example.com\\pay\\1"],
    ["a leading space", " https://pay.example.com/pay/1"],
    ["a newline", "https://pay.example.com/pay/1\nhttps://evil.example"],
    ["a tab", "https://pay.exa\tmple.com/pay/1"],
    ["no host", "https:///pay/1"],
    ["a very long URL", `https://pay.example.com/${"a".repeat(3000)}`],
    ["ftp", "ftp://pay.example.com/pay/1"],
    ["blob", "blob:https://pay.example.com/1"],
  ])("refuses %s", (_name, raw) => {
    expect(providerRedirectUrl(raw)).toBeNull();
  });

  it.each([[undefined], [null], [42], [{}], [["https://pay.example.com/"]]])(
    "refuses a value that is not a string (%j)",
    (raw) => {
      expect(providerRedirectUrl(raw)).toBeNull();
    },
  );
});

describe("goToProvider", () => {
  it("assigns the location once for a safe URL", () => {
    const assign = vi.fn();
    expect(goToProvider({ location: { assign } }, "https://pay.example.com/pay/1")).toBe(true);
    expect(assign).toHaveBeenCalledExactlyOnceWith("https://pay.example.com/pay/1");
  });

  it("never assigns an unsafe URL", () => {
    const assign = vi.fn();
    for (const raw of ["http://pay.example.com/", "javascript:alert(1)", null, ""]) {
      expect(goToProvider({ location: { assign } }, raw)).toBe(false);
    }
    expect(assign).not.toHaveBeenCalled();
  });
});
