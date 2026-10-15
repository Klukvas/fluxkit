import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminSession } from "../database/schema/index.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { login, loginCookie, sessionCookieOf } from "../test/auth-http.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SessionService } from "./session.service.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a different long passphrase 42";

describe("login racing a password reset (the session must not outlive the reset)", () => {
  const clock = new FakeClock("2030-06-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  let sessions: SessionService;
  const created: string[] = [];

  async function newUser(role: "owner" | "manager"): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role, password: PASSWORD });
    created.push(user.id);
    return user;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    sessions = running.app.get(SessionService);
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

  it("revokes a session issued for the old password when the reset lands just before the session insert", async () => {
    const owner = await newUser("owner");
    const victim = await newUser("manager");
    const ownerCookie = await loginCookie(running.baseUrl, owner.email, PASSWORD);

    // Deterministic ordering: when the login reaches the session insert (the password was checked and, before the
    // fix, the user transaction had already committed), a password reset is started and given time to finish.
    // With the session created inside the user-row lock the reset must wait for the login to commit instead.
    const original = sessions.create.bind(sessions);
    let reset: Promise<{ status: number }> | undefined;
    vi.spyOn(sessions, "create").mockImplementation(async (...args) => {
      reset = http(running.baseUrl, "POST", `/admin/users/${victim.id}/reset-password`, {
        body: { newPassword: NEW_PASSWORD },
        headers: { cookie: ownerCookie },
      });
      await Promise.race([reset, new Promise((resolve) => setTimeout(resolve, 500))]);
      return original(...args);
    });

    const result = await login(running.baseUrl, victim.email, PASSWORD);
    expect(reset).toBeDefined();
    expect((await reset)?.status).toBe(204);

    // Whatever the login answered, no session for the old password may remain.
    expect(result.status).toBe(200);
    const cookie = sessionCookieOf(result) ?? "";
    expect(
      (await http(running.baseUrl, "GET", "/admin/brands", { headers: { cookie } })).status,
    ).toBe(401);
    expect(await db.select().from(adminSession).where(eq(adminSession.userId, victim.id))).toEqual(
      [],
    );
  });
});
