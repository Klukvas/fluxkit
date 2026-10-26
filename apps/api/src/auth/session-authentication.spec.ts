import { Controller, Get, Module } from "@nestjs/common";
import { permissionsOf } from "@fluxkit/core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminUser } from "../database/schema/index.js";
import type { ProblemBody } from "../common/problem.filter.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SOME_ID } from "../test/routes.js";
import type { AdminPrincipal } from "./admin-authenticator.js";
import { CurrentAdmin } from "./current-admin.js";
import { RequirePermission } from "./route-access.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";
import { SessionAdminAuthenticator } from "./session-admin-authenticator.js";
import { SessionService } from "./session.service.js";

@Controller("admin/probe-me")
class WhoAmIProbeController {
  @Get()
  @RequirePermission("catalog.read")
  whoAmI(@CurrentAdmin() admin: AdminPrincipal): AdminPrincipal {
    return admin;
  }
}

@Module({ controllers: [WhoAmIProbeController] })
class WhoAmIProbeModule {}

const START = "2030-03-01T08:00:00.000Z";

describe("admin sessions end to end (real SessionAdminAuthenticator, real Postgres)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;
  let db: Database;
  let sessions: SessionService;
  const created: string[] = [];

  async function newUser(role: TestAdminUser["role"]): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role });
    created.push(user.id);
    return user;
  }

  async function signIn(user: TestAdminUser): Promise<{ cookie: string; token: string }> {
    const { token } = await sessions.create(user.id);
    return { cookie: `${SESSION_COOKIE_NAME}=${token}`, token };
  }

  const call = (cookie: string, path = "/admin/brands") =>
    http<ProblemBody>(running.baseUrl, "GET", path, { headers: { cookie } });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      adminSessionIdleMinutes: 60,
      adminSessionMaxHours: 24,
      extraFeatures: [{ name: "whoami-probe", module: WhoAmIProbeModule }],
    });
    db = running.app.get<Database>(DRIZZLE);
    sessions = running.app.get(SessionService);
  });

  beforeEach(() => {
    clock.set(START);
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("a cookie issued by the session service authenticates a real call", async () => {
    const { cookie } = await signIn(await newUser("viewer"));
    expect((await call(cookie)).status).toBe(200);
  });

  it("the handler sees the principal: user, email, role from the database, permissions, session", async () => {
    const user = await newUser("manager");
    const { cookie } = await signIn(user);
    const result = await http<AdminPrincipal>(running.baseUrl, "GET", "/admin/probe-me", {
      headers: { cookie },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      userId: user.id,
      email: user.email,
      role: "manager",
      permissions: [
        "catalog.read",
        "catalog.write",
        "catalog.publish",
        "orders.read",
        "orders.write",
        "customers.read",
        "customers.write",
        "shipping.manage",
        "email.manage",
      ],
    });
    expect(result.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(result.body)).not.toContain("passwordHash");
  });

  it("does not authenticate without a cookie, with a garbage cookie or with an unknown token", async () => {
    expect((await http(running.baseUrl, "GET", "/admin/brands")).status).toBe(401);
    expect((await call(`${SESSION_COOKIE_NAME}=garbage`)).status).toBe(401);
    expect((await call(`${SESSION_COOKIE_NAME}=${"A".repeat(43)}`)).status).toBe(401);
  });

  it("uses the first valid session cookie and ignores a malformed one before it", async () => {
    const { token } = await signIn(await newUser("viewer"));
    expect((await call(`${SESSION_COOKIE_NAME}=bad; ${SESSION_COOKIE_NAME}=${token}`)).status).toBe(
      200,
    );
    expect((await call(`a=b; ${SESSION_COOKIE_NAME}=${token}; c=d`)).status).toBe(200);
  });

  it("applies the role of the user: viewer is read-only, manager may write and publish", async () => {
    const viewer = await signIn(await newUser("viewer"));
    const manager = await signIn(await newUser("manager"));
    const post = (cookie: string, path: string) =>
      http<ProblemBody>(running.baseUrl, "POST", path, { body: {}, headers: { cookie } });
    expect((await post(viewer.cookie, "/admin/brands")).status).toBe(403);
    expect((await post(viewer.cookie, `/admin/products/${SOME_ID}/publish`)).status).toBe(403);
    expect((await post(manager.cookie, "/admin/brands")).status).toBe(400);
    expect((await post(manager.cookie, `/admin/products/${SOME_ID}/publish`)).status).toBe(404);
  });

  it("applies a role change on the very next request", async () => {
    const user = await newUser("viewer");
    const { cookie } = await signIn(user);
    const publish = () =>
      http<ProblemBody>(running.baseUrl, "POST", `/admin/products/${SOME_ID}/publish`, {
        headers: { cookie },
      });
    expect((await publish()).status).toBe(403);
    await db.update(adminUser).set({ role: "manager" }).where(eq(adminUser.id, user.id));
    expect((await publish()).status).toBe(404);
    await db.update(adminUser).set({ role: "viewer" }).where(eq(adminUser.id, user.id));
    expect((await publish()).status).toBe(403);
  });

  it("expires after the idle timeout with a controlled clock", async () => {
    const { cookie } = await signIn(await newUser("viewer"));
    clock.advanceMinutes(59);
    expect((await call(cookie)).status).toBe(200);
    clock.advanceMinutes(61);
    const expired = await call(cookie);
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ code: "unauthorized" });
    clock.set(START);
    expect((await call(cookie)).status).toBe(401);
  });

  it("expires at the absolute lifetime even when used continuously", async () => {
    const { cookie } = await signIn(await newUser("viewer"));
    // Every 50 minutes keeps the 60-minute idle timeout from firing; only the 24-hour limit can end it.
    for (let minutes = 50; minutes < 24 * 60; minutes += 50) {
      clock.set(new Date(Date.parse(START) + minutes * 60_000));
      expect((await call(cookie)).status, `minute ${minutes}`).toBe(200);
    }
    clock.set(new Date(Date.parse(START) + 24 * 3_600_000));
    expect((await call(cookie)).status).toBe(401);
  });

  it("stops working as soon as the user is deactivated", async () => {
    const user = await newUser("owner");
    const { cookie } = await signIn(user);
    expect((await call(cookie)).status).toBe(200);
    await db.update(adminUser).set({ isActive: false }).where(eq(adminUser.id, user.id));
    expect((await call(cookie)).status).toBe(401);
  });

  it("stops working when the session is revoked, but not other sessions of the same user", async () => {
    const user = await newUser("viewer");
    const [first, second] = [await signIn(user), await signIn(user)];
    expect((await call(first.cookie)).status).toBe(200);
    await sessions.revoke(first.token);
    expect((await call(first.cookie)).status).toBe(401);
    expect((await call(second.cookie)).status).toBe(200);
    await sessions.revokeAllForUser(user.id);
    expect((await call(second.cookie)).status).toBe(401);
  });

  it("does not accept a session token in a header or the query string", async () => {
    const { token } = await signIn(await newUser("owner"));
    const result = await http<ProblemBody>(
      running.baseUrl,
      "GET",
      `/admin/brands?session=${token}`,
      {
        headers: { authorization: `Bearer ${token}`, "x-session": token },
      },
    );
    expect(result.status).toBe(401);
  });

  it("the principal handed to handlers carries the role's permissions", async () => {
    const authenticator = new SessionAdminAuthenticator(sessions);
    const user = await newUser("manager");
    const { token } = await signIn(user);
    const principal = await authenticator.authenticate({
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    } as never);
    expect(principal).toMatchObject({
      userId: user.id,
      email: user.email,
      role: "manager",
      permissions: permissionsOf("manager"),
    });
    expect(principal?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rethrows an internal failure instead of answering 'not signed in' or 'allowed'", async () => {
    const failing = new SessionAdminAuthenticator({
      resolve: () => Promise.reject(new Error("database down")),
    } as unknown as SessionService);
    await expect(
      failing.authenticate({
        headers: { cookie: `${SESSION_COOKIE_NAME}=${"A".repeat(43)}` },
      } as never),
    ).rejects.toThrow("database down");
  });
});
