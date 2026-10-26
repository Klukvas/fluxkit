import { describe, expect, it } from "vitest";
import { GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH, type HmacSha256 } from "../orders/access-token.js";
import {
  AUTH_TOKEN_LIFETIME_MINUTES,
  AUTH_TOKEN_PURPOSES,
  AUTH_TOKEN_REFUSALS,
  authTokenExpiresAt,
  CUSTOMER_AUTH_TOKEN_LABEL,
  CUSTOMER_AUTH_TOKEN_PATTERN,
  customerAuthTokenMessage,
  deriveCustomerAuthToken,
  evaluateAuthToken,
  isCustomerAuthTokenFormat,
  type AuthTokenCustomerFacts,
  type AuthTokenFacts,
} from "./auth-token.js";

/** The deterministic stand-in of `orders/access-token.spec.ts`; the real HMAC is covered in apps/api (node:crypto). */
const fakeHmac: HmacSha256 = (key, message) => {
  const bytes = new Uint8Array(32);
  const text = `${key}\u0000${message}`;
  for (let index = 0; index < text.length; index += 1) {
    const slot = index % 32;
    bytes[slot] = ((bytes[slot] ?? 0) * 31 + text.charCodeAt(index)) & 0xff;
  }
  return bytes;
};

const SECRET = "s".repeat(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH);
const TOKEN_ID = "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6";
const MINUTE = 60_000;

describe("auth token constants (ADR 0031 decision 9)", () => {
  it("has two purposes with 60 minutes for a reset and 48 hours for a verification", () => {
    expect([...AUTH_TOKEN_PURPOSES]).toEqual(["password_reset", "email_verification"]);
    expect(AUTH_TOKEN_LIFETIME_MINUTES).toEqual({
      password_reset: 60,
      email_verification: 48 * 60,
    });
    expect(Object.isFrozen(AUTH_TOKEN_LIFETIME_MINUTES)).toBe(true);
  });

  it("uses its own domain-separation label, distinct from the guest order token's", () => {
    expect(CUSTOMER_AUTH_TOKEN_LABEL).toBe("fluxkit:customer-auth-token:v1");
    expect(CUSTOMER_AUTH_TOKEN_LABEL).not.toBe("fluxkit:order-access-token:v1");
  });
});

describe("authTokenExpiresAt", () => {
  const created = new Date("2026-10-26T10:00:00.000Z");

  it("adds the purpose's lifetime", () => {
    expect(authTokenExpiresAt("password_reset", created)).toEqual(
      new Date("2026-10-26T11:00:00.000Z"),
    );
    expect(authTokenExpiresAt("email_verification", created)).toEqual(
      new Date("2026-10-28T10:00:00.000Z"),
    );
  });

  it("throws for an unknown purpose or an invalid date", () => {
    expect(() => authTokenExpiresAt("login" as never, created)).toThrow(RangeError);
    expect(() => authTokenExpiresAt("password_reset", new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("customerAuthTokenMessage (the HMAC input layout)", () => {
  it("is label, purpose and token id separated by newlines", () => {
    expect(customerAuthTokenMessage("password_reset", TOKEN_ID)).toBe(
      `fluxkit:customer-auth-token:v1\npassword_reset\n${TOKEN_ID}`,
    );
    expect(customerAuthTokenMessage("email_verification", TOKEN_ID)).toBe(
      `fluxkit:customer-auth-token:v1\nemail_verification\n${TOKEN_ID}`,
    );
  });

  it("refuses a token id that is not a lower-case UUID, and an unknown purpose", () => {
    for (const tokenId of [
      "",
      "0B6F8D3E-1C2A-4D5E-9F10-A1B2C3D4E5F6",
      `${TOKEN_ID}\n`,
      `${TOKEN_ID}\npassword_reset`,
      "not-a-uuid",
    ]) {
      expect(() => customerAuthTokenMessage("password_reset", tokenId), tokenId).toThrow(
        RangeError,
      );
    }
    expect(() => customerAuthTokenMessage("password_reset\n" as never, TOKEN_ID)).toThrow(
      RangeError,
    );
  });
});

describe("deriveCustomerAuthToken", () => {
  const input = { secret: SECRET, purpose: "password_reset" as const, tokenId: TOKEN_ID };

  it("is 32 bytes in unpadded base64url (43 characters) and matches the format check", () => {
    const token = deriveCustomerAuthToken(input, fakeHmac);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isCustomerAuthTokenFormat(token)).toBe(true);
  });

  it("is deterministic and hands the secret to the port as the key, never in the message", () => {
    const seen: { key: string; message: string }[] = [];
    const spy: HmacSha256 = (key, message) => {
      seen.push({ key, message });
      return fakeHmac(key, message);
    };
    const first = deriveCustomerAuthToken(input, spy);
    expect(deriveCustomerAuthToken({ ...input }, spy)).toBe(first);
    expect(seen[0]).toEqual({
      key: SECRET,
      message: customerAuthTokenMessage("password_reset", TOKEN_ID),
    });
    expect(seen[0]?.message).not.toContain(SECRET);
  });

  it("differs per secret, per purpose and per token id", () => {
    const tokens = new Set([
      deriveCustomerAuthToken(input, fakeHmac),
      deriveCustomerAuthToken({ ...input, secret: "t".repeat(32) }, fakeHmac),
      deriveCustomerAuthToken({ ...input, purpose: "email_verification" }, fakeHmac),
      deriveCustomerAuthToken(
        { ...input, tokenId: "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f7" },
        fakeHmac,
      ),
    ]);
    expect(tokens.size).toBe(4);
  });

  it("refuses a short secret, a bad token id and a port that does not return 32 bytes", () => {
    expect(() => deriveCustomerAuthToken({ ...input, secret: "s".repeat(31) }, fakeHmac)).toThrow(
      RangeError,
    );
    expect(() => deriveCustomerAuthToken({ ...input, tokenId: "x" }, fakeHmac)).toThrow(RangeError);
    expect(() => deriveCustomerAuthToken(input, () => new Uint8Array(31))).toThrow(RangeError);
  });
});

describe("isCustomerAuthTokenFormat (checked before the hash lookup)", () => {
  it("accepts exactly 43 base64url characters", () => {
    expect(CUSTOMER_AUTH_TOKEN_PATTERN.test("A".repeat(43))).toBe(true);
    expect(isCustomerAuthTokenFormat(`${"a".repeat(42)}_`)).toBe(true);
    expect(isCustomerAuthTokenFormat(`${"a".repeat(42)}-`)).toBe(true);
  });

  it.each([
    ["42 characters", "a".repeat(42)],
    ["44 characters", "a".repeat(44)],
    ["padding", `${"a".repeat(42)}=`],
    ["plus (base64, not base64url)", `${"a".repeat(42)}+`],
    ["slash", `${"a".repeat(42)}/`],
    ["a trailing newline", `${"a".repeat(43)}\n`],
    ["a space", ` ${"a".repeat(42)}`],
    ["a non-ASCII letter", `${"a".repeat(42)}я`],
    ["a huge string", "a".repeat(1_000_000)],
    ["empty", ""],
  ])("refuses %s", (_label, value) => {
    expect(isCustomerAuthTokenFormat(value)).toBe(false);
  });

  it("refuses non-strings", () => {
    for (const value of [undefined, null, 43, {}, ["a".repeat(43)]]) {
      expect(isCustomerAuthTokenFormat(value)).toBe(false);
    }
  });
});

describe("evaluateAuthToken", () => {
  const now = new Date("2026-10-26T10:30:00.000Z");
  const token: AuthTokenFacts = {
    purpose: "password_reset",
    email: "shopper@example.com",
    expiresAt: new Date("2026-10-26T11:00:00.000Z"),
    usedAt: null,
  };
  const customer: AuthTokenCustomerFacts = { email: "shopper@example.com", isActive: true };
  const evaluate = (
    overrides: {
      token?: AuthTokenFacts | null;
      customer?: AuthTokenCustomerFacts | null;
      purpose?: "password_reset" | "email_verification";
      now?: Date;
    } = {},
  ) =>
    evaluateAuthToken({
      token: overrides.token === undefined ? token : overrides.token,
      customer: overrides.customer === undefined ? customer : overrides.customer,
      purpose: overrides.purpose ?? "password_reset",
      now: overrides.now ?? now,
    });

  it("accepts an unused, unexpired token of the right purpose for an active customer with the same email", () => {
    expect(evaluate()).toEqual({ ok: true });
  });

  it("refuses an unknown token", () => {
    expect(evaluate({ token: null })).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a token of the other purpose", () => {
    expect(evaluate({ purpose: "email_verification" })).toEqual({
      ok: false,
      reason: "wrong_purpose",
    });
  });

  describe("expiry boundary", () => {
    it("accepts 1 ms before expires_at", () => {
      expect(evaluate({ now: new Date(token.expiresAt.getTime() - 1) })).toEqual({ ok: true });
    });

    it("refuses at exactly expires_at", () => {
      expect(evaluate({ now: new Date(token.expiresAt.getTime()) })).toEqual({
        ok: false,
        reason: "expired",
      });
    });

    it("refuses after expires_at", () => {
      expect(evaluate({ now: new Date(token.expiresAt.getTime() + MINUTE) })).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  it("refuses a used token (also one invalidated by a newer token or a password change)", () => {
    expect(evaluate({ token: { ...token, usedAt: new Date("2026-10-26T10:10:00.000Z") } })).toEqual(
      {
        ok: false,
        reason: "used",
      },
    );
    // Used in the future relative to now (clock skew between instances): still used.
    expect(evaluate({ token: { ...token, usedAt: new Date("2026-10-26T10:40:00.000Z") } })).toEqual(
      {
        ok: false,
        reason: "used",
      },
    );
  });

  it("refuses an inactive or deleted customer", () => {
    expect(evaluate({ customer: { ...customer, isActive: false } })).toEqual({
      ok: false,
      reason: "customer_inactive",
    });
    expect(evaluate({ customer: null })).toEqual({ ok: false, reason: "customer_inactive" });
  });

  it("refuses a token sent to an address the customer no longer has", () => {
    expect(evaluate({ customer: { ...customer, email: "new@example.com" } })).toEqual({
      ok: false,
      reason: "email_changed",
    });
  });

  it("compares addresses in their stored (normalized) form, nothing looser", () => {
    expect(evaluate({ customer: { ...customer, email: "Shopper@Example.com" } })).toEqual({
      ok: true,
    });
    // A look-alike Cyrillic "о" is another address.
    expect(evaluate({ customer: { ...customer, email: "shоpper@example.com" } })).toEqual({
      ok: false,
      reason: "email_changed",
    });
  });

  it("reports `used` only when every other check passes (verify-email answers 204 again on that alone)", () => {
    const used = { ...token, usedAt: new Date("2026-10-26T10:10:00.000Z") };
    expect(evaluate({ token: used, now: token.expiresAt })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(evaluate({ token: used, customer: { ...customer, isActive: false } })).toEqual({
      ok: false,
      reason: "customer_inactive",
    });
    expect(evaluate({ token: used, customer: { ...customer, email: "x@example.com" } })).toEqual({
      ok: false,
      reason: "email_changed",
    });
    expect(evaluate({ token: used, purpose: "email_verification" })).toEqual({
      ok: false,
      reason: "wrong_purpose",
    });
  });

  it("checks in a fixed order: not_found, wrong_purpose, expired, customer_inactive, email_changed, used", () => {
    expect([...AUTH_TOKEN_REFUSALS]).toEqual([
      "not_found",
      "wrong_purpose",
      "expired",
      "customer_inactive",
      "email_changed",
      "used",
    ]);
    const everythingWrong = {
      token: { ...token, purpose: "email_verification" as const, usedAt: now },
      customer: { email: "x@example.com", isActive: false },
      now: new Date(token.expiresAt.getTime() + 1),
    };
    expect(evaluate(everythingWrong)).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it("throws for input that can only be a bug", () => {
    expect(() => evaluate({ now: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => evaluate({ token: { ...token, expiresAt: new Date(Number.NaN) } })).toThrow(
      RangeError,
    );
    expect(() => evaluate({ purpose: "login" as never })).toThrow(RangeError);
  });
});
