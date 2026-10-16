import { permissionsOf, ROLES, type AdminRole } from "@fluxkit/core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminSession, adminUser } from "../database/schema/index.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  testPasswordHasher,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { login, loginCookie, sessionCookieOf } from "../test/auth-http.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { PasswordHasher } from "./password-hasher.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";

const START = "2030-07-01T08:00:00.000Z";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";

describe("logout, me and change-password", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;
  let db: Database;
  let hasher: PasswordHasher;
  const created: string[] = [];

  async function newUser(role: AdminRole = "viewer"): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role, password: PASSWORD });
    created.push(user.id);
    return user;
  }

  async function rowOf(id: string) {
    const [row] = await db.select().from(adminUser).where(eq(adminUser.id, id));
    if (row === undefined) throw new Error("test user vanished");
    return row;
  }

  const sessionCount = async (userId: string): Promise<number> =>
    (await db.select().from(adminSession).where(eq(adminSession.userId, userId))).length;

  const call = (method: "GET" | "POST", path: string, cookie: string | undefined, body?: unknown) =>
    http<Record<string, unknown>>(running.baseUrl, method, path, {
      ...(body === undefined ? {} : { body }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });

  const changePassword = (
    cookie: string | undefined,
    currentPassword: string,
    newPassword: string,
  ) => call("POST", "/admin/auth/change-password", cookie, { currentPassword, newPassword });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    hasher = running.app.get(PasswordHasher);
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  describe("GET /admin/auth/me", () => {
    it("answers 401 without a session", async () => {
      const result = await call("GET", "/admin/auth/me", undefined);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: "unauthorized" });
    });

    it.each(ROLES)(
      "answers 200 for a signed-in %s with the user and the permissions of the role",
      async (role) => {
        const user = await newUser(role);
        const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
        const result = await call("GET", "/admin/auth/me", cookie);
        expect(result.status).toBe(200);
        expect(result.body).toEqual({
          user: {
            id: user.id,
            email: user.email,
            role,
            isActive: true,
            lastLoginAt: clock.now().toISOString(),
          },
          permissions: [...permissionsOf(role)],
        });
      },
    );

    it("reads the database state of THIS request: a role change shows at once, a deactivation ends the session", async () => {
      const user = await newUser("viewer");
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      await db.update(adminUser).set({ role: "manager" }).where(eq(adminUser.id, user.id));
      const promoted = await call("GET", "/admin/auth/me", cookie);
      expect(promoted.body).toMatchObject({
        user: { role: "manager" },
        permissions: [
          "catalog.read",
          "catalog.write",
          "catalog.publish",
          "orders.read",
          "orders.write",
          "customers.read",
          "customers.write",
        ],
      });
      await db.update(adminUser).set({ isActive: false }).where(eq(adminUser.id, user.id));
      expect((await call("GET", "/admin/auth/me", cookie)).status).toBe(401);
    });
  });

  describe("POST /admin/auth/logout", () => {
    it("answers 401 without a session", async () => {
      expect((await call("POST", "/admin/auth/logout", undefined)).status).toBe(401);
    });

    it("needs the CSRF header", async () => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const result = await http(running.baseUrl, "POST", "/admin/auth/logout", {
        headers: { cookie },
        csrf: false,
      });
      expect(result.status).toBe(403);
      expect((await call("GET", "/admin/auth/me", cookie)).status).toBe(200);
    });

    it.each(ROLES)(
      "lets a %s sign out: 204, cookie cleared, session deleted, old cookie answers 401",
      async (role) => {
        const user = await newUser(role);
        const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
        expect(await sessionCount(user.id)).toBe(1);
        const result = await call("POST", "/admin/auth/logout", cookie);
        expect(result.status).toBe(204);
        expect(result.body).toBeUndefined();
        const cleared = result.headers.getSetCookie();
        expect(cleared).toHaveLength(1);
        expect(cleared[0]).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
        expect(cleared[0]).toContain("Path=/admin");
        expect(cleared[0]).toContain("HttpOnly");
        expect(cleared[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
        expect(await sessionCount(user.id)).toBe(0);
        const again = await call("GET", "/admin/auth/me", cookie);
        expect(again.status).toBe(401);
        expect((await call("GET", "/admin/brands", cookie)).status).toBe(401);
        expect((await call("POST", "/admin/auth/logout", cookie)).status).toBe(401);
      },
    );

    it("ends only the current session, not the other sessions of the user or of anyone else", async () => {
      const user = await newUser();
      const other = await newUser();
      const first = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const second = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const stranger = await loginCookie(running.baseUrl, other.email, PASSWORD);
      expect((await call("POST", "/admin/auth/logout", first)).status).toBe(204);
      expect((await call("GET", "/admin/auth/me", first)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", second)).status).toBe(200);
      expect((await call("GET", "/admin/auth/me", stranger)).status).toBe(200);
    });
  });

  describe("POST /admin/auth/change-password", () => {
    it("answers 401 without a session", async () => {
      expect((await changePassword(undefined, PASSWORD, NEW_PASSWORD)).status).toBe(401);
    });

    it("needs the CSRF header", async () => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const result = await http(running.baseUrl, "POST", "/admin/auth/change-password", {
        body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        headers: { cookie },
        csrf: false,
      });
      expect(result.status).toBe(403);
    });

    it.each(ROLES)(
      "lets a %s change the own password (204): the new one works, the old one does not",
      async (role) => {
        const user = await newUser(role);
        const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
        const before = await rowOf(user.id);
        clock.advanceMinutes(1);
        const result = await changePassword(cookie, PASSWORD, NEW_PASSWORD);
        expect(result.status).toBe(204);
        const after = await rowOf(user.id);
        expect(after.passwordHash).not.toBe(before.passwordHash);
        expect(await testPasswordHasher.verify(NEW_PASSWORD, after.passwordHash)).toBe(true);
        expect(after.passwordChangedAt.toISOString()).toBe(clock.now().toISOString());
        expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(401);
        expect((await login(running.baseUrl, user.email, NEW_PASSWORD)).status).toBe(200);
      },
    );

    it("ends ALL OTHER sessions of the user, keeps the current one, and leaves other users alone", async () => {
      const user = await newUser();
      const other = await newUser();
      const current = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const second = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const third = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const stranger = await loginCookie(running.baseUrl, other.email, PASSWORD);
      expect((await changePassword(current, PASSWORD, NEW_PASSWORD)).status).toBe(204);
      expect((await call("GET", "/admin/auth/me", current)).status).toBe(200);
      expect((await call("GET", "/admin/auth/me", second)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", third)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", stranger)).status).toBe(200);
      expect(await sessionCount(user.id)).toBe(1);
    });

    it("resets the failure counter after a correct current password", async () => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      await db.update(adminUser).set({ failedLoginCount: 3 }).where(eq(adminUser.id, user.id));
      await changePassword(cookie, PASSWORD, NEW_PASSWORD);
      expect((await rowOf(user.id)).failedLoginCount).toBe(0);
    });

    it("rejects a wrong current password with 400 validation_failed on currentPassword, after exactly one scrypt verification", async () => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const before = await rowOf(user.id);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const result = await changePassword(cookie, "not my password", NEW_PASSWORD);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "currentPassword", code: "incorrect" }],
      });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(dummy).not.toHaveBeenCalled();
      expect((await rowOf(user.id)).passwordHash).toBe(before.passwordHash);
      expect(await sessionCount(user.id)).toBe(1);
    });

    it("counts wrong current passwords toward the lockout: 5 lock the account, which then cannot be used to guess either", async () => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const other = await loginCookie(running.baseUrl, user.email, PASSWORD);
      for (let failure = 1; failure <= 4; failure += 1) {
        await changePassword(cookie, "not my password", NEW_PASSWORD);
        expect((await rowOf(user.id)).failedLoginCount).toBe(failure);
      }
      await changePassword(cookie, "not my password", NEW_PASSWORD);
      const locked = await rowOf(user.id);
      expect(locked.failedLoginCount).toBe(5);
      expect(locked.lockedUntil?.toISOString()).toBe(
        new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
      );
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(401);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const refused = await changePassword(cookie, PASSWORD, NEW_PASSWORD);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ errors: [{ path: "currentPassword" }] });
      expect(verify).not.toHaveBeenCalled();
      expect(dummy).toHaveBeenCalledTimes(1);
      expect((await rowOf(user.id)).passwordHash).toBe(locked.passwordHash);
      // Existing sessions are not touched by the lock.
      expect((await call("GET", "/admin/auth/me", other)).status).toBe(200);
    });

    it.each([
      ["too short", "short one", "newPassword", "too_short"],
      ["too long", "x".repeat(129), "newPassword", "too_long"],
      ["equal to the email", "EMAIL", "newPassword", "equals_email"],
      ["equal to the current password", PASSWORD, "newPassword", "same_as_current"],
    ])(
      "rejects a new password that is %s with 400 on newPassword and changes nothing",
      async (_name, candidate, path, code) => {
        const user = await newUser();
        const second = await loginCookie(running.baseUrl, user.email, PASSWORD);
        const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
        const before = await rowOf(user.id);
        const newPassword = candidate === "EMAIL" ? user.email : candidate;
        const result = await changePassword(cookie, PASSWORD, newPassword);
        expect(result.status).toBe(400);
        expect(result.body).toMatchObject({ code: "validation_failed" });
        const errors = (result.body as unknown as ProblemBody).errors ?? [];
        expect(errors.map((error) => `${error.path}:${error.code}`)).toContain(`${path}:${code}`);
        const after = await rowOf(user.id);
        expect(after.passwordHash).toBe(before.passwordHash);
        // A policy failure is not a failed login: no count, and no session was revoked.
        expect(after.failedLoginCount).toBe(0);
        expect((await call("GET", "/admin/auth/me", second)).status).toBe(200);
      },
    );

    it.each([
      ["no body", undefined],
      ["a missing newPassword", { currentPassword: PASSWORD }],
      ["a missing currentPassword", { newPassword: NEW_PASSWORD }],
      ["an unknown field", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, extra: 1 }],
      ["numbers", { currentPassword: 1, newPassword: 2 }],
    ])("answers 400 for %s", async (_name, body) => {
      const user = await newUser();
      const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
      const result = await call("POST", "/admin/auth/change-password", cookie, body);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
    });
  });

  it("every auth route sets no session cookie by accident and never answers a hash", async () => {
    const user = await newUser("owner");
    const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
    const row = await rowOf(user.id);
    const me = await call("GET", "/admin/auth/me", cookie);
    expect(JSON.stringify(me.body)).not.toContain(row.passwordHash);
    expect(sessionCookieOf(me)).toBeUndefined();
  });
});
