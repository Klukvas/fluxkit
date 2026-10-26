import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_DELIVERY_TUNING,
  type EmailDeliveryConfig,
} from "./email-delivery-config.js";
import {
  EmailLinkUnavailableError,
  StorefrontEmailLinks,
  type EmailLinkInput,
  type GuestOrderAccessSource,
} from "./email-links.js";
import { deriveAuthToken } from "../auth/auth-token-crypto.js";
import { deriveAccessToken } from "../../orders/access-token.js";

const SECRET = "test-order-token-secret-0123456789-abcdef";
const TOKEN_ID = "6f1c1a52-8f3e-4a8b-9d0e-1c2b3a4d5e6f";

/** The auth links read no order: a source that fails the spec if it is asked. */
const NO_ORDER_ACCESS: GuestOrderAccessSource = {
  find: () => Promise.reject(new Error("an auth link must not read an order")),
};

function source(
  overrides: Partial<EmailDeliveryConfig> = {},
  orderAccess: GuestOrderAccessSource = NO_ORDER_ACCESS,
): StorefrontEmailLinks {
  return new StorefrontEmailLinks(
    {
      from: null,
      replyTo: null,
      storefrontPublicUrl: "https://shop.example.com",
      tokenSecret: SECRET,
      tuning: DEFAULT_EMAIL_DELIVERY_TUNING,
      ...overrides,
    },
    orderAccess,
  );
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
  it("builds the reset and verification links from STOREFRONT_PUBLIC_URL with the token derived for its purpose in the fragment", async () => {
    const reset = await source().linksFor(input("customer.password_reset"));
    expect(reset).toEqual({
      storefront: "https://shop.example.com/uk",
      action: `https://shop.example.com/uk/account/reset-password#t=${deriveAuthToken(SECRET, "password_reset", TOKEN_ID)}`,
    });
    const verify = await source().linksFor(input("customer.verify_email", { locale: "en" }));
    expect(verify.action).toBe(
      `https://shop.example.com/en/account/verify-email#t=${deriveAuthToken(SECRET, "email_verification", TOKEN_ID)}`,
    );
    // Deterministic: every attempt of one row renders the same link.
    expect(await source().linksFor(input("customer.password_reset"))).toEqual(reset);
  });

  it("gives other mails no action link, and encodes the locale segment", async () => {
    expect(
      (await source().linksFor(input("customer.password_changed", { variables: {} }))).action,
    ).toBeNull();
    expect(
      (await source().linksFor(input("admin.test", { variables: { providerCode: "fake" } })))
        .action,
    ).toBeNull();
    expect((await source().linksFor(input("admin.test", { locale: "a/b" }))).storefront).toBe(
      "https://shop.example.com/a%2Fb",
    );
  });

  it("refuses to build an auth link without the secret or a token id (the mail then fails render_failed)", async () => {
    await expect(
      source({ tokenSecret: null }).linksFor(input("customer.password_reset")),
    ).rejects.toThrow(/ORDER_TOKEN_SECRET/);
    for (const tokenId of [undefined, "x", TOKEN_ID.toUpperCase(), 42]) {
      await expect(
        source().linksFor(input("customer.verify_email", { variables: { tokenId } })),
      ).rejects.toThrow(/token row id/);
    }
  });
});

describe("the order links of the order mails (ADR 0023, ADR 0031 decision 13)", () => {
  const ORDER_ID = "0b6f7a52-1c3e-4d8b-8d0e-1c2b3a4d5e6f";
  const KEY = "9d0e1c2b-3a4d-4e6f-8f3e-6f1c1a528f3e";
  const NUMBER = "7K3M-9QX2";
  const issued = deriveAccessToken(SECRET, ORDER_ID, KEY);
  const access = (hash: string | null = issued.hash): GuestOrderAccessSource => ({
    find: (orderId) =>
      Promise.resolve(
        orderId === ORDER_ID ? { idempotencyKey: KEY, accessTokenHash: hash } : undefined,
      ),
  });
  const orderInput = (templateKey: string, overrides: Partial<EmailLinkInput> = {}) =>
    input(templateKey, {
      recipientKind: "guest",
      orderId: ORDER_ID,
      variables: { orderNumber: NUMBER },
      ...overrides,
    });

  it.each(["order.placed", "order.paid", "shipment.created"])(
    "%s: a guest gets the order page with the token derived from the order id and its idempotency key in the fragment",
    async (templateKey) => {
      const links = await source({}, access()).linksFor(orderInput(templateKey, { locale: "en" }));
      expect(links.action).toBe(`https://shop.example.com/en/order/${NUMBER}#t=${issued.token}`);
      expect(links.storefront).toBe("https://shop.example.com/en");
    },
  );

  it("a customer gets the account order page and no token; an order of a deleted account gets no link", async () => {
    const customer = orderInput("order.placed", {
      recipientKind: "customer",
      customerId: ORDER_ID,
    });
    expect((await source({}, NO_ORDER_ACCESS).linksFor(customer)).action).toBe(
      `https://shop.example.com/uk/account/orders/${NUMBER}`,
    );
    const deleted = orderInput("order.placed", { recipientKind: "customer", customerId: null });
    expect((await source({}, NO_ORDER_ACCESS).linksFor(deleted)).action).toBeNull();
  });

  it("an order mail that is closed (cancelled, expired) and an admin mail have no order link", async () => {
    for (const key of ["order.cancelled", "order.expired"]) {
      expect((await source({}, NO_ORDER_ACCESS).linksFor(orderInput(key))).action).toBeNull();
    }
    const admin = orderInput("order.placed", { recipientKind: "admin" });
    expect((await source({}, NO_ORDER_ACCESS).linksFor(admin)).action).toBeNull();
  });

  it("refuses a dead or impossible guest link: another secret or stored hash, no order, no secret, a bad number", async () => {
    await expect(
      source({}, access("0".repeat(64))).linksFor(orderInput("order.placed")),
    ).rejects.toThrow(/does not match/);
    await expect(source({}, access(null)).linksFor(orderInput("order.placed"))).rejects.toThrow(
      /does not match/,
    );
    await expect(
      source({ tokenSecret: `${SECRET}-rotated` }, access()).linksFor(orderInput("order.placed")),
    ).rejects.toThrow(/does not match/);
    await expect(
      source({}, access()).linksFor(orderInput("order.placed", { orderId: KEY })),
    ).rejects.toThrow(/does not exist/);
    await expect(
      source({ tokenSecret: null }, access()).linksFor(orderInput("order.placed")),
    ).rejects.toThrow(/ORDER_TOKEN_SECRET/);
    await expect(
      source({}, access()).linksFor(orderInput("order.placed", { orderId: null })),
    ).rejects.toThrow(/order id/);
    for (const orderNumber of [undefined, "7k3m-9qx2", "../x", 7]) {
      await expect(
        source({}, access()).linksFor(orderInput("order.placed", { variables: { orderNumber } })),
      ).rejects.toThrow(/order number/);
    }
  });

  it("lets a temporary read failure through as such (the mail is retried, not failed)", async () => {
    const failing: GuestOrderAccessSource = {
      find: () => Promise.reject(new EmailLinkUnavailableError()),
    };
    await expect(source({}, failing).linksFor(orderInput("order.placed"))).rejects.toBeInstanceOf(
      EmailLinkUnavailableError,
    );
  });
});
