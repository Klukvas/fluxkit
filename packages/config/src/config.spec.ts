import { describe, expect, it } from "vitest";
import { loadEnv, parseEnabledFeatures } from "./index.js";

describe("parseEnabledFeatures", () => {
  it("returns an empty list for unset or blank input", () => {
    expect(parseEnabledFeatures(undefined)).toEqual([]);
    expect(parseEnabledFeatures("  ")).toEqual([]);
  });

  it("trims, lowercases and de-duplicates names", () => {
    expect(parseEnabledFeatures(" Example, wishlist ,example")).toEqual(["example", "wishlist"]);
  });

  it("rejects invalid feature names loudly", () => {
    expect(() => parseEnabledFeatures("ok,Bad Name!")).toThrow(/Invalid feature name/);
  });
});

describe("loadEnv", () => {
  it("applies defaults and parses features", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", FEATURES_ENABLED: "example" });
    expect(env.port).toBe(3000);
    expect(env.enabledFeatures).toEqual(["example"]);
    expect(env.redisUrl).toBeUndefined();
  });

  it("fails with a readable message when DATABASE_URL is missing", () => {
    expect(() => loadEnv({})).toThrow(/Invalid environment: DATABASE_URL/);
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadEnv({ DATABASE_URL: "x", PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("loadEnv locales", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to uk with locales uk and en", () => {
    const env = loadEnv(base);
    expect(env.defaultLocale).toBe("uk");
    expect(env.locales).toEqual(["uk", "en"]);
  });

  it("parses a custom list, trimming spaces", () => {
    const env = loadEnv({ ...base, DEFAULT_LOCALE: "en", LOCALES: "en, uk ,pl" });
    expect(env.defaultLocale).toBe("en");
    expect(env.locales).toEqual(["en", "uk", "pl"]);
  });

  it("accepts region segments", () => {
    const env = loadEnv({ ...base, DEFAULT_LOCALE: "en-us", LOCALES: "en-us,uk" });
    expect(env.locales).toEqual(["en-us", "uk"]);
  });

  it("rejects a default locale missing from the list", () => {
    expect(() => loadEnv({ ...base, DEFAULT_LOCALE: "de" })).toThrow(/DEFAULT_LOCALE/);
  });

  it("rejects duplicates", () => {
    expect(() => loadEnv({ ...base, LOCALES: "uk,en,uk" })).toThrow(/duplicate/i);
  });

  it.each(["UK,en", "u,en", "uk,e n", "uk,,en", "uk,en_US", "uk,-en", "uk,en-", "abcdefghi,uk"])(
    "rejects invalid locale list %j",
    (locales) => {
      expect(() => loadEnv({ ...base, LOCALES: locales })).toThrow(/LOCALES/);
    },
  );

  it("rejects an invalid default locale code", () => {
    expect(() => loadEnv({ ...base, DEFAULT_LOCALE: "UK" })).toThrow(/DEFAULT_LOCALE/);
  });

  it("rejects an empty LOCALES value", () => {
    expect(() => loadEnv({ ...base, LOCALES: "" })).toThrow(/LOCALES/);
  });
});

describe("loadEnv admin auth", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to a secure cookie, 720 idle minutes and 168 maximum hours", () => {
    const env = loadEnv(base);
    expect(env.adminCookieSecure).toBe(true);
    expect(env.adminSessionIdleMinutes).toBe(720);
    expect(env.adminSessionMaxHours).toBe(168);
  });

  it("parses explicit values", () => {
    const env = loadEnv({
      ...base,
      ADMIN_COOKIE_SECURE: "false",
      ADMIN_SESSION_IDLE_MINUTES: "30",
      ADMIN_SESSION_MAX_HOURS: "8",
    });
    expect(env).toMatchObject({
      adminCookieSecure: false,
      adminSessionIdleMinutes: 30,
      adminSessionMaxHours: 8,
    });
  });

  it.each(["TRUE", "False", "1", "0", "yes", "", " true"])(
    "rejects ADMIN_COOKIE_SECURE=%j loudly instead of guessing",
    (value) => {
      expect(() => loadEnv({ ...base, ADMIN_COOKIE_SECURE: value })).toThrow(/ADMIN_COOKIE_SECURE/);
    },
  );

  it.each(["0", "-5", "1.5", "abc", "", "1e3", "0x10", " 12", "99999999"])(
    "rejects ADMIN_SESSION_IDLE_MINUTES=%j",
    (value) => {
      expect(() => loadEnv({ ...base, ADMIN_SESSION_IDLE_MINUTES: value })).toThrow(
        /ADMIN_SESSION_IDLE_MINUTES/,
      );
    },
  );

  it.each(["0", "-5", "1.5", "abc", "", "1e3", "0x10", " 12", "99999999"])(
    "rejects ADMIN_SESSION_MAX_HOURS=%j",
    (value) => {
      expect(() => loadEnv({ ...base, ADMIN_SESSION_MAX_HOURS: value })).toThrow(
        /ADMIN_SESSION_MAX_HOURS/,
      );
    },
  );
});

describe("loadEnv pricing", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to UAH, prices including tax and a low-stock threshold of 5", () => {
    const env = loadEnv(base);
    expect(env.shopCurrency).toBe("UAH");
    expect(env.pricesIncludeTax).toBe(true);
    expect(env.lowStockThreshold).toBe(5);
  });

  it("parses explicit values", () => {
    const env = loadEnv({
      ...base,
      SHOP_CURRENCY: "JPY",
      PRICES_INCLUDE_TAX: "false",
      LOW_STOCK_THRESHOLD: "0",
    });
    expect(env).toMatchObject({
      shopCurrency: "JPY",
      pricesIncludeTax: false,
      lowStockThreshold: 0,
    });
  });

  it.each(["uah", "Uah", "UAH ", " UAH", "XXX", "US", "USDD", "", "hryvnia", "__proto__"])(
    "rejects SHOP_CURRENCY=%j loudly",
    (value) => {
      expect(() => loadEnv({ ...base, SHOP_CURRENCY: value })).toThrow(/SHOP_CURRENCY/);
    },
  );

  it.each(["TRUE", "False", "1", "0", "yes", "", " true"])(
    "rejects PRICES_INCLUDE_TAX=%j loudly instead of guessing",
    (value) => {
      expect(() => loadEnv({ ...base, PRICES_INCLUDE_TAX: value })).toThrow(/PRICES_INCLUDE_TAX/);
    },
  );

  it.each(["-1", "1.5", "abc", "", "1e3", "0x10", " 5", "05", "+5", "1000000001"])(
    "rejects LOW_STOCK_THRESHOLD=%j",
    (value) => {
      expect(() => loadEnv({ ...base, LOW_STOCK_THRESHOLD: value })).toThrow(/LOW_STOCK_THRESHOLD/);
    },
  );
});
