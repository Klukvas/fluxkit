import type { AdminRole } from "@fluxkit/core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminSession, adminUser } from "../../database/schema/index.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  testPasswordHasher,
  type TestAdminUser,
} from "../../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { login, loginCookie } from "../../test/auth-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SOME_ID } from "../../test/routes.js";

const START = "2030-08-01T08:00:00.000Z";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const USER_KEYS = ["createdAt", "email", "id", "isActive", "lastLoginAt", "role", "updatedAt"];

interface UserBody {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
}

describe("/admin/users (owner only)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  async function newUser(
    role: AdminRole,
    options: { isActive?: boolean } = {},
  ): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role, password: PASSWORD, ...options });
    created.push(user.id);
    return user;
  }

  /** A user plus a signed-in cookie. */
  async function signedIn(
    role: AdminRole,
    options: { isActive?: boolean } = {},
  ): Promise<TestAdminUser & { cookie: string }> {
    const user = await newUser(role, options);
    const cookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
    return { ...user, cookie };
  }

  const call = <TBody = Record<string, unknown>>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    cookie: string | undefined,
    body?: unknown,
  ): Promise<HttpResult<TBody>> =>
    http<TBody>(running.baseUrl, method, path, {
      ...(body === undefined ? {} : { body }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });

  async function rowOf(id: string) {
    const [row] = await db.select().from(adminUser).where(eq(adminUser.id, id));
    if (row === undefined) throw new Error("test user vanished");
    return row;
  }

  const sessionCount = async (userId: string): Promise<number> =>
    (await db.select().from(adminSession).where(eq(adminSession.userId, userId))).length;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    // The last-owner rule counts ALL active owners of the database. This file runs alone against a `_test` database
    // (ensureMigrated refuses any other), so it starts from an empty user table.
    await db.delete(adminUser);
  });

  beforeEach(() => {
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await db.delete(adminUser);
    await running.app.close();
  });

  describe("access", () => {
    const routes: [string, "GET" | "POST" | "PATCH", string, unknown][] = [
      ["list", "GET", "/admin/users", undefined],
      [
        "create",
        "POST",
        "/admin/users",
        { email: "x@example.test", role: "viewer", password: PASSWORD },
      ],
      ["get", "GET", `/admin/users/${SOME_ID}`, undefined],
      ["update", "PATCH", `/admin/users/${SOME_ID}`, { role: "viewer" }],
      [
        "reset-password",
        "POST",
        `/admin/users/${SOME_ID}/reset-password`,
        { newPassword: NEW_PASSWORD },
      ],
    ];

    it.each(routes)("%s answers 401 without a session", async (_name, method, path, body) => {
      const result = await call<ProblemBody>(method, path, undefined, body);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: "unauthorized" });
    });

    it.each(["manager", "viewer"] as const)(
      "a %s gets 403 forbidden on EVERY users route",
      async (role) => {
        const caller = await signedIn(role);
        for (const [name, method, path, body] of routes) {
          const result = await call<ProblemBody>(method, path, caller.cookie, body);
          expect(result.status, name).toBe(403);
          expect(result.body, name).toMatchObject({ code: "forbidden" });
          expect(result.body.detail, name).toContain("users.manage");
        }
        expect(
          await db.select().from(adminUser).where(eq(adminUser.email, "x@example.test")),
        ).toEqual([]);
      },
    );

    it("has no DELETE (or PUT) route: deactivate instead", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("viewer");
      expect((await call("DELETE", `/admin/users/${target.id}`, owner.cookie)).status).toBe(404);
      expect((await call("PUT", `/admin/users/${target.id}`, owner.cookie, {})).status).toBe(404);
      expect((await call("DELETE", "/admin/users", owner.cookie)).status).toBe(404);
      expect((await rowOf(target.id)).isActive).toBe(true);
    });
  });

  describe("GET /admin/users", () => {
    it("lists users ordered by email as a page, with only the documented fields", async () => {
      const owner = await signedIn("owner");
      await newUser("viewer");
      await newUser("manager");
      const result = await call<{
        items: UserBody[];
        total: number;
        limit: number;
        offset: number;
      }>("GET", "/admin/users", owner.cookie);
      expect(result.status).toBe(200);
      expect(result.body.total).toBe(3);
      expect(result.body).toMatchObject({ limit: 50, offset: 0 });
      const emails = result.body.items.map((item) => item.email);
      expect(emails).toEqual([...emails].sort());
      for (const item of result.body.items) {
        expect(Object.keys(item).sort()).toEqual(USER_KEYS);
      }
    });

    it("paginates with limit and offset and validates them", async () => {
      const owner = await signedIn("owner");
      await newUser("viewer");
      await newUser("viewer");
      const all = await call<{ items: UserBody[] }>("GET", "/admin/users", owner.cookie);
      const page = await call<{ items: UserBody[]; total: number; limit: number; offset: number }>(
        "GET",
        "/admin/users?limit=1&offset=1",
        owner.cookie,
      );
      expect(page.body.items).toEqual([all.body.items[1]]);
      expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
      expect((await call("GET", "/admin/users?limit=0", owner.cookie)).status).toBe(400);
      expect((await call("GET", "/admin/users?limit=101", owner.cookie)).status).toBe(400);
      expect((await call("GET", "/admin/users?offset=-1", owner.cookie)).status).toBe(400);
    });
  });

  describe("POST /admin/users", () => {
    it("creates a user: 201, Location, no hash in the body, normalized email, and the user can sign in", async () => {
      const owner = await signedIn("owner");
      const result = await call<UserBody>("POST", "/admin/users", owner.cookie, {
        email: "  New.Person@Example.TEST ",
        role: "manager",
        password: NEW_PASSWORD,
      });
      expect(result.status).toBe(201);
      expect(Object.keys(result.body).sort()).toEqual(USER_KEYS);
      expect(result.body).toMatchObject({
        email: "new.person@example.test",
        role: "manager",
        isActive: true,
        lastLoginAt: null,
      });
      expect(result.headers.get("location")).toBe(`/admin/users/${result.body.id}`);
      created.push(result.body.id);
      const row = await rowOf(result.body.id);
      expect(row.passwordHash).not.toContain(NEW_PASSWORD);
      expect(await testPasswordHasher.verify(NEW_PASSWORD, row.passwordHash)).toBe(true);
      expect((await login(running.baseUrl, "NEW.person@example.test", NEW_PASSWORD)).status).toBe(
        200,
      );
    });

    it("answers 409 conflict on the field email for a duplicate, whatever its case", async () => {
      const owner = await signedIn("owner");
      const existing = await newUser("viewer");
      const result = await call<ProblemBody>("POST", "/admin/users", owner.cookie, {
        email: existing.email.toUpperCase(),
        role: "viewer",
        password: NEW_PASSWORD,
      });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "conflict", field: "email" });
    });

    it.each([
      [
        "an unknown role",
        { email: "a@example.test", role: "superuser", password: NEW_PASSWORD },
        "role",
      ],
      ["a missing role", { email: "a@example.test", password: NEW_PASSWORD }, "role"],
      ["a missing password", { email: "a@example.test", role: "viewer" }, "password"],
      ["a missing email", { role: "viewer", password: NEW_PASSWORD }, "email"],
      ["an email without @", { email: "nope", role: "viewer", password: NEW_PASSWORD }, "email"],
      [
        "an email with a space",
        { email: "a b@example.test", role: "viewer", password: NEW_PASSWORD },
        "email",
      ],
      [
        "a too short password",
        { email: "a@example.test", role: "viewer", password: "short" },
        "password",
      ],
      [
        "a password of 129 characters",
        { email: "a@example.test", role: "viewer", password: "x".repeat(129) },
        "password",
      ],
      [
        "the email as password",
        { email: "someone@example.test", role: "viewer", password: "someone@example.test" },
        "password",
      ],
      [
        "an unknown field",
        { email: "a@example.test", role: "viewer", password: NEW_PASSWORD, isActive: false },
        "isActive",
      ],
      [
        "a field that tries to set the hash",
        { email: "a@example.test", role: "viewer", password: NEW_PASSWORD, passwordHash: "x" },
        "passwordHash",
      ],
    ])("answers 400 with the field named for %s", async (_name, body, path) => {
      const owner = await signedIn("owner");
      const result = await call<ProblemBody>("POST", "/admin/users", owner.cookie, body);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
      expect(result.body.errors?.map((error) => error.path)).toContain(path);
      expect(
        await db.select().from(adminUser).where(eq(adminUser.email, "a@example.test")),
      ).toEqual([]);
    });
  });

  describe("GET /admin/users/:id", () => {
    it("returns the user, 404 for an unknown id and 400 for a malformed id", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("viewer");
      const found = await call<UserBody>("GET", `/admin/users/${target.id}`, owner.cookie);
      expect(found.status).toBe(200);
      expect(Object.keys(found.body).sort()).toEqual(USER_KEYS);
      expect(found.body).toMatchObject({ id: target.id, email: target.email, role: "viewer" });
      const missing = await call<ProblemBody>("GET", `/admin/users/${SOME_ID}`, owner.cookie);
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ code: "not_found" });
      expect((await call("GET", "/admin/users/not-a-uuid", owner.cookie)).status).toBe(400);
    });
  });

  describe("PATCH /admin/users/:id", () => {
    it("changes the role; it applies to the target's very next request and needs no new sign-in", async () => {
      const owner = await signedIn("owner");
      const target = await signedIn("manager");
      const publish = () =>
        call<ProblemBody>("POST", `/admin/products/${SOME_ID}/publish`, target.cookie);
      expect((await publish()).status).toBe(404);
      const result = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner.cookie, {
        role: "viewer",
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: target.id, role: "viewer" });
      expect((await publish()).status).toBe(403);
      expect((await call("GET", "/admin/auth/me", target.cookie)).status).toBe(200);
      expect(await sessionCount(target.id)).toBe(1);
    });

    it("deactivating revokes ALL sessions of the user at once; reactivating allows a new login", async () => {
      const owner = await signedIn("owner");
      const target = await signedIn("viewer");
      const second = await loginCookie(running.baseUrl, target.email, PASSWORD);
      const bystander = await signedIn("viewer");
      expect(await sessionCount(target.id)).toBe(2);
      const result = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner.cookie, {
        isActive: false,
      });
      expect(result.status).toBe(200);
      expect(result.body.isActive).toBe(false);
      expect(await sessionCount(target.id)).toBe(0);
      expect((await call("GET", "/admin/auth/me", target.cookie)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", second)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", bystander.cookie)).status).toBe(200);
      expect((await login(running.baseUrl, target.email, PASSWORD)).status).toBe(401);
      await call("PATCH", `/admin/users/${target.id}`, owner.cookie, { isActive: true });
      expect((await login(running.baseUrl, target.email, PASSWORD)).status).toBe(200);
    });

    it("changes role and activity together, and an empty body changes nothing", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("manager");
      const same = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner.cookie, {});
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ role: "manager", isActive: true });
      const both = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner.cookie, {
        role: "viewer",
        isActive: false,
      });
      expect(both.body).toMatchObject({ role: "viewer", isActive: false });
    });

    it.each([
      ["an unknown role", { role: "superuser" }, "role"],
      ["a non-boolean isActive", { isActive: "no" }, "isActive"],
      ["an email change", { email: "other@example.test" }, "email"],
      ["a hash", { passwordHash: "scrypt$16$8$1$x$y" }, "passwordHash"],
      ["a password", { password: NEW_PASSWORD }, "password"],
      ["lockout fields", { failedLoginCount: 0, lockedUntil: null }, "failedLoginCount"],
    ])("answers 400 for %s and changes nothing", async (_name, body, path) => {
      const owner = await signedIn("owner");
      const target = await newUser("viewer");
      const before = await rowOf(target.id);
      const result = await call<ProblemBody>(
        "PATCH",
        `/admin/users/${target.id}`,
        owner.cookie,
        body,
      );
      expect(result.status).toBe(400);
      expect(result.body.errors?.map((error) => error.path)).toContain(path);
      expect(await rowOf(target.id)).toEqual(before);
    });

    it("answers 404 for an unknown id", async () => {
      const owner = await signedIn("owner");
      const result = await call<ProblemBody>("PATCH", `/admin/users/${SOME_ID}`, owner.cookie, {
        role: "viewer",
      });
      expect(result.status).toBe(404);
    });

    describe("the last active owner is protected (409 rule_violation with the core reason)", () => {
      it("cannot be demoted", async () => {
        const owner = await signedIn("owner");
        const result = await call<ProblemBody>("PATCH", `/admin/users/${owner.id}`, owner.cookie, {
          role: "manager",
        });
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({
          code: "rule_violation",
          rule: "last_owner_cannot_be_demoted",
        });
        expect((await rowOf(owner.id)).role).toBe("owner");
      });

      it("cannot be deactivated, and keeps their sessions", async () => {
        const owner = await signedIn("owner");
        const result = await call<ProblemBody>("PATCH", `/admin/users/${owner.id}`, owner.cookie, {
          isActive: false,
        });
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({
          code: "rule_violation",
          rule: "last_owner_cannot_be_deactivated",
        });
        expect((await rowOf(owner.id)).isActive).toBe(true);
        expect(await sessionCount(owner.id)).toBe(1);
      });

      it("with two owners one may be demoted, then the other is the last one", async () => {
        const first = await signedIn("owner");
        const second = await signedIn("owner");
        const demoted = await call<UserBody>("PATCH", `/admin/users/${second.id}`, first.cookie, {
          role: "viewer",
        });
        expect(demoted.status).toBe(200);
        const refused = await call<ProblemBody>("PATCH", `/admin/users/${first.id}`, first.cookie, {
          role: "viewer",
        });
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ rule: "last_owner_cannot_be_demoted" });
      });

      it("does not count an inactive owner as a remaining owner", async () => {
        const active = await signedIn("owner");
        await newUser("owner", { isActive: false });
        const result = await call<ProblemBody>(
          "PATCH",
          `/admin/users/${active.id}`,
          active.cookie,
          {
            role: "manager",
          },
        );
        expect(result.status).toBe(409);
      });

      it("may be re-saved as owner and may change other users freely", async () => {
        const owner = await signedIn("owner");
        const noOp = await call("PATCH", `/admin/users/${owner.id}`, owner.cookie, {
          role: "owner",
        });
        expect(noOp.status).toBe(200);
        const other = await newUser("viewer");
        const promoted = await call<UserBody>("PATCH", `/admin/users/${other.id}`, owner.cookie, {
          role: "owner",
        });
        expect(promoted.status).toBe(200);
      });
    });

    describe("no privilege escalation", () => {
      it.each(["manager", "viewer"] as const)(
        "a %s cannot make themselves owner (403) and nothing changes",
        async (role) => {
          const caller = await signedIn(role);
          const result = await call<ProblemBody>(
            "PATCH",
            `/admin/users/${caller.id}`,
            caller.cookie,
            {
              role: "owner",
            },
          );
          expect(result.status).toBe(403);
          expect(result.body).toMatchObject({ code: "forbidden" });
          expect((await rowOf(caller.id)).role).toBe(role);
        },
      );

      it("a viewer cannot change another user either", async () => {
        const viewer = await signedIn("viewer");
        const target = await newUser("viewer");
        const result = await call("PATCH", `/admin/users/${target.id}`, viewer.cookie, {
          role: "manager",
        });
        expect(result.status).toBe(403);
        expect((await rowOf(target.id)).role).toBe("viewer");
      });
    });
  });

  describe("POST /admin/users/:id/reset-password", () => {
    it("sets a new password, clears the lockout, ends ALL sessions of that user and only theirs", async () => {
      const owner = await signedIn("owner");
      const target = await signedIn("manager");
      const second = await loginCookie(running.baseUrl, target.email, PASSWORD);
      await db
        .update(adminUser)
        .set({ failedLoginCount: 5, lockedUntil: new Date(clock.now().getTime() + 600_000) })
        .where(eq(adminUser.id, target.id));
      const before = await rowOf(target.id);
      clock.advanceMinutes(1);
      const result = await call("POST", `/admin/users/${target.id}/reset-password`, owner.cookie, {
        newPassword: NEW_PASSWORD,
      });
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      const after = await rowOf(target.id);
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(await testPasswordHasher.verify(NEW_PASSWORD, after.passwordHash)).toBe(true);
      expect(after.passwordChangedAt.toISOString()).toBe(clock.now().toISOString());
      expect(after.failedLoginCount).toBe(0);
      expect(after.lockedUntil).toBeNull();
      expect(await sessionCount(target.id)).toBe(0);
      expect((await call("GET", "/admin/auth/me", target.cookie)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", second)).status).toBe(401);
      expect((await call("GET", "/admin/auth/me", owner.cookie)).status).toBe(200);
      expect((await login(running.baseUrl, target.email, PASSWORD)).status).toBe(401);
      expect((await login(running.baseUrl, target.email, NEW_PASSWORD)).status).toBe(200);
    });

    it("an owner resetting their own password loses their own sessions too", async () => {
      const owner = await signedIn("owner");
      const result = await call("POST", `/admin/users/${owner.id}/reset-password`, owner.cookie, {
        newPassword: NEW_PASSWORD,
      });
      expect(result.status).toBe(204);
      expect((await call("GET", "/admin/auth/me", owner.cookie)).status).toBe(401);
    });

    it.each([
      ["too short", "short", "too_short"],
      ["too long", "x".repeat(129), "too_long"],
      ["the user's email", "EMAIL", "equals_email"],
    ])(
      "rejects a password that is %s with 400 on newPassword and changes nothing",
      async (_name, candidate, code) => {
        const owner = await signedIn("owner");
        const target = await signedIn("viewer");
        const before = await rowOf(target.id);
        const result = await call<ProblemBody>(
          "POST",
          `/admin/users/${target.id}/reset-password`,
          owner.cookie,
          { newPassword: candidate === "EMAIL" ? target.email : candidate },
        );
        expect(result.status).toBe(400);
        expect(result.body.errors?.map((error) => `${error.path}:${error.code}`)).toContain(
          `newPassword:${code}`,
        );
        expect((await rowOf(target.id)).passwordHash).toBe(before.passwordHash);
        expect(await sessionCount(target.id)).toBe(1);
      },
    );

    it.each([
      ["no body", undefined],
      ["an empty object", {}],
      ["an unknown field", { newPassword: NEW_PASSWORD, currentPassword: PASSWORD }],
      ["a number", { newPassword: 123456789012 }],
    ])("answers 400 for %s", async (_name, body) => {
      const owner = await signedIn("owner");
      const target = await newUser("viewer");
      const result = await call(
        "POST",
        `/admin/users/${target.id}/reset-password`,
        owner.cookie,
        body,
      );
      expect(result.status).toBe(400);
    });

    it("answers 404 for an unknown user and 400 for a malformed id", async () => {
      const owner = await signedIn("owner");
      expect(
        (
          await call("POST", `/admin/users/${SOME_ID}/reset-password`, owner.cookie, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call("POST", "/admin/users/nope/reset-password", owner.cookie, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(400);
    });
  });
});
