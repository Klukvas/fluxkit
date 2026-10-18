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

describe("loadEnv customer auth", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to a secure cookie, 43 200 idle minutes (30 days) and 2 160 maximum hours (90 days)", () => {
    const env = loadEnv(base);
    expect(env.storeCookieSecure).toBe(true);
    expect(env.customerSessionIdleMinutes).toBe(43_200);
    expect(env.customerSessionMaxHours).toBe(2_160);
  });

  it("parses explicit values and keeps them separate from the admin ones", () => {
    const env = loadEnv({
      ...base,
      STORE_COOKIE_SECURE: "false",
      CUSTOMER_SESSION_IDLE_MINUTES: "60",
      CUSTOMER_SESSION_MAX_HOURS: "12",
    });
    expect(env).toMatchObject({
      storeCookieSecure: false,
      customerSessionIdleMinutes: 60,
      customerSessionMaxHours: 12,
      adminCookieSecure: true,
      adminSessionIdleMinutes: 720,
      adminSessionMaxHours: 168,
    });
  });

  it("accepts the upper bounds exactly (one year)", () => {
    const env = loadEnv({
      ...base,
      CUSTOMER_SESSION_IDLE_MINUTES: "525600",
      CUSTOMER_SESSION_MAX_HOURS: "8760",
    });
    expect(env.customerSessionIdleMinutes).toBe(525_600);
    expect(env.customerSessionMaxHours).toBe(8_760);
  });

  it.each(["TRUE", "False", "1", "0", "yes", "", " true"])(
    "rejects STORE_COOKIE_SECURE=%j loudly instead of guessing",
    (value) => {
      expect(() => loadEnv({ ...base, STORE_COOKIE_SECURE: value })).toThrow(/STORE_COOKIE_SECURE/);
    },
  );

  it.each(["0", "-5", "1.5", "abc", "", "1e3", "0x10", " 12", "525601", "99999999"])(
    "rejects CUSTOMER_SESSION_IDLE_MINUTES=%j",
    (value) => {
      expect(() => loadEnv({ ...base, CUSTOMER_SESSION_IDLE_MINUTES: value })).toThrow(
        /CUSTOMER_SESSION_IDLE_MINUTES/,
      );
    },
  );

  it.each(["0", "-5", "1.5", "abc", "", "1e3", "0x10", " 12", "8761", "99999999"])(
    "rejects CUSTOMER_SESSION_MAX_HOURS=%j",
    (value) => {
      expect(() => loadEnv({ ...base, CUSTOMER_SESSION_MAX_HOURS: value })).toThrow(
        /CUSTOMER_SESSION_MAX_HOURS/,
      );
    },
  );

  it("does not let the admin variables change the customer ones", () => {
    const env = loadEnv({ ...base, ADMIN_COOKIE_SECURE: "false", ADMIN_SESSION_IDLE_MINUTES: "5" });
    expect(env.storeCookieSecure).toBe(true);
    expect(env.customerSessionIdleMinutes).toBe(43_200);
  });
});

describe("loadEnv cart", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults the cart lifetime to 30 days", () => {
    expect(loadEnv(base).cartTtlDays).toBe(30);
  });

  it("accepts the bounds 1 and 365 exactly", () => {
    expect(loadEnv({ ...base, CART_TTL_DAYS: "1" }).cartTtlDays).toBe(1);
    expect(loadEnv({ ...base, CART_TTL_DAYS: "365" }).cartTtlDays).toBe(365);
  });

  it.each(["0", "366", "-5", "1.5", "abc", "", "1e2", "0x10", " 12", "012", "99999999"])(
    "rejects CART_TTL_DAYS=%j",
    (value) => {
      expect(() => loadEnv({ ...base, CART_TTL_DAYS: value })).toThrow(/CART_TTL_DAYS/);
    },
  );
});

describe("loadEnv orders", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to 30 minutes to pay and 90 days of guest access", () => {
    const env = loadEnv(base);
    expect(env.orderPaymentTtlMinutes).toBe(30);
    expect(env.orderGuestAccessDays).toBe(90);
  });

  it("accepts the bounds exactly", () => {
    expect(loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: "5" }).orderPaymentTtlMinutes).toBe(5);
    expect(loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: "1440" }).orderPaymentTtlMinutes).toBe(
      1440,
    );
    expect(loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: "1" }).orderGuestAccessDays).toBe(1);
    expect(loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: "3650" }).orderGuestAccessDays).toBe(3650);
  });

  it.each(["0", "4", "1441", "-5", "30.5", "abc", "", "1e2", "0x10", " 30", "030"])(
    "rejects ORDER_PAYMENT_TTL_MINUTES=%j",
    (value) => {
      expect(() => loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: value })).toThrow(
        /ORDER_PAYMENT_TTL_MINUTES/,
      );
    },
  );

  it.each(["0", "3651", "-1", "1.5", "abc", "", "1e2", "0x10", " 90", "090"])(
    "rejects ORDER_GUEST_ACCESS_DAYS=%j",
    (value) => {
      expect(() => loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: value })).toThrow(
        /ORDER_GUEST_ACCESS_DAYS/,
      );
    },
  );
});

describe("loadEnv ORDER_TOKEN_SECRET", () => {
  const base = { DATABASE_URL: "postgres://x" };
  const SECRET = "o".repeat(32);

  it("is optional outside production and then undefined (the API refuses to start without it)", () => {
    expect(loadEnv(base).orderTokenSecret).toBeUndefined();
    expect(loadEnv({ ...base, NODE_ENV: "development" }).orderTokenSecret).toBeUndefined();
  });

  it("is passed through exactly (never trimmed or altered) when it is at least 32 characters", () => {
    expect(loadEnv({ ...base, ORDER_TOKEN_SECRET: SECRET }).orderTokenSecret).toBe(SECRET);
    expect(loadEnv({ ...base, ORDER_TOKEN_SECRET: ` ${SECRET} ` }).orderTokenSecret).toBe(
      ` ${SECRET} `,
    );
  });

  it.each(["", "short", "o".repeat(31)])(
    "rejects %j as too short, in every environment",
    (value) => {
      expect(() => loadEnv({ ...base, ORDER_TOKEN_SECRET: value })).toThrow(/ORDER_TOKEN_SECRET/);
      expect(() => loadEnv({ ...base, NODE_ENV: "production", ORDER_TOKEN_SECRET: value })).toThrow(
        /ORDER_TOKEN_SECRET/,
      );
    },
  );

  it.each(["production", "Production", " PRODUCTION "])(
    "is required when NODE_ENV is %j",
    (nodeEnv) => {
      expect(() => loadEnv({ ...base, NODE_ENV: nodeEnv })).toThrow(/ORDER_TOKEN_SECRET/);
      expect(
        loadEnv({ ...base, NODE_ENV: nodeEnv, ORDER_TOKEN_SECRET: SECRET }).orderTokenSecret,
      ).toBe(SECRET);
    },
  );

  it("never appears in the error message", () => {
    const secret = "short-secret-value";
    try {
      loadEnv({ ...base, ORDER_TOKEN_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("loadEnv scheduler", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to enabled with a 60 second tick", () => {
    const env = loadEnv(base);
    expect(env.schedulerEnabled).toBe(true);
    expect(env.schedulerIntervalSeconds).toBe(60);
  });

  it("accepts the bounds and both switch values", () => {
    expect(loadEnv({ ...base, SCHEDULER_ENABLED: "false" }).schedulerEnabled).toBe(false);
    expect(loadEnv({ ...base, SCHEDULER_ENABLED: "true" }).schedulerEnabled).toBe(true);
    expect(loadEnv({ ...base, SCHEDULER_INTERVAL_SECONDS: "10" }).schedulerIntervalSeconds).toBe(
      10,
    );
    expect(loadEnv({ ...base, SCHEDULER_INTERVAL_SECONDS: "3600" }).schedulerIntervalSeconds).toBe(
      3600,
    );
  });

  it.each(["TRUE", "yes", "1", "0", "", " true", "off"])(
    "rejects SCHEDULER_ENABLED=%j (exactly true or false)",
    (value) => {
      expect(() => loadEnv({ ...base, SCHEDULER_ENABLED: value })).toThrow(/SCHEDULER_ENABLED/);
    },
  );

  it.each(["0", "9", "3601", "-60", "60.5", "abc", "", "1e2", "0x3c", " 60", "060"])(
    "rejects SCHEDULER_INTERVAL_SECONDS=%j",
    (value) => {
      expect(() => loadEnv({ ...base, SCHEDULER_INTERVAL_SECONDS: value })).toThrow(
        /SCHEDULER_INTERVAL_SECONDS/,
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

describe("loadEnv TRUST_PROXY", () => {
  const base = { DATABASE_URL: "postgres://x" };

  it("defaults to 0: no proxy is trusted", () => {
    expect(loadEnv(base).trustProxy).toBe(0);
  });

  it.each([
    ["0", 0],
    ["1", 1],
    ["2", 2],
    ["10", 10],
  ])("accepts %j hops", (value, expected) => {
    expect(loadEnv({ ...base, TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  it.each(["", "-1", "11", "100", "1.5", "01", "1e1", "0x1", " 1", "true", "loopback", "10.0.0.1"])(
    "rejects %j and names the variable",
    (value) => {
      expect(() => loadEnv({ ...base, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    },
  );

  it("does not echo the rejected value or the other variables in the error", () => {
    try {
      loadEnv({ ...base, DATABASE_URL: "postgres://user:hunter2@db/x", TRUST_PROXY: "secret-ish" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("hunter2");
      expect(String(error)).not.toContain("secret-ish");
    }
  });
});
