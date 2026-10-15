import { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminSession } from "../database/schema/index.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { startApp } from "../test/app.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { SessionService } from "./session.service.js";

describe("expired session cleanup at application start", () => {
  const clock = new FakeClock("2030-06-01T08:00:00.000Z");

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes expired sessions of every user once, when the application bootstraps", async () => {
    const seeding = await startApp({ adminAuthenticator: "production-default", clock });
    const seedDb = seeding.app.get<Database>(DRIZZLE);
    const [first, second] = [
      await createTestAdminUser(seedDb, { role: "manager" }),
      await createTestAdminUser(seedDb, { role: "viewer" }),
    ];
    const sessions = seeding.app.get(SessionService);
    const longAgo = new Date(clock.now().getTime() - 30 * 24 * 60 * 60_000);
    const recent = new Date(clock.now().getTime() - 5 * 60_000);
    const stale = [
      await sessions.create(first.id, longAgo),
      await sessions.create(second.id, longAgo),
    ];
    const live = [
      await sessions.create(first.id, recent),
      await sessions.create(second.id, recent),
    ];
    await seeding.app.close();

    const restarted = await startApp({ adminAuthenticator: "production-default", clock });
    try {
      const db = restarted.app.get<Database>(DRIZZLE);
      const rows = [
        ...(await db.select().from(adminSession).where(eq(adminSession.userId, first.id))),
        ...(await db.select().from(adminSession).where(eq(adminSession.userId, second.id))),
      ].map((row) => row.id);
      expect(rows.sort()).toEqual(live.map((session) => session.sessionId).sort());
      expect(rows).not.toContain(stale[0]?.sessionId);
      expect(rows).not.toContain(stale[1]?.sessionId);
    } finally {
      await deleteTestAdminUsers(restarted.app.get<Database>(DRIZZLE), [first.id, second.id]);
      await restarted.app.close();
    }
  });

  it("logs a failure as a warning with the error name and code only, and still starts", async () => {
    const failure = Object.assign(new Error("secret text for victim@example.com"), {
      code: "57P01",
    });
    vi.spyOn(SessionService.prototype, "deleteExpired").mockRejectedValue(failure);
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    const started = await startApp({ adminAuthenticator: "production-default", clock });
    try {
      const text = warn.mock.calls.flat().map(String).join("\n");
      expect(text).toContain("Could not delete expired admin sessions");
      expect(text).toContain("Error");
      expect(text).toContain("57P01");
      expect(text).not.toContain("victim@example.com");
      expect(text).not.toContain("secret text");
    } finally {
      await started.app.close();
    }
  });
});
