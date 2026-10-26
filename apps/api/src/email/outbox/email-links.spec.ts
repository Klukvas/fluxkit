import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_DELIVERY_TUNING,
  type EmailDeliveryConfig,
} from "./email-delivery-config.js";
import { StorefrontEmailLinks, type EmailLinkInput } from "./email-links.js";
import { deriveAuthToken } from "../auth/auth-token-crypto.js";

const SECRET = "test-order-token-secret-0123456789-abcdef";
const TOKEN_ID = "6f1c1a52-8f3e-4a8b-9d0e-1c2b3a4d5e6f";

function source(overrides: Partial<EmailDeliveryConfig> = {}): StorefrontEmailLinks {
  return new StorefrontEmailLinks({
    from: null,
    replyTo: null,
    storefrontPublicUrl: "https://shop.example.com",
    tokenSecret: SECRET,
    tuning: DEFAULT_EMAIL_DELIVERY_TUNING,
    ...overrides,
  });
}

function input(templateKey: string, overrides: Partial<EmailLinkInput> = {}): EmailLinkInput {
  return {
    messageId: "00000000-0000-4000-8000-0000000000aa",
    templateKey,
    locale: "uk",
    recipientKind: "customer",
    customerId: null,
    orderId: null,
    variables: { tokenId: TOKEN_ID },
    ...overrides,
  };
}

describe("StorefrontEmailLinks (ADR 0031 decision 13)", () => {
  it("builds the reset and verification links from STOREFRONT_PUBLIC_URL with the token derived for its purpose in the fragment", () => {
    const reset = source().linksFor(input("customer.password_reset"));
    expect(reset).toEqual({
      storefront: "https://shop.example.com/uk",
      action: `https://shop.example.com/uk/account/reset-password#t=${deriveAuthToken(SECRET, "password_reset", TOKEN_ID)}`,
    });
    const verify = source().linksFor(input("customer.verify_email", { locale: "en" }));
    expect(verify.action).toBe(
      `https://shop.example.com/en/account/verify-email#t=${deriveAuthToken(SECRET, "email_verification", TOKEN_ID)}`,
    );
    // Deterministic: every attempt of one row renders the same link.
    expect(source().linksFor(input("customer.password_reset"))).toEqual(reset);
  });

  it("gives other mails no action link, and encodes the locale segment", () => {
    expect(
      source().linksFor(input("customer.password_changed", { variables: {} })).action,
    ).toBeNull();
    expect(
      source().linksFor(input("admin.test", { variables: { providerCode: "fake" } })).action,
    ).toBeNull();
    expect(source().linksFor(input("admin.test", { locale: "a/b" })).storefront).toBe(
      "https://shop.example.com/a%2Fb",
    );
  });

  it("refuses to build an auth link without the secret or a token id (the mail then fails render_failed)", () => {
    expect(() => source({ tokenSecret: null }).linksFor(input("customer.password_reset"))).toThrow(
      /ORDER_TOKEN_SECRET/,
    );
    for (const tokenId of [undefined, "x", TOKEN_ID.toUpperCase(), 42]) {
      expect(() =>
        source().linksFor(input("customer.verify_email", { variables: { tokenId } })),
      ).toThrow(/token row id/);
    }
  });
});
