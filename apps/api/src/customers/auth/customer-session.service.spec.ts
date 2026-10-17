import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../database/schema/index.js";
import { customer, customerSession } from "../../database/schema/index.js";
import type { Database } from "../../database/database.module.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { FakeClock } from "../../test/fake-clock.js";
import { ensureMigrated } from "../../test/migrate.js";
import { CustomerSessionRepository } from "./customer-session.repository.js";
import { CustomerSessionService } from "./customer-session.service.js";

const LIMITS = { cookieSecure: true, idleMinutes: 60, maxHours: 24 };
const START = "2030-06-01T12:00:00.000Z";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("CustomerSessionService (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const db: Database = drizzle(pool, { schema });
  const clock = new FakeClock(START);
  const service = new CustomerSessionService(new CustomerSessionRepository(db), clock, LIMITS);
  const created: string[] = [];
  let shopper: TestCustomer;

  async function newCustomer(
    options?: Parameters<typeof createTestCustomer>[1],
  ): Promise<TestCustomer> {
    const made = await createTestCustomer(db, options);
    created.push(made.id);
    return made;
  }

  async function storedSessions(
    customerId: string,
  ): Promise<(typeof customerSession.$inferSelect)[]> {
    return db.select().from(customerSession).where(eq(customerSession.customerId, customerId));
  }

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    clock.set(START);
    shopper = await newCustomer();
  });

  afterEach(async () => {
    await deleteTestCustomers(db, created.splice(0));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("create returns a 32-byte base64url token once and stores only its SHA-256", async () => {
    const session = await service.create(shopper.id);
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(session.token, "base64url")).toHaveLength(32);
    const rows = await storedSessions(shopper.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256(session.token));
    expect(rows[0]?.id).toBe(session.sessionId);
    // The raw token is nowhere in the database: not in the session row, not in any customer row.
    const sessionDump = await pool.query(
      "select to_jsonb(s)::text as text from customer_session s",
    );
    const customerDump = await pool.query("select to_jsonb(c)::text as text from customer c");
    for (const { text } of [...sessionDump.rows, ...customerDump.rows] as { text: string }[]) {
      expect(text.includes(session.token)).toBe(false);
    }
  });

  it("create stores created_at, last_seen_at = now and expires_at = now + max lifetime", async () => {
    const session = await service.create(shopper.id);
    const [row] = await storedSessions(shopper.id);
    expect(row?.createdAt.toISOString()).toBe(START);
    expect(row?.lastSeenAt.toISOString()).toBe(START);
    expect(row?.expiresAt.toISOString()).toBe("2030-06-02T12:00:00.000Z");
    expect(session.expiresAt.toISOString()).toBe("2030-06-02T12:00:00.000Z");
  });

  it("creates a NEW token every time, also for the same customer (no session fixation)", async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      tokens.add((await service.create(shopper.id)).token);
    }
    expect(tokens.size).toBe(20);
    expect(await storedSessions(shopper.id)).toHaveLength(20);
  });

  it("resolve returns the session and the customer read from the database", async () => {
    const { token, sessionId } = await service.create(shopper.id);
    expect(await service.resolve(token)).toEqual({
      sessionId,
      customer: { id: shopper.id, email: shopper.email },
    });
  });

  it("a session of customer A never authenticates customer B", async () => {
    const other = await newCustomer();
    const a = await service.create(shopper.id);
    const b = await service.create(other.id);
    expect((await service.resolve(a.token))?.customer.id).toBe(shopper.id);
    expect((await service.resolve(b.token))?.customer.id).toBe(other.id);
    await service.revokeSession(a.sessionId);
    expect(await service.resolve(a.token)).toBeUndefined();
    expect((await service.resolve(b.token))?.customer.id).toBe(other.id);
  });

  it("expires after the idle timeout and deletes the session", async () => {
    const { token } = await service.create(shopper.id);
    clock.advanceMinutes(59);
    expect(await service.resolve(token)).toBeDefined();
    clock.advanceMinutes(60);
    expect(await service.resolve(token)).toBeUndefined();
    expect(await storedSessions(shopper.id)).toHaveLength(0);
  });

  it("idle time counts from the last activity, not from creation", async () => {
    const { token } = await service.create(shopper.id);
    for (let i = 0; i < 5; i += 1) {
      clock.advanceMinutes(50);
      expect(await service.resolve(token), `after ${(i + 1) * 50} minutes`).toBeDefined();
    }
  });

  it("expires at the absolute lifetime even when used all the time, exactly at the limit", async () => {
    const { token } = await service.create(shopper.id);
    for (let minutes = 50; minutes < 24 * 60; minutes += 50) {
      clock.set(new Date(Date.parse(START) + minutes * 60_000));
      expect(await service.resolve(token), `minute ${minutes}`).toBeDefined();
    }
    clock.set("2030-06-02T11:59:59.000Z");
    expect(await service.resolve(token)).toBeDefined();
    clock.set("2030-06-02T12:00:00.000Z");
    expect(await service.resolve(token)).toBeUndefined();
    expect(await storedSessions(shopper.id)).toHaveLength(0);
  });

  it("rejects a session whose stored expires_at passed even if the configured lifetime is longer", async () => {
    const { token, sessionId } = await service.create(shopper.id);
    await db
      .update(customerSession)
      .set({ expiresAt: new Date(Date.parse(START) + 1000) })
      .where(eq(customerSession.id, sessionId));
    clock.advanceMinutes(1);
    expect(await service.resolve(token)).toBeUndefined();
  });

  it("does not resolve for a deactivated customer on the very next call, and not after reactivation if it was deleted", async () => {
    const { token } = await service.create(shopper.id);
    await db.update(customer).set({ isActive: false }).where(eq(customer.id, shopper.id));
    expect(await service.resolve(token)).toBeUndefined();
    await db.update(customer).set({ isActive: true }).where(eq(customer.id, shopper.id));
    expect(await service.resolve(token)).toBeDefined();
  });

  it("returns undefined for unknown, garbage and wrongly shaped tokens without touching others", async () => {
    const { token } = await service.create(shopper.id);
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

  it("does not accept the stored hash as a token (the hash is not a credential)", async () => {
    const { token } = await service.create(shopper.id);
    expect(await service.resolve(sha256(token))).toBeUndefined();
    expect(await service.resolve(sha256(token).slice(0, 43))).toBeUndefined();
  });

  it("touches last_seen_at at most once a minute", async () => {
    const { token } = await service.create(shopper.id);
    const lastSeen = async (): Promise<string | undefined> =>
      (await storedSessions(shopper.id))[0]?.lastSeenAt.toISOString();

    clock.advanceMinutes(0.5);
    await service.resolve(token);
    expect(await lastSeen()).toBe(START);

    clock.set("2030-06-01T12:01:00.000Z");
    await service.resolve(token);
    expect(await lastSeen()).toBe("2030-06-01T12:01:00.000Z");

    clock.set("2030-06-01T12:01:30.000Z");
    await service.resolve(token);
    expect(await lastSeen()).toBe("2030-06-01T12:01:00.000Z");
  });

  it("revoke deletes the session; the token cannot be used again; unknown or malformed tokens are harmless", async () => {
    const { token } = await service.create(shopper.id);
    expect(await service.revoke(token)).toBe(true);
    expect(await service.resolve(token)).toBeUndefined();
    expect(await service.revoke(token)).toBe(false);
    expect(await service.revoke("garbage")).toBe(false);
    expect(await service.revoke(undefined as unknown as string)).toBe(false);
  });

  it("revoke leaves other sessions alone", async () => {
    const [a, b] = [await service.create(shopper.id), await service.create(shopper.id)];
    await service.revoke(a.token);
    expect(await service.resolve(b.token)).toBeDefined();
  });

  it("revokeSession deletes one session by id", async () => {
    const [a, b] = [await service.create(shopper.id), await service.create(shopper.id)];
    await service.revokeSession(a.sessionId);
    expect(await service.resolve(a.token)).toBeUndefined();
    expect(await service.resolve(b.token)).toBeDefined();
  });

  it("revokeAllForCustomer deletes every session of that customer only", async () => {
    const other = await newCustomer();
    const mine = [await service.create(shopper.id), await service.create(shopper.id)];
    const theirs = await service.create(other.id);
    expect(await service.revokeAllForCustomer(shopper.id)).toBe(2);
    for (const session of mine) {
      expect(await service.resolve(session.token)).toBeUndefined();
    }
    expect(await service.resolve(theirs.token)).toBeDefined();
  });

  it("revokeAllForCustomer can keep one session (the current one)", async () => {
    const [keep, drop1, drop2] = [
      await service.create(shopper.id),
      await service.create(shopper.id),
      await service.create(shopper.id),
    ];
    expect(await service.revokeAllForCustomer(shopper.id, keep.sessionId)).toBe(2);
    expect(await service.resolve(keep.token)).toBeDefined();
    expect(await service.resolve(drop1.token)).toBeUndefined();
    expect(await service.resolve(drop2.token)).toBeUndefined();
  });

  it("keeping a session id of ANOTHER customer revokes everything of this one", async () => {
    const other = await newCustomer();
    const foreign = await service.create(other.id);
    const mine = await service.create(shopper.id);
    expect(await service.revokeAllForCustomer(shopper.id, foreign.sessionId)).toBe(1);
    expect(await service.resolve(mine.token)).toBeUndefined();
    expect(await service.resolve(foreign.token)).toBeDefined();
  });

  it("deleting the customer deletes its sessions (database cascade)", async () => {
    await service.create(shopper.id);
    await deleteTestCustomers(db, [shopper.id]);
    expect(await storedSessions(shopper.id)).toHaveLength(0);
  });

  it("does not catch database failures: they surface, they never become 'not signed in'", async () => {
    const broken = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
    const brokenDb: Database = drizzle(broken, { schema });
    const brokenService = new CustomerSessionService(
      new CustomerSessionRepository(brokenDb),
      clock,
      LIMITS,
    );
    const { token } = await service.create(shopper.id);
    await broken.end();
    await expect(brokenService.resolve(token)).rejects.toThrow();
  });
});
