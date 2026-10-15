import type { AdminRole } from "@fluxkit/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminUser } from "../../database/schema/index.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { loginCookie } from "../../test/auth-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { OWNER_CHANGE_LOCK_KEY } from "../admin-user.repository.js";

const PASSWORD = "correct horse battery staple";
const ROUNDS = 12;

describe("the last active owner under concurrency", () => {
  const clock = new FakeClock("2030-09-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  async function newUser(role: AdminRole): Promise<TestAdminUser & { cookie: string }> {
    const user = await createTestAdminUser(db, { role, password: PASSWORD });
    created.push(user.id);
    // Every login comes from 127.0.0.1: move to a fresh throttle window between users.
    clock.advanceMinutes(11);
    return { ...user, cookie: await loginCookie(running.baseUrl, user.email, PASSWORD) };
  }

  const patch = (cookie: string, id: string, body: unknown) =>
    http<Record<string, unknown>>(running.baseUrl, "PATCH", `/admin/users/${id}`, {
      body,
      headers: { cookie },
    });

  const activeOwners = async (): Promise<number> =>
    db.$count(adminUser, and(eq(adminUser.role, "owner"), eq(adminUser.isActive, true)));

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    // Counts ALL owners of the database; this file runs alone against a `_test` database (see ensureMigrated).
    await db.delete(adminUser);
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await db.delete(adminUser);
    await running.app.close();
  });

  it.each([
    ["demoting each other", { role: "viewer" }],
    ["deactivating each other", { isActive: false }],
  ])(
    "two owners %s at the same moment: at most one succeeds and an active owner remains (repeated for several rounds)",
    async (_name, change) => {
      for (let round = 1; round <= ROUNDS; round += 1) {
        const first = await newUser("owner");
        const second = await newUser("owner");
        const results = await Promise.all([
          patch(first.cookie, second.id, change),
          patch(second.cookie, first.id, change),
        ]);
        const succeeded = results.filter((result) => result.status === 200).length;
        expect(succeeded, `round ${round}`).toBeLessThanOrEqual(1);
        expect(await activeOwners(), `round ${round}`).toBeGreaterThanOrEqual(1);
        for (const result of results) {
          // The loser is refused by the rule (409) or already lost its role before the guard ran (403 or 401).
          expect([200, 401, 403, 409], `round ${round}`).toContain(result.status);
        }
        await deleteTestAdminUsers(db, created.splice(0));
      }
    },
  );

  it("three owners: concurrent requests can remove two of them but never the last", async () => {
    const owners = [await newUser("owner"), await newUser("owner"), await newUser("owner")];
    const [a, b, c] = owners as [
      (typeof owners)[number],
      (typeof owners)[number],
      (typeof owners)[number],
    ];
    await Promise.all([
      patch(a.cookie, b.id, { role: "viewer" }),
      patch(b.cookie, c.id, { role: "viewer" }),
      patch(c.cookie, a.id, { role: "viewer" }),
      patch(a.cookie, c.id, { isActive: false }),
      patch(b.cookie, a.id, { isActive: false }),
      patch(c.cookie, b.id, { isActive: false }),
    ]);
    expect(await activeOwners()).toBeGreaterThanOrEqual(1);
  });

  it("every owner change waits for the owner-change lock (deterministic proof that the lock is taken)", async () => {
    const owner = await newUser("owner");
    const target = await newUser("manager");
    let settled = false;
    let pending: ReturnType<typeof patch> | undefined;
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${OWNER_CHANGE_LOCK_KEY})`);
      pending = patch(owner.cookie, target.id, { role: "viewer" });
      void pending.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      // The request reached the service but cannot decide while somebody else may be changing owners.
      expect(settled).toBe(false);
    });
    const result = await pending;
    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({ id: target.id, role: "viewer" });
  });
});
