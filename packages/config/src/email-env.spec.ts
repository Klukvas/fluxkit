import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_PROVIDER,
  EMAIL_PROVIDER_CHOICES,
  loadEnv,
  parseMailboxVariable,
  TEST_ONLY_EMAIL_PROVIDERS,
} from "./index.js";

const base = { DATABASE_URL: "postgres://x" };
const production = {
  ...base,
  NODE_ENV: "production",
  MEDIA_STORAGE_DRIVER: "none",
  ORDER_TOKEN_SECRET: "p".repeat(40),
};
const FROM = "Fluxkit Demo Shop <shop@mail.example>";

function messageOf(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("loadEnv did not throw");
}

describe("EMAIL_PROVIDER", () => {
  it("is none by default, for unset and blank", () => {
    expect(DEFAULT_EMAIL_PROVIDER).toBe("none");
    expect(loadEnv(base).emailProvider).toBe("none");
    expect(loadEnv({ ...base, EMAIL_PROVIDER: "" }).emailProvider).toBe("none");
    expect(loadEnv({ ...base, EMAIL_PROVIDER: "  " }).emailProvider).toBe("none");
    expect(loadEnv({ ...base, EMAIL_PROVIDER: " none " }).emailProvider).toBe("none");
  });

  it("accepts exactly none, resend and fake", () => {
    expect([...EMAIL_PROVIDER_CHOICES]).toEqual(["none", "resend", "fake"]);
    for (const provider of ["resend", "fake"]) {
      const env = loadEnv({ ...base, EMAIL_PROVIDER: provider, EMAIL_FROM: FROM });
      expect(env.emailProvider).toBe(provider);
    }
  });

  it.each(["None", "FAKE", "smtp", "resend,fake", "none,fake"])(
    "refuses %j loudly, naming the variable, never the value",
    (value) => {
      const message = messageOf({ ...base, EMAIL_PROVIDER: value, EMAIL_FROM: FROM });
      expect(message).toMatch(/EMAIL_PROVIDER: must be one of none, resend, fake/);
      expect(message).not.toContain(value);
    },
  );

  it("lists fake as the only test-only provider", () => {
    expect([...TEST_ONLY_EMAIL_PROVIDERS]).toEqual(["fake"]);
  });

  it.each(["production", "Production", " PRODUCTION "])(
    "refuses the test-only fake provider when NODE_ENV is %j",
    (nodeEnv) => {
      const message = messageOf({
        ...production,
        NODE_ENV: nodeEnv,
        EMAIL_PROVIDER: "fake",
        EMAIL_FROM: FROM,
        STOREFRONT_PUBLIC_URL: "https://shop.example",
      });
      expect(message).toMatch(/EMAIL_PROVIDER: "fake" is a test-only provider/);
    },
  );

  it("accepts the fake provider outside production and resend in production", () => {
    expect(
      loadEnv({ ...base, NODE_ENV: "test", EMAIL_PROVIDER: "fake", EMAIL_FROM: FROM })
        .emailProvider,
    ).toBe("fake");
    expect(
      loadEnv({
        ...production,
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM: FROM,
        STOREFRONT_PUBLIC_URL: "https://shop.example",
      }).emailProvider,
    ).toBe("resend");
  });

  it("does not need a sender or a public URL when the provider is none, in production too", () => {
    const env = loadEnv({ ...production, EMAIL_PROVIDER: "none" });
    expect(env.emailProvider).toBe("none");
    expect(env.emailFrom).toBeUndefined();
    expect(env.emailReplyTo).toBeUndefined();
    expect(env.storefrontPublicUrl).toBeUndefined();
  });
});

describe("EMAIL_FROM and EMAIL_REPLY_TO", () => {
  it("are required together with a provider, never with none", () => {
    expect(loadEnv(base).emailFrom).toBeUndefined();
    const message = messageOf({ ...base, EMAIL_PROVIDER: "fake" });
    expect(message).toMatch(/EMAIL_FROM: is required when EMAIL_PROVIDER is not none/);
    expect(messageOf({ ...base, EMAIL_PROVIDER: "resend", EMAIL_FROM: "  " })).toMatch(
      /EMAIL_FROM: is required/,
    );
  });

  it("reads a named and a bare mailbox into address and display name", () => {
    const named = loadEnv({ ...base, EMAIL_PROVIDER: "fake", EMAIL_FROM: FROM });
    expect(named.emailFrom).toEqual({
      address: "shop@mail.example",
      displayName: "Fluxkit Demo Shop",
    });
    const bare = loadEnv({
      ...base,
      EMAIL_PROVIDER: "fake",
      EMAIL_FROM: "Orders@Mail.Example",
      EMAIL_REPLY_TO: '"Support Team" <help@mail.example>',
    });
    expect(bare.emailFrom).toEqual({ address: "orders@mail.example", displayName: null });
    expect(bare.emailReplyTo).toEqual({
      address: "help@mail.example",
      displayName: "Support Team",
    });
  });

  it("checks the values even when the provider is none, so a typo is found at boot", () => {
    expect(messageOf({ ...base, EMAIL_FROM: "not an address" })).toMatch(
      /EMAIL_FROM must be one address/,
    );
    expect(messageOf({ ...base, EMAIL_REPLY_TO: "a@b.example, c@d.example" })).toMatch(
      /EMAIL_REPLY_TO must be one address/,
    );
  });

  it.each([
    "a@b.example\r\nBcc: x@y.example",
    "Shop\nName <a@b.example>",
    "a@b.example\0",
    "Sh<op> <a@b.example>",
    "Shop <a@b.example> <c@d.example>",
    "Shop <a@b.example> trailing",
    "a@b",
    "a@b.example, c@d.example",
    "<a@b.example",
    "Shop ‮<a@b.example>",
    "а@b.example",
    `${"x".repeat(201)}@b.example`,
    `${"Shop ".repeat(30)} <a@b.example>`,
  ])("refuses the mailbox %j without echoing it", (value) => {
    const message = messageOf({ ...base, EMAIL_PROVIDER: "fake", EMAIL_FROM: value });
    expect(message).toMatch(/EMAIL_FROM must be one address/);
    expect(message).not.toContain(value.trim());
  });

  it("holds the same rules as core for the shapes it accepts", () => {
    expect(parseMailboxVariable('"Shop" <a@b.example>')).toEqual({
      address: "a@b.example",
      displayName: "Shop",
    });
    expect(parseMailboxVariable("<a@b.example>")).toEqual({
      address: "a@b.example",
      displayName: null,
    });
    expect(parseMailboxVariable("")).toBeUndefined();
  });
});

describe("STOREFRONT_PUBLIC_URL for the API", () => {
  it("defaults to the storefront dev origin outside production", () => {
    expect(loadEnv(base).storefrontPublicUrl).toBe("http://localhost:3001");
    expect(loadEnv({ ...base, STOREFRONT_PUBLIC_URL: "" }).storefrontPublicUrl).toBe(
      "http://localhost:3001",
    );
  });

  it("reads an origin, without a trailing slash", () => {
    expect(
      loadEnv({ ...base, STOREFRONT_PUBLIC_URL: "http://127.0.0.1:3101/" }).storefrontPublicUrl,
    ).toBe("http://127.0.0.1:3101");
    expect(
      loadEnv({ ...base, STOREFRONT_PUBLIC_URL: "https://Shop.Example" }).storefrontPublicUrl,
    ).toBe("https://shop.example");
  });

  it.each([
    "https://shop.example/path",
    "https://shop.example/?x=1",
    "https://shop.example/#t",
    "https://user:secret-pass@shop.example",
    "ftp://shop.example",
    "shop.example",
    "https://",
    "javascript:alert(1)",
  ])("refuses %j and never echoes it", (value) => {
    const message = messageOf({ ...base, STOREFRONT_PUBLIC_URL: value });
    expect(message).toMatch(/STOREFRONT_PUBLIC_URL must be an http\(s\) origin/);
    expect(message).not.toContain("secret-pass");
    expect(message).not.toContain(value);
  });

  it("is required in production once a provider is configured, and must be https", () => {
    const withProvider = { ...production, EMAIL_PROVIDER: "resend", EMAIL_FROM: FROM };
    expect(messageOf(withProvider)).toMatch(
      /STOREFRONT_PUBLIC_URL: is required when EMAIL_PROVIDER/,
    );
    expect(messageOf({ ...withProvider, STOREFRONT_PUBLIC_URL: "http://shop.example" })).toMatch(
      /STOREFRONT_PUBLIC_URL: must use https/,
    );
    expect(
      loadEnv({ ...withProvider, STOREFRONT_PUBLIC_URL: "https://shop.example" })
        .storefrontPublicUrl,
    ).toBe("https://shop.example");
  });

  it("outside production a provider works with the default and with http", () => {
    const env = loadEnv({ ...base, EMAIL_PROVIDER: "fake", EMAIL_FROM: FROM });
    expect(env.storefrontPublicUrl).toBe("http://localhost:3001");
    expect(
      loadEnv({
        ...base,
        EMAIL_PROVIDER: "fake",
        EMAIL_FROM: FROM,
        STOREFRONT_PUBLIC_URL: "http://127.0.0.1:3101",
      }).storefrontPublicUrl,
    ).toBe("http://127.0.0.1:3101");
  });

  it("does not demand https from a production shop that sends no mail", () => {
    expect(
      loadEnv({ ...production, STOREFRONT_PUBLIC_URL: "http://shop.example" }).storefrontPublicUrl,
    ).toBe("http://shop.example");
  });
});

describe("secrets never reach an error message", () => {
  it("names variables only, with every other variable invalid at once", () => {
    const secret = "re_secret-key-0123456789abcdef";
    const message = messageOf({
      DATABASE_URL: `postgres://user:${secret}@host/db`,
      NODE_ENV: "production",
      MEDIA_STORAGE_DRIVER: "none",
      ORDER_TOKEN_SECRET: secret,
      EMAIL_PROVIDER: `Fake-${secret}`,
      EMAIL_FROM: `${secret} <bad>`,
      EMAIL_REPLY_TO: `${secret}`,
      STOREFRONT_PUBLIC_URL: `http://user:${secret}@shop.example/x`,
    });
    expect(message).toMatch(/EMAIL_PROVIDER/);
    expect(message).toMatch(/EMAIL_FROM/);
    expect(message).toMatch(/EMAIL_REPLY_TO/);
    expect(message).toMatch(/STOREFRONT_PUBLIC_URL/);
    expect(message).not.toContain(secret);
  });
});
