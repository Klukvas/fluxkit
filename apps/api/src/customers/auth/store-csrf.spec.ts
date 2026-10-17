import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { customerProbeFeature } from "../../test/customer-probe.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "./customer-session-cookie.js";
import { CustomerSessionService } from "./customer-session.service.js";

const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

describe("CSRF header on /store writes (ADR 0016)", () => {
  let running: RunningApp;
  let db: Database;
  let cookie: string;
  let customerId: string;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ extraFeatures: customerProbeFeature });
    db = running.app.get<Database>(DRIZZLE);
    const shopper = await createTestCustomer(db);
    customerId = shopper.id;
    const { token } = await running.app.get(CustomerSessionService).create(shopper.id);
    cookie = `${CUSTOMER_SESSION_COOKIE_NAME}=${token}`;
  });

  afterAll(async () => {
    await deleteTestCustomers(db, [customerId]);
    await running.app.close();
  });

  it.each(METHODS)(
    "%s without the header is 403 forbidden, also for an anonymous caller",
    async (method) => {
      const result = await http<ProblemBody>(
        running.baseUrl,
        method,
        "/store/probe-customer/public-write",
        {
          body: method === "DELETE" ? undefined : {},
          csrf: false,
        },
      );
      expect(result.status).toBe(403);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(result.body).toMatchObject({ code: "forbidden", status: 403 });
      expect(result.body.detail).toContain("X-Fluxkit-CSRF");
      expect(result.body.detail).toContain("store");
    },
  );

  it.each(METHODS)("%s with the header reaches the handler", async (method) => {
    const result = await http(running.baseUrl, method, "/store/probe-customer/public-write", {
      body: method === "DELETE" ? undefined : {},
    });
    expect(result.status).toBe(method === "POST" ? 201 : 200);
    expect(result.body).toEqual({ ok: true });
  });

  it.each(["0", "2", "true", "yes", ""])("rejects the header value %j", async (value) => {
    const result = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/public-write",
      {
        body: {},
        headers: { "x-fluxkit-csrf": value },
      },
    );
    expect(result.status).toBe(403);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["form-urlencoded", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=x"],
    ["no content type", null],
  ])("rejects a body sent as %s", async (_name, contentType) => {
    const result = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/public-write",
      {
        rawBody: '{"a":1}',
        contentType,
      },
    );
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "forbidden" });
  });

  it("the CSRF check comes before authentication: 403, not 401, without the header (anonymous and signed in)", async () => {
    const anonymous = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/write",
      {
        body: {},
        csrf: false,
      },
    );
    expect(anonymous.status).toBe(403);
    const signedIn = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/write",
      {
        body: {},
        csrf: false,
        headers: { cookie },
      },
    );
    expect(signedIn.status).toBe(403);
    // With the header the same signed-in request succeeds, and anonymous gets its 401.
    const ok = await http(running.baseUrl, "POST", "/store/probe-customer/write", {
      body: {},
      headers: { cookie },
    });
    expect(ok.status).toBe(201);
    const stillAnonymous = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/write",
      {
        body: {},
      },
    );
    expect(stillAnonymous.status).toBe(401);
  });

  it("a cookie alone never makes a write legitimate (that is the point of the header)", async () => {
    const result = await http<ProblemBody>(
      running.baseUrl,
      "DELETE",
      "/store/probe-customer-class/two",
      {
        csrf: false,
        headers: { cookie },
      },
    );
    expect(result.status).toBe(403);
  });

  it.each(["/STORE/probe-customer/public-write", "/Store/probe-customer/public-write/"])(
    "also guards the spelling %s that Express routes to the same handler",
    async (path) => {
      const result = await http<ProblemBody>(running.baseUrl, "POST", path, {
        body: {},
        csrf: false,
      });
      expect(result.status).toBe(403);
      const withHeader = await http(running.baseUrl, "POST", path, { body: {} });
      expect(withHeader.status).toBe(201);
    },
  );

  it("never lets a write through without the header, whatever odd path form is tried", async () => {
    for (const path of [
      "//store/probe-customer/public-write",
      "/store//probe-customer/public-write",
      "/store/./probe-customer/public-write",
      "/store/probe-customer/../probe-customer/public-write",
      "/%73tore/probe-customer/public-write",
      "/store%2Fprobe-customer/public-write",
      "/store/probe-customer/public-write;x=1",
    ]) {
      const result = await http<ProblemBody>(running.baseUrl, "POST", path, {
        body: {},
        csrf: false,
      });
      expect(result.status, path).not.toBeLessThan(400);
    }
  });

  it("GET, HEAD and OPTIONS are exempt and existing store reads are unchanged", async () => {
    for (const path of ["/store/probe-customer/public", "/store/config", "/store/categories"]) {
      const result = await http(running.baseUrl, "GET", path, { csrf: false });
      expect(result.status, path).toBe(200);
    }
    const head = await fetch(`${running.baseUrl}/store/config`, { method: "HEAD" });
    expect(head.status).toBe(200);
    const options = await fetch(`${running.baseUrl}/store/probe-customer/public-write`, {
      method: "OPTIONS",
    });
    // Exempt from the CSRF rule (this server has no OPTIONS handlers, so it is a plain 404, never 403).
    expect(options.status).not.toBe(403);
    expect(options.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not change /admin: its own guard still answers (and an unknown store route stays 404)", async () => {
    const admin = await http<ProblemBody>(running.baseUrl, "POST", "/admin/brands", {
      body: {},
      csrf: false,
    });
    expect(admin.status).toBe(403);
    expect(admin.body.detail).toContain("admin");
    const unknown = await http<ProblemBody>(running.baseUrl, "GET", "/store/does-not-exist");
    expect(unknown.status).toBe(404);
  });

  it("sends no CORS headers: a preflight is never answered with permission", async () => {
    const preflight = await fetch(`${running.baseUrl}/store/probe-customer/public-write`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-fluxkit-csrf",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    expect(preflight.headers.get("access-control-allow-headers")).toBeNull();
  });
});
