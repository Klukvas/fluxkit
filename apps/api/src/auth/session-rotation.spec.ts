import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { adminSession, customerSession } from "../database/schema/index.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../test/admin-user-fixtures.js";
import { createTestCustomer, deleteTestCustomers } from "../test/customer-fixtures.js";
import { startApp, type RunningApp } from "../test/app.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { CustomerAccountService } from "../customers/account/account.service.js";
import { AuthService } from "./auth.service.js";
import { PasswordHasher } from "./password-hasher.js";
import { hashSessionToken } from "./session-token.js";

const PASSWORD = "correct horse battery staple";
const NEXT = "a brand new passphrase";

for (const kind of ["admin", "customer"] as const) {
  describe.each([false, true])(`${kind} session rotation (Secure=%s)`, (secure) => {
    const clock = new FakeClock("2030-07-01T08:00:00.000Z");
    const path = kind === "admin" ? "/admin/auth" : "/store/account";
    const cookieName = kind === "admin" ? "fluxkit_admin_session" : "fluxkit_customer_session";
    const table = kind === "admin" ? adminSession : customerSession;
    let running: RunningApp;
    let db: Database;
    const ids: string[] = [];
    const secrets: string[] = [];

    async function newUser() {
      const user =
        kind === "admin"
          ? await createTestAdminUser(db, { password: PASSWORD })
          : await createTestCustomer(db, { password: PASSWORD });
      ids.push(user.id);
      return user;
    }
    const call = (method: "GET" | "POST", route: string, cookie?: string, body?: unknown) =>
      http(running.baseUrl, method, `${path}/${route}`, {
        ...(cookie === undefined ? {} : { headers: { cookie } }),
        ...(body === undefined ? {} : { body }),
      });
    async function login(email: string, cookie?: string, password = PASSWORD) {
      return call("POST", "login", cookie, { email, password });
    }
    function cookieOf(headers: Headers): string {
      const cookie = headers
        .getSetCookie()
        .find((value) => value.startsWith(`${cookieName}=`))
        ?.split(";")[0];
      if (cookie === undefined) throw new Error("Expected a session cookie");
      const token = cookie.slice(cookie.indexOf("=") + 1);
      secrets.push(token, hashSessionToken(token));
      return cookie;
    }
    const change = (cookie: string, currentPassword = PASSWORD, newPassword = NEXT) =>
      call("POST", "change-password", cookie, { currentPassword, newPassword });

    beforeAll(async () => {
      await ensureMigrated();
      running = await startApp({
        adminAuthenticator: "production-default",
        clock,
        adminCookieSecure: secure,
        storeCookieSecure: secure,
      });
      db = running.app.get<Database>(DRIZZLE);
    });
    beforeEach(() => {
      clock.advanceMinutes(11);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      if (kind === "admin") await deleteTestAdminUsers(db, ids.splice(0));
      else await deleteTestCustomers(db, ids.splice(0));
      secrets.length = 0;
    });
    afterAll(async () => {
      await running.app.close();
    });

    it("replaces the token, preserves the row and lifetime, and revokes other sessions", async () => {
      const user = await newUser();
      const current = cookieOf((await login(user.email)).headers);
      const other = cookieOf((await login(user.email)).headers);
      const oldHash = hashSessionToken(current.slice(current.indexOf("=") + 1));
      const [before] = await db.select().from(table).where(eq(table.tokenHash, oldHash));
      if (before === undefined) throw new Error("Missing test session");
      clock.advanceMinutes(5);
      const result = await change(current);
      expect(result.status).toBe(204);
      const replacement = cookieOf(result.headers);
      expect(replacement).not.toBe(current);
      expect((await call("GET", "me", current)).status).toBe(401);
      expect((await call("GET", "me", replacement)).status).toBe(200);
      expect((await call("GET", "me", other)).status).toBe(401);
      const [after] = await db.select().from(table).where(eq(table.id, before.id));
      expect(after).toMatchObject({
        id: before.id,
        createdAt: before.createdAt,
        expiresAt: before.expiresAt,
      });
      const header = result.headers.getSetCookie()[0] ?? "";
      for (const attribute of [
        "HttpOnly",
        `Path=/${kind === "admin" ? "admin" : "store"}`,
        `SameSite=${kind === "admin" ? "Strict" : "Lax"}`,
        `Max-Age=${Math.floor((before.expiresAt.getTime() - clock.now().getTime()) / 1000)}`,
      ]) {
        expect(header).toContain(attribute);
      }
      expect(header.includes("; Secure")).toBe(secure);
    });

    it("allows exactly one concurrent password change and keeps its replacement token valid", async () => {
      const user = await newUser();
      const current = cookieOf((await login(user.email)).headers);
      const hasher = running.app.get(PasswordHasher);
      const hash = hasher.hash.bind(hasher);
      let arrived = 0;
      let release!: () => void;
      const bothHashed = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Both requests must check the original password before either can acquire the user row lock.
      vi.spyOn(hasher, "hash").mockImplementation(async (password) => {
        const result = await hash(password);
        if (++arrived === 2) release();
        await bothHashed;
        return result;
      });
      const results = await Promise.all([
        change(current),
        change(current, PASSWORD, "a different new passphrase"),
      ]);
      expect(arrived).toBe(2);
      expect(results.map((result) => result.status).sort()).toEqual([204, 400]);
      const winner = results.find((result) => result.status === 204);
      const loser = results.find((result) => result.status === 400);
      if (winner === undefined || loser === undefined)
        throw new Error("Expected one winner and loser");
      expect(loser.headers.getSetCookie()).toEqual([]);
      expect(loser.body).not.toHaveProperty("token");
      const replacement = cookieOf(winner.headers);
      expect(replacement).not.toBe(current);
      expect((await call("GET", "me", replacement)).status).toBe(200);
      expect((await call("GET", "me", current)).status).toBe(401);
    });

    it("rejects a change-password principal without tokenHash as unauthorized", async () => {
      const user = await newUser();
      const current = cookieOf((await login(user.email)).headers);
      const oldHash = hashSessionToken(current.slice(current.indexOf("=") + 1));
      const [session] = await db.select().from(table).where(eq(table.tokenHash, oldHash));
      if (session === undefined) throw new Error("Missing test session");
      const body = { currentPassword: PASSWORD, newPassword: NEXT };
      const result =
        kind === "admin"
          ? running.app.get(AuthService).changePassword(
              {
                userId: user.id,
                email: user.email,
                role: "owner",
                permissions: [],
                sessionId: session.id,
              },
              body,
            )
          : running.app
              .get(CustomerAccountService)
              .changePassword(
                { customerId: user.id, email: user.email, sessionId: session.id },
                body,
              );
      await expect(result).rejects.toMatchObject({ code: "unauthorized", status: 401 });
      expect((await call("GET", "me", current)).status).toBe(200);
    });

    it.each(["wrong password", "policy"])(
      "keeps the old token and sets no cookie on %s failure",
      async (failure) => {
        const user = await newUser();
        const current = cookieOf((await login(user.email)).headers);
        const result = await change(
          current,
          failure === "wrong password" ? "wrong password" : PASSWORD,
          failure === "policy" ? "short" : NEXT,
        );
        expect(result.status).toBe(400);
        expect(result.headers.getSetCookie()).toEqual([]);
        expect((await call("GET", "me", current)).status).toBe(200);
      },
    );

    it.each(["logout", "token replaced"])(
      "rolls back password and revocations after %s between resolve and rotate",
      async (race) => {
        const user = await newUser();
        const current = cookieOf((await login(user.email)).headers);
        const other = cookieOf((await login(user.email)).headers);
        const hasher = running.app.get(PasswordHasher);
        const hash = hasher.hash.bind(hasher);
        vi.spyOn(hasher, "hash").mockImplementationOnce(async (password) => {
          if (race === "logout") {
            expect((await call("POST", "logout", current)).status).toBe(204);
          } else {
            const oldHash = hashSessionToken(current.slice(current.indexOf("=") + 1));
            await db
              .update(table)
              .set({ tokenHash: hashSessionToken("R".repeat(43)) })
              .where(eq(table.tokenHash, oldHash));
          }
          return hash(password);
        });
        const result = await change(current);
        expect(result.status).toBe(401);
        expect(result.headers.getSetCookie()).toEqual([]);
        expect((await call("GET", "me", other)).status).toBe(200);
        expect((await login(user.email)).status).toBe(200);
        expect((await login(user.email, undefined, NEXT)).status).toBe(401);
      },
    );

    it("never logs either token or hash during password rotation", async () => {
      const output: string[] = [];
      for (const stream of [process.stdout, process.stderr]) {
        vi.spyOn(stream, "write").mockImplementation(((chunk: string | Uint8Array) => {
          output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
          return true;
        }) as typeof stream.write);
      }
      const user = await newUser();
      const current = cookieOf((await login(user.email)).headers);
      const changed = await change(current);
      expect(changed.status).toBe(204);
      cookieOf(changed.headers);
      for (const secret of secrets) expect(output.join("")).not.toContain(secret);
    });

    if (kind === "admin") {
      it.each([false, true])(
        "revokes the presented cookie after success only (another user=%s)",
        async (another) => {
          const first = await newUser();
          const target = another ? await newUser() : first;
          const current = cookieOf((await login(first.email)).headers);
          const refused = await login(target.email, current, "wrong password");
          expect(refused.status).toBe(401);
          expect(refused.headers.getSetCookie()).toEqual([]);
          expect((await call("GET", "me", current)).status).toBe(200);
          const success = await login(target.email, current);
          expect(success.status).toBe(200);
          expect((await call("GET", "me", current)).status).toBe(401);
          expect((await call("GET", "me", cookieOf(success.headers))).status).toBe(200);
        },
      );
    }
  });
}
