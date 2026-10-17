import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordHasher } from "../../auth/password-hasher.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession } from "../../database/schema/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerCookieOf, customerLogin, customerSetCookieOf } from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

const PASSWORD = "correct horse battery staple";
const WRONG = "definitely not the password";
const MAX_HOURS = 24;

type LoginResult = HttpResult<
  { customer: Record<string, unknown>; cartNotices: unknown[] } & ProblemBody
>;

describe("POST /store/account/login", () => {
  const clock = new FakeClock("2030-05-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  async function newCustomer(
    options: { isActive?: boolean; password?: string } = {},
  ): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD, ...options });
    created.push(made.id);
    return made;
  }

  const login = (email: string, password: string, cookie?: string) =>
    customerLogin<LoginResult["body"]>(running.baseUrl, email, password, cookie);

  async function stateOf(id: string) {
    const [row] = await db.select().from(customer).where(eq(customer.id, id));
    if (row === undefined) {
      throw new Error("customer vanished");
    }
    return row;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      customerSessionMaxHours: MAX_HOURS,
    });
    db = running.app.get<Database>(DRIZZLE);
  });

  beforeEach(() => {
    // A fresh rate-limit window per test (20 logins per 10 minutes per address; the limiter shares this clock).
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteTestCustomers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  describe("success", () => {
    it("answers 200 with only the public customer and sets the session cookie with the exact attributes", async () => {
      const shopper = await newCustomer();
      const result = await login(shopper.email, PASSWORD);
      expect(result.status).toBe(200);
      expect(Object.keys(result.body)).toEqual(["customer", "cartNotices"]);
      expect(result.body.cartNotices).toEqual([]);
      expect(Object.keys(result.body.customer).sort()).toEqual(
        ["createdAt", "email", "firstName", "id", "lastName", "phone"].sort(),
      );
      expect(result.body.customer).toMatchObject({ id: shopper.id, email: shopper.email });
      expect(result.headers.get("cache-control")).toBe("no-store");

      const header = customerSetCookieOf(result) ?? "";
      const [pair, ...attributes] = header.split("; ");
      expect(pair).toMatch(/^fluxkit_customer_session=[A-Za-z0-9_-]{43}$/);
      expect(attributes).toEqual(
        expect.arrayContaining([
          "Path=/store",
          "HttpOnly",
          "SameSite=Lax",
          "Secure",
          `Max-Age=${MAX_HOURS * 3600}`,
        ]),
      );
      // Express computes Expires from the real clock; Max-Age (from the injected one) is asserted above.
      expect(attributes.some((attribute) => attribute.startsWith("Expires="))).toBe(true);
      expect(attributes).not.toContain("Domain");
    });

    it("omits Secure only when STORE_COOKIE_SECURE=false", async () => {
      const insecure = await startApp({ storeCookieSecure: false, clock });
      try {
        const shopper = await newCustomer();
        const result = await customerLogin(insecure.baseUrl, shopper.email, PASSWORD);
        expect(result.status).toBe(200);
        const attributes = (customerSetCookieOf(result) ?? "").split("; ");
        expect(attributes).not.toContain("Secure");
        expect(attributes).toContain("HttpOnly");
      } finally {
        await insecure.app.close();
      }
    });

    it("stamps last_login_at, resets the failure counters and stores only the hash of the token", async () => {
      const shopper = await newCustomer();
      await login(shopper.email, WRONG);
      await login(shopper.email, WRONG);
      expect((await stateOf(shopper.id)).failedLoginCount).toBe(2);

      const result = await login(shopper.email, PASSWORD);
      expect(result.status).toBe(200);
      const row = await stateOf(shopper.id);
      expect(row.failedLoginCount).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.lastLoginAt?.toISOString()).toBe(clock.now().toISOString());

      const token = (customerCookieOf(result) ?? "").replace("fluxkit_customer_session=", "");
      const sessions = await db
        .select()
        .from(customerSession)
        .where(eq(customerSession.customerId, shopper.id));
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(JSON.stringify(sessions)).not.toContain(token);
    });

    it("matches the email whatever its case or spacing", async () => {
      const shopper = await newCustomer();
      const result = await login(`  ${shopper.email.toUpperCase()} `, PASSWORD);
      expect(result.status).toBe(200);
      expect(result.body.customer["id"]).toBe(shopper.id);
    });

    it("stores a fresh hash when the stored scrypt parameters are not the current ones", async () => {
      const shopper = await newCustomer();
      const oldHash = await new PasswordHasher({ N: 32, r: 8, p: 1 }).hash(PASSWORD);
      await db.update(customer).set({ passwordHash: oldHash }).where(eq(customer.id, shopper.id));
      expect((await login(shopper.email, PASSWORD)).status).toBe(200);
      const upgraded = (await stateOf(shopper.id)).passwordHash;
      expect(upgraded).not.toBe(oldHash);
      expect(upgraded.startsWith("scrypt$16$8$1$")).toBe(true);
      expect((await login(shopper.email, PASSWORD)).status).toBe(200);
    });

    it("every login is a NEW session with a NEW token (parallel sessions are allowed)", async () => {
      const shopper = await newCustomer();
      const first = await login(shopper.email, PASSWORD);
      const second = await login(shopper.email, PASSWORD);
      expect(customerCookieOf(first)).not.toBe(customerCookieOf(second));
      for (const result of [first, second]) {
        const me = await http(running.baseUrl, "GET", "/store/account/me", {
          headers: { cookie: customerCookieOf(result) ?? "" },
        });
        expect(me.status).toBe(200);
      }
    });
  });

  describe("session fixation", () => {
    it("revokes the session of the cookie the request carried and issues a different token", async () => {
      const shopper = await newCustomer();
      const first = await login(shopper.email, PASSWORD);
      const oldCookie = customerCookieOf(first) ?? "";

      const second = await login(shopper.email, PASSWORD, oldCookie);
      expect(second.status).toBe(200);
      const newCookie = customerCookieOf(second) ?? "";
      expect(newCookie).not.toBe("");
      expect(newCookie).not.toBe(oldCookie);

      const stale = await http(running.baseUrl, "GET", "/store/account/me", {
        headers: { cookie: oldCookie },
      });
      expect(stale.status).toBe(401);
      const fresh = await http(running.baseUrl, "GET", "/store/account/me", {
        headers: { cookie: newCookie },
      });
      expect(fresh.status).toBe(200);
      const sessions = await db
        .select()
        .from(customerSession)
        .where(eq(customerSession.customerId, shopper.id));
      expect(sessions).toHaveLength(1);
    });

    it("signing in as another customer ends the session the browser still held", async () => {
      const [alice, bob] = [await newCustomer(), await newCustomer()];
      const aliceCookie = customerCookieOf(await login(alice.email, PASSWORD)) ?? "";
      const asBob = await login(bob.email, PASSWORD, aliceCookie);
      expect(asBob.status).toBe(200);
      expect(
        (
          await http(running.baseUrl, "GET", "/store/account/me", {
            headers: { cookie: aliceCookie },
          })
        ).status,
      ).toBe(401);
    });

    it("a FAILED login revokes nothing and a made-up cookie value is ignored", async () => {
      const shopper = await newCustomer();
      const held = customerCookieOf(await login(shopper.email, PASSWORD)) ?? "";
      const failed = await login(shopper.email, WRONG, held);
      expect(failed.status).toBe(401);
      expect(customerSetCookieOf(failed)).toBeUndefined();
      expect(
        (await http(running.baseUrl, "GET", "/store/account/me", { headers: { cookie: held } }))
          .status,
      ).toBe(200);
      const bogus = await login(
        shopper.email,
        PASSWORD,
        `fluxkit_customer_session=${"A".repeat(43)}`,
      );
      expect(bogus.status).toBe(200);
    });
  });

  describe("identical failures (no account enumeration)", () => {
    async function lockedCustomer(): Promise<TestCustomer> {
      const shopper = await newCustomer();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(shopper.email, WRONG);
      }
      expect((await stateOf(shopper.id)).lockedUntil).not.toBeNull();
      return shopper;
    }

    it("unknown email, wrong password, locked and inactive answer the same status, headers and body, with no cookie", async () => {
      const wrongPassword = await newCustomer();
      const inactive = await newCustomer({ isActive: false });
      const locked = await lockedCustomer();
      const results: [string, LoginResult][] = [
        ["unknown", await login("nobody-at-all@example.test", PASSWORD)],
        ["wrong password", await login(wrongPassword.email, WRONG)],
        ["inactive, right password", await login(inactive.email, PASSWORD)],
        ["inactive, wrong password", await login(inactive.email, WRONG)],
        ["locked, right password", await login(locked.email, PASSWORD)],
        ["locked, wrong password", await login(locked.email, WRONG)],
      ];
      const [, reference] = results[0] as [string, LoginResult];
      expect(reference.status).toBe(401);
      expect(reference.body).toMatchObject({ code: "unauthorized", status: 401 });
      const comparableHeaders = (result: LoginResult) =>
        [...result.headers]
          .filter(
            ([name]) =>
              !["date", "etag", "content-length", "keep-alive", "connection"].includes(name),
          )
          .sort();
      for (const [name, result] of results) {
        expect(result.status, name).toBe(reference.status);
        expect(result.body, name).toEqual(reference.body);
        expect(comparableHeaders(result), name).toEqual(comparableHeaders(reference));
        expect(result.headers.get("set-cookie"), name).toBeNull();
        expect(result.headers.get("cache-control"), name).toBe("no-store");
      }
      // Neither the email nor a hint of the reason appears in the body.
      const text = JSON.stringify(reference.body);
      expect(text).not.toMatch(/locked|inactive|unknown|exist|no account/i);
    });

    it("an inactive or locked account is refused although the password is right, and no session is created", async () => {
      const inactive = await newCustomer({ isActive: false });
      const locked = await lockedCustomer();
      for (const shopper of [inactive, locked]) {
        expect((await login(shopper.email, PASSWORD)).status).toBe(401);
        const sessions = await db
          .select()
          .from(customerSession)
          .where(eq(customerSession.customerId, shopper.id));
        expect(sessions).toHaveLength(0);
      }
    });

    it("does one password-hash computation for EVERY failure, an unknown email included (response time must not tell)", async () => {
      const hasher = running.app.get(PasswordHasher);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const wrongPassword = await newCustomer();
      const inactive = await newCustomer({ isActive: false });
      const locked = await lockedCustomer();
      verify.mockClear();
      dummy.mockClear();

      const work = async (email: string): Promise<number> => {
        verify.mockClear();
        dummy.mockClear();
        await login(email, WRONG);
        return verify.mock.calls.length + dummy.mock.calls.length;
      };
      expect(await work("nobody-at-all@example.test")).toBe(1);
      expect(dummy).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
      expect(await work(wrongPassword.email)).toBe(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(await work(inactive.email)).toBe(1);
      expect(dummy).toHaveBeenCalledTimes(1);
      expect(await work(locked.email)).toBe(1);
      expect(dummy).toHaveBeenCalledTimes(1);
    });
  });

  describe("lockout (5 failures lock for 15 minutes)", () => {
    it("locks on the 5th failure; a right password is then refused until the lock expires; a login resets the count", async () => {
      const shopper = await newCustomer();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect((await login(shopper.email, WRONG)).status).toBe(401);
        expect((await stateOf(shopper.id)).lockedUntil, `after ${attempt}`).toBeNull();
      }
      expect((await stateOf(shopper.id)).failedLoginCount).toBe(4);
      expect((await login(shopper.email, WRONG)).status).toBe(401);
      const locked = await stateOf(shopper.id);
      expect(locked.failedLoginCount).toBe(5);
      expect(locked.lockedUntil?.toISOString()).toBe(
        new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
      );

      expect((await login(shopper.email, PASSWORD)).status).toBe(401);
      clock.advanceMinutes(14);
      expect((await login(shopper.email, PASSWORD)).status).toBe(401);
      // Failures during the lock neither count nor extend it.
      const during = await stateOf(shopper.id);
      expect(during.failedLoginCount).toBe(5);
      expect(during.lockedUntil?.toISOString()).toBe(locked.lockedUntil?.toISOString());

      clock.advanceMinutes(1);
      const after = await login(shopper.email, PASSWORD);
      expect(after.status).toBe(200);
      const reset = await stateOf(shopper.id);
      expect(reset.failedLoginCount).toBe(0);
      expect(reset.lockedUntil).toBeNull();
    });

    it("an expired lock starts a fresh count", async () => {
      const shopper = await newCustomer();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(shopper.email, WRONG);
      }
      clock.advanceMinutes(15);
      expect((await login(shopper.email, WRONG)).status).toBe(401);
      const row = await stateOf(shopper.id);
      expect(row.failedLoginCount).toBe(1);
      expect(row.lockedUntil).toBeNull();
    });

    it("the lock is per account: another customer is unaffected", async () => {
      const [target, bystander] = [await newCustomer(), await newCustomer()];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(target.email, WRONG);
      }
      expect((await login(bystander.email, PASSWORD)).status).toBe(200);
    });

    it("existing sessions survive a lock (it only stops new sign-ins)", async () => {
      const shopper = await newCustomer();
      const cookie = customerCookieOf(await login(shopper.email, PASSWORD)) ?? "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(shopper.email, WRONG);
      }
      expect(
        (await http(running.baseUrl, "GET", "/store/account/me", { headers: { cookie } })).status,
      ).toBe(200);
    });
  });

  describe("request rules", () => {
    it("limits login attempts per address: the 21st in 10 minutes is 429 with Retry-After, before any lookup", async () => {
      const hasher = running.app.get(PasswordHasher);
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const result = await login("nobody-at-all@example.test", WRONG);
        expect(result.status, `attempt ${attempt}`).toBe(401);
      }
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const limited = await login("nobody-at-all@example.test", WRONG);
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: "too_many_requests" });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(limited.headers.get("cache-control")).toBe("no-store");
      expect(dummy).not.toHaveBeenCalled();
      // The window ends.
      clock.advanceMinutes(10);
      expect((await login("nobody-at-all@example.test", WRONG)).status).toBe(401);
    });

    it("its limit is separate from the admin login limit", async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await login("nobody-at-all@example.test", WRONG);
      }
      const admin = await http<ProblemBody>(running.baseUrl, "POST", "/admin/auth/login", {
        body: { email: "nobody-at-all@example.test", password: WRONG },
      });
      expect(admin.status).toBe(401);
    });

    it("needs the CSRF header", async () => {
      const shopper = await newCustomer();
      const result = await http<ProblemBody>(running.baseUrl, "POST", "/store/account/login", {
        body: { email: shopper.email, password: PASSWORD },
        csrf: false,
      });
      expect(result.status).toBe(403);
      expect(result.headers.get("set-cookie")).toBeNull();
    });

    it("is strict about the body", async () => {
      const cases: [unknown, string, string][] = [
        [{ email: "a@b.test", password: "x", rememberMe: true }, "rememberMe", "unknown_field"],
        [{ email: "a@b.test" }, "password", "required"],
        [{ password: "x" }, "email", "required"],
        [{ email: 5, password: "x" }, "email", "invalid_type"],
        [{ email: "a@b.test", password: "x".repeat(1025) }, "password", "too_big"],
      ];
      for (const [payload, path, code] of cases) {
        const result = await http<ProblemBody>(running.baseUrl, "POST", "/store/account/login", {
          body: payload,
        });
        expect(result.status, JSON.stringify(payload)).toBe(400);
        expect(result.body.errors).toContainEqual(expect.objectContaining({ path, code }));
      }
    });
  });
});
