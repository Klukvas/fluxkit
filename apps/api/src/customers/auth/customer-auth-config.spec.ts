import {
  DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES,
  DEFAULT_CUSTOMER_SESSION_MAX_HOURS,
  loadEnv,
} from "@fluxkit/config";
import { CUSTOMER_SESSION_DEFAULTS, SESSION_BOUNDS } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerProbeFeature } from "../../test/customer-probe.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { DEFAULT_CUSTOMER_AUTH_CONFIG } from "./customer-auth-config.js";

describe("customer auth rules and their copies agree", () => {
  it("the config package defaults equal CUSTOMER_SESSION_DEFAULTS of @fluxkit/core", () => {
    expect(DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES).toBe(CUSTOMER_SESSION_DEFAULTS.idleMinutes);
    expect(DEFAULT_CUSTOMER_SESSION_MAX_HOURS).toBe(CUSTOMER_SESSION_DEFAULTS.maxHours);
    expect(DEFAULT_CUSTOMER_AUTH_CONFIG).toEqual({
      cookieSecure: true,
      idleMinutes: CUSTOMER_SESSION_DEFAULTS.idleMinutes,
      maxHours: CUSTOMER_SESSION_DEFAULTS.maxHours,
    });
  });

  it("the config bounds equal SESSION_BOUNDS of @fluxkit/core: the bound passes and one more fails", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(
      loadEnv({ ...base, CUSTOMER_SESSION_IDLE_MINUTES: String(SESSION_BOUNDS.maxIdleMinutes) }),
    ).toBeDefined();
    expect(() =>
      loadEnv({
        ...base,
        CUSTOMER_SESSION_IDLE_MINUTES: String(SESSION_BOUNDS.maxIdleMinutes + 1),
      }),
    ).toThrow(/CUSTOMER_SESSION_IDLE_MINUTES/);
    expect(
      loadEnv({ ...base, CUSTOMER_SESSION_MAX_HOURS: String(SESSION_BOUNDS.maxMaxHours) }),
    ).toBeDefined();
    expect(() =>
      loadEnv({ ...base, CUSTOMER_SESSION_MAX_HOURS: String(SESSION_BOUNDS.maxMaxHours + 1) }),
    ).toThrow(/CUSTOMER_SESSION_MAX_HOURS/);
  });
});

describe("the customer cookie follows STORE_COOKIE_SECURE and CUSTOMER_SESSION_MAX_HOURS", () => {
  let insecure: RunningApp;
  let secureByDefault: RunningApp;
  let db: Database;
  const created: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    insecure = await startApp({
      storeCookieSecure: false,
      customerSessionMaxHours: 2,
      extraFeatures: customerProbeFeature,
    });
    secureByDefault = await startApp({ extraFeatures: customerProbeFeature });
    db = insecure.app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await deleteTestCustomers(db, created);
    await insecure.app.close();
    await secureByDefault.app.close();
  });

  async function setCookieAttributes(running: RunningApp): Promise<string[]> {
    const shopper = await createTestCustomer(db);
    created.push(shopper.id);
    const result = await http(running.baseUrl, "POST", "/store/probe-customer/sign-in", {
      body: { customerId: shopper.id },
    });
    const [header = ""] = result.headers.getSetCookie();
    return header.split("; ").map((part) => part.toLowerCase());
  }

  it("omits Secure only when STORE_COOKIE_SECURE=false, and uses the configured Max-Age", async () => {
    const attributes = await setCookieAttributes(insecure);
    expect(attributes).not.toContain("secure");
    expect(attributes).toContain("max-age=7200");
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");
    expect(attributes).toContain("path=/store");
  });

  it("is Secure when the variable is not set (secure by default)", async () => {
    const attributes = await setCookieAttributes(secureByDefault);
    expect(attributes).toContain("secure");
    expect(attributes).toContain(`max-age=${CUSTOMER_SESSION_DEFAULTS.maxHours * 3600}`);
  });

  it("the admin cookie setting does not change the customer cookie", async () => {
    const adminInsecure = await startApp({
      adminCookieSecure: false,
      extraFeatures: customerProbeFeature,
    });
    try {
      const shopper = await createTestCustomer(adminInsecure.app.get<Database>(DRIZZLE));
      created.push(shopper.id);
      const result = await http(adminInsecure.baseUrl, "POST", "/store/probe-customer/sign-in", {
        body: { customerId: shopper.id },
      });
      const attributes = (result.headers.getSetCookie()[0] ?? "")
        .split("; ")
        .map((part) => part.toLowerCase());
      expect(attributes).toContain("secure");
    } finally {
      await adminInsecure.app.close();
    }
  });
});
