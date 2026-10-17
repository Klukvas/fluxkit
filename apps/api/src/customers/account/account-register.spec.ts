import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { customer, customerSession } from "../../database/schema/index.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerCookieOf, customerSetCookieOf } from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

const PASSWORD = "correct horse battery staple";
const MAX_HOURS = 24;

interface RegisterResponse {
  customer: Record<string, unknown>;
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: `register-${Math.random().toString(36).slice(2)}@example.test`,
    password: PASSWORD,
    firstName: "Olena",
    lastName: "Kovalenko",
    ...overrides,
  };
}

describe("POST /store/account/register", () => {
  const clock = new FakeClock("2030-04-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const toDelete: string[] = [];

  const register = (payload: unknown, headers: Record<string, string> = {}) =>
    http<RegisterResponse & ProblemBody>(running.baseUrl, "POST", "/store/account/register", {
      body: payload,
      headers,
    });

  async function rowByEmail(email: string) {
    const [row] = await db.select().from(customer).where(eq(customer.email, email));
    return row;
  }

  /** Registers and remembers the id for cleanup. */
  async function registered(
    payload: Record<string, unknown>,
  ): Promise<HttpResult<RegisterResponse>> {
    const result = await http<RegisterResponse>(
      running.baseUrl,
      "POST",
      "/store/account/register",
      { body: payload },
    );
    const id = result.body?.customer?.["id"];
    if (typeof id === "string") {
      toDelete.push(id);
    }
    return result;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({
      adminAuthenticator: "production-default",
      clock,
      customerSessionMaxHours: MAX_HOURS,
    });
    db = running.app.get<Database>(DRIZZLE);
  });

  afterEach(async () => {
    await deleteTestCustomers(db, toDelete.splice(0));
    // A new rate-limit window for the next test (the limiter shares the injected clock).
    clock.advanceMinutes(61);
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("creates the account, signs the customer in and answers 201 with only the public customer", async () => {
    const payload = body({
      email: "  Olena.Register@Example.TEST ",
      firstName: "  Olena ",
      phone: "+380 (50) 123-45-67",
    });
    const result = await registered(payload);
    expect(result.status).toBe(201);
    expect(Object.keys(result.body)).toEqual(["customer"]);
    expect(Object.keys(result.body.customer).sort()).toEqual(
      ["createdAt", "email", "firstName", "id", "lastName", "phone"].sort(),
    );
    expect(result.body.customer).toMatchObject({
      email: "olena.register@example.test",
      firstName: "Olena",
      lastName: "Kovalenko",
      phone: "+380501234567",
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("content-type")).toContain("application/json");

    const row = await rowByEmail("olena.register@example.test");
    expect(row?.id).toBe(result.body.customer["id"]);
    expect(row?.isActive).toBe(true);
    expect(row?.failedLoginCount).toBe(0);
    expect(row?.lockedUntil).toBeNull();
    expect(row?.emailVerifiedAt).toBeNull();
    // Same scrypt format as admin users, with the parameters of the app under test.
    expect(row?.passwordHash).toMatch(/^scrypt\$16\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  it("issues a session cookie with the exact attributes and stores only the hash of its token", async () => {
    const result = await registered(body());
    const header = customerSetCookieOf(result);
    expect(header).toBeDefined();
    const [pair, ...attributes] = (header ?? "").split("; ");
    const token = (pair ?? "").replace("fluxkit_customer_session=", "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attributes).toContain("Path=/store");
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Secure");
    expect(attributes).toContain(`Max-Age=${MAX_HOURS * 3600}`);
    expect(attributes.some((attribute) => attribute.startsWith("Expires="))).toBe(true);

    const rows = await db
      .select()
      .from(customerSession)
      .where(eq(customerSession.customerId, String(result.body.customer["id"])));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(token);

    // The cookie works.
    const me = await http(running.baseUrl, "GET", "/store/account/me", {
      headers: { cookie: customerCookieOf(result) ?? "" },
    });
    expect(me.status).toBe(200);
  });

  it("stores phone as null when it is not sent", async () => {
    const result = await registered(body());
    expect(result.status).toBe(201);
    expect(result.body.customer["phone"]).toBeNull();
  });

  it("answers 409 conflict on email for a taken address, whatever its case or spacing, and creates nothing", async () => {
    const existing = await registered(body({ email: "taken@example.test" }));
    expect(existing.status).toBe(201);
    for (const email of ["taken@example.test", "TAKEN@Example.Test", "  taken@example.test  "]) {
      const result = await register(body({ email }));
      expect(result.status, email).toBe(409);
      expect(result.body).toMatchObject({
        code: "conflict",
        field: "email",
        constraint: "customer_email_key",
      });
      expect(customerSetCookieOf(result as HttpResult)).toBeUndefined();
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
    const rows = await db.select().from(customer).where(eq(customer.email, "taken@example.test"));
    expect(rows).toHaveLength(1);
    const sessions = await db
      .select()
      .from(customerSession)
      .where(eq(customerSession.customerId, rows[0]?.id ?? ""));
    expect(sessions).toHaveLength(1);
  });

  it("rejects a weak password with the core codes under `password`", async () => {
    const email = "weak-password@example.test";
    const cases: [string, string][] = [
      ["short", "too_short"],
      ["x".repeat(129), "too_long"],
      [email, "equals_email"],
      [`${PASSWORD}\u0000`, "contains_nul"],
    ];
    for (const [password, code] of cases) {
      const result = await register(body({ email, password }));
      expect(result.status, code).toBe(400);
      expect(result.body.code).toBe("validation_failed");
      expect(result.body.errors, code).toContainEqual(
        expect.objectContaining({ path: "password", code }),
      );
    }
    expect(await rowByEmail(email)).toBeUndefined();
  });

  it("rejects bad fields with one error per field and creates nothing", async () => {
    const before = await db.$count(customer);
    const cases: [string, Record<string, unknown>, string, string][] = [
      ["email format", { email: "not-an-email" }, "email", "invalid_format"],
      ["email empty", { email: "   " }, "email", "empty"],
      ["first name empty", { firstName: "  " }, "firstName", "empty"],
      ["last name too long", { lastName: "x".repeat(101) }, "lastName", "too_long"],
      ["name control character", { firstName: "Ol\u0007ena" }, "firstName", "invalid_characters"],
      ["phone letters", { phone: "call me" }, "phone", "invalid_format"],
      ["phone too short", { phone: "123" }, "phone", "too_short"],
      ["phone empty", { phone: "" }, "phone", "invalid_format"],
    ];
    for (const [name, overrides, path, code] of cases) {
      const result = await register(body(overrides));
      expect(result.status, name).toBe(400);
      expect(result.body.errors, name).toContainEqual(expect.objectContaining({ path, code }));
    }
    expect(await db.$count(customer)).toBe(before);
  });

  it("is strict about the body: unknown fields, wrong types, missing fields and oversized text are 400", async () => {
    const before = await db.$count(customer);
    const cases: [string, unknown, string, string][] = [
      ["isActive", body({ isActive: true }), "isActive", "unknown_field"],
      ["id", body({ id: "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f" }), "id", "unknown_field"],
      ["passwordHash", body({ passwordHash: "x" }), "passwordHash", "unknown_field"],
      ["number password", body({ password: 12345678901234 }), "password", "invalid_type"],
      ["null name", body({ firstName: null }), "firstName", "invalid_type"],
      ["missing email", { password: PASSWORD, firstName: "A", lastName: "B" }, "email", "required"],
      ["huge email", body({ email: "a".repeat(1025) }), "email", "too_big"],
      ["huge password", body({ password: "a".repeat(1025) }), "password", "too_big"],
    ];
    for (const [name, payload, path, code] of cases) {
      const result = await register(payload);
      expect(result.status, name).toBe(400);
      expect(result.body.errors, name).toContainEqual(expect.objectContaining({ path, code }));
    }
    for (const payload of [[], "text", 5, null]) {
      expect((await register(payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect(await db.$count(customer)).toBe(before);
  });

  it("needs the CSRF header and a JSON content type", async () => {
    const payload = body();
    const noHeader = await http<ProblemBody>(running.baseUrl, "POST", "/store/account/register", {
      body: payload,
      csrf: false,
    });
    expect(noHeader.status).toBe(403);
    const wrongType = await http<ProblemBody>(running.baseUrl, "POST", "/store/account/register", {
      body: payload,
      contentType: "text/plain",
    });
    expect(wrongType.status).toBe(403);
    expect(await rowByEmail(String(payload["email"]))).toBeUndefined();
    expect(noHeader.headers.get("cache-control")).toBe("no-store");
  });

  it("marks even a body-parser failure (413 for an oversized body) no-store, like every response under /store/account", async () => {
    const result = await http<ProblemBody>(running.baseUrl, "POST", "/store/account/register", {
      rawBody: JSON.stringify({ email: "a".repeat(300_000) }),
    });
    expect(result.status).toBe(413);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("limits registrations per address: the 11th in an hour is 429 with Retry-After, before any validation or hashing", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await registered(body());
      expect(result.status, `attempt ${attempt + 1}`).toBe(201);
    }
    // An invalid body proves the limit runs before validation: it is 429, not 400.
    const limited = await register({});
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: "too_many_requests" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(customerSetCookieOf(limited as HttpResult)).toBeUndefined();

    clock.advanceMinutes(61);
    const again = await registered(body());
    expect(again.status).toBe(201);
  });

  it("never leaks the hash, lockout state, internal flags or any other customer's data", async () => {
    const other: TestCustomer = await createTestCustomer(db, { password: PASSWORD });
    toDelete.push(other.id);
    const result = await registered(body({ phone: "0501234567" }));
    const wire = JSON.stringify(result.body) + JSON.stringify([...result.headers]);
    for (const forbidden of [
      "scrypt",
      "passwordHash",
      "password_hash",
      "failedLoginCount",
      "lockedUntil",
      "isActive",
      "emailVerifiedAt",
      "passwordChangedAt",
      "lastLoginAt",
      other.id,
      other.email,
      PASSWORD,
    ]) {
      expect(wire, forbidden).not.toContain(forbidden);
    }
  });

  it("replaces a session cookie the request already carried: the old session ends and a NEW token is issued", async () => {
    const first = await registered(body());
    const oldCookie = customerCookieOf(first) ?? "";

    const third = await http<RegisterResponse>(running.baseUrl, "POST", "/store/account/register", {
      body: body(),
      headers: { cookie: oldCookie },
    });
    toDelete.push(String(third.body.customer["id"]));
    expect(third.status).toBe(201);
    const newCookie = customerCookieOf(third);
    expect(newCookie).toBeDefined();
    expect(newCookie).not.toBe(oldCookie);
    const stale = await http(running.baseUrl, "GET", "/store/account/me", {
      headers: { cookie: oldCookie },
    });
    expect(stale.status).toBe(401);
    const fresh = await http<RegisterResponse>(running.baseUrl, "GET", "/store/account/me", {
      headers: { cookie: newCookie ?? "" },
    });
    expect(fresh.body.customer["id"]).toBe(third.body.customer["id"]);
  });
});
