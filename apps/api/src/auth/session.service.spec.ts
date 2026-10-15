import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../database/schema/index.js";
import { adminSession, adminUser } from "../database/schema/index.js";
import type { Database } from "../database/database.module.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { ensureMigrated } from "../test/migrate.js";
import { SessionRepository } from "./session.repository.js";
import { SessionService } from "./session.service.js";

const LIMITS = { cookieSecure: true, idleMinutes: 60, maxHours: 24 };
const START = "2030-06-01T12:00:00.000Z";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("SessionService (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const db: Database = drizzle(pool, { schema });
  const clock = new FakeClock(START);
  const service = new SessionService(new SessionRepository(db), clock, LIMITS);
  const created: string[] = [];
  let user: TestAdminUser;

  async function newUser(
    options?: Parameters<typeof createTestAdminUser>[1],
  ): Promise<TestAdminUser> {
    const made = await createTestAdminUser(db, options);
    created.push(made.id);
    return made;
  }

  async function storedSessions(userId: string): Promise<(typeof adminSession.$inferSelect)[]> {
    return db.select().from(adminSession).where(eq(adminSession.userId, userId));
  }

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    clock.set(START);
    user = await newUser({ role: "manager" });
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("create returns a 32-byte base64url token once and stores only its SHA-256", async () => {
    const session = await service.create(user.id);
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(session.token, "base64url")).toHaveLength(32);
    const rows = await storedSessions(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256(session.token));
    expect(rows[0]?.id).toBe(session.sessionId);
    const everything = await pool.query("select to_jsonb(s)::text as text from admin_session s");
    expect(
      (everything.rows as { text: string }[]).some(({ text }) => text.includes(session.token)),
    ).toBe(false);
  });

  it("create stores created_at, last_seen_at = now and expires_at = now + max lifetime", async () => {
    const session = await service.create(user.id);
    const [row] = await storedSessions(user.id);
    expect(row?.createdAt.toISOString()).toBe(START);
    expect(row?.lastSeenAt.toISOString()).toBe(START);
    expect(row?.expiresAt.toISOString()).toBe("2030-06-02T12:00:00.000Z");
    expect(session.expiresAt.toISOString()).toBe("2030-06-02T12:00:00.000Z");
  });

  it("creates a different token every time", async () => {
    const [first, second] = [await service.create(user.id), await service.create(user.id)];
    expect(first.token).not.toBe(second.token);
  });

  it("resolve returns the session and the user with the role from the database", async () => {
    const { token, sessionId } = await service.create(user.id);
    const resolved = await service.resolve(token);
    expect(resolved).toEqual({
      sessionId,
      user: { id: user.id, email: user.email, role: "manager" },
    });
  });

  it("resolve accepts an explicit time, create too", async () => {
    const { token } = await service.create(user.id, new Date("2030-06-01T10:00:00.000Z"));
    expect(await service.resolve(token, new Date("2030-06-01T10:30:00.000Z"))).toBeDefined();
    expect(await service.resolve(token, new Date("2030-06-01T12:30:00.000Z"))).toBeUndefined();
  });

  it("expires after the idle timeout and deletes the session", async () => {
    const { token } = await service.create(user.id);
    clock.advanceMinutes(59);
    expect(await service.resolve(token)).toBeDefined();
    clock.advanceMinutes(60);
    expect(await service.resolve(token)).toBeUndefined();
    expect(await storedSessions(user.id)).toHaveLength(0);
  });

  it("idle time counts from the last activity, not from creation", async () => {
    const { token } = await service.create(user.id);
    for (let i = 0; i < 5; i += 1) {
      clock.advanceMinutes(50);
      expect(await service.resolve(token), `after ${(i + 1) * 50} minutes`).toBeDefined();
    }
  });

  it("expires at the absolute lifetime even when the session is used all the time", async () => {
    const { token } = await service.create(user.id);
    for (let minutes = 50; minutes < 24 * 60; minutes += 50) {
      clock.set(new Date(Date.parse(START) + minutes * 60_000));
      expect(await service.resolve(token), `minute ${minutes}`).toBeDefined();
    }
    clock.set("2030-06-02T11:59:59.000Z");
    expect(await service.resolve(token)).toBeDefined();
    clock.set("2030-06-02T12:00:00.000Z");
    expect(await service.resolve(token)).toBeUndefined();
    expect(await storedSessions(user.id)).toHaveLength(0);
  });

  it("does not resolve for a deactivated user, and resolves again when reactivated", async () => {
    const { token } = await service.create(user.id);
    await db.update(adminUser).set({ isActive: false }).where(eq(adminUser.id, user.id));
    expect(await service.resolve(token)).toBeUndefined();
    await db.update(adminUser).set({ isActive: true }).where(eq(adminUser.id, user.id));
    expect(await service.resolve(token)).toBeDefined();
  });

  it("sees a role change on the very next call (the role is never cached)", async () => {
    const { token } = await service.create(user.id);
    expect((await service.resolve(token))?.user.role).toBe("manager");
    await db.update(adminUser).set({ role: "viewer" }).where(eq(adminUser.id, user.id));
    expect((await service.resolve(token))?.user.role).toBe("viewer");
    await db.update(adminUser).set({ role: "owner" }).where(eq(adminUser.id, user.id));
    expect((await service.resolve(token))?.user.role).toBe("owner");
  });

  it("returns undefined for unknown, garbage and wrongly shaped tokens without touching others", async () => {
    const { token } = await service.create(user.id);
    const sameLengthUnknown = Buffer.alloc(32, 7).toString("base64url");
    expect(sameLengthUnknown).toHaveLength(43);
    for (const bad of [
      sameLengthUnknown,
      "",
      "garbage",
      "x".repeat(43),
      `${token}A`,
      token.slice(1),
      "../../etc/passwd",
      "' or 1=1 --",
      token.replace(/.$/, "!"),
    ]) {
      expect(await service.resolve(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(await service.resolve(undefined as unknown as string)).toBeUndefined();
    expect(await service.resolve(token)).toBeDefined();
  });

  it("touches last_seen_at at most once a minute", async () => {
    const { token } = await service.create(user.id);
    const lastSeen = async (): Promise<string | undefined> =>
      (await storedSessions(user.id))[0]?.lastSeenAt.toISOString();

    clock.advanceMinutes(0.5);
    await service.resolve(token);
    expect(await lastSeen()).toBe(START);

    clock.advanceMinutes(0.49);
    await service.resolve(token);
    expect(await lastSeen()).toBe(START);

    clock.set("2030-06-01T12:01:00.000Z");
    await service.resolve(token);
    expect(await lastSeen()).toBe("2030-06-01T12:01:00.000Z");

    clock.set("2030-06-01T12:01:30.000Z");
    await service.resolve(token);
    expect(await lastSeen()).toBe("2030-06-01T12:01:00.000Z");
  });

  it("revoke deletes the session and is harmless for unknown or malformed tokens", async () => {
    const { token } = await service.create(user.id);
    expect(await service.revoke(token)).toBe(true);
    expect(await service.resolve(token)).toBeUndefined();
    expect(await service.revoke(token)).toBe(false);
    expect(await service.revoke("garbage")).toBe(false);
    expect(await service.revoke(undefined as unknown as string)).toBe(false);
  });

  it("revoke leaves other sessions alone", async () => {
    const [a, b] = [await service.create(user.id), await service.create(user.id)];
    await service.revoke(a.token);
    expect(await service.resolve(b.token)).toBeDefined();
  });

  it("revokeAllForUser deletes every session of that user only", async () => {
    const other = await newUser();
    const mine = [await service.create(user.id), await service.create(user.id)];
    const theirs = await service.create(other.id);
    expect(await service.revokeAllForUser(user.id)).toBe(2);
    for (const session of mine) {
      expect(await service.resolve(session.token)).toBeUndefined();
    }
    expect(await service.resolve(theirs.token)).toBeDefined();
  });

  it("revokeAllForUser can keep one session (the current one)", async () => {
    const [keep, drop1, drop2] = [
      await service.create(user.id),
      await service.create(user.id),
      await service.create(user.id),
    ];
    expect(await service.revokeAllForUser(user.id, keep.sessionId)).toBe(2);
    expect(await service.resolve(keep.token)).toBeDefined();
    expect(await service.resolve(drop1.token)).toBeUndefined();
    expect(await service.resolve(drop2.token)).toBeUndefined();
  });

  it("deleting the user deletes its sessions (database cascade)", async () => {
    await service.create(user.id);
    await deleteTestAdminUsers(db, [user.id]);
    expect(await storedSessions(user.id)).toHaveLength(0);
  });
});
