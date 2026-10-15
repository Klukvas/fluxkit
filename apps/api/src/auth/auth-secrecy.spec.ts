import { adminUser } from "../database/schema/index.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { loginCookie } from "../test/auth-http.js";
import { FakeClock } from "../test/fake-clock.js";
import { http, type HttpResult } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SOME_ID } from "../test/routes.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";

describe("the password hash never leaves the server", () => {
  const clock = new FakeClock("2030-10-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const created: string[] = [];
  let output: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    // Every line the process prints, whichever logger wrote it (Nest's console logger writes to stdout and stderr).
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, "write").mockImplementation(((chunk: string | Uint8Array) => {
        output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof stream.write);
    }
  });

  afterEach(async () => {
    await deleteTestAdminUsers(db, created.splice(0));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await running.app.close();
  });

  it("is in no body or header of any users or auth response and in no log line", async () => {
    output = [];
    const owner = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    const viewer = await createTestAdminUser(db, { role: "viewer", password: PASSWORD });
    created.push(owner.id, viewer.id);

    const seen: { name: string; result: HttpResult }[] = [];
    const run = async (
      name: string,
      method: "GET" | "POST" | "PATCH",
      path: string,
      cookie: string | undefined,
      body?: unknown,
    ): Promise<HttpResult<Record<string, unknown>>> => {
      const result = await http<Record<string, unknown>>(running.baseUrl, method, path, {
        ...(body === undefined ? {} : { body }),
        ...(cookie === undefined ? {} : { headers: { cookie } }),
      });
      seen.push({ name, result });
      return result;
    };

    clock.advanceMinutes(11);
    const loginOk = await run("login ok", "POST", "/admin/auth/login", undefined, {
      email: owner.email,
      password: PASSWORD,
    });
    const cookie = (loginOk.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    await run("login wrong", "POST", "/admin/auth/login", undefined, {
      email: owner.email,
      password: "wrong password here",
    });
    await run("login unknown", "POST", "/admin/auth/login", undefined, {
      email: "nobody-here@example.test",
      password: PASSWORD,
    });
    await run("me", "GET", "/admin/auth/me", cookie);
    await run("me anonymous", "GET", "/admin/auth/me", undefined);
    await run("users list", "GET", "/admin/users", cookie);
    await run("users get", "GET", `/admin/users/${viewer.id}`, cookie);
    await run("users get missing", "GET", `/admin/users/${SOME_ID}`, cookie);
    const createdUser = await run("users create", "POST", "/admin/users", cookie, {
      email: "created-by-test@example.test",
      role: "manager",
      password: NEW_PASSWORD,
    });
    created.push(String(createdUser.body["id"]));
    await run("users create duplicate", "POST", "/admin/users", cookie, {
      email: owner.email,
      role: "manager",
      password: NEW_PASSWORD,
    });
    await run("users create invalid", "POST", "/admin/users", cookie, {
      email: "bad",
      role: "root",
      password: "x",
    });
    await run("users patch", "PATCH", `/admin/users/${viewer.id}`, cookie, { role: "manager" });
    await run("users patch last owner", "PATCH", `/admin/users/${owner.id}`, cookie, {
      role: "viewer",
    });
    await run("users patch bad field", "PATCH", `/admin/users/${viewer.id}`, cookie, {
      passwordHash: "x",
    });
    await run("users reset", "POST", `/admin/users/${viewer.id}/reset-password`, cookie, {
      newPassword: NEW_PASSWORD,
    });
    await run("users reset invalid", "POST", `/admin/users/${viewer.id}/reset-password`, cookie, {
      newPassword: "short",
    });
    await run("change wrong current", "POST", "/admin/auth/change-password", cookie, {
      currentPassword: "not my password",
      newPassword: NEW_PASSWORD,
    });
    await run("change ok", "POST", "/admin/auth/change-password", cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    const viewerCookie = await (async () => {
      clock.advanceMinutes(11);
      return loginCookie(running.baseUrl, viewer.email, NEW_PASSWORD);
    })();
    await run("viewer forbidden", "GET", "/admin/users", viewerCookie);
    await run("logout", "POST", "/admin/auth/logout", cookie);

    // Every hash that exists now, including the ones written during this test.
    const hashes = (await db.select({ hash: adminUser.passwordHash }).from(adminUser)).map(
      (row) => row.hash,
    );
    expect(hashes.length).toBeGreaterThanOrEqual(3);
    // "scrypt$" is the prefix of every stored hash string, so even a truncated or reformatted hash would match.
    const forbiddenFragments = [...hashes, "scrypt$"];

    expect(seen.length).toBeGreaterThanOrEqual(20);
    for (const { name, result } of seen) {
      const text = JSON.stringify(result.body ?? null) + JSON.stringify([...result.headers]);
      for (const fragment of forbiddenFragments) {
        expect(text, `${name} must not contain ${fragment.slice(0, 12)}`).not.toContain(fragment);
      }
      for (const secret of [PASSWORD, NEW_PASSWORD]) {
        expect(text, `${name} must not echo a password`).not.toContain(secret);
      }
    }

    const printed = output.join("");
    expect(printed.length).toBeGreaterThan(0);
    for (const fragment of [...forbiddenFragments, PASSWORD, NEW_PASSWORD, "not my password"]) {
      expect(printed, `log output must not contain ${fragment.slice(0, 12)}`).not.toContain(
        fragment,
      );
    }
  });
});
