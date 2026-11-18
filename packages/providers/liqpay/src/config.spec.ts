import { describe, expect, it } from "vitest";
import { parseLiqPayEnv, validateIntegrationSecret } from "./config.js";

describe("parseLiqPayEnv", () => {
  it("accepts trimmed keys without echoing them in errors", () => {
    const config = parseLiqPayEnv({
      LIQPAY_PUBLIC_KEY: "  pub_invented_12345678  ",
      LIQPAY_PRIVATE_KEY: "priv_invented_12345678",
    });
    expect(config.publicKey).toBe("pub_invented_12345678");
    expect(config.privateKey).toBe("priv_invented_12345678");
  });

  it("refuses a missing public key", () => {
    expect(() => parseLiqPayEnv({ LIQPAY_PRIVATE_KEY: "priv_invented_12345678" })).toThrow(
      /LIQPAY_PUBLIC_KEY/,
    );
  });

  it("refuses a key shorter than 8 characters", () => {
    expect(() =>
      parseLiqPayEnv({
        LIQPAY_PUBLIC_KEY: "short",
        LIQPAY_PRIVATE_KEY: "priv_invented_12345678",
      }),
    ).toThrow(/LIQPAY_PUBLIC_KEY/);
  });
});

describe("validateIntegrationSecret", () => {
  it("validates public_key and private_key fields", () => {
    expect(validateIntegrationSecret("public_key", "pub_invented_12345678")).toBeUndefined();
    expect(validateIntegrationSecret("private_key", "priv_invented_12345678")).toBeUndefined();
    expect(validateIntegrationSecret("token", "x")).toBe("Unknown secret field.");
  });
});