import { DrizzleQueryError } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { login, loginCookie } from "../test/auth-http.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  UnlockAdminUsageError,
  describeUnlockAdminError,
  formatUnlocked,
  parseUnlockAdminArgs,
  runUnlockAdminCommand,
} from "./unlock-admin-command.js";

const PASSWORD = "correct horse battery staple";

function usageMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnlockAdminUsageError);
    return (error as Error).message;
  }
  throw new Error("Expected an UnlockAdminUsageError but nothing was thrown");
}

describe("parseUnlockAdminArgs", () => {
  it("requires --email", () => {
    expect(usageMessage(() => parseUnlockAdminArgs([]))).toMatch(/--email is required/);
  });

  it("normalizes the email like login does (trim, lower case)", () => {
    expect(parseUnlockAdminArgs(["--email", "  Boss@Example.COM "])).toEqual({
      email: "boss@example.com",
    });
  });

  it("accepts --email=value and --email value", () => {
    expect(parseUnlockAdminArgs(["--email=a@b.co"])).toEqual({ email: "a@b.co" });
    expect(parseUnlockAdminArgs(["--email", "a@b.co"])).toEqual({ email: "a@b.co" });
  });

  it("rejects an invalid email", () => {
    expect(usageMessage(() => parseUnlockAdminArgs(["--email", "nope"]))).toMatch(/valid email/);
  });

  it("rejects unknown flags (including --role), stray values and a repeated --email", () => {
    expect(
      usageMessage(() => parseUnlockAdminArgs(["--email", "a@b.co", "--role", "owner"])),
    ).toMatch(/Unknown argument "--role"/);
    expect(usageMessage(() => parseUnlockAdminArgs(["--email", "a@b.co", "--force"]))).toMatch(
      /Unknown argument "--force"/,
    );
    expect(usageMessage(() => parseUnlockAdminArgs(["--email", "a@b.co", "extra"]))).toMatch(
      /Unexpected argument "extra"/,
    );
    expect(
      usageMessage(() => parseUnlockAdminArgs(["--email", "a@b.co", "--email=c@d.co"])),
    ).toMatch(/--email was given more than once/);
  });

  it("rejects a flag without a value", () => {
    expect(usageMessage(() => parseUnlockAdminArgs(["--email"]))).toMatch(/--email needs a value/);
    expect(usageMessage(() => parseUnlockAdminArgs(["--email", "--other"]))).toMatch(
      /--email needs a value/,
    );
  });

  it.each([
    [["--password", "hunter2hunter2"]],
    [["--password=hunter2hunter2"]],
    [["--pass", "hunter2hunter2"]],
    [["-p", "hunter2hunter2"]],
    [["--new-password=hunter2hunter2"]],
  ])("refuses a password-like argument %j without echoing the value", (extra) => {
    const message = usageMessage(() => parseUnlockAdminArgs(["--email", "a@b.co", ...extra]));
    expect(message).toMatch(/process list and shell history/);
    expect(message).not.toContain("hunter2");
  });
});

describe("formatUnlocked and describeUnlockAdminError", () => {
  it("prints exactly one short line", () => {
    expect(formatUnlocked({ email: "a@b.co", outcome: "unlocked" })).toBe("Unlocked a@b.co");
    expect(formatUnlocked({ email: "a@b.co", outcome: "not_locked" })).toBe(
      "a@b.co was not locked",
    );
  });

  it("prints a usage error's message alone and an unexpected error without SQL, parameters or message", () => {
    expect(describeUnlockAdminError(new UnlockAdminUsageError("Nope."))).toBe("Nope.");
    const text = describeUnlockAdminError(
      new DrizzleQueryError("select * from admin_user where email = $1", ["victim@example.com"], {
        name: "Error",
        message: "Connection terminated unexpectedly",
      } as Error),
    );
    expect(text).not.toContain("victim@example.com");
    expect(text).not.toContain("admin_user");
    expect(text).not.toContain("Failed query");
  });
});

describe("runUnlockAdminCommand (real app, real Postgres)", () => {
  const databaseUrl = requireTestDatabaseUrl();
  const env = { DATABASE_URL: databaseUrl };
  const clock = new FakeClock("2030-06-01T08:00:00.000Z");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];

  async function newUser(
    options: Parameters<typeof createTestAdminUser>[1] = {},
  ): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role: "manager", password: PASSWORD, ...options });
    created.push(user.id);
    return user;
  }

  type Row = Record<string, unknown>;

  async function rowOf(id: string): Promise<Row> {
    const result = await pool.query<Row>("select * from admin_user where id = $1", [id]);
    const [row] = result.rows;
    if (row === undefined) throw new Error("test user vanished");
    return row;
  }

  async function sessionsOf(userId: string): Promise<Row[]> {
    const result = await pool.query<Row>(
      "select * from admin_session where user_id = $1 order by id",
      [userId],
    );
    return result.rows;
  }

  /** Five wrong passwords through the real endpoint: the account is locked for 15 minutes. */
  async function lockThroughLogin(user: TestAdminUser): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(running.baseUrl, user.email, "wrong password entirely")).status).toBe(
        401,
      );
    }
    const row = await rowOf(user.id);
    expect(row["failed_login_count"]).toBe(5);
    expect(row["locked_until"]).toBeInstanceOf(Date);
    // Locked: even the right password is refused.
    expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(401);
  }

  function without(row: Row, columns: string[]): Row {
    return Object.fromEntries(Object.entries(row).filter(([name]) => !columns.includes(name)));
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
  });

  afterEach(async () => {
    clock.advanceMinutes(11);
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
    await pool.end();
  });

  it("unlocks an account locked by real failed logins, and the owner can sign in again", async () => {
    const user = await newUser();
    await lockThroughLogin(user);

    const result = await runUnlockAdminCommand(["--email", user.email], env);

    expect(result).toEqual({ email: user.email, outcome: "unlocked" });
    const row = await rowOf(user.id);
    expect(row["failed_login_count"]).toBe(0);
    expect(row["locked_until"]).toBeNull();
    expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
  });

  it("changes only failed_login_count, locked_until and updated_at; sessions and other users stay untouched", async () => {
    const user = await newUser({ role: "owner" });
    const bystander = await newUser();
    const signedInCookie = await loginCookie(running.baseUrl, user.email, PASSWORD);
    await lockThroughLogin(user);
    await lockThroughLogin(bystander);
    const userBefore = await rowOf(user.id);
    const bystanderBefore = await rowOf(bystander.id);
    const sessionsBefore = await sessionsOf(user.id);
    expect(sessionsBefore).toHaveLength(1);

    await runUnlockAdminCommand(["--email", user.email], env);

    const userAfter = await rowOf(user.id);
    const touched = ["failed_login_count", "locked_until", "updated_at"];
    expect(without(userAfter, touched)).toEqual(without(userBefore, touched));
    expect(userAfter["password_hash"]).toBe(userBefore["password_hash"]);
    expect(userAfter["role"]).toBe("owner");
    expect(userAfter["is_active"]).toBe(true);
    expect(await rowOf(bystander.id)).toEqual(bystanderBefore);
    expect(await sessionsOf(user.id)).toEqual(sessionsBefore);
    expect(
      (
        await http(running.baseUrl, "GET", "/admin/auth/me", {
          headers: { cookie: signedInCookie },
        })
      ).status,
    ).toBe(200);
  });

  it("does not activate a deactivated account or change its role", async () => {
    const user = await newUser({ isActive: false, role: "viewer" });
    await pool.query(
      "update admin_user set failed_login_count = 5, locked_until = $2 where id = $1",
      [user.id, new Date("2030-06-01T09:00:00.000Z")],
    );
    await runUnlockAdminCommand(["--email", user.email], env);
    const row = await rowOf(user.id);
    expect(row).toMatchObject({
      is_active: false,
      role: "viewer",
      failed_login_count: 0,
      locked_until: null,
    });
  });

  it("clears a partial failure count too", async () => {
    const user = await newUser();
    await login(running.baseUrl, user.email, "wrong password entirely");
    expect((await rowOf(user.id))["failed_login_count"]).toBe(1);
    expect((await runUnlockAdminCommand(["--email", user.email], env)).outcome).toBe("unlocked");
    expect((await rowOf(user.id))["failed_login_count"]).toBe(0);
  });

  it("normalizes the email like login (case and surrounding spaces)", async () => {
    const user = await newUser();
    await lockThroughLogin(user);
    const result = await runUnlockAdminCommand(["--email", `  ${user.email.toUpperCase()} `], env);
    expect(result).toEqual({ email: user.email, outcome: "unlocked" });
    expect((await rowOf(user.id))["locked_until"]).toBeNull();
  });

  it("says the account was not locked and writes nothing", async () => {
    const user = await newUser();
    const before = await rowOf(user.id);
    const result = await runUnlockAdminCommand(["--email", user.email], env);
    expect(result).toEqual({ email: user.email, outcome: "not_locked" });
    expect(await rowOf(user.id)).toEqual(before);
  });

  it("rejects an unknown email with a clear message", async () => {
    await expect(
      runUnlockAdminCommand(["--email", "nobody-here@example.test"], env),
    ).rejects.toThrow(/No admin user with the email nobody-here@example\.test\./);
    await expect(
      runUnlockAdminCommand(["--email", "nobody-here@example.test"], env),
    ).rejects.toBeInstanceOf(UnlockAdminUsageError);
  });

  it("rejects bad arguments before touching the database (no DATABASE_URL needed)", async () => {
    await expect(runUnlockAdminCommand(["--email"], {})).rejects.toBeInstanceOf(
      UnlockAdminUsageError,
    );
    await expect(
      runUnlockAdminCommand(["--email", "a@b.co", "--password", "x"], {}),
    ).rejects.toBeInstanceOf(UnlockAdminUsageError);
  });

  it("never returns or prints the password hash", async () => {
    const user = await newUser();
    await lockThroughLogin(user);
    const hash = String((await rowOf(user.id))["password_hash"]);
    const result = await runUnlockAdminCommand(["--email", user.email], env);
    expect(JSON.stringify(result)).not.toContain(hash);
    expect(formatUnlocked(result)).not.toContain(hash);
  });
});
