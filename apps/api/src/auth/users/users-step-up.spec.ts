import { randomUUID } from "node:crypto";
import type { AdminRole } from "@fluxkit/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { requireEnv } from "../../test/env.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { PasswordHasher } from "../password-hasher.js";
import { AdminStepUpService } from "../step-up/admin-step-up.service.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const USER_KEYS = ["createdAt", "email", "id", "isActive", "lastLoginAt", "role", "updatedAt"];

interface UserBody {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
}

/**
 * Password re-entry on the owner operations (plan `docs/plans/2026-11-16-admin-integrations.md` section 8 and its
 * section 11 decision 2): a stolen owner session must not be able to mint an owner account, or a password it knows,
 * and so walk through the integrations step-up. Exactly three results ask for the actor's current password: a new
 * owner, a promotion to owner or the reactivation of an inactive owner, and the reset of an owner's password (their
 * own included). Everything else is unchanged and needs no Redis.
 *
 * Real Postgres and Redis, real sessions. Every test signs in a fresh owner (the budget is 5 attempts per admin per
 * 15 minutes) and sends its own client address (20 per address), both windows kept in Redis under this file's prefix.
 */
describe("the actor's current password on the owner operations (ADR 0058)", () => {
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];
  let addressCounter = 0;

  const nextAddress = (): string => {
    addressCounter += 1;
    return `203.0.113.${String(addressCounter)}`;
  };

  async function newUser(
    role: AdminRole,
    options: { isActive?: boolean } = {},
  ): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role, password: PASSWORD, ...options });
    created.push(user.id);
    return user;
  }

  /** A user plus a signed-in cookie and the client address their requests come from. */
  async function signedIn(
    role: AdminRole,
  ): Promise<TestAdminUser & { cookie: string; address: string }> {
    const user = await newUser(role);
    const address = nextAddress();
    // Signed in from that address too, so one address does not fill its login window for the whole file.
    const signIn = await http(running.baseUrl, "POST", "/admin/auth/login", {
      body: { email: user.email, password: PASSWORD },
      headers: { "x-forwarded-for": address },
    });
    const cookie = (signIn.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    if (signIn.status !== 200 || cookie === "") {
      throw new Error(`Test setup bug: login answered ${String(signIn.status)}`);
    }
    return { ...user, cookie, address };
  }

  const call = <TBody = Record<string, unknown>>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    actor: { cookie: string; address: string },
    body?: unknown,
  ): Promise<HttpResult<TBody>> =>
    http<TBody>(running.baseUrl, method, path, {
      ...(body === undefined ? {} : { body }),
      headers: { cookie: actor.cookie, "x-forwarded-for": actor.address },
    });

  async function rowOf(id: string) {
    const [row] = await db.select().from(adminUser).where(eq(adminUser.id, id));
    if (row === undefined) throw new Error("test user vanished");
    return row;
  }

  const sessionCount = async (userId: string): Promise<number> =>
    (await db.select().from(adminSession).where(eq(adminSession.userId, userId))).length;

  const userRowsOf = (email: string) =>
    db.select().from(adminUser).where(eq(adminUser.email, email));

  /** The step-up refusals of one actor, as the operation codes their audit records carry. */
  async function stepUpFailuresOf(actorId: string): Promise<string[]> {
    const result = await db.execute<{ operation: string }>(sql`
      select detail->>'operation' as operation from admin_audit_event
      where action = 'admin_user.step_up_failed' and admin_user_id = ${actorId}::uuid
      order by created_at`);
    return result.rows.map((row) => row.operation);
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      redisUrl: requireEnv("REDIS_URL"),
      rateLimitKeyPrefix: `users_step_up_${randomUUID()}`,
      trustProxy: 1,
    });
    db = running.app.get<Database>(DRIZZLE);
    // The last-owner rule counts ALL active owners of the database. This file runs alone against a `_test` database
    // (ensureMigrated refuses any other), so it starts from an empty user table.
    await db.delete(adminUser);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await db.delete(adminUser);
    await running.app.close();
  });

  describe("POST /admin/users creating an owner", () => {
    it("without the current password: 400 on currentPassword, no user, no failed login counted", async () => {
      const owner = await signedIn("owner");
      const email = `new-owner-${randomUUID()}@example.test`;
      const result = await call<ProblemBody>("POST", "/admin/users", owner, {
        email,
        role: "owner",
        password: NEW_PASSWORD,
      });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
      expect(result.body.errors?.map((error) => `${error.path}:${error.code}`)).toContain(
        "currentPassword:required",
      );
      expect(await userRowsOf(email)).toEqual([]);
      // A missing field is a typo, not a password guess: it neither counts nor is recorded.
      expect((await rowOf(owner.id)).failedLoginCount).toBe(0);
      expect(await stepUpFailuresOf(owner.id)).toEqual([]);
    });

    it("with a wrong current password: 403, no user, the failure counted and on record", async () => {
      const owner = await signedIn("owner");
      const email = `new-owner-${randomUUID()}@example.test`;
      const result = await call<ProblemBody>("POST", "/admin/users", owner, {
        email,
        role: "owner",
        password: NEW_PASSWORD,
        currentPassword: "not the password",
      });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: "forbidden", rule: "current_password_incorrect" });
      expect(await userRowsOf(email)).toEqual([]);
      expect((await rowOf(owner.id)).failedLoginCount).toBe(1);
      // The refusal is on record although the create was rolled back.
      expect(await stepUpFailuresOf(owner.id)).toEqual(["admin_user.created"]);
    });

    it("with the right current password the owner is created and can sign in", async () => {
      const owner = await signedIn("owner");
      const email = `new-owner-${randomUUID()}@example.test`;
      const result = await call<UserBody>("POST", "/admin/users", owner, {
        email,
        role: "owner",
        password: NEW_PASSWORD,
        currentPassword: PASSWORD,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      created.push(result.body.id);
      expect(Object.keys(result.body).sort()).toEqual(USER_KEYS);
      expect(result.body).toMatchObject({ email, role: "owner", isActive: true });
      expect((await login(running.baseUrl, email, NEW_PASSWORD)).status).toBe(200);
      expect((await rowOf(owner.id)).failedLoginCount).toBe(0);
    });

    it.each(["manager", "viewer"] as const)(
      "creating a %s needs no current password",
      async (role) => {
        const owner = await signedIn("owner");
        const email = `new-${role}-${randomUUID()}@example.test`;
        const result = await call<UserBody>("POST", "/admin/users", owner, {
          email,
          role,
          password: NEW_PASSWORD,
        });
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        created.push(result.body.id);
        expect(result.body).toMatchObject({ email, role });
      },
    );
  });

  describe("PATCH /admin/users/:id", () => {
    it("promoting a non-owner to owner: 400 without, 403 wrong, 200 with the right password", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("manager");
      const promote = (body: Record<string, unknown>) =>
        call<ProblemBody & UserBody>("PATCH", `/admin/users/${target.id}`, owner, {
          role: "owner",
          ...body,
        });

      const missing = await promote({});
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => error.path)).toContain("currentPassword");
      expect((await rowOf(target.id)).role).toBe("manager");

      const wrong = await promote({ currentPassword: "not the password" });
      expect(wrong.status).toBe(403);
      expect(wrong.body.rule).toBe("current_password_incorrect");
      expect((await rowOf(target.id)).role).toBe("manager");

      const done = await promote({ currentPassword: PASSWORD });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect((await rowOf(target.id)).role).toBe("owner");
      expect(await stepUpFailuresOf(owner.id)).toEqual(["admin_user.role_changed"]);
    });

    it("reactivating an inactive owner needs the current password", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("owner", { isActive: false });
      const missing = await call<ProblemBody>("PATCH", `/admin/users/${target.id}`, owner, {
        isActive: true,
      });
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => error.path)).toContain("currentPassword");
      expect((await rowOf(target.id)).isActive).toBe(false);

      const done = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner, {
        isActive: true,
        currentPassword: PASSWORD,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(await rowOf(target.id)).toMatchObject({ role: "owner", isActive: true });
    });

    it("one request that promotes AND reactivates asks for the password once", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("viewer", { isActive: false });
      const verify = vi.spyOn(running.app.get(AdminStepUpService), "verify");
      const done = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner, {
        role: "owner",
        isActive: true,
        currentPassword: PASSWORD,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(await rowOf(target.id)).toMatchObject({ role: "owner", isActive: true });
    });

    it.each([
      ["demoting an owner", { role: "manager" }, { role: "manager" }],
      ["deactivating an owner", { isActive: false }, { isActive: false }],
      ["re-saving an owner as owner", { role: "owner" }, { role: "owner" }],
    ])("%s needs no current password", async (_name, body, expected) => {
      const owner = await signedIn("owner");
      const target = await signedIn("owner");
      const result = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner, body);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(await rowOf(target.id)).toMatchObject(expected);
      // Deactivating still ends every session of the target.
      if ("isActive" in body && body.isActive === false) {
        expect(await sessionCount(target.id)).toBe(0);
      }
    });

    it("reactivating a non-owner needs no current password", async () => {
      const owner = await signedIn("owner");
      const target = await newUser("manager", { isActive: false });
      const result = await call<UserBody>("PATCH", `/admin/users/${target.id}`, owner, {
        isActive: true,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect((await rowOf(target.id)).isActive).toBe(true);
    });
  });

  describe("POST /admin/users/:id/reset-password", () => {
    it("resetting an owner's password: 400 without, 403 wrong, 204 with the right password", async () => {
      const actor = await signedIn("owner");
      const target = await signedIn("owner");
      const before = await rowOf(target.id);
      const reset = (body: Record<string, unknown>) =>
        call<ProblemBody>("POST", `/admin/users/${target.id}/reset-password`, actor, {
          newPassword: NEW_PASSWORD,
          ...body,
        });

      const missing = await reset({});
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => error.path)).toContain("currentPassword");
      expect((await rowOf(target.id)).passwordHash).toBe(before.passwordHash);
      expect(await sessionCount(target.id)).toBe(1);

      const wrong = await reset({ currentPassword: "not the password" });
      expect(wrong.status).toBe(403);
      expect(wrong.body.rule).toBe("current_password_incorrect");
      expect((await rowOf(target.id)).passwordHash).toBe(before.passwordHash);
      expect(await sessionCount(target.id)).toBe(1);

      const done = await reset({ currentPassword: PASSWORD });
      expect(done.status, JSON.stringify(done.body)).toBe(204);
      const after = await rowOf(target.id);
      expect(await testPasswordHasher.verify(NEW_PASSWORD, after.passwordHash)).toBe(true);
      expect(await sessionCount(target.id)).toBe(0);
      expect(await stepUpFailuresOf(actor.id)).toEqual(["admin_user.password_reset"]);
    });

    it("an inactive owner is still an owner: their reset needs the password", async () => {
      const actor = await signedIn("owner");
      const target = await newUser("owner", { isActive: false });
      const missing = await call<ProblemBody>(
        "POST",
        `/admin/users/${target.id}/reset-password`,
        actor,
        { newPassword: NEW_PASSWORD },
      );
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => error.path)).toContain("currentPassword");
    });

    it("an owner resetting their OWN password gives their current one, and loses all their sessions", async () => {
      const owner = await signedIn("owner");
      const second = await loginCookie(running.baseUrl, owner.email, PASSWORD);
      const missing = await call<ProblemBody>(
        "POST",
        `/admin/users/${owner.id}/reset-password`,
        owner,
        { newPassword: NEW_PASSWORD },
      );
      expect(missing.status).toBe(400);
      expect(missing.body.errors?.map((error) => error.path)).toContain("currentPassword");
      expect((await call("GET", "/admin/auth/me", owner)).status).toBe(200);

      const done = await call("POST", `/admin/users/${owner.id}/reset-password`, owner, {
        newPassword: NEW_PASSWORD,
        currentPassword: PASSWORD,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(204);
      expect(await sessionCount(owner.id)).toBe(0);
      expect((await call("GET", "/admin/auth/me", owner)).status).toBe(401);
      expect(
        (await http(running.baseUrl, "GET", "/admin/auth/me", { headers: { cookie: second } }))
          .status,
      ).toBe(401);
      expect((await login(running.baseUrl, owner.email, NEW_PASSWORD)).status).toBe(200);
    });

    it.each(["manager", "viewer"] as const)(
      "resetting a %s's password needs no current password",
      async (role) => {
        const owner = await signedIn("owner");
        const target = await newUser(role);
        const result = await call("POST", `/admin/users/${target.id}/reset-password`, owner, {
          newPassword: NEW_PASSWORD,
        });
        expect(result.status, JSON.stringify(result.body)).toBe(204);
        expect(
          await testPasswordHasher.verify(NEW_PASSWORD, (await rowOf(target.id)).passwordHash),
        ).toBe(true);
      },
    );
  });

  it("spends one of the five attempts per 15 minutes on a SUCCESS too: the sixth is 429 before any hashing", async () => {
    const owner = await signedIn("owner");
    const createOwner = () =>
      call<ProblemBody & UserBody>("POST", "/admin/users", owner, {
        email: `budget-owner-${randomUUID()}@example.test`,
        role: "owner",
        password: NEW_PASSWORD,
        currentPassword: PASSWORD,
      });
    for (let index = 0; index < 5; index += 1) {
      const result = await createOwner();
      expect(result.status, `attempt ${String(index + 1)}: ${JSON.stringify(result.body)}`).toBe(
        201,
      );
      created.push(result.body.id);
    }
    const hasher = running.app.get(PasswordHasher);
    const verify = vi.spyOn(hasher, "verify");
    const dummy = vi.spyOn(hasher, "verifyDummy");
    const hash = vi.spyOn(hasher, "hash");
    const limited = await createOwner();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(verify).not.toHaveBeenCalled();
    expect(dummy).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();

    // A change that needs no password re-entry is not touched by the exhausted budget.
    const manager = await call<UserBody>("POST", "/admin/users", owner, {
      email: `budget-manager-${randomUUID()}@example.test`,
      role: "manager",
      password: NEW_PASSWORD,
    });
    expect(manager.status, JSON.stringify(manager.body)).toBe(201);
    created.push(manager.body.id);
  });
});

/**
 * Owner decision 4 of the plan: the new sensitive actions fail closed. Without the shared strict limits the three
 * owner operations answer 503 and do no password work; everything that needs no re-entry keeps working.
 */
describe("the owner operations without Redis", () => {
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    // No `redisUrl`: `UnavailableStrictWindows` answers "unavailable" for every attempt.
    running = await startApp({ adminAuthenticator: "production-default" });
    db = running.app.get<Database>(DRIZZLE);
    await db.delete(adminUser);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await db.delete(adminUser);
    await running.app.close();
  });

  async function signedInOwner(): Promise<TestAdminUser & { cookie: string }> {
    const user = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    created.push(user.id);
    return { ...user, cookie: await loginCookie(running.baseUrl, user.email, PASSWORD) };
  }

  const send = <T>(
    method: "POST" | "PATCH",
    path: string,
    cookie: string,
    body: unknown,
  ): Promise<HttpResult<T>> =>
    http<T>(running.baseUrl, method, path, { body, headers: { cookie } });

  it.each(["create an owner", "promote to owner", "reset an owner's password"] as const)(
    "%s answers 503 and does no password work and no write",
    async (operation) => {
      const owner = await signedInOwner();
      const target = await createTestAdminUser(db, { role: "manager", password: PASSWORD });
      created.push(target.id);
      const hasher = running.app.get(PasswordHasher);
      const verify = vi.spyOn(hasher, "verify");
      const dummy = vi.spyOn(hasher, "verifyDummy");
      const email = `no-redis-${randomUUID()}@example.test`;
      const refused = await (operation === "create an owner"
        ? send<ProblemBody>("POST", "/admin/users", owner.cookie, {
            email,
            role: "owner",
            password: NEW_PASSWORD,
            currentPassword: PASSWORD,
          })
        : operation === "promote to owner"
          ? send<ProblemBody>("PATCH", `/admin/users/${target.id}`, owner.cookie, {
              role: "owner",
              currentPassword: PASSWORD,
            })
          : send<ProblemBody>(`POST`, `/admin/users/${owner.id}/reset-password`, owner.cookie, {
              newPassword: NEW_PASSWORD,
              currentPassword: PASSWORD,
            }));
      expect(refused.status, JSON.stringify(refused.body)).toBe(503);
      expect(refused.body).toMatchObject({
        code: "service_unavailable",
        rule: "step_up_unavailable",
      });
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(verify).not.toHaveBeenCalled();
      expect(dummy).not.toHaveBeenCalled();
      expect(await db.select().from(adminUser).where(eq(adminUser.email, email))).toEqual([]);
      const [stored] = await db.select().from(adminUser).where(eq(adminUser.id, target.id));
      expect(stored?.role).toBe("manager");
    },
  );

  it("leaves every operation that needs no password re-entry working", async () => {
    const owner = await signedInOwner();
    const manager = await send<{ id: string }>("POST", "/admin/users", owner.cookie, {
      email: `no-redis-manager-${randomUUID()}@example.test`,
      role: "manager",
      password: NEW_PASSWORD,
    });
    expect(manager.status, JSON.stringify(manager.body)).toBe(201);
    created.push(manager.body.id);
    const reset = await send(
      "POST",
      `/admin/users/${manager.body.id}/reset-password`,
      owner.cookie,
      { newPassword: `${NEW_PASSWORD} two` },
    );
    expect(reset.status, JSON.stringify(reset.body)).toBe(204);
    const second = await signedInOwner();
    const demoted = await send("PATCH", `/admin/users/${second.id}`, owner.cookie, {
      role: "manager",
    });
    expect(demoted.status, JSON.stringify(demoted.body)).toBe(200);
  });
});
