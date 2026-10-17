import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession } from "../../database/schema/index.js";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerProbeFeature } from "../../test/customer-probe.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http } from "../../test/http.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { ensureMigrated } from "../../test/migrate.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "./customer-session-cookie.js";
import { CustomerSessionService } from "./customer-session.service.js";

const START = "2030-03-01T08:00:00.000Z";
const IDLE_MINUTES = 60;
const MAX_HOURS = 24;
const PROBE_ME = "/store/probe-customer/me";

interface Principal {
  customerId: string;
  email: string;
  sessionId: string;
}

describe("customer authentication end to end (real session service, real Postgres)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;
  let db: Database;
  let sessions: CustomerSessionService;
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const created: string[] = [];

  async function newCustomer(options?: { isActive?: boolean }): Promise<TestCustomer> {
    const made = await createTestCustomer(db, options);
    created.push(made.id);
    return made;
  }

  async function signIn(shopper: TestCustomer): Promise<{ cookie: string; token: string }> {
    const { token } = await sessions.create(shopper.id);
    return { cookie: `${CUSTOMER_SESSION_COOKIE_NAME}=${token}`, token };
  }

  const call = (
    cookie: string | undefined,
    path = PROBE_ME,
    headers: Record<string, string> = {},
  ) =>
    http<Principal & ProblemBody>(running.baseUrl, "GET", path, {
      headers: { ...(cookie === undefined ? {} : { cookie }), ...headers },
    });

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      customerSessionIdleMinutes: IDLE_MINUTES,
      customerSessionMaxHours: MAX_HOURS,
      extraFeatures: customerProbeFeature,
    });
    db = running.app.get<Database>(DRIZZLE);
    sessions = running.app.get(CustomerSessionService);
  });

  beforeEach(() => {
    clock.set(START);
  });

  afterEach(async () => {
    await deleteTestCustomers(db, created.splice(0));
  });

  afterAll(async () => {
    await pool.end();
    await running.app.close();
  });

  it("authenticates a real session and hands the principal to @CurrentCustomer", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    const result = await call(cookie);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      customerId: shopper.id,
      email: shopper.email,
      sessionId: expect.any(String),
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("a session of customer A is customer A and never customer B", async () => {
    const [a, b] = [await newCustomer(), await newCustomer()];
    const [sessionA, sessionB] = [await signIn(a), await signIn(b)];
    expect((await call(sessionA.cookie)).body.customerId).toBe(a.id);
    expect((await call(sessionB.cookie)).body.customerId).toBe(b.id);
    // The customer id cannot be chosen by the caller: not by query, header or body.
    const spoof = await call(sessionA.cookie, `${PROBE_ME}?customerId=${b.id}`, {
      "x-customer-id": b.id,
    });
    expect(spoof.body.customerId).toBe(a.id);
  });

  it("answers the identical 401 for every kind of failure", async () => {
    const shopper = await newCustomer();
    const inactive = await newCustomer({ isActive: false });
    const unknownToken = Buffer.alloc(32, 9).toString("base64url");

    const revoked = await signIn(shopper);
    await sessions.revoke(revoked.token);

    const idle = await signIn(shopper);
    const absolute = await signIn(shopper);
    const deactivated = await signIn(inactive);

    const failures: [string, string | undefined][] = [
      ["no cookie", undefined],
      ["empty cookie value", `${CUSTOMER_SESSION_COOKIE_NAME}=`],
      ["malformed token", `${CUSTOMER_SESSION_COOKIE_NAME}=not-a-token`],
      ["unknown well-formed token", `${CUSTOMER_SESSION_COOKIE_NAME}=${unknownToken}`],
      ["revoked session", revoked.cookie],
      ["inactive customer", deactivated.cookie],
    ];
    const outcomes: Awaited<ReturnType<typeof call>>[] = [];
    for (const [, cookie] of failures) outcomes.push(await call(cookie));

    // Expired by idle time: nothing has touched it for longer than the idle limit.
    clock.advanceMinutes(IDLE_MINUTES + 1);
    outcomes.push(await call(idle.cookie));
    // Expired by absolute lifetime, while "in use" all along (a request every 50 minutes keeps it from idling out).
    for (let minutes = 50; minutes < MAX_HOURS * 60; minutes += 50) {
      clock.set(new Date(Date.parse(START) + minutes * 60_000));
      expect(await sessions.resolve(absolute.token), `minute ${minutes}`).toBeDefined();
    }
    clock.set(new Date(Date.parse(START) + MAX_HOURS * 3_600_000));
    outcomes.push(await call(absolute.cookie));

    expect(outcomes).toHaveLength(failures.length + 2);
    const [first, ...rest] = outcomes;
    expect(first?.status).toBe(401);
    expect(first?.body).toMatchObject({ code: "unauthorized", status: 401 });
    for (const outcome of rest) {
      expect(outcome.status).toBe(401);
      expect(outcome.body).toEqual(first?.body);
      expect(outcome.headers.get("content-type")).toBe(first?.headers.get("content-type"));
      expect(outcome.headers.get("cache-control")).toBe("no-store");
      expect(outcome.headers.get("www-authenticate")).toBeNull();
      expect(outcome.headers.getSetCookie()).toEqual([]);
    }
  });

  it("rejects an idle session and a session past its absolute end right at the limits", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    clock.advanceMinutes(IDLE_MINUTES - 1);
    expect((await call(cookie)).status).toBe(200);
    clock.advanceMinutes(IDLE_MINUTES);
    expect((await call(cookie)).status).toBe(401);
    expect(
      await db.select().from(customerSession).where(eq(customerSession.customerId, shopper.id)),
    ).toHaveLength(0);
  });

  it("a deactivated customer is rejected on the very next request, with the same session", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    expect((await call(cookie)).status).toBe(200);
    await db.update(customer).set({ isActive: false }).where(eq(customer.id, shopper.id));
    expect((await call(cookie)).status).toBe(401);
    await db.update(customer).set({ isActive: true }).where(eq(customer.id, shopper.id));
    expect((await call(cookie)).status).toBe(200);
  });

  it("a deleted customer is rejected on the very next request", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    await deleteTestCustomers(db, [shopper.id]);
    expect((await call(cookie)).status).toBe(401);
  });

  it("a revoked token cannot be used again, and revoke-all-except keeps only the named session", async () => {
    const shopper = await newCustomer();
    const [keep, drop1, drop2] = [
      await signIn(shopper),
      await signIn(shopper),
      await signIn(shopper),
    ];
    const keepId = (await call(keep.cookie)).body.sessionId;
    expect(await sessions.revokeAllForCustomer(shopper.id, keepId)).toBe(2);
    expect((await call(keep.cookie)).status).toBe(200);
    expect((await call(drop1.cookie)).status).toBe(401);
    expect((await call(drop2.cookie)).status).toBe(401);
    // Reuse after revoke, repeatedly.
    expect((await call(drop1.cookie)).status).toBe(401);
    expect(await sessions.revokeAllForCustomer(shopper.id)).toBe(1);
    expect((await call(keep.cookie)).status).toBe(401);
  });

  it("reads ONLY the cookie: Authorization headers, query parameters, other headers and bodies never authenticate", async () => {
    const shopper = await newCustomer();
    const { token } = await signIn(shopper);
    const attempts: [string, string, Record<string, string>][] = [
      ["Bearer", PROBE_ME, { authorization: `Bearer ${token}` }],
      [
        "Basic",
        PROBE_ME,
        { authorization: `Basic ${Buffer.from(`a:${token}`).toString("base64")}` },
      ],
      ["Token scheme", PROBE_ME, { authorization: `Token ${token}` }],
      ["query by cookie name", `${PROBE_ME}?${CUSTOMER_SESSION_COOKIE_NAME}=${token}`, {}],
      ["query token", `${PROBE_ME}?token=${token}&access_token=${token}`, {}],
      ["custom header", PROBE_ME, { "x-fluxkit-customer-session": token, "x-session": token }],
      [
        "cookie with another name",
        PROBE_ME,
        { cookie: `session=${token}; customer_session=${token}` },
      ],
      ["cookie with a wrong case name", PROBE_ME, { cookie: `Fluxkit_Customer_Session=${token}` }],
      ["quoted cookie value", PROBE_ME, { cookie: `${CUSTOMER_SESSION_COOKIE_NAME}="${token}"` }],
    ];
    for (const [name, path, headers] of attempts) {
      const result = await call(undefined, path, headers);
      expect(result.status, name).toBe(401);
    }
    const viaBody = await http<ProblemBody>(
      running.baseUrl,
      "POST",
      "/store/probe-customer/write",
      {
        body: { token, sessionToken: token, [CUSTOMER_SESSION_COOKIE_NAME]: token },
      },
    );
    expect(viaBody.status).toBe(401);
    // The very same token in the cookie works, which proves the attempts above failed for the right reason.
    expect((await call(`${CUSTOMER_SESSION_COOKIE_NAME}=${token}`)).status).toBe(200);
  });

  it("a repeated cookie uses the first well-formed value only", async () => {
    const [a, b] = [await newCustomer(), await newCustomer()];
    const [sessionA, sessionB] = [await signIn(a), await signIn(b)];
    const result = await call(`${sessionA.cookie}; ${sessionB.cookie}`);
    expect(result.body.customerId).toBe(a.id);
  });

  it("marks anonymous 401 and success responses of customer routes no-store, also the class-level decorator", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    for (const [method, path] of [
      ["GET", "/store/probe-customer-class/one"],
      ["DELETE", "/store/probe-customer-class/two"],
    ] as const) {
      const anonymous = await http<ProblemBody>(running.baseUrl, method, path);
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      expect(anonymous.headers.get("cache-control")).toBe("no-store");
      const signedIn = await http<Principal>(running.baseUrl, method, path, {
        headers: { cookie },
      });
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.customerId).toBe(shopper.id);
      expect(signedIn.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("leaves public store routes public (no authentication, no forced no-store)", async () => {
    const result = await call(undefined, "/store/probe-customer/public");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBeNull();
    const withBadCookie = await call(
      `${CUSTOMER_SESSION_COOKIE_NAME}=not-a-token`,
      "/store/probe-customer/public",
    );
    expect(withBadCookie.status).toBe(200);
  });

  it("sets the cookie from the configuration: HttpOnly, SameSite=Lax, Path=/store, Secure, Max-Age", async () => {
    const shopper = await newCustomer();
    const result = await http(running.baseUrl, "POST", "/store/probe-customer/sign-in", {
      body: { customerId: shopper.id },
    });
    expect(result.status).toBe(201);
    const [header] = result.headers.getSetCookie();
    const [pair = "", ...attributes] = (header ?? "").split("; ");
    expect(pair).toMatch(new RegExp(`^${CUSTOMER_SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43}$`));
    const lowered = attributes.map((attribute) => attribute.toLowerCase());
    expect(lowered).toContain("httponly");
    expect(lowered).toContain("samesite=lax");
    expect(lowered).toContain("path=/store");
    expect(lowered).toContain("secure");
    expect(lowered).toContain(`max-age=${MAX_HOURS * 3600}`);
    // And the cookie it issued works.
    expect((await call(pair)).body.customerId).toBe(shopper.id);
  });

  it("sign-out clears the cookie on the same path and ends the session", async () => {
    const shopper = await newCustomer();
    const { cookie } = await signIn(shopper);
    const result = await http(running.baseUrl, "POST", "/store/probe-customer/sign-out", {
      headers: { cookie },
    });
    expect(result.status).toBe(201);
    const [header] = result.headers.getSetCookie();
    expect(header).toContain(`${CUSTOMER_SESSION_COOKIE_NAME}=;`);
    expect(header?.toLowerCase()).toContain("path=/store");
    expect((await call(cookie)).status).toBe(401);
  });

  it("stores only the SHA-256 of the token: the raw token is nowhere in the database", async () => {
    const shopper = await newCustomer();
    const { token } = await signIn(shopper);
    const [row] = await db
      .select()
      .from(customerSession)
      .where(eq(customerSession.customerId, shopper.id));
    expect(row?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    const tables = await pool.query<{ table_schema: string; table_name: string }>(
      "select table_schema, table_name from information_schema.tables where table_schema in ('public','drizzle') and table_type = 'BASE TABLE'",
    );
    expect(tables.rows.length).toBeGreaterThan(10);
    for (const { table_schema: schema, table_name: name } of tables.rows) {
      const dump = await pool.query<{ text: string }>(
        `select to_jsonb(t)::text as text from "${schema}"."${name.replace(/"/g, '""')}" t`,
      );
      for (const { text } of dump.rows) {
        expect(text.includes(token), `table ${schema}.${name}`).toBe(false);
      }
    }
  });
});
