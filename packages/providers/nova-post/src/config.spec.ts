import { describe, expect, it } from "vitest";
import { NOVA_POST_BASE_URLS, NovaPostConfigError, parseNovaPostEnv } from "./config.js";

const KEY = "0123456789abcdef0123456789abcdef";

describe("parseNovaPostEnv", () => {
  it("defaults to the sandbox and takes production only when it is written", () => {
    expect(parseNovaPostEnv({ NOVA_POST_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      environment: "sandbox",
      baseUrl: "https://api-stage.novapost.com/v.1.0",
    });
    expect(
      parseNovaPostEnv({ NOVA_POST_API_KEY: KEY, NOVA_POST_ENVIRONMENT: "" }).environment,
    ).toBe("sandbox");
    expect(
      parseNovaPostEnv({ NOVA_POST_API_KEY: ` ${KEY} `, NOVA_POST_ENVIRONMENT: "production" }),
    ).toEqual({
      apiKey: KEY,
      environment: "production",
      baseUrl: "https://api.novapost.com/v.1.0",
    });
  });

  it("has exactly the two base URLs of ADR 0030 (no URL variable exists)", () => {
    expect(NOVA_POST_BASE_URLS).toEqual({
      sandbox: "https://api-stage.novapost.com/v.1.0",
      production: "https://api.novapost.com/v.1.0",
    });
    expect(Object.isFrozen(NOVA_POST_BASE_URLS)).toBe(true);
    const parsed = parseNovaPostEnv({
      NOVA_POST_API_KEY: KEY,
      NOVA_POST_BASE_URL: "https://evil.example",
      NOVA_POST_URL: "https://evil.example",
    });
    expect(parsed.baseUrl).toBe(NOVA_POST_BASE_URLS.sandbox);
  });

  it("refuses to start without a key, naming the variable", () => {
    for (const value of [undefined, "", "   "]) {
      expect(() => parseNovaPostEnv({ NOVA_POST_API_KEY: value })).toThrow(NovaPostConfigError);
      expect(() => parseNovaPostEnv({ NOVA_POST_API_KEY: value })).toThrow(
        /NOVA_POST_API_KEY is required/,
      );
    }
  });

  it("refuses a malformed key without showing it", () => {
    for (const value of [
      "short-key",
      "with a space inside 0123456789",
      "ключ-0123456789abcdef",
      "x".repeat(513),
    ]) {
      let message = "";
      try {
        parseNovaPostEnv({ NOVA_POST_API_KEY: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, value).toMatch(/NOVA_POST_API_KEY must be/);
      expect(message, value).not.toContain(value.trim());
    }
  });

  it("refuses an unknown environment (production is never guessed), without echoing the value", () => {
    for (const value of ["prod", "PRODUCTION", "live", "staging"]) {
      let message = "";
      try {
        parseNovaPostEnv({ NOVA_POST_API_KEY: KEY, NOVA_POST_ENVIRONMENT: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, value).toMatch(/NOVA_POST_ENVIRONMENT must be one of sandbox, production/);
      expect(message, value).not.toContain(KEY);
    }
  });
});
