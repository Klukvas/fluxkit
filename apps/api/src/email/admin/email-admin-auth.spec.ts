import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { EmailAdminWorld } from "../../test/email-admin-world.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SOME_ID } from "../../test/routes.js";
import { EMAIL_ADMIN_PERMISSIONS } from "./email-admin-permissions.js";

type Method = "GET" | "POST";

/** Every route of the admin email API: method, path, body, and what an allowed caller gets for these inputs. */
const routes: readonly (readonly [Method, string, unknown, number])[] = [
  ["GET", "/admin/email/status", undefined, 200],
  ["POST", "/admin/email/test", {}, 202],
  ["GET", "/admin/email/messages", undefined, 200],
  ["GET", `/admin/email/messages/${SOME_ID}`, undefined, 404],
  ["POST", `/admin/email/messages/${SOME_ID}/resend`, undefined, 404],
  ["POST", `/admin/email/messages/${SOME_ID}/cancel`, undefined, 404],
  ["GET", "/admin/email/templates", undefined, 200],
  ["GET", "/admin/email/templates/admin.test/preview?locale=en", undefined, 200],
];

describe("admin email routes behind the real default guard, the CSRF rule and email.manage", () => {
  let anonymous: RunningApp;
  let ctx: EmailAdminWorld;

  beforeAll(async () => {
    await ensureMigrated();
    anonymous = await startApp({ adminAuthenticator: "production-default" });
    ctx = await EmailAdminWorld.start();
  });

  beforeEach(async () => {
    await ctx.world.clear();
    ctx.world.clock.advanceMinutes(61);
  });

  afterAll(async () => {
    await anonymous.app.close();
    await ctx.stop();
  });

  it("is declared once for the controllers: email.manage for reads and writes", () => {
    expect(EMAIL_ADMIN_PERMISSIONS).toEqual({ read: "email.manage", write: "email.manage" });
  });

  it.each(routes)("%s %s answers 401 without a session", async (method, path, body) => {
    const result = await http<ProblemBody>(anonymous.baseUrl, method, path, { body });
    expect(result.status).toBe(401);
    expect(result.headers.get("content-type")).toContain("application/problem+json");
    expect(result.body).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it.each(routes)(
    "%s %s answers 401 for a switched-off test authenticator too",
    async (method, path, body) => {
      ctx.signOut();
      const result = await ctx.call<ProblemBody>(method, path, { body });
      expect(result.status).toBe(401);
    },
  );

  it.each(routes)(
    "%s %s answers 403 to a viewer, naming email.manage, and does nothing",
    async (method, path, body) => {
      await ctx.signInAs("viewer");
      const result = await ctx.call<ProblemBody>(method, path, { body });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: "forbidden" });
      expect(result.body.detail).toContain("email.manage");
      expect(await ctx.world.count()).toBe(0);
      expect(ctx.world.provider().calls).toEqual([]);
    },
  );

  it.each(routes.filter(([method]) => method === "POST"))(
    "%s %s answers 403 without the CSRF header, even for an owner, and does nothing",
    async (method, path, body) => {
      await ctx.signInAs("owner");
      const result = await ctx.call<ProblemBody>(method, path, { body: body ?? {}, csrf: false });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: "forbidden" });
      expect(await ctx.world.count()).toBe(0);
      expect(ctx.world.provider().calls).toEqual([]);
    },
  );

  it.each(routes)(
    "%s %s works for a manager and for an owner",
    async (method, path, body, allowed) => {
      for (const role of ["manager", "owner"] as const) {
        await ctx.signInAs(role);
        const result = await ctx.call<ProblemBody>(method, path, { body });
        expect(result.status, `${role} ${method} ${path}`).toBe(allowed);
      }
    },
  );

  it("a viewer's rejected test send does not use up the rate limit window of the admin", async () => {
    const viewer = await ctx.signInAs("viewer");
    for (let call = 0; call < 6; call += 1) {
      expect((await ctx.call("POST", "/admin/email/test", { body: {} })).status).toBe(403);
    }
    ctx.switchTo(viewer);
    await ctx.signInAs("owner");
    expect((await ctx.call("POST", "/admin/email/test", { body: {} })).status).toBe(202);
  });
});
