import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession } from "../../database/schema/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import {
  customerLogin,
  customerLoginCookie,
  customerSetCookieOf,
} from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const WRONG = "definitely not the password";

interface AccountBody {
  customer: Record<string, unknown>;
}

describe("the signed-in customer account: logout, me, profile, change-password", () => {
  const clock = new FakeClock("2030-06-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  async function newCustomer(): Promise<TestCustomer> {
    const made = await createTestCustomer(db, { password: PASSWORD });
    created.push(made.id);
    return made;
  }

  async function signedIn(): Promise<{ shopper: TestCustomer; cookie: string }> {
    const shopper = await newCustomer();
    return { shopper, cookie: await customerLoginCookie(running.baseUrl, shopper.email, PASSWORD) };
  }

  const call = <T = AccountBody & ProblemBody>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    cookie: string | undefined,
    body?: unknown,
  ): Promise<HttpResult<T>> =>
    http<T>(running.baseUrl, method, path, {
      ...(body === undefined ? {} : { body }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });

  async function sessionCount(customerId: string): Promise<number> {
    return db.$count(customerSession, eq(customerSession.customerId, customerId));
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
  });

  beforeEach(() => {
    // A fresh login rate-limit window per test (the limiter shares this clock).
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    await deleteTestCustomers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  describe("every route needs the customer session", () => {
    it("answers the identical 401 without a cookie and with a bogus one, with no-store and no Set-Cookie", async () => {
      const bogus = `fluxkit_customer_session=${"A".repeat(43)}`;
      const routes: ["GET" | "POST" | "PATCH", string, unknown][] = [
        ["GET", "/store/account/me", undefined],
        ["PATCH", "/store/account/me", { firstName: "X" }],
        ["POST", "/store/account/logout", undefined],
        [
          "POST",
          "/store/account/change-password",
          { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        ],
      ];
      for (const [method, path, body] of routes) {
        for (const cookie of [undefined, bogus]) {
          const result = await call<ProblemBody>(method, path, cookie, body);
          expect(result.status, `${method} ${path}`).toBe(401);
          expect(result.body).toMatchObject({ code: "unauthorized" });
          expect(result.headers.get("cache-control")).toBe("no-store");
          expect(result.headers.get("set-cookie")).toBeNull();
        }
      }
    });
  });

  describe("logout", () => {
    it("deletes this session only, clears the cookie with the same path and answers 204", async () => {
      const { shopper, cookie } = await signedIn();
      const other = await customerLoginCookie(running.baseUrl, shopper.email, PASSWORD);
      expect(await sessionCount(shopper.id)).toBe(2);

      const result = await call<undefined>("POST", "/store/account/logout", cookie);
      expect(result.status).toBe(204);
      const cleared = customerSetCookieOf(result) ?? "";
      expect(cleared).toContain("fluxkit_customer_session=;");
      expect(cleared).toContain("Path=/store");
      expect(cleared).toContain("HttpOnly");
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(result.headers.get("cache-control")).toBe("no-store");

      expect(await sessionCount(shopper.id)).toBe(1);
      expect((await call("GET", "/store/account/me", cookie)).status).toBe(401);
      expect((await call("GET", "/store/account/me", other)).status).toBe(200);
    });

    it("a second logout with the dead cookie is 401", async () => {
      const { cookie } = await signedIn();
      expect((await call("POST", "/store/account/logout", cookie)).status).toBe(204);
      expect((await call("POST", "/store/account/logout", cookie)).status).toBe(401);
    });
  });

  describe("me", () => {
    it("returns only the public customer of the cookie's owner, with no-store", async () => {
      const { shopper, cookie } = await signedIn();
      const result = await call("GET", "/store/account/me", cookie);
      expect(result.status).toBe(200);
      expect(Object.keys(result.body)).toEqual(["customer"]);
      expect(Object.keys(result.body.customer).sort()).toEqual(
        ["createdAt", "email", "emailVerified", "firstName", "id", "lastName", "phone"].sort(),
      );
      expect(result.body.customer).toMatchObject({
        id: shopper.id,
        email: shopper.email,
        firstName: "Test",
        lastName: "Customer",
        phone: null,
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(result.body)).not.toContain("scrypt");
    });

    it("ownership: each customer sees only their own record, and no query, header or body can redirect it", async () => {
      const alice = await signedIn();
      const bob = await signedIn();
      const asAlice = await http<AccountBody>(
        running.baseUrl,
        "GET",
        `/store/account/me?customerId=${bob.shopper.id}&id=${bob.shopper.id}`,
        {
          headers: {
            cookie: alice.cookie,
            "x-customer-id": bob.shopper.id,
            "x-forwarded-user": bob.shopper.email,
          },
        },
      );
      expect(asAlice.body.customer["id"]).toBe(alice.shopper.id);
      const asBob = await call("GET", "/store/account/me", bob.cookie);
      expect(asBob.body.customer["id"]).toBe(bob.shopper.id);
      expect(JSON.stringify(asAlice.body)).not.toContain(bob.shopper.email);
    });
  });

  describe("PATCH me", () => {
    it("changes names and phone of the caller and nobody else", async () => {
      const alice = await signedIn();
      const bob = await signedIn();
      const result = await call("PATCH", "/store/account/me", alice.cookie, {
        firstName: "  Olena ",
        lastName: "Shevchenko",
        phone: "+380 50 123 45 67",
      });
      expect(result.status).toBe(200);
      expect(result.body.customer).toMatchObject({
        id: alice.shopper.id,
        firstName: "Olena",
        lastName: "Shevchenko",
        phone: "+380501234567",
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
      const [aliceRow] = await db.select().from(customer).where(eq(customer.id, alice.shopper.id));
      expect(aliceRow?.firstName).toBe("Olena");
      const [bobRow] = await db.select().from(customer).where(eq(customer.id, bob.shopper.id));
      expect(bobRow).toMatchObject({ firstName: "Test", lastName: "Customer", phone: null });
    });

    it("phone: null removes the phone; a partial body changes only what was sent; an empty body changes nothing", async () => {
      const { cookie } = await signedIn();
      await call("PATCH", "/store/account/me", cookie, { phone: "0501234567" });
      const partial = await call("PATCH", "/store/account/me", cookie, { lastName: "Bondar" });
      expect(partial.body.customer).toMatchObject({
        firstName: "Test",
        lastName: "Bondar",
        phone: "0501234567",
      });
      const removed = await call("PATCH", "/store/account/me", cookie, { phone: null });
      expect(removed.body.customer["phone"]).toBeNull();
      const empty = await call("PATCH", "/store/account/me", cookie, {});
      expect(empty.status).toBe(200);
      expect(empty.body.customer).toMatchObject({ lastName: "Bondar", phone: null });
    });

    it("is strict: email, id, activity, lockout, hash and every unknown field are 400 and change nothing", async () => {
      const { shopper, cookie } = await signedIn();
      const before = (await db.select().from(customer).where(eq(customer.id, shopper.id)))[0];
      const forbiddenFields: Record<string, unknown> = {
        email: "someone-else@example.test",
        id: "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f",
        isActive: false,
        passwordHash: "scrypt$16$8$1$AAAAAAAAAAAAAAAAAAAAAA==$x",
        failedLoginCount: 0,
        lockedUntil: null,
        emailVerifiedAt: "2030-01-01T00:00:00.000Z",
        role: "owner",
        customerId: "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f",
      };
      for (const [field, value] of Object.entries(forbiddenFields)) {
        const result = await call<ProblemBody>("PATCH", "/store/account/me", cookie, {
          firstName: "Changed",
          [field]: value,
        });
        expect(result.status, field).toBe(400);
        expect(result.body.errors, field).toContainEqual(
          expect.objectContaining({ path: field, code: "unknown_field" }),
        );
      }
      const after = (await db.select().from(customer).where(eq(customer.id, shopper.id)))[0];
      expect(after).toEqual(before);
    });

    it("validates names and phone with the registration rules, all errors at once", async () => {
      const { cookie } = await signedIn();
      const result = await call<ProblemBody>("PATCH", "/store/account/me", cookie, {
        firstName: "   ",
        lastName: "x".repeat(101),
        phone: "abc",
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "firstName", code: "empty" }),
          expect.objectContaining({ path: "lastName", code: "too_long" }),
          expect.objectContaining({ path: "phone", code: "invalid_format" }),
        ]),
      );
      for (const bad of [{ firstName: null }, { lastName: 5 }, { phone: 5 }]) {
        expect((await call("PATCH", "/store/account/me", cookie, bad)).status).toBe(400);
      }
    });

    it("needs the CSRF header", async () => {
      const { cookie } = await signedIn();
      const result = await http<ProblemBody>(running.baseUrl, "PATCH", "/store/account/me", {
        body: { firstName: "X" },
        headers: { cookie },
        csrf: false,
      });
      expect(result.status).toBe(403);
    });
  });

  describe("change-password", () => {
    const change = (cookie: string, currentPassword: string, newPassword: string) =>
      call<ProblemBody>("POST", "/store/account/change-password", cookie, {
        currentPassword,
        newPassword,
      });

    it("revokes every OTHER session, keeps this one, stamps password_changed_at; the old password stops working and the new one works", async () => {
      const { shopper, cookie } = await signedIn();
      const phone = await customerLoginCookie(running.baseUrl, shopper.email, PASSWORD);
      const laptop = await customerLoginCookie(running.baseUrl, shopper.email, PASSWORD);
      expect(await sessionCount(shopper.id)).toBe(3);
      const [before] = await db.select().from(customer).where(eq(customer.id, shopper.id));

      clock.advanceMinutes(5);
      const result = await change(cookie, PASSWORD, NEW_PASSWORD);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect(result.headers.get("cache-control")).toBe("no-store");

      expect(await sessionCount(shopper.id)).toBe(1);
      expect((await call("GET", "/store/account/me", cookie)).status).toBe(200);
      expect((await call("GET", "/store/account/me", phone)).status).toBe(401);
      expect((await call("GET", "/store/account/me", laptop)).status).toBe(401);

      const [after] = await db.select().from(customer).where(eq(customer.id, shopper.id));
      expect(after?.passwordChangedAt.toISOString()).toBe(clock.now().toISOString());
      expect(after?.passwordChangedAt.getTime()).toBeGreaterThan(
        before?.passwordChangedAt.getTime() ?? 0,
      );
      expect(after?.passwordHash).not.toBe(before?.passwordHash);
      expect(after?.passwordHash.startsWith("scrypt$16$8$1$")).toBe(true);

      expect((await customerLogin(running.baseUrl, shopper.email, PASSWORD)).status).toBe(401);
      expect((await customerLogin(running.baseUrl, shopper.email, NEW_PASSWORD)).status).toBe(200);
    });

    it("another customer's sessions are never touched", async () => {
      const alice = await signedIn();
      const bob = await signedIn();
      expect((await change(alice.cookie, PASSWORD, NEW_PASSWORD)).status).toBe(204);
      expect((await call("GET", "/store/account/me", bob.cookie)).status).toBe(200);
      expect(await sessionCount(bob.shopper.id)).toBe(1);
    });

    it("a wrong current password is 400 `currentPassword: incorrect`, changes nothing and counts toward the lockout like a failed login", async () => {
      const { shopper, cookie } = await signedIn();
      const other = await customerLoginCookie(running.baseUrl, shopper.email, PASSWORD);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await change(cookie, WRONG, NEW_PASSWORD);
        expect(result.status).toBe(400);
        expect(result.body.errors).toEqual([
          expect.objectContaining({ path: "currentPassword", code: "incorrect" }),
        ]);
      }
      const [counted] = await db.select().from(customer).where(eq(customer.id, shopper.id));
      expect(counted?.failedLoginCount).toBe(4);
      expect(await sessionCount(shopper.id)).toBe(2);
      expect((await call("GET", "/store/account/me", other)).status).toBe(200);

      // The 5th failure locks the account: sign-in is refused, existing sessions keep working.
      expect((await change(cookie, WRONG, NEW_PASSWORD)).status).toBe(400);
      const [locked] = await db.select().from(customer).where(eq(customer.id, shopper.id));
      expect(locked?.lockedUntil).not.toBeNull();
      expect((await customerLogin(running.baseUrl, shopper.email, PASSWORD)).status).toBe(401);
      expect((await call("GET", "/store/account/me", cookie)).status).toBe(200);
      // A locked account cannot be used to guess here either: even the RIGHT password is refused until the lock ends.
      const refused = await change(cookie, PASSWORD, NEW_PASSWORD);
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ path: "currentPassword", code: "incorrect" }),
      ]);
      clock.advanceMinutes(15);
      expect((await change(cookie, PASSWORD, NEW_PASSWORD)).status).toBe(204);
    });

    it("a successful change resets the failure counter", async () => {
      const { shopper, cookie } = await signedIn();
      await change(cookie, WRONG, NEW_PASSWORD);
      await change(cookie, WRONG, NEW_PASSWORD);
      expect((await change(cookie, PASSWORD, NEW_PASSWORD)).status).toBe(204);
      const [row] = await db.select().from(customer).where(eq(customer.id, shopper.id));
      expect(row?.failedLoginCount).toBe(0);
    });

    it("applies the password policy to the new password and refuses the same password", async () => {
      const { shopper, cookie } = await signedIn();
      const cases: [string, string][] = [
        ["short", "too_short"],
        ["x".repeat(129), "too_long"],
        [shopper.email, "equals_email"],
        [`${NEW_PASSWORD}\u0000`, "contains_nul"],
        [PASSWORD, "same_as_current"],
      ];
      for (const [newPassword, code] of cases) {
        const result = await change(cookie, PASSWORD, newPassword);
        expect(result.status, code).toBe(400);
        expect(result.body.errors, code).toContainEqual(
          expect.objectContaining({ path: "newPassword", code }),
        );
      }
      // Nothing changed: the old password still works and no session was revoked.
      expect((await customerLogin(running.baseUrl, shopper.email, PASSWORD)).status).toBe(200);
    });

    it("is strict about the body and needs the CSRF header", async () => {
      const { cookie } = await signedIn();
      const cases: [unknown, string, string][] = [
        [{ currentPassword: PASSWORD }, "newPassword", "required"],
        [{ newPassword: NEW_PASSWORD }, "currentPassword", "required"],
        [
          { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, email: "x@example.test" },
          "email",
          "unknown_field",
        ],
        [{ currentPassword: 5, newPassword: NEW_PASSWORD }, "currentPassword", "invalid_type"],
      ];
      for (const [payload, path, code] of cases) {
        const result = await call<ProblemBody>(
          "POST",
          "/store/account/change-password",
          cookie,
          payload,
        );
        expect(result.status).toBe(400);
        expect(result.body.errors).toContainEqual(expect.objectContaining({ path, code }));
      }
      const noCsrf = await http<ProblemBody>(
        running.baseUrl,
        "POST",
        "/store/account/change-password",
        {
          body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          headers: { cookie },
          csrf: false,
        },
      );
      expect(noCsrf.status).toBe(403);
    });

    it("an inactive customer cannot change a password (401, like every request of theirs)", async () => {
      const { shopper, cookie } = await signedIn();
      await db.update(customer).set({ isActive: false }).where(eq(customer.id, shopper.id));
      expect((await change(cookie, PASSWORD, NEW_PASSWORD)).status).toBe(401);
    });
  });

  describe("session lifetime through the real routes", () => {
    it("a customer deactivated while signed in is 401 on the very next request on every route", async () => {
      const { shopper, cookie } = await signedIn();
      await db.update(customer).set({ isActive: false }).where(eq(customer.id, shopper.id));
      expect((await call("GET", "/store/account/me", cookie)).status).toBe(401);
      expect((await call("PATCH", "/store/account/me", cookie, { firstName: "X" })).status).toBe(
        401,
      );
      expect((await call("POST", "/store/account/logout", cookie)).status).toBe(401);
    });

    it("with two cookies of the same name only the first well-formed one is read; the second never lends its identity", async () => {
      const alice = await signedIn();
      const bob = await signedIn();
      const result = await call("GET", "/store/account/me", `${alice.cookie}; ${bob.cookie}`);
      expect(result.status).toBe(200);
      expect(result.body.customer["id"]).toBe(alice.shopper.id);
      expect(JSON.stringify(result.body)).not.toContain(bob.shopper.email);
    });
  });
});
