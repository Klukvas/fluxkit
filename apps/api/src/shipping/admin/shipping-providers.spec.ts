import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { shippingProviderSetting } from "../../database/schema/index.js";
import { testPrincipal } from "../../test/allow-all-admin-authenticator.js";
import {
  testShippingProviders,
  type TestShippingProvider,
} from "../../test/test-shipping-provider.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../../test/admin-user-fixtures.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";

type Json = Record<string, unknown>;

describe("admin shipping provider settings and connection check", () => {
  let signedIn: RunningApp;
  let withoutProviders: RunningApp;
  let tightLimit: RunningApp;
  let db: Database;
  let adminId: string;

  const settingsPath = (code: string) => `/admin/shipping/providers/${code}/settings`;
  const fake = (): TestShippingProvider =>
    signedIn.app.get(ShippingProviderRegistry).get("fake") as TestShippingProvider;

  beforeAll(async () => {
    await ensureMigrated();
    withoutProviders = await startApp();
    db = withoutProviders.app.get<Database>(DRIZZLE);
    // updated_by is a real foreign key: sign in as a user that exists.
    const user = await createTestAdminUser(db, { role: "owner" });
    adminId = user.id;
    const principal = { ...testPrincipal("owner"), userId: user.id };
    signedIn = await startApp({
      extraShippingProviders: testShippingProviders(),
      adminAuthenticator: { authenticate: () => principal },
    });
    tightLimit = await startApp({
      extraShippingProviders: testShippingProviders(),
      adminAuthenticator: { authenticate: () => principal },
      rateLimits: { shippingCheck: { maxAttempts: 2, windowMinutes: 1 } },
    });
  });

  afterEach(async () => {
    await db
      .delete(shippingProviderSetting)
      .where(eq(shippingProviderSetting.providerCode, "fake"));
    fake().reset();
  });

  afterAll(async () => {
    // Before the apps close: the database pool goes with them.
    await deleteTestAdminUsers(db, [adminId]);
    for (const running of [signedIn, withoutProviders, tightLimit]) {
      await running.app.close();
    }
  });

  describe("settings", () => {
    it("answers an empty profile before anything is saved", async () => {
      const result = await http<Json>(signedIn.baseUrl, "GET", settingsPath("fake"));
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        providerCode: "fake",
        settings: {},
        updatedAt: null,
        updatedBy: null,
      });
    });

    it("saves the profile, records who saved it, and replaces it on the next save", async () => {
      const profile = {
        senderCityRef: "fake-city-kyiv",
        defaultParcel: { weightGrams: 500, sizesMm: [100, 100, 100] },
        note: null,
      };
      const saved = await http<Json>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: profile },
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({
        providerCode: "fake",
        settings: profile,
        updatedBy: adminId,
      });
      expect(typeof saved.body.updatedAt).toBe("string");
      const read = await http<Json>(signedIn.baseUrl, "GET", settingsPath("fake"));
      expect(read.body).toEqual(saved.body);

      const second = await http<Json>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { senderCityRef: "fake-city-lviv" } },
      });
      expect(second.body).toMatchObject({ settings: { senderCityRef: "fake-city-lviv" } });
      expect(second.body.settings).not.toHaveProperty("defaultParcel");
      expect(String(second.body.updatedAt) >= String(saved.body.updatedAt)).toBe(true);
      expect(
        await db.$count(shippingProviderSetting, eq(shippingProviderSetting.providerCode, "fake")),
      ).toBe(1);
    });

    it("answers 404 for a provider that is not enabled and 400 for something that is not a provider code", async () => {
      for (const [method, body] of [
        ["GET", undefined],
        ["PUT", { settings: {} }],
      ] as const) {
        const unknown = await http<ProblemBody>(
          withoutProviders.baseUrl,
          method,
          settingsPath("fake"),
          { body },
        );
        expect(unknown.status, method).toBe(404);
        expect(unknown.body, method).toMatchObject({ code: "not_found" });
        const bad = await http<ProblemBody>(
          signedIn.baseUrl,
          method,
          settingsPath("Not%20A%20Code"),
          { body },
        );
        expect(bad.status, method).toBe(400);
        expect(
          bad.body.errors?.map((e) => e.path),
          method,
        ).toEqual(["code"]);
      }
      expect(
        await db.$count(shippingProviderSetting, eq(shippingProviderSetting.providerCode, "fake")),
      ).toBe(0);
    });

    it("refuses anything but { settings: object } and saves nothing", async () => {
      const cases: [unknown, string[]][] = [
        [{}, ["settings:invalid_type"]],
        [{ settings: [] }, ["settings:invalid_type"]],
        [{ settings: "x" }, ["settings:invalid_type"]],
        [{ settings: {}, extra: 1 }, ["extra:unknown_field"]],
      ];
      for (const [body, expected] of cases) {
        const result = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
          body,
        });
        expect(result.status, JSON.stringify(body)).toBe(400);
        expect(
          (result.body.errors ?? []).map((e) => `${e.path}:${e.code}`),
          JSON.stringify(body),
        ).toEqual(expected);
      }
      expect(
        await db.$count(shippingProviderSetting, eq(shippingProviderSetting.providerCode, "fake")),
      ).toBe(0);
    });

    it("keeps credentials out of the database: a key that names one is refused, and the answer never echoes the value", async () => {
      const secret = "sk-live-0123456789-do-not-store";
      const result = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { senderCityRef: "x", apiKey: secret, nested: { Password: secret } } },
      });
      expect(result.status).toBe(400);
      expect((result.body.errors ?? []).map((e) => `${e.path}:${e.code}`).sort()).toEqual([
        "settings.apiKey:secret_not_allowed",
        "settings.nested.Password:secret_not_allowed",
      ]);
      expect(JSON.stringify(result.body)).not.toContain(secret);
      expect(
        await db.$count(shippingProviderSetting, eq(shippingProviderSetting.providerCode, "fake")),
      ).toBe(0);
    });

    it("bounds the profile: depth, size and key shapes", async () => {
      const deep = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { a: { b: { c: { d: { e: { f: 1 } } } } } } },
      });
      expect((deep.body.errors ?? []).map((e) => `${e.path}:${e.code}`)).toEqual([
        "settings.a.b.c.d.e:too_deep",
      ]);
      const proto = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        rawBody: '{"settings": {"__proto__": {"x": 1}}}',
      });
      expect(proto.status).toBe(400);
      expect((proto.body.errors ?? []).map((e) => `${e.path}:${e.code}`)).toEqual([
        "settings.__proto__:invalid_key",
      ]);
      const huge = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: {
          settings: Object.fromEntries(
            Array.from({ length: 40 }, (_, i) => [`k${String(i)}`, "x".repeat(500)]),
          ),
        },
      });
      expect((huge.body.errors ?? []).map((e) => `${e.path}:${e.code}`)).toEqual([
        "settings:too_large",
      ]);
    });

    it("applies the provider's own rules after the bounded check (validateSettings, plan step 7b)", async () => {
      const seen: unknown[] = [];
      fake().settingsIssues = (settings) => {
        seen.push(settings);
        return typeof settings.senderPhone === "string"
          ? []
          : [
              { path: "senderPhone", code: "invalid_type" },
              { path: "defaultParcel.weightGrams", code: "too_small" },
            ];
      };
      const refused = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { defaultParcel: { weightGrams: 0 } } },
      });
      expect(refused.status).toBe(400);
      expect((refused.body.errors ?? []).map((e) => `${e.path}:${e.code}`)).toEqual([
        "settings.senderPhone:invalid_type",
        "settings.defaultParcel.weightGrams:too_small",
      ]);
      // The bounded check comes first: a credential-like key never reaches the provider.
      const secret = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { apiKey: "x" } },
      });
      expect((secret.body.errors ?? []).map((e) => `${e.path}:${e.code}`)).toEqual([
        "settings.apiKey:secret_not_allowed",
      ]);
      expect(seen).toHaveLength(1);
      const accepted = await http<Json>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
        body: { settings: { senderPhone: "380000000000" } },
      });
      expect(accepted.status).toBe(200);
    });

    it("treats a provider validator that breaks the port or throws as a provider bug (500), saving nothing and echoing nothing", async () => {
      const secret = "+380501234567 sk-live-do-not-echo";
      for (const answer of [
        () => [{ path: "senderPhone", code: `The phone ${secret} is wrong` }],
        () => "not a list",
        () => {
          throw new Error(secret);
        },
      ]) {
        fake().settingsIssues = answer;
        const result = await http<ProblemBody>(signedIn.baseUrl, "PUT", settingsPath("fake"), {
          body: { settings: { senderName: "A B" } },
        });
        expect(result.status).toBe(500);
        expect(JSON.stringify(result.body)).not.toContain(secret);
      }
      expect(
        await db.$count(shippingProviderSetting, eq(shippingProviderSetting.providerCode, "fake")),
      ).toBe(0);
    });
  });

  describe("connection check", () => {
    it("answers ok when the provider's check passes", async () => {
      const result = await http<Json>(
        signedIn.baseUrl,
        "POST",
        "/admin/shipping/providers/fake/check",
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
    });

    it("answers the typed reason and carrier codes only, never a message or a key", async () => {
      fake().failNext({
        reason: "invalid_credentials",
        providerCodes: ["401", "KEY_EXPIRED"],
      });
      const failed = await http<Json>(
        signedIn.baseUrl,
        "POST",
        "/admin/shipping/providers/fake/check",
      );
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual({
        ok: false,
        reason: "invalid_credentials",
        providerCodes: ["401", "KEY_EXPIRED"],
      });
      fake().failNext({ reason: "unavailable" });
      const down = await http<Json>(
        signedIn.baseUrl,
        "POST",
        "/admin/shipping/providers/fake/check",
      );
      expect(down.body).toEqual({ ok: false, reason: "unavailable", providerCodes: [] });
      // The failure was consumed: the next check passes again.
      expect(
        (await http<Json>(signedIn.baseUrl, "POST", "/admin/shipping/providers/fake/check")).body,
      ).toEqual({ ok: true });
    });

    it("turns a provider that never answers into 'unavailable' after the API's time limit", async () => {
      fake().failNext({ hang: true });
      const result = await http<Json>(
        signedIn.baseUrl,
        "POST",
        "/admin/shipping/providers/fake/check",
      );
      expect(result.body).toEqual({ ok: false, reason: "unavailable", providerCodes: [] });
    }, 15_000);

    it("answers 404 for a provider that is not enabled and 400 for a malformed code", async () => {
      const unknown = await http<ProblemBody>(
        withoutProviders.baseUrl,
        "POST",
        "/admin/shipping/providers/fake/check",
      );
      expect(unknown.status).toBe(404);
      const bad = await http<ProblemBody>(
        signedIn.baseUrl,
        "POST",
        "/admin/shipping/providers/BAD/check",
      );
      expect(bad.status).toBe(400);
    });

    it("is limited per signed-in admin: the third check inside the window answers 429 with Retry-After", async () => {
      const statuses: number[] = [];
      let last: { headers: Headers; body: ProblemBody } | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await http<ProblemBody>(
          tightLimit.baseUrl,
          "POST",
          "/admin/shipping/providers/fake/check",
        );
        statuses.push(result.status);
        last = result;
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect(last?.body).toMatchObject({ code: "too_many_requests" });
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });
});
