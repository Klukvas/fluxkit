import { describe, expect, it } from "vitest";
import { parseBrevoEnv } from "./config.js";

describe("Brevo configuration", () => {
  it("accepts bounded header-safe keys without inventing a prefix", () => {
    for (const key of ["x", "arbitrary-prefix_123", "X".repeat(1024)]) {
      expect(parseBrevoEnv({ BREVO_API_KEY: key })).toEqual({ apiKey: key });
    }
  });
  it("rejects missing, oversized, whitespace and control-bearing keys without leaking them", () => {
    for (const key of [
      undefined,
      "",
      " ",
      "x".repeat(1025),
      "x\r\nInjected:1",
      "x\0",
      "é",
      " key",
      "key ",
      "key\n",
    ]) {
      expect(() => parseBrevoEnv({ BREVO_API_KEY: key })).toThrow(/^BREVO_API_KEY /);
    }
    expect(() => parseBrevoEnv({ BREVO_API_KEY: "secret value" })).toThrow(
      "BREVO_API_KEY must contain 1 to 1024 visible ASCII characters without whitespace (the value is not shown).",
    );
  });
});
