import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { login, loginCookie } from "../test/auth-http.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";

const PASSWORD = "correct horse battery staple";
const TWO_HUNDRED_KB = JSON.stringify({ padding: "x".repeat(200 * 1024) });

describe("Cache-Control: no-store on every /admin response", () => {
  const clock = new FakeClock("2030-06-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  let owner: TestAdminUser;
  let viewer: TestAdminUser;
  let ownerCookie: string;
  let viewerCookie: string;

  const noStore = (headers: Headers): string | null => headers.get("cache-control");

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    owner = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    viewer = await createTestAdminUser(db, { role: "viewer", password: PASSWORD });
    ownerCookie = await loginCookie(running.baseUrl, owner.email, PASSWORD);
    viewerCookie = await loginCookie(running.baseUrl, viewer.email, PASSWORD);
  });

  beforeEach(() => {
    // The per-IP login limit counts every call from 127.0.0.1: a new window per test.
    clock.advanceMinutes(11);
  });

  afterAll(async () => {
    await deleteTestAdminUsers(db, [owner.id, viewer.id]);
    await running.app.close();
  });

  it("is set on a success (login and an authenticated read)", async () => {
    const signedIn = await login(running.baseUrl, owner.email, PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(noStore(signedIn.headers)).toBe("no-store");
    const read = await http(running.baseUrl, "GET", "/admin/auth/me", {
      headers: { cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    expect(noStore(read.headers)).toBe("no-store");
  });

  it("is set on 401, 403 and 404 inside /admin", async () => {
    const unauthorized = await http(running.baseUrl, "GET", "/admin/brands");
    expect(unauthorized.status).toBe(401);
    expect(noStore(unauthorized.headers)).toBe("no-store");

    const forbidden = await http(running.baseUrl, "GET", "/admin/users", {
      headers: { cookie: viewerCookie },
    });
    expect(forbidden.status).toBe(403);
    expect(noStore(forbidden.headers)).toBe("no-store");

    const missing = await http(running.baseUrl, "GET", "/admin/brands/not-a-real-route/x/y", {
      headers: { cookie: ownerCookie },
    });
    expect(missing.status).toBe(404);
    expect(noStore(missing.headers)).toBe("no-store");
  });

  it("is set on a 400 validation error", async () => {
    const result = await http(running.baseUrl, "POST", "/admin/auth/login", {
      body: { email: 42 },
    });
    expect(result.status).toBe(400);
    expect(noStore(result.headers)).toBe("no-store");
  });

  it("is set on a body-parser 413, which fails before any route or guard runs", async () => {
    const result = await http(running.baseUrl, "POST", "/admin/auth/login", {
      rawBody: TWO_HUNDRED_KB,
    });
    expect(result.status).toBe(413);
    expect(noStore(result.headers)).toBe("no-store");
  });

  it("is set on a 429 from the login throttle", async () => {
    let last = await login(running.baseUrl, "nobody@example.test", PASSWORD);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      last = await login(running.baseUrl, "nobody@example.test", PASSWORD);
    }
    expect(last.status).toBe(429);
    expect(noStore(last.headers)).toBe("no-store");
  });

  it("matches the path the way the guard does: case-insensitive, with or without a trailing slash", async () => {
    for (const path of ["/ADMIN/brands", "/Admin/auth/me", "/admin", "/admin/"]) {
      const result = await http(running.baseUrl, "GET", path);
      expect(noStore(result.headers), path).toBe("no-store");
    }
  });

  it("is NOT set on /store, /health, unknown paths or look-alike prefixes", async () => {
    for (const path of [
      "/store/products",
      "/health",
      "/nothing-here",
      "/administrator",
      "/store/x",
    ]) {
      const result = await http(running.baseUrl, "GET", path);
      expect(noStore(result.headers), path).toBeNull();
    }
  });
});
