import { Logger } from "@nestjs/common";
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
import { startApp, TEST_SCRYPT_PARAMS, type RunningApp } from "../test/app.js";
import { login, sessionCookieOf } from "../test/auth-http.js";
import { FakeClock } from "../test/fake-clock.js";
import { http, type HttpResult } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { PasswordHasher } from "./password-hasher.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";

const START = "2030-06-01T08:00:00.000Z";
const PASSWORD = "correct horse battery staple";

/** Everything a response shows to the caller except the time-dependent `date` header. */
function visible(result: HttpResult): {
  status: number;
  headers: [string, string][];
  body: string;
} {
  return {
    status: result.status,
    headers: [...result.headers.entries()].filter(([name]) => name !== "date").sort(),
    body: JSON.stringify(result.body),
  };
}

describe("POST /admin/auth/login", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;
  let db: Database;
  let hasher: PasswordHasher;
  const created: string[] = [];

  async function newUser(
    options: { isActive?: boolean; passwordHash?: string } = {},
  ): Promise<TestAdminUser> {
    const user = await createTestAdminUser(db, { role: "manager", password: PASSWORD, ...options });
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

  /** Scrypt operations of one request: verifications (real or dummy) and hash computations. */
  function spyHasher() {
    return {
      verify: vi.spyOn(hasher, "verify"),
      dummy: vi.spyOn(hasher, "verifyDummy"),
      hash: vi.spyOn(hasher, "hash"),
    };
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    hasher = running.app.get(PasswordHasher);
  });

  beforeEach(() => {
    // A new 10-minute window per test, so the per-IP limit (every call comes from 127.0.0.1) never leaks between tests.
    clock.advanceMinutes(11);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    await running.app.close();
  });

  describe("success", () => {
    it("answers 200 with the user, sets the session cookie with the fixed flags, and the cookie signs in", async () => {
      const user = await newUser();
      const result = await login(running.baseUrl, user.email, PASSWORD);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          role: "manager",
          isActive: true,
          lastLoginAt: clock.now().toISOString(),
        },
      });
      const setCookie = result.headers.getSetCookie();
      expect(setCookie).toHaveLength(1);
      expect(setCookie[0]).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
      for (const flag of ["HttpOnly", "SameSite=Strict", "Path=/admin", "Secure", "Max-Age="]) {
        expect(setCookie[0], flag).toContain(flag);
      }
      const cookie = sessionCookieOf(result) ?? "";
      expect(
        (await http(running.baseUrl, "GET", "/admin/brands", { headers: { cookie } })).status,
      ).toBe(200);
    });

    it("normalizes the email like the stored form (case and surrounding spaces)", async () => {
      const user = await newUser();
      const result = await login(running.baseUrl, `  ${user.email.toUpperCase()} `, PASSWORD);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ user: { id: user.id } });
    });

    it("creates a NEW session on every login and never adopts a token the caller sent (no session fixation)", async () => {
      const user = await newUser();
      const first = sessionCookieOf(await login(running.baseUrl, user.email, PASSWORD));
      const second = sessionCookieOf(await login(running.baseUrl, user.email, PASSWORD));
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(await sessionCount(user.id)).toBe(2);

      const planted = `${SESSION_COOKIE_NAME}=${"P".repeat(43)}`;
      const withPlanted = await http<Record<string, unknown>>(
        running.baseUrl,
        "POST",
        "/admin/auth/login",
        { body: { email: user.email, password: PASSWORD }, headers: { cookie: planted } },
      );
      expect(withPlanted.status).toBe(200);
      expect(sessionCookieOf(withPlanted)).not.toBe(planted);
      expect(
        (await http(running.baseUrl, "GET", "/admin/brands", { headers: { cookie: planted } }))
          .status,
      ).toBe(401);

      // Logging in while holding a valid session also issues a different one and keeps the old one working.
      const reuse = await http<Record<string, unknown>>(
        running.baseUrl,
        "POST",
        "/admin/auth/login",
        { body: { email: user.email, password: PASSWORD }, headers: { cookie: first ?? "" } },
      );
      expect(sessionCookieOf(reuse)).not.toBe(first);
      expect(await sessionCount(user.id)).toBe(4);
    });

    it("updates last_login_at and resets the lockout counters", async () => {
      const user = await newUser();
      await db
        .update(adminUser)
        .set({ failedLoginCount: 3, lastLoginAt: null })
        .where(eq(adminUser.id, user.id));
      await login(running.baseUrl, user.email, PASSWORD);
      const row = await rowOf(user.id);
      expect(row.failedLoginCount).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.lastLoginAt?.toISOString()).toBe(clock.now().toISOString());
    });

    it("rehashes the password in place when the stored parameters are not the current ones", async () => {
      const oldHash = await new PasswordHasher({ N: 32, r: 8, p: 1 }).hash(PASSWORD);
      const user = await newUser({ passwordHash: oldHash });
      expect(testPasswordHasher.needsRehash(oldHash)).toBe(true);
      const spies = spyHasher();
      const result = await login(running.baseUrl, user.email, PASSWORD);
      expect(result.status).toBe(200);
      expect(spies.hash).toHaveBeenCalledTimes(1);
      const row = await rowOf(user.id);
      expect(row.passwordHash).not.toBe(oldHash);
      expect(testPasswordHasher.needsRehash(row.passwordHash)).toBe(false);
      expect(await testPasswordHasher.verify(PASSWORD, row.passwordHash)).toBe(true);
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
    });

    it("does one verification and no rehash when the hash is current", async () => {
      const user = await newUser();
      const spies = spyHasher();
      await login(running.baseUrl, user.email, PASSWORD);
      expect(spies.verify).toHaveBeenCalledTimes(1);
      expect(spies.dummy).not.toHaveBeenCalled();
      expect(spies.hash).not.toHaveBeenCalled();
      expect(TEST_SCRYPT_PARAMS.N).toBe(16);
    });
  });

  describe("request shape", () => {
    it("needs the CSRF header like every state-changing admin request", async () => {
      const user = await newUser();
      const result = await http<ProblemBody>(running.baseUrl, "POST", "/admin/auth/login", {
        body: { email: user.email, password: PASSWORD },
        csrf: false,
      });
      expect(result.status).toBe(403);
      expect(sessionCookieOf(result)).toBeUndefined();
    });

    it.each([
      ["no body", undefined],
      ["an empty object", {}],
      ["a missing password", { email: "a@example.test" }],
      ["a missing email", { password: PASSWORD }],
      ["a numeric password", { email: "a@example.test", password: 12345678 }],
      ["an object as email", { email: { $ne: "" }, password: PASSWORD }],
      ["an array as password", { email: "a@example.test", password: [PASSWORD] }],
      ["an unknown field", { email: "a@example.test", password: PASSWORD, remember: true }],
      ["a password over 1024 characters", { email: "a@example.test", password: "x".repeat(1025) }],
    ])("answers 400 validation_failed for %s", async (_name, body) => {
      const result = await http<ProblemBody>(running.baseUrl, "POST", "/admin/auth/login", {
        ...(body === undefined ? {} : { body }),
      });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "validation_failed" });
      expect(sessionCookieOf(result)).toBeUndefined();
    });

    it.each([
      ["an empty password", ""],
      ["a password shorter than the policy", "short"],
      ["a password of exactly 1024 characters", "x".repeat(1024)],
    ])("sends %s through the normal failure path (401), not a 400", async (_name, password) => {
      const user = await newUser();
      const result = await login(running.baseUrl, user.email, password);
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: "unauthorized" });
    });

    it("treats a malformed email like an unknown account (401), not a validation error", async () => {
      for (const email of ["not-an-email", "", "a@b", "x".repeat(1000)]) {
        const result = await login(running.baseUrl, email, PASSWORD);
        expect(result.status, email.slice(0, 20)).toBe(401);
      }
    });
  });

  describe("every failure looks the same", () => {
    async function failureCases() {
      const wrongPassword = await newUser();
      const inactive = await newUser({ isActive: false });
      const locked = await newUser();
      await db
        .update(adminUser)
        .set({
          failedLoginCount: 5,
          lockedUntil: new Date(clock.now().getTime() + 10 * 60_000),
        })
        .where(eq(adminUser.id, locked.id));
      return {
        unknown: { email: "nobody-here@example.test", password: PASSWORD },
        wrongPassword: { email: wrongPassword.email, password: "this is the wrong one" },
        locked: { email: locked.email, password: PASSWORD },
        inactive: { email: inactive.email, password: PASSWORD },
      };
    }

    it("answers byte-identical 401 problems (body and headers) for unknown email, wrong password, locked and inactive", async () => {
      const cases = await failureCases();
      const results: Record<string, HttpResult> = {};
      for (const [name, credentials] of Object.entries(cases)) {
        results[name] = await login(running.baseUrl, credentials.email, credentials.password);
      }
      const reference = visible(results["unknown"] as HttpResult);
      expect(reference.status).toBe(401);
      expect(JSON.parse(reference.body)).toMatchObject({
        type: "about:blank",
        status: 401,
        code: "unauthorized",
      });
      for (const [name, result] of Object.entries(results)) {
        expect(visible(result), name).toEqual(reference);
        expect(result.headers.getSetCookie(), name).toEqual([]);
        expect(result.headers.get("content-type"), name).toContain("application/problem+json");
      }
    });

    it("does exactly ONE scrypt verification per failure: the dummy one when there is nothing to check", async () => {
      const cases = await failureCases();
      const expected: Record<string, { verify: number; dummy: number }> = {
        unknown: { verify: 0, dummy: 1 },
        wrongPassword: { verify: 1, dummy: 0 },
        locked: { verify: 0, dummy: 1 },
        inactive: { verify: 0, dummy: 1 },
      };
      for (const [name, credentials] of Object.entries(cases)) {
        const spies = spyHasher();
        const result = await login(running.baseUrl, credentials.email, credentials.password);
        expect(result.status, name).toBe(401);
        expect(spies.verify.mock.calls.length, `${name} verify`).toBe(expected[name]?.verify);
        expect(spies.dummy.mock.calls.length, `${name} dummy`).toBe(expected[name]?.dummy);
        expect(spies.hash, `${name} hash`).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      }
    });

    it("does not touch the lockout columns of an inactive or locked account, and creates no session", async () => {
      const cases = await failureCases();
      const lockedRow = await db
        .select()
        .from(adminUser)
        .where(eq(adminUser.email, cases.locked.email));
      const inactiveRow = await db
        .select()
        .from(adminUser)
        .where(eq(adminUser.email, cases.inactive.email));
      await login(running.baseUrl, cases.locked.email, "wrong again");
      await login(running.baseUrl, cases.inactive.email, "wrong again");
      await login(running.baseUrl, cases.inactive.email, PASSWORD);
      const lockedAfter = await db
        .select()
        .from(adminUser)
        .where(eq(adminUser.email, cases.locked.email));
      const inactiveAfter = await db
        .select()
        .from(adminUser)
        .where(eq(adminUser.email, cases.inactive.email));
      expect(lockedAfter[0]?.failedLoginCount).toBe(5);
      expect(lockedAfter[0]?.lockedUntil?.toISOString()).toBe(
        lockedRow[0]?.lockedUntil?.toISOString(),
      );
      expect(inactiveAfter[0]?.failedLoginCount).toBe(inactiveRow[0]?.failedLoginCount);
      expect(await sessionCount(lockedRow[0]?.id ?? "")).toBe(0);
      expect(await sessionCount(inactiveRow[0]?.id ?? "")).toBe(0);
    });
  });

  describe("per account lockout (5 failures lock for 15 minutes)", () => {
    const wrong = (user: TestAdminUser) => login(running.baseUrl, user.email, "definitely wrong");

    it("counts failures, locks on the 5th and not before (4 failures still let the right password in)", async () => {
      const user = await newUser();
      for (let failure = 1; failure <= 4; failure += 1) {
        expect((await wrong(user)).status).toBe(401);
        const row = await rowOf(user.id);
        expect(row.failedLoginCount).toBe(failure);
        expect(row.lockedUntil).toBeNull();
      }
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
      const user2 = await newUser();
      for (let failure = 1; failure <= 5; failure += 1) await wrong(user2);
      const locked = await rowOf(user2.id);
      expect(locked.failedLoginCount).toBe(5);
      expect(locked.lockedUntil?.toISOString()).toBe(
        new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
      );
      expect((await login(running.baseUrl, user2.email, PASSWORD)).status).toBe(401);
    });

    it("does not extend or count failures during the lock; the lock ends at exactly 15 minutes", async () => {
      const user = await newUser();
      for (let failure = 1; failure <= 5; failure += 1) await wrong(user);
      const lockedUntil = (await rowOf(user.id)).lockedUntil?.toISOString();
      clock.advanceMinutes(7);
      for (let failure = 1; failure <= 3; failure += 1) await wrong(user);
      const during = await rowOf(user.id);
      expect(during.failedLoginCount).toBe(5);
      expect(during.lockedUntil?.toISOString()).toBe(lockedUntil);
      clock.advanceMinutes(7);
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(401);
      clock.advanceMinutes(1);
      const ok = await login(running.baseUrl, user.email, PASSWORD);
      expect(ok.status).toBe(200);
      const after = await rowOf(user.id);
      expect(after.failedLoginCount).toBe(0);
      expect(after.lockedUntil).toBeNull();
    });

    it("starts a fresh count after the lock expired", async () => {
      const user = await newUser();
      for (let failure = 1; failure <= 5; failure += 1) await wrong(user);
      clock.advanceMinutes(16);
      await wrong(user);
      const row = await rowOf(user.id);
      expect(row.failedLoginCount).toBe(1);
      expect(row.lockedUntil).toBeNull();
    });

    it("resets the count on success: 4 failures, success, 4 failures do not lock", async () => {
      const user = await newUser();
      for (let failure = 1; failure <= 4; failure += 1) await wrong(user);
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
      expect((await rowOf(user.id)).failedLoginCount).toBe(0);
      for (let failure = 1; failure <= 4; failure += 1) await wrong(user);
      const row = await rowOf(user.id);
      expect(row.failedLoginCount).toBe(4);
      expect(row.lockedUntil).toBeNull();
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
    });

    it.each([
      ["a lock", { failedLoginCount: 5, lockedUntil: new Date("2030-06-01T20:00:00.000Z") }],
      ["a deactivation", { isActive: false }],
    ])(
      "%s that lands between the password check and the commit still refuses the correct password",
      async (_name, change) => {
        const user = await newUser();
        let pending: Promise<HttpResult<Record<string, unknown>>> | undefined;
        await db.transaction(async (transaction) => {
          await transaction.select().from(adminUser).where(eq(adminUser.id, user.id)).for("update");
          // The request reads the row without the lock, verifies the password, then waits for the row lock.
          pending = login(running.baseUrl, user.email, PASSWORD);
          await new Promise((resolve) => setTimeout(resolve, 400));
          await transaction.update(adminUser).set(change).where(eq(adminUser.id, user.id));
        });
        const result = await pending;
        expect(result?.status).toBe(401);
        expect(result?.headers.getSetCookie()).toEqual([]);
        expect(await sessionCount(user.id)).toBe(0);
        expect((await rowOf(user.id)).lastLoginAt).toBeNull();
      },
    );

    it("counts concurrent failures exactly: ten simultaneous wrong passwords end with one lock of count 5", async () => {
      const user = await newUser();
      const results = await Promise.all(Array.from({ length: 10 }, () => wrong(user)));
      expect(results.every((result) => result.status === 401)).toBe(true);
      const row = await rowOf(user.id);
      expect(row.failedLoginCount).toBe(5);
      expect(row.lockedUntil?.toISOString()).toBe(
        new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
      );
    });
  });

  describe("per IP limit (20 attempts per 10 minutes, in memory)", () => {
    it("answers the 21st attempt with 429 too_many_requests and Retry-After, 401 before that", async () => {
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const result = await login(running.baseUrl, "nobody-here@example.test", PASSWORD);
        expect(result.status, `attempt ${attempt}`).toBe(401);
      }
      const limited = await login(running.baseUrl, "nobody-here@example.test", PASSWORD);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("content-type")).toContain("application/problem+json");
      expect(limited.headers.get("retry-after")).toBe("600");
      expect(limited.headers.getSetCookie()).toEqual([]);
      expect(limited.body).toEqual({
        type: "about:blank",
        title: "Too many requests",
        status: 429,
        code: "too_many_requests",
        detail: "Too many login attempts. Try again later.",
      });
    });

    it("counts successful logins too, and Retry-After shrinks with the window", async () => {
      const user = await newUser();
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
      }
      clock.advanceMinutes(4);
      const limited = await login(running.baseUrl, user.email, PASSWORD);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe(String(6 * 60));
    });

    it("lets the next window in after 10 minutes", async () => {
      const user = await newUser();
      for (let attempt = 1; attempt <= 21; attempt += 1) {
        await login(running.baseUrl, "nobody-here@example.test", "wrong");
      }
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(429);
      clock.advanceMinutes(10);
      expect((await login(running.baseUrl, user.email, PASSWORD)).status).toBe(200);
    });

    it("answers a throttled client the same whether the account exists, with no scrypt and no account change", async () => {
      const user = await newUser();
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        await login(running.baseUrl, "nobody-here@example.test", PASSWORD);
      }
      const spies = spyHasher();
      const known = await login(running.baseUrl, user.email, PASSWORD);
      const wrongPassword = await login(running.baseUrl, user.email, "wrong");
      const unknown = await login(running.baseUrl, "other-nobody@example.test", PASSWORD);
      expect(known.status).toBe(429);
      expect(visible(known)).toEqual(visible(unknown));
      expect(visible(wrongPassword)).toEqual(visible(unknown));
      expect(spies.verify).not.toHaveBeenCalled();
      expect(spies.dummy).not.toHaveBeenCalled();
      const row = await rowOf(user.id);
      expect(row.failedLoginCount).toBe(0);
      expect(row.lastLoginAt).toBeNull();
      expect(await sessionCount(user.id)).toBe(0);
    });
  });

  describe("logging", () => {
    function captureLogs(): { lines: () => string[]; calls: (level: string) => string[] } {
      const captured: { level: string; text: string }[] = [];
      for (const level of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          captured.push({ level, text: args.map((arg) => String(arg)).join(" ") });
        });
      }
      return {
        lines: () => captured.map((entry) => entry.text),
        calls: (level) => captured.filter((entry) => entry.level === level).map((e) => e.text),
      };
    }

    it("logs a success with the user id at log level, without email, password or token", async () => {
      const user = await newUser();
      const logs = captureLogs();
      const result = await login(running.baseUrl, user.email, PASSWORD);
      const token = (sessionCookieOf(result) ?? "").split("=")[1] ?? "";
      expect(token).toHaveLength(43);
      const entries = logs.calls("log").filter((line) => line.includes("login"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toContain(user.id);
      for (const line of logs.lines()) {
        expect(line).not.toContain(user.email);
        expect(line).not.toContain(PASSWORD);
        expect(line).not.toContain(token);
      }
    });

    it.each([
      ["unknown_account", async () => ({ email: "nobody-here@example.test", password: PASSWORD })],
      [
        "wrong_password",
        async () => ({ email: (await newUser()).email, password: "the wrong password" }),
      ],
      [
        "inactive",
        async () => ({ email: (await newUser({ isActive: false })).email, password: PASSWORD }),
      ],
      [
        "locked",
        async () => {
          const user = await newUser();
          await db
            .update(adminUser)
            .set({ failedLoginCount: 5, lockedUntil: new Date(clock.now().getTime() + 60_000) })
            .where(eq(adminUser.id, user.id));
          return { email: user.email, password: PASSWORD };
        },
      ],
    ])("logs a %s failure at warn level with only the reason code", async (reason, prepare) => {
      const credentials = await prepare();
      const logs = captureLogs();
      expect((await login(running.baseUrl, credentials.email, credentials.password)).status).toBe(
        401,
      );
      const entries = logs.calls("warn").filter((line) => line.includes("login"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toContain(reason);
      for (const line of logs.lines()) {
        expect(line).not.toContain(credentials.email);
        expect(line).not.toContain(credentials.password);
        expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      }
    });

    it("logs ip_throttled when the window is used up", async () => {
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        await login(running.baseUrl, "nobody-here@example.test", PASSWORD);
      }
      const logs = captureLogs();
      expect((await login(running.baseUrl, "someone@example.test", PASSWORD)).status).toBe(429);
      const entries = logs.calls("warn").filter((line) => line.includes("login"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toContain("ip_throttled");
      for (const line of logs.lines()) {
        expect(line).not.toContain("someone@example.test");
      }
    });
  });
});
