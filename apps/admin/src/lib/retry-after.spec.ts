import { describe, expect, it } from "vitest";
import { retryAfterMinutes } from "./retry-after";

describe("retryAfterMinutes", () => {
  it("rounds the seconds of Retry-After up to whole minutes", () => {
    expect(retryAfterMinutes("1")).toBe(1);
    expect(retryAfterMinutes("60")).toBe(1);
    expect(retryAfterMinutes("61")).toBe(2);
    expect(retryAfterMinutes("600")).toBe(10);
  });

  it("gives no wait for a missing, zero, negative, non-numeric, HTTP-date or absurd value", () => {
    for (const value of [
      null,
      "",
      "0",
      "-5",
      "1.5",
      "abc",
      "Wed, 21 Oct 2026 07:28:00 GMT",
      "999999",
    ]) {
      expect(retryAfterMinutes(value), String(value)).toBeNull();
    }
  });
});
